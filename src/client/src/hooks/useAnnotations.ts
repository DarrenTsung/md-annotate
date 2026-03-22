import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  Annotation,
  CreateAnnotationRequest,
  FileResponse,
  WsMessage,
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
}

export function useAnnotations({ filePath, session }: UseAnnotationsOptions): UseAnnotationsResult {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [fileData, setFileData] = useState<FileResponse | null>(null);
  const [claudeConnected, setClaudeConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
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
  };
}
