import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  Annotation,
  CreateAnnotationRequest,
  FileResponse,
  WsMessage,
  VersionEntry,
  DiffHunk,
} from '@shared/types.js';
import { createApi } from '../lib/api.js';

interface UseAnnotationsOptions {
  filePath: string;
  session: string | null;
}

interface UseAnnotationsResult {
  annotations: Annotation[];
  fileData: FileResponse | null;
  claudeConnected: boolean;
  loading: boolean;
  createAnnotation: (req: CreateAnnotationRequest) => Promise<Annotation>;
  updateAnnotation: (id: string, status: 'open' | 'resolved') => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
  addComment: (annotationId: string, text: string) => Promise<void>;
  removeAction: (action: string, sourceStart: number, sourceEnd: number) => Promise<void>;
  activeAnnotationId: string | null;
  setActiveAnnotationId: (id: string | null) => void;
  versions: VersionEntry[];
  lastEdited: string | null;
  activeVersionId: string | null;
  setActiveVersionId: (id: string | null) => void;
  autoShowVersionId: string | null;
  shownDiffHunks: DiffHunk[] | null;
  versionPreview: { rawMarkdown: string; renderedHtml: string } | null;
}

export function useAnnotations({ filePath, session }: UseAnnotationsOptions): UseAnnotationsResult {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [fileData, setFileData] = useState<FileResponse | null>(null);
  const [claudeConnected, setClaudeConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [lastEdited, setLastEdited] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [autoShowVersionId, setAutoShowVersionId] = useState<string | null>(null);
  const [shownDiffHunks, setShownDiffHunks] = useState<DiffHunk[] | null>(null);
  const [versionPreview, setVersionPreview] = useState<{ rawMarkdown: string; renderedHtml: string } | null>(null);
  const previewCacheRef = useRef<Map<string, { rawMarkdown: string; renderedHtml: string; hunks: DiffHunk[] }>>(new Map());
  const autoShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoShowHunksRef = useRef<DiffHunk[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const api = useMemo(() => createApi(filePath, session), [filePath, session]);

  // Initial data fetch
  useEffect(() => {
    async function load() {
      try {
        const [file, anns, status] = await Promise.all([
          api.getFile(),
          api.getAnnotations(),
          api.getClaudeStatus(),
        ]);
        setFileData(file);
        setAnnotations(anns);
        setClaudeConnected(status.connected);
        setVersions(file.versions);
        setLastEdited(file.lastEdited);
      } catch (err) {
        console.error('Failed to load initial data:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [api]);

  // WebSocket connection — subscribe to the specific file
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Subscribe to this file's updates
      ws.send(JSON.stringify({
        type: 'subscribe',
        filePath,
        session: session || undefined,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        switch (msg.type) {
          case 'file-changed':
            if (msg.filePath === filePath) {
              setFileData((prev) =>
                prev
                  ? {
                      ...prev,
                      rawMarkdown: msg.rawMarkdown,
                      renderedHtml: msg.renderedHtml,
                    }
                  : null
              );
            }
            break;
          case 'annotations-changed':
            if (msg.filePath === filePath) {
              setAnnotations(msg.annotations);
            }
            break;
          case 'version-created':
            if (msg.filePath === filePath) {
              setVersions((prev) => [...prev, msg.version]);
              setLastEdited(msg.lastEdited);

              // Show overlay immediately, accumulating hunks across rapid edits.
              // Reset the 5s dismiss timer on each new version.
              autoShowHunksRef.current = [...autoShowHunksRef.current, ...msg.version.hunks];
              setAutoShowVersionId(msg.version.id);
              setShownDiffHunks([...autoShowHunksRef.current]);
              if (autoShowTimerRef.current) clearTimeout(autoShowTimerRef.current);
              autoShowTimerRef.current = setTimeout(() => {
                setAutoShowVersionId(null);
                setShownDiffHunks(null);
                autoShowHunksRef.current = [];
              }, 5000);
            }
            break;
          case 'connected':
            console.log('WebSocket connected');
            break;
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket closed, reconnecting in 2s...');
      setTimeout(() => {
        wsRef.current = null;
      }, 2000);
    };

    return () => {
      ws.close();
    };
  }, [filePath, session]);

  // Resolve the shown version's diff overlay and preview.
  // Auto-show: hunks are set directly by the WS handler (accumulated).
  // Hover: fetch preview from server to show historical state.
  const shownVersionId = activeVersionId ?? autoShowVersionId;
  useEffect(() => {
    if (!shownVersionId) {
      setVersionPreview(null);
      // Only clear hunks if not in auto-show (WS handler manages auto-show hunks)
      if (!autoShowVersionId) setShownDiffHunks(null);
      return;
    }

    // Auto-show: WS handler already set the accumulated hunks
    if (!activeVersionId && autoShowVersionId) {
      setVersionPreview(null);
      return;
    }

    // Hover: check if this is the latest version
    const isLatest = versions.length > 0 && versions[versions.length - 1].id === shownVersionId;
    if (isLatest) {
      const version = versions[versions.length - 1];
      setShownDiffHunks(version.hunks);
      setVersionPreview(null);
      return;
    }

    // Older version: fetch preview to show historical document state
    const cached = previewCacheRef.current.get(shownVersionId);
    if (cached) {
      setShownDiffHunks(cached.hunks);
      setVersionPreview({ rawMarkdown: cached.rawMarkdown, renderedHtml: cached.renderedHtml });
      return;
    }

    let cancelled = false;
    api.getVersionPreview(shownVersionId).then((preview) => {
      if (cancelled) return;
      previewCacheRef.current.set(shownVersionId, preview);
      setShownDiffHunks(preview.hunks);
      setVersionPreview({ rawMarkdown: preview.rawMarkdown, renderedHtml: preview.renderedHtml });
    }).catch((err) => {
      console.error('Failed to fetch version preview:', err);
      // Fall back to per-version hunks on current doc
      if (cancelled) return;
      const version = versions.find((v) => v.id === shownVersionId);
      if (version) setShownDiffHunks(version.hunks);
    });

    return () => { cancelled = true; };
  }, [shownVersionId, activeVersionId, autoShowVersionId, versions, api]);

  // Invalidate preview cache when versions change
  useEffect(() => {
    previewCacheRef.current.clear();
  }, [versions]);

  const createAnnotation = useCallback(
    async (req: CreateAnnotationRequest): Promise<Annotation> => {
      const annotation = await api.createAnnotation(req);
      setAnnotations((prev) => [...prev, annotation]);
      return annotation;
    },
    [api]
  );

  const updateAnnotation = useCallback(
    async (id: string, status: 'open' | 'resolved'): Promise<void> => {
      const updated = await api.updateAnnotation(id, { status });
      setAnnotations((prev) =>
        prev.map((a) => (a.id === id ? updated : a))
      );
    },
    [api]
  );

  const deleteAnnotation = useCallback(async (id: string): Promise<void> => {
    await api.deleteAnnotation(id);
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    setActiveAnnotationId((prev) => (prev === id ? null : prev));
  }, [api]);

  const addComment = useCallback(
    async (annotationId: string, text: string): Promise<void> => {
      await api.addComment(annotationId, { author: 'user', text });
      const anns = await api.getAnnotations();
      setAnnotations(anns);
    },
    [api]
  );

  const removeAction = useCallback(
    async (action: string, sourceStart: number, sourceEnd: number): Promise<void> => {
      await api.removeAction(action, sourceStart, sourceEnd);
    },
    [api]
  );

  return {
    annotations,
    fileData,
    claudeConnected,
    loading,
    createAnnotation,
    updateAnnotation,
    deleteAnnotation,
    addComment,
    removeAction,
    activeAnnotationId,
    setActiveAnnotationId,
    versions,
    lastEdited,
    activeVersionId,
    setActiveVersionId,
    autoShowVersionId,
    shownDiffHunks,
    versionPreview,
  };
}
