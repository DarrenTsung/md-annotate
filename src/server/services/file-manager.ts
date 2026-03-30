import fs from 'fs';
import { watch, type FSWatcher } from 'chokidar';
import type { WebSocket } from 'ws';

import { renderMarkdown } from './markdown.js';
import { AnnotationService } from './annotations.js';
import { ItermBridge } from './iterm-bridge.js';
import { VersionHistory } from './version-history.js';
import type { WsMessage, VersionEntry } from '../../shared/types.js';

/** Enrich removed hunks with rendered HTML for the diff overlay. */
function enrichVersionHunks(version: VersionEntry): VersionEntry {
  return {
    ...version,
    hunks: version.hunks.map((h) =>
      h.type === 'removed' ? { ...h, renderedValue: renderMarkdown(h.value) } : h
    ),
  };
}

interface FileState {
  rawMarkdown: string;
  renderedHtml: string;
  annotationService: AnnotationService;
  versionHistory: VersionHistory;
  mdWatcher: FSWatcher;
  sidecarWatcher: FSWatcher;
  /** True after an 'unlink' event, cleared on next 'add'. Used to
   *  distinguish actual delete+recreate from atomic writes (which also
   *  change the inode but don't fire unlink). */
  wasDeleted: boolean;
  /** iTerm session IDs associated with this file */
  sessions: Set<string>;
  /** WebSocket clients subscribed to this file */
  clients: Set<WebSocket>;
  /** Cleanup timeout — deferred teardown after last client disconnects */
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  lastSidecarContent: string;
  sidecarWriteTimeout: ReturnType<typeof setTimeout> | null;
}

const CLEANUP_DELAY_MS = 30_000;

export class FileManager {
  private files = new Map<string, FileState>();
  private itermBridge: ItermBridge;

  constructor() {
    this.itermBridge = new ItermBridge((ids) => {
      // Find which file owns these annotation IDs and broadcast
      for (const state of this.files.values()) {
        const all = state.annotationService.getAll();
        if (all.some((a) => ids.includes(a.id))) {
          state.annotationService.markSentToClaude(ids);
          this.broadcastToFile(state, {
            type: 'annotations-changed',
            filePath: state.annotationService.getSidecarPath().replace('.annotations.json', ''),
            annotations: state.annotationService.getAll(),
          });
          break;
        }
      }
    });
  }

  getItermBridge(): ItermBridge {
    return this.itermBridge;
  }

  /**
   * Get or lazily create per-file state (watchers, annotation service, caches).
   */
  getOrCreate(filePath: string): FileState {
    let state = this.files.get(filePath);
    if (state) {
      // Cancel any pending cleanup
      if (state.cleanupTimer) {
        clearTimeout(state.cleanupTimer);
        state.cleanupTimer = null;
      }
      return state;
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const rawMarkdown = fs.readFileSync(filePath, 'utf-8');
    const renderedHtml = renderMarkdown(rawMarkdown);
    const annotationService = new AnnotationService(filePath);
    const versionHistory = new VersionHistory(filePath);
    versionHistory.initBaseline(rawMarkdown);
    state = {
      rawMarkdown,
      renderedHtml,
      annotationService,
      versionHistory,
      mdWatcher: null!,
      sidecarWatcher: null!,
      wasDeleted: false,
      sessions: new Set(),
      clients: new Set(),
      cleanupTimer: null,
      lastSidecarContent: '',
      sidecarWriteTimeout: null,
    };

    // Watch the markdown file
    const mdWatcher = watch(filePath, {
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    // Track unlink events to distinguish delete+recreate from atomic writes.
    // Atomic writes (write temp + rename) change the inode but don't fire
    // unlink, so we only reset state when we see an actual unlink first.
    mdWatcher.on('unlink', () => {
      console.log(`[${filePath}] File deleted`);
      state!.wasDeleted = true;
    });

    const handleFileContent = (newContent: string) => {
      // Record version diff BEFORE updating state
      const version = state!.versionHistory.recordChange(state!.rawMarkdown, newContent);

      state!.rawMarkdown = newContent;
      state!.renderedHtml = renderMarkdown(state!.rawMarkdown);

      const { annotations, changed } = annotationService.reanchor(state!.rawMarkdown);

      this.broadcastToFile(state!, {
        type: 'file-changed',
        filePath,
        rawMarkdown: state!.rawMarkdown,
        renderedHtml: state!.renderedHtml,
      });
      if (version) {
        this.broadcastToFile(state!, {
          type: 'version-created',
          filePath,
          version: enrichVersionHunks(version),
          lastEdited: version.timestamp,
        });
      }
      if (changed) {
        this.broadcastToFile(state!, {
          type: 'annotations-changed',
          filePath,
          annotations,
        });
      }
    };

    mdWatcher.on('change', () => {
      console.log(`[${filePath}] Markdown changed, reloading...`);
      const newContent = fs.readFileSync(filePath, 'utf-8');
      handleFileContent(newContent);
    });

    // 'add' fires when the file reappears after an unlink (delete+recreate).
    mdWatcher.on('add', () => {
      if (!state!.wasDeleted) return;
      state!.wasDeleted = false;

      console.log(`[${filePath}] File recreated after deletion — resetting state`);
      const newContent = fs.readFileSync(filePath, 'utf-8');
      state!.rawMarkdown = newContent;
      state!.renderedHtml = renderMarkdown(newContent);
      state!.annotationService.clear();
      state!.versionHistory.initBaseline(newContent);
      state!.sessions.clear();
      this.broadcastToFile(state!, {
        type: 'file-changed',
        filePath,
        rawMarkdown: state!.rawMarkdown,
        renderedHtml: state!.renderedHtml,
      });
      this.broadcastToFile(state!, {
        type: 'annotations-changed',
        filePath,
        annotations: [],
      });
    });

    state.mdWatcher = mdWatcher;

    // Watch the sidecar file
    const sidecarPath = annotationService.getSidecarPath();
    const sidecarWatcher = watch(sidecarPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    });

    const onSidecarChange = () => {
      if (state!.sidecarWriteTimeout) clearTimeout(state!.sidecarWriteTimeout);
      state!.sidecarWriteTimeout = setTimeout(() => {
        try {
          const content = fs.readFileSync(sidecarPath, 'utf-8');
          if (content === state!.lastSidecarContent) return;
          state!.lastSidecarContent = content;
          console.log(`[${filePath}] Sidecar changed externally, pushing update...`);
          this.broadcastToFile(state!, {
            type: 'annotations-changed',
            filePath,
            annotations: annotationService.getAll(),
          });
        } catch {
          // File might be mid-write
        }
      }, 100);
    };

    sidecarWatcher.on('change', onSidecarChange);
    sidecarWatcher.on('add', () => {
      console.log(`[${filePath}] Sidecar created, pushing update...`);
      this.broadcastToFile(state!, {
        type: 'annotations-changed',
        filePath,
        annotations: annotationService.getAll(),
      });
    });

    state.sidecarWatcher = sidecarWatcher;

    this.files.set(filePath, state);
    console.log(`[FileManager] Initialized state for ${filePath}`);
    return state;
  }

  /**
   * Subscribe a WebSocket client to a file's updates.
   */
  subscribe(filePath: string, ws: WebSocket, session?: string): void {
    const state = this.getOrCreate(filePath);
    state.clients.add(ws);
    if (session) {
      // Detect if this session was previously on a different file
      let previousFile: string | null = null;
      for (const [otherPath, otherState] of this.files) {
        if (otherPath !== filePath && otherState.sessions.has(session)) {
          previousFile = otherPath;
          otherState.sessions.delete(session);
        }
      }
      state.sessions.add(session);

      // Notify the Claude session that the file changed
      if (previousFile) {
        const fileName = filePath.split('/').pop();
        this.itermBridge.sendNotification(
          session,
          `[md-annotate] Navigated to ${fileName} (${filePath})`
        );
      }
    }
  }

  /**
   * Unsubscribe a WebSocket client from all files.
   */
  unsubscribe(ws: WebSocket): void {
    for (const [filePath, state] of this.files) {
      state.clients.delete(ws);
      if (state.clients.size === 0) {
        // Schedule cleanup after delay
        if (!state.cleanupTimer) {
          state.cleanupTimer = setTimeout(() => {
            this.cleanup(filePath);
          }, CLEANUP_DELAY_MS);
        }
      }
    }
  }

  /**
   * Associate a session with a file (called from API routes).
   * A session can be linked to multiple files simultaneously.
   */
  addSession(filePath: string, session: string): void {
    const state = this.getOrCreate(filePath);
    state.sessions.add(session);
  }

  /**
   * Get the session IDs for a file.
   */
  getSessions(filePath: string): Set<string> {
    return this.files.get(filePath)?.sessions ?? new Set();
  }

  /**
   * Get file content (markdown + HTML + version history).
   */
  getFileContent(filePath: string): {
    rawMarkdown: string;
    renderedHtml: string;
    filePath: string;
    lastEdited: string | null;
    versions: import('../../shared/types.js').VersionEntry[];
  } {
    const state = this.getOrCreate(filePath);
    return {
      rawMarkdown: state.rawMarkdown,
      renderedHtml: state.renderedHtml,
      filePath,
      lastEdited: state.versionHistory.getLastEdited(),
      versions: state.versionHistory.getVersions(),
    };
  }

  /**
   * Reverse lookup: find which file a session is associated with.
   * Returns the first match (for backwards compat with single-file callers).
   */
  getFileForSession(session: string): string | null {
    for (const [filePath, state] of this.files) {
      if (state.sessions.has(session)) {
        return filePath;
      }
    }
    return null;
  }

  /**
   * Reverse lookup: find all files a session is associated with.
   */
  getFilesForSession(session: string): string[] {
    const files: string[] = [];
    for (const [filePath, state] of this.files) {
      if (state.sessions.has(session)) {
        files.push(filePath);
      }
    }
    return files;
  }

  /**
   * Find which file contains a given annotation ID across all files
   * linked to a session. Returns { filePath, svc } or null.
   */
  findAnnotation(session: string, annotationId: string): { filePath: string; svc: import('./annotations.js').AnnotationService } | null {
    for (const filePath of this.getFilesForSession(session)) {
      const svc = this.getAnnotationService(filePath);
      if (svc.getById(annotationId)) {
        return { filePath, svc };
      }
    }
    return null;
  }

  /**
   * Ensure the cached content matches the file on disk.
   * If the file has been edited since the last cache update (e.g. chokidar
   * hasn't fired yet due to stabilization delay), sync eagerly so that
   * annotation offsets are correct before being returned to callers.
   */
  ensureFresh(filePath: string): void {
    const state = this.files.get(filePath);
    if (!state) return;

    let currentContent: string;
    try {
      currentContent = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return;
    }

    if (currentContent === state.rawMarkdown) return;

    console.log(`[${filePath}] Eager sync: file changed before watcher fired`);
    const version = state.versionHistory.recordChange(state.rawMarkdown, currentContent);
    state.rawMarkdown = currentContent;
    state.renderedHtml = renderMarkdown(currentContent);

    const { annotations, changed } = state.annotationService.reanchor(currentContent);

    this.broadcastToFile(state, {
      type: 'file-changed',
      filePath,
      rawMarkdown: state.rawMarkdown,
      renderedHtml: state.renderedHtml,
    });
    if (version) {
      this.broadcastToFile(state, {
        type: 'version-created',
        filePath,
        version: enrichVersionHunks(version),
        lastEdited: version.timestamp,
      });
    }
    if (changed) {
      this.broadcastToFile(state, {
        type: 'annotations-changed',
        filePath,
        annotations,
      });
    }
  }

  /**
   * Get annotation service for a file.
   */
  getAnnotationService(filePath: string): AnnotationService {
    return this.getOrCreate(filePath).annotationService;
  }

  /**
   * Get version history service for a file.
   */
  getVersionHistory(filePath: string): VersionHistory {
    return this.getOrCreate(filePath).versionHistory;
  }

  /**
   * Broadcast annotations update for a file (used after external mutations).
   */
  broadcastAnnotations(filePath: string): void {
    const state = this.files.get(filePath);
    if (!state) return;
    this.broadcastToFile(state, {
      type: 'annotations-changed',
      filePath,
      annotations: state.annotationService.getAll(),
    });
  }

  private broadcastToFile(state: FileState, msg: WsMessage): void {
    const data = JSON.stringify(msg);
    for (const client of state.clients) {
      if (client.readyState === 1 /* WebSocket.OPEN */) {
        client.send(data);
      }
    }
  }

  private cleanup(filePath: string): void {
    const state = this.files.get(filePath);
    if (!state) return;
    if (state.clients.size > 0) return; // Clients reconnected

    console.log(`[FileManager] Cleaning up state for ${filePath}`);
    state.mdWatcher.close();
    state.sidecarWatcher.close();
    if (state.sidecarWriteTimeout) clearTimeout(state.sidecarWriteTimeout);
    this.files.delete(filePath);
  }

  /**
   * Shut down all file watchers and cleanup.
   */
  shutdown(): void {
    for (const [filePath, state] of this.files) {
      if (state.cleanupTimer) clearTimeout(state.cleanupTimer);
      state.mdWatcher.close();
      state.sidecarWatcher.close();
      if (state.sidecarWriteTimeout) clearTimeout(state.sidecarWriteTimeout);
    }
    this.files.clear();
  }
}
