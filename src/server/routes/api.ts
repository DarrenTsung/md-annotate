import { Router } from 'express';
import type {
  CreateAnnotationRequest,
  AddCommentRequest,
  UpdateAnnotationRequest,
} from '../../shared/types.js';
import type { FileManager } from '../services/file-manager.js';

export function createApiRouter(fileManager: FileManager): Router {
  const router = Router();

  // All routes require filePath as a query param
  function getFilePath(req: { query: Record<string, unknown> }): string | null {
    const fp = req.query.filePath;
    return typeof fp === 'string' && fp.length > 0 ? fp : null;
  }

  // GET /api/file?filePath=...
  router.get('/file', (req, res) => {
    const filePath = getFilePath(req);
    if (!filePath) {
      res.status(400).json({ error: 'filePath query parameter is required' });
      return;
    }
    try {
      res.json(fileManager.getFileContent(filePath));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  // GET /api/annotations?filePath=...
  router.get('/annotations', (req, res) => {
    const filePath = getFilePath(req);
    if (!filePath) {
      res.status(400).json({ error: 'filePath query parameter is required' });
      return;
    }
    try {
      const svc = fileManager.getAnnotationService(filePath);
      res.json(svc.getAll());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  // POST /api/annotations?filePath=...&session=...
  router.post('/annotations', (req, res) => {
    const filePath = getFilePath(req);
    if (!filePath) {
      res.status(400).json({ error: 'filePath query parameter is required' });
      return;
    }

    const body = req.body as CreateAnnotationRequest;
    if (!body.selectedText || !body.commentText) {
      res.status(400).json({ error: 'selectedText and commentText are required' });
      return;
    }

    try {
      const svc = fileManager.getAnnotationService(filePath);
      const annotation = svc.create(body);

      // Queue for sending to Claude — send to all sessions watching this file
      const session = typeof req.query.session === 'string' ? req.query.session : null;
      const sessions = fileManager.getSessions(filePath);
      if (session) {
        sessions.add(session);
        fileManager.addSession(filePath, session);
      }

      const bridge = fileManager.getItermBridge();
      for (const sid of sessions) {
        bridge.queueAnnotation(sid, annotation, filePath, svc.getSidecarPath());
      }

      res.status(201).json(annotation);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  // PUT /api/annotations/:id?filePath=...
  router.put('/annotations/:id', (req, res) => {
    const filePath = getFilePath(req);
    if (!filePath) {
      res.status(400).json({ error: 'filePath query parameter is required' });
      return;
    }

    try {
      const svc = fileManager.getAnnotationService(filePath);
      const body = req.body as UpdateAnnotationRequest;
      const annotation = svc.update(req.params.id, body);
      if (!annotation) {
        res.status(404).json({ error: 'Annotation not found' });
        return;
      }
      res.json(annotation);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  // DELETE /api/annotations/:id?filePath=...
  router.delete('/annotations/:id', (req, res) => {
    const filePath = getFilePath(req);
    if (!filePath) {
      res.status(400).json({ error: 'filePath query parameter is required' });
      return;
    }

    try {
      const svc = fileManager.getAnnotationService(filePath);
      const deleted = svc.delete(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Annotation not found' });
        return;
      }
      res.status(204).send();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  // POST /api/annotations/:id/comments?filePath=...
  router.post('/annotations/:id/comments', (req, res) => {
    const filePath = getFilePath(req);
    if (!filePath) {
      res.status(400).json({ error: 'filePath query parameter is required' });
      return;
    }

    const body = req.body as AddCommentRequest;
    if (!body.text || !body.author) {
      res.status(400).json({ error: 'author and text are required' });
      return;
    }

    try {
      const svc = fileManager.getAnnotationService(filePath);
      const comment = svc.addComment(req.params.id, body.author, body.text);
      if (!comment) {
        res.status(404).json({ error: 'Annotation not found' });
        return;
      }

      // If user reply, reopen if resolved and send to Claude
      if (body.author === 'user') {
        const annotation = svc.getById(req.params.id);
        if (annotation) {
          if (annotation.status === 'resolved') {
            svc.update(req.params.id, { status: 'open' });
          }
          const bridge = fileManager.getItermBridge();
          for (const sid of fileManager.getSessions(filePath)) {
            bridge.queueAnnotation(sid, annotation, filePath, svc.getSidecarPath());
          }
        }
      }

      res.status(201).json(comment);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  // POST /api/reply?session=... — CLI: md-annotate reply <id> "text"
  router.post('/reply', (req, res) => {
    const session = typeof req.query.session === 'string' ? req.query.session : null;
    if (!session) {
      res.status(400).json({ error: 'session query parameter is required' });
      return;
    }

    const filePath = fileManager.getFileForSession(session);
    if (!filePath) {
      res.status(404).json({ error: 'No file associated with this session' });
      return;
    }

    const { annotationId, text, resolve } = req.body as {
      annotationId: string;
      text: string;
      resolve?: boolean;
    };
    if (!annotationId || !text) {
      res.status(400).json({ error: 'annotationId and text are required' });
      return;
    }

    try {
      const svc = fileManager.getAnnotationService(filePath);
      const comment = svc.addComment(annotationId, 'claude', text);
      if (!comment) {
        res.status(404).json({ error: 'Annotation not found' });
        return;
      }

      // Auto-clear working state when Claude replies
      svc.update(annotationId, {
        ...(resolve ? { status: 'resolved' as const } : {}),
        working: false,
      });

      fileManager.broadcastAnnotations(filePath);
      const annotation = svc.getById(annotationId);
      res.json({ annotationId, status: annotation?.status, comment });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/resolve?session=... — CLI: md-annotate resolve <id>
  router.post('/resolve', (req, res) => {
    const session = typeof req.query.session === 'string' ? req.query.session : null;
    if (!session) {
      res.status(400).json({ error: 'session query parameter is required' });
      return;
    }

    const filePath = fileManager.getFileForSession(session);
    if (!filePath) {
      res.status(404).json({ error: 'No file associated with this session' });
      return;
    }

    const { annotationId } = req.body as { annotationId: string };
    if (!annotationId) {
      res.status(400).json({ error: 'annotationId is required' });
      return;
    }

    try {
      const svc = fileManager.getAnnotationService(filePath);
      const annotation = svc.update(annotationId, { status: 'resolved' });
      if (!annotation) {
        res.status(404).json({ error: 'Annotation not found' });
        return;
      }

      fileManager.broadcastAnnotations(filePath);
      res.json({ annotationId, status: 'resolved' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/start?session=... — CLI: md-annotate start <id>
  router.post('/start', (req, res) => {
    const session = typeof req.query.session === 'string' ? req.query.session : null;
    if (!session) {
      res.status(400).json({ error: 'session query parameter is required' });
      return;
    }

    const filePath = fileManager.getFileForSession(session);
    if (!filePath) {
      res.status(404).json({ error: 'No file associated with this session' });
      return;
    }

    const { annotationId } = req.body as { annotationId: string };
    if (!annotationId) {
      res.status(400).json({ error: 'annotationId is required' });
      return;
    }

    try {
      const svc = fileManager.getAnnotationService(filePath);
      const annotation = svc.update(annotationId, { working: true });
      if (!annotation) {
        res.status(404).json({ error: 'Annotation not found' });
        return;
      }

      fileManager.broadcastAnnotations(filePath);
      res.json({ annotationId, working: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/end?session=... — CLI: md-annotate end <id>
  router.post('/end', (req, res) => {
    const session = typeof req.query.session === 'string' ? req.query.session : null;
    if (!session) {
      res.status(400).json({ error: 'session query parameter is required' });
      return;
    }

    const filePath = fileManager.getFileForSession(session);
    if (!filePath) {
      res.status(404).json({ error: 'No file associated with this session' });
      return;
    }

    const { annotationId } = req.body as { annotationId: string };
    if (!annotationId) {
      res.status(400).json({ error: 'annotationId is required' });
      return;
    }

    try {
      const svc = fileManager.getAnnotationService(filePath);
      const annotation = svc.update(annotationId, { working: false });
      if (!annotation) {
        res.status(404).json({ error: 'Annotation not found' });
        return;
      }

      fileManager.broadcastAnnotations(filePath);
      res.json({ annotationId, working: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/next?session=... — CLI: md-annotate next
  // Returns the oldest pending annotation and marks it working.
  router.post('/next', (req, res) => {
    const session = typeof req.query.session === 'string' ? req.query.session : null;
    if (!session) {
      res.status(400).json({ error: 'session query parameter is required' });
      return;
    }

    const filePath = fileManager.getFileForSession(session);
    if (!filePath) {
      res.status(404).json({ error: 'No file associated with this session' });
      return;
    }

    try {
      const svc = fileManager.getAnnotationService(filePath);
      const pending = svc.getAll().filter((a) => {
        if (a.status !== 'open') return false;
        if (a.working) return false;
        // Pending if the last comment is from a user (needs Claude's response)
        const last = a.comments[a.comments.length - 1];
        return last && last.author === 'user';
      });

      if (pending.length === 0) {
        res.json({ filePath, annotation: null, remaining: 0 });
        return;
      }

      // Oldest first
      pending.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const next = pending[0];

      svc.update(next.id, { working: true });
      fileManager.broadcastAnnotations(filePath);

      // Re-read after update to get fresh data
      const updated = svc.getById(next.id)!;
      res.json({ filePath, annotation: updated, remaining: pending.length - 1 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/status?session=... — CLI: md-annotate status
  router.get('/status', (req, res) => {
    const session = typeof req.query.session === 'string' ? req.query.session : null;
    if (!session) {
      res.status(400).json({ error: 'session query parameter is required' });
      return;
    }

    const filePath = fileManager.getFileForSession(session);
    if (!filePath) {
      res.status(404).json({ error: 'No file associated with this session' });
      return;
    }

    try {
      const svc = fileManager.getAnnotationService(filePath);
      const annotations = svc.getAll().filter((a) => {
        if (a.status !== 'open') return false;
        // Pending if the last comment is from a user (needs Claude's response)
        const last = a.comments[a.comments.length - 1];
        return last && last.author === 'user';
      });
      res.json({ filePath, annotations });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/claude/status?session=...
  router.get('/claude/status', (req, res) => {
    const session = typeof req.query.session === 'string' ? req.query.session : null;
    const bridge = fileManager.getItermBridge();
    res.json({
      connected: session ? bridge.isSessionReachable(session) : false,
      session,
    });
  });

  return router;
}
