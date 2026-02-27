import fs from 'fs';
import { watch, type FSWatcher } from 'chokidar';
import type { WebSocket } from 'ws';

import { renderMarkdown } from './markdown.js';
import { AnnotationService } from './annotations.js';
import { ItermBridge } from './iterm-bridge.js';
import type { WsMessage } from '../../shared/types.js';

interface FileState {
  rawMarkdown: string;
  renderedHtml: string;
  annotationService: AnnotationService;
  mdWatcher: FSWatcher;
  sidecarWatcher: FSWatcher;
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

    state = {
      rawMarkdown,
      renderedHtml,
      annotationService,
      mdWatcher: null!,
      sidecarWatcher: null!,
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

    mdWatcher.on('change', () => {
      console.log(`[${filePath}] Markdown changed, reloading...`);
      state!.rawMarkdown = fs.readFileSync(filePath, 'utf-8');
      state!.renderedHtml = renderMarkdown(state!.rawMarkdown);

      const { annotations, changed } = annotationService.reanchor(state!.rawMarkdown);

      this.broadcastToFile(state!, {
        type: 'file-changed',
        filePath,
        rawMarkdown: state!.rawMarkdown,
        renderedHtml: state!.renderedHtml,
      });
      if (changed) {
        this.broadcastToFile(state!, {
          type: 'annotations-changed',
          filePath,
          annotations,
        });
      }
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
      state.sessions.add(session);
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
   */
  addSession(filePath: string, session: string): void {
    const state = this.files.get(filePath);
    if (state) {
      state.sessions.add(session);
    }
  }

  /**
   * Get the session IDs for a file.
   */
  getSessions(filePath: string): Set<string> {
    return this.files.get(filePath)?.sessions ?? new Set();
  }

  /**
   * Get file content (markdown + HTML).
   */
  getFileContent(filePath: string): { rawMarkdown: string; renderedHtml: string; filePath: string } {
    const state = this.getOrCreate(filePath);
    return {
      rawMarkdown: state.rawMarkdown,
      renderedHtml: state.renderedHtml,
      filePath,
    };
  }

  /**
   * Get annotation service for a file.
   */
  getAnnotationService(filePath: string): AnnotationService {
    return this.getOrCreate(filePath).annotationService;
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
