import { Router } from 'express';
import type {
  CreateAnnotationRequest,
  AddCommentRequest,
  UpdateAnnotationRequest,
} from '../../shared/types.js';
import type { AnnotationService } from '../services/annotations.js';
import type { ItermBridge } from '../services/iterm-bridge.js';

export function createApiRouter(
  annotationService: AnnotationService,
  itermBridge: ItermBridge,
  getFileContent: () => { rawMarkdown: string; renderedHtml: string; filePath: string }
): Router {
  const router = Router();

  // GET /api/file — raw markdown + rendered HTML
  router.get('/file', (_req, res) => {
    res.json(getFileContent());
  });

  // GET /api/annotations — all annotations
  router.get('/annotations', (_req, res) => {
    res.json(annotationService.getAll());
  });

  // POST /api/annotations — create annotation
  router.post('/annotations', (req, res) => {
    const body = req.body as CreateAnnotationRequest;
    if (!body.selectedText || !body.commentText) {
      res.status(400).json({ error: 'selectedText and commentText are required' });
      return;
    }

    const annotation = annotationService.create(body);

    // Queue for sending to Claude
    itermBridge.queueAnnotation(annotation);

    res.status(201).json(annotation);
  });

  // PUT /api/annotations/:id — update annotation
  router.put('/annotations/:id', (req, res) => {
    const body = req.body as UpdateAnnotationRequest;
    const annotation = annotationService.update(req.params.id, body);
    if (!annotation) {
      res.status(404).json({ error: 'Annotation not found' });
      return;
    }
    res.json(annotation);
  });

  // DELETE /api/annotations/:id — delete annotation
  router.delete('/annotations/:id', (req, res) => {
    const deleted = annotationService.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Annotation not found' });
      return;
    }
    res.status(204).send();
  });

  // POST /api/annotations/:id/comments — add reply
  router.post('/annotations/:id/comments', (req, res) => {
    const body = req.body as AddCommentRequest;
    if (!body.text || !body.author) {
      res.status(400).json({ error: 'author and text are required' });
      return;
    }

    const comment = annotationService.addComment(
      req.params.id,
      body.author,
      body.text
    );
    if (!comment) {
      res.status(404).json({ error: 'Annotation not found' });
      return;
    }

    // If this is a user reply, also send to Claude
    if (body.author === 'user') {
      const annotation = annotationService.getById(req.params.id);
      if (annotation) {
        itermBridge.queueAnnotation(annotation);
      }
    }

    res.status(201).json(comment);
  });

  // GET /api/claude/status — connection status
  router.get('/claude/status', (_req, res) => {
    res.json({
      connected: itermBridge.isConnected(),
      sessionId: process.env.ITERM_SESSION_ID || null,
    });
  });

  return router;
}
