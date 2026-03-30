import { Router } from 'express';
import fs from 'node:fs';
import type {
  CreateAnnotationRequest,
  AddCommentRequest,
  UpdateAnnotationRequest,
} from '../../shared/types.js';
import type { FileManager } from '../services/file-manager.js';
import { renderMarkdown } from '../services/markdown.js';
import { enrichHunks } from '../services/diff-enrich.js';

export function createApiRouter(fileManager: FileManager): Router {
  const router = Router();

  // All routes require filePath as a query param
  function getFilePath(req: { query: Record<string, unknown> }): string | null {
    const fp = req.query.filePath;
    return typeof fp === 'string' && fp.length > 0 ? fp : null;
  }

  // GET /api/file?filePath=...&session=...
  router.get('/file', (req, res) => {
    const filePath = getFilePath(req);
    if (!filePath) {
      res.status(400).json({ error: 'filePath query parameter is required' });
      return;
    }
    try {
      // Optionally link a session to this file (used by `md-annotate open`)
      const session = typeof req.query.session === 'string' ? req.query.session : null;
      if (session) {
        fileManager.addSession(filePath, session);
      }
      res.json(fileManager.getFileContent(filePath));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  // GET /api/versions?filePath=...
  router.get('/versions', (req, res) => {
    const filePath = getFilePath(req);
    if (!filePath) {
      res.status(400).json({ error: 'filePath query parameter is required' });
      return;
    }
    try {
      const content = fileManager.getFileContent(filePath);
      res.json({ versions: content.versions, lastEdited: content.lastEdited });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  // GET /api/version-diff?filePath=...&versionId=...
  // Returns cumulative diff: all changes from just before that version to now.
  router.get('/version-diff', (req, res) => {
    const filePath = getFilePath(req);
    const versionId = typeof req.query.versionId === 'string' ? req.query.versionId : null;
    if (!filePath || !versionId) {
      res.status(400).json({ error: 'filePath and versionId query parameters are required' });
      return;
    }
    try {
      const vh = fileManager.getVersionHistory(filePath);
      const content = fileManager.getFileContent(filePath);
      const hunks = vh.getCumulativeDiff(versionId, content.rawMarkdown);
      if (hunks === null) {
        res.status(404).json({ error: 'Version snapshot not found' });
        return;
      }
      res.json({ hunks: enrichHunks(hunks) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  // GET /api/version-preview?filePath=...&versionId=...
  // Returns the rendered document as it looked after a version was applied,
  // plus that version's diff hunks for overlay.
  router.get('/version-preview', (req, res) => {
    const filePath = getFilePath(req);
    const versionId = typeof req.query.versionId === 'string' ? req.query.versionId : null;
    if (!filePath || !versionId) {
      res.status(400).json({ error: 'filePath and versionId query parameters are required' });
      return;
    }
    try {
      const vh = fileManager.getVersionHistory(filePath);
      const content = fileManager.getFileContent(filePath);
      const afterContent = vh.getContentAfterVersion(versionId, content.rawMarkdown);
      if (afterContent === null) {
        res.status(404).json({ error: 'Version not found' });
        return;
      }
      const versions = vh.getVersions();
      const version = versions.find((v) => v.id === versionId);
      res.json({
        rawMarkdown: afterContent,
        renderedHtml: renderMarkdown(afterContent),
        hunks: enrichHunks(version?.hunks ?? []),
      });
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

  // Helper: get session from query, find annotation across all linked files
  function findAnnotationForSession(
    req: { query: Record<string, unknown>; body: unknown },
    res: import('express').Response
  ): { session: string; filePath: string; svc: ReturnType<typeof fileManager.getAnnotationService>; annotationId: string } | null {
    const session = typeof req.query.session === 'string' ? req.query.session : null;
    if (!session) {
      res.status(400).json({ error: 'session query parameter is required' });
      return null;
    }

    const { annotationId } = req.body as { annotationId: string };
    if (!annotationId) {
      res.status(400).json({ error: 'annotationId is required' });
      return null;
    }

    const found = fileManager.findAnnotation(session, annotationId);
    if (!found) {
      res.status(404).json({ error: 'Annotation not found in any file for this session' });
      return null;
    }

    return { session, ...found, annotationId };
  }

  // POST /api/reply?session=... — CLI: md-annotate reply <id> "text"
  router.post('/reply', (req, res) => {
    const { annotationId, text, resolve } = req.body as {
      annotationId: string;
      text: string;
      resolve?: boolean;
    };
    if (!annotationId || !text) {
      res.status(400).json({ error: 'annotationId and text are required' });
      return;
    }

    const ctx = findAnnotationForSession(req, res);
    if (!ctx) return;

    try {
      fileManager.ensureFresh(ctx.filePath);
      const comment = ctx.svc.addComment(annotationId, 'claude', text);
      if (!comment) {
        res.status(404).json({ error: 'Annotation not found' });
        return;
      }

      // Auto-clear working state when Claude replies
      ctx.svc.update(annotationId, {
        ...(resolve ? { status: 'resolved' as const } : {}),
        working: false,
      });

      fileManager.broadcastAnnotations(ctx.filePath);
      const annotation = ctx.svc.getById(annotationId);
      res.json({ annotationId, status: annotation?.status, comment });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/resolve?session=... — CLI: md-annotate resolve <id>
  router.post('/resolve', (req, res) => {
    const ctx = findAnnotationForSession(req, res);
    if (!ctx) return;

    try {
      fileManager.ensureFresh(ctx.filePath);
      const existing = ctx.svc.getById(ctx.annotationId);
      if (!existing) {
        res.status(404).json({ error: 'Annotation not found' });
        return;
      }

      const lastComment = existing.comments[existing.comments.length - 1];
      if (!lastComment || lastComment.author !== 'claude') {
        res.status(400).json({ error: 'Cannot resolve without replying first' });
        return;
      }

      ctx.svc.update(ctx.annotationId, { status: 'resolved' });
      fileManager.broadcastAnnotations(ctx.filePath);
      res.json({ annotationId: ctx.annotationId, status: 'resolved' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/start?session=... — CLI: md-annotate start <id>
  router.post('/start', (req, res) => {
    const ctx = findAnnotationForSession(req, res);
    if (!ctx) return;

    try {
      const annotation = ctx.svc.update(ctx.annotationId, { working: true });
      if (!annotation) {
        res.status(404).json({ error: 'Annotation not found' });
        return;
      }

      fileManager.broadcastAnnotations(ctx.filePath);
      res.json({ annotationId: ctx.annotationId, working: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/end?session=... — CLI: md-annotate end <id>
  router.post('/end', (req, res) => {
    const ctx = findAnnotationForSession(req, res);
    if (!ctx) return;

    try {
      const annotation = ctx.svc.update(ctx.annotationId, { working: false });
      if (!annotation) {
        res.status(404).json({ error: 'Annotation not found' });
        return;
      }

      fileManager.broadcastAnnotations(ctx.filePath);
      res.json({ annotationId: ctx.annotationId, working: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/next?session=... — CLI: md-annotate next
  // Returns the oldest pending annotation across all linked files.
  router.post('/next', (req, res) => {
    const session = typeof req.query.session === 'string' ? req.query.session : null;
    if (!session) {
      res.status(400).json({ error: 'session query parameter is required' });
      return;
    }

    const filePaths = fileManager.getFilesForSession(session);
    if (filePaths.length === 0) {
      res.status(404).json({ error: 'No files associated with this session' });
      return;
    }

    try {
      // Collect pending annotations across all files
      const allPending: Array<{ filePath: string; annotation: import('../../shared/types.js').Annotation }> = [];
      for (const fp of filePaths) {
        fileManager.ensureFresh(fp);
        const svc = fileManager.getAnnotationService(fp);
        for (const a of svc.getAll()) {
          if (a.status !== 'open') continue;
          if (a.working) continue;
          const last = a.comments[a.comments.length - 1];
          if (last && last.author === 'user') {
            allPending.push({ filePath: fp, annotation: a });
          }
        }
      }

      if (allPending.length === 0) {
        res.json({ filePath: filePaths[0], annotation: null, remaining: 0 });
        return;
      }

      // Oldest first
      allPending.sort((a, b) => new Date(a.annotation.createdAt).getTime() - new Date(b.annotation.createdAt).getTime());
      const next = allPending[0];

      const svc = fileManager.getAnnotationService(next.filePath);
      svc.update(next.annotation.id, { working: true });
      fileManager.broadcastAnnotations(next.filePath);

      const updated = svc.getById(next.annotation.id)!;
      res.json({ filePath: next.filePath, annotation: updated, remaining: allPending.length - 1 });
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

    const filePaths = fileManager.getFilesForSession(session);
    if (filePaths.length === 0) {
      res.status(404).json({ error: 'No files associated with this session' });
      return;
    }

    try {
      const allAnnotations: import('../../shared/types.js').Annotation[] = [];
      for (const fp of filePaths) {
        fileManager.ensureFresh(fp);
        const svc = fileManager.getAnnotationService(fp);
        for (const a of svc.getAll()) {
          if (a.status !== 'open') continue;
          const last = a.comments[a.comments.length - 1];
          if (last && last.author === 'user') {
            allAnnotations.push(a);
          }
        }
      }
      res.json({ filePaths, annotations: allAnnotations });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/remove-action?filePath=...
  // Removes a single action from an <!-- @actions: ... --> comment in the markdown file.
  // If it was the last action, removes the entire comment.
  router.post('/remove-action', (req, res) => {
    const filePath = getFilePath(req);
    if (!filePath) {
      res.status(400).json({ error: 'filePath query parameter is required' });
      return;
    }

    const { action, sourceStart, sourceEnd } = req.body as {
      action: string;
      sourceStart: number;
      sourceEnd: number;
    };
    if (!action || sourceStart == null || sourceEnd == null) {
      res.status(400).json({ error: 'action, sourceStart, and sourceEnd are required' });
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const block = content.slice(sourceStart, sourceEnd);

      // Find the @actions comment in this block
      const commentRe = /<!--\s*@actions:\s*(.+?)\s*-->/;
      const match = commentRe.exec(block);
      if (!match) {
        res.json({ modified: false });
        return;
      }

      const actions = match[1].split(',').map((a) => a.trim()).filter(Boolean);
      const remaining = actions.filter((a) => {
        const clean = a.replace(/^["']|["']$/g, '');
        return clean !== action;
      });

      let replacement: string;
      if (remaining.length === 0) {
        // Remove the entire comment and any leading whitespace before it
        replacement = block.replace(/\s*<!--\s*@actions:.*?-->/, '');
      } else {
        replacement = block.replace(commentRe, `<!-- @actions: ${remaining.join(', ')} -->`);
      }

      const newContent = content.slice(0, sourceStart) + replacement + content.slice(sourceEnd);
      fs.writeFileSync(filePath, newContent, 'utf-8');
      res.json({ modified: true });
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
