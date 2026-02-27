import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  Annotation,
  CreateAnnotationRequest,
  FileResponse,
  WsMessage,
} from '@shared/types.js';
import { api } from '../lib/api.js';

interface UseAnnotationsResult {
  annotations: Annotation[];
  fileData: FileResponse | null;
  claudeConnected: boolean;
  loading: boolean;
  createAnnotation: (req: CreateAnnotationRequest) => Promise<Annotation>;
  updateAnnotation: (id: string, status: 'open' | 'resolved') => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
  addComment: (annotationId: string, text: string) => Promise<void>;
  activeAnnotationId: string | null;
  setActiveAnnotationId: (id: string | null) => void;
}

export function useAnnotations(): UseAnnotationsResult {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [fileData, setFileData] = useState<FileResponse | null>(null);
  const [claudeConnected, setClaudeConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

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
  }, []);

  // WebSocket connection
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        switch (msg.type) {
          case 'file-changed':
            setFileData((prev) =>
              prev
                ? {
                    ...prev,
                    rawMarkdown: msg.rawMarkdown,
                    renderedHtml: msg.renderedHtml,
                  }
                : null
            );
            break;
          case 'annotations-changed':
            setAnnotations(msg.annotations);
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
  }, []);

  const createAnnotation = useCallback(
    async (req: CreateAnnotationRequest): Promise<Annotation> => {
      const annotation = await api.createAnnotation(req);
      setAnnotations((prev) => [...prev, annotation]);
      return annotation;
    },
    []
  );

  const updateAnnotation = useCallback(
    async (id: string, status: 'open' | 'resolved'): Promise<void> => {
      const updated = await api.updateAnnotation(id, { status });
      setAnnotations((prev) =>
        prev.map((a) => (a.id === id ? updated : a))
      );
    },
    []
  );

  const deleteAnnotation = useCallback(async (id: string): Promise<void> => {
    await api.deleteAnnotation(id);
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    setActiveAnnotationId((prev) => (prev === id ? null : prev));
  }, []);

  const addComment = useCallback(
    async (annotationId: string, text: string): Promise<void> => {
      await api.addComment(annotationId, { author: 'user', text });
      const anns = await api.getAnnotations();
      setAnnotations(anns);
    },
    []
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
    activeAnnotationId,
    setActiveAnnotationId,
  };
}
