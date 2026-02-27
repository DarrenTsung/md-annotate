import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { watch } from 'chokidar';
import open from 'open';

import { renderMarkdown } from './services/markdown.js';
import { AnnotationService } from './services/annotations.js';
import { ItermBridge } from './services/iterm-bridge.js';
import { createApiRouter } from './routes/api.js';
import type { WsMessage } from '../shared/types.js';

interface ServerOptions {
  filePath: string;
  port: number;
  noOpen: boolean;
  itermSessionId: string | null;
}

export function startServer(options: ServerOptions): void {
  const { filePath, port, noOpen, itermSessionId } = options;

  // State
  let rawMarkdown = fs.readFileSync(filePath, 'utf-8');
  let renderedHtml = renderMarkdown(rawMarkdown);

  // Services
  const annotationService = new AnnotationService(filePath);
  const itermBridge = new ItermBridge(
    itermSessionId,
    filePath,
    annotationService.getSidecarPath(),
    (ids) => {
      annotationService.markSentToClaude(ids);
      broadcastAnnotations();
    }
  );

  // Express
  const app = express();
  const server = createServer(app);

  app.use(express.json());

  // Serve built client in production
  const clientDist = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../dist/client'
  );
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
  }

  // API routes
  app.use(
    '/api',
    createApiRouter(annotationService, itermBridge, () => ({
      rawMarkdown,
      renderedHtml,
      filePath,
    }))
  );

  // WebSocket
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    const msg: WsMessage = { type: 'connected' };
    ws.send(JSON.stringify(msg));
    ws.on('close', () => clients.delete(ws));
  });

  function broadcast(msg: WsMessage): void {
    const data = JSON.stringify(msg);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  function broadcastAnnotations(): void {
    broadcast({
      type: 'annotations-changed',
      annotations: annotationService.getAll(),
    });
  }

  // Watch the markdown file for external changes
  const mdWatcher = watch(filePath, {
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  mdWatcher.on('change', () => {
    console.log('Markdown file changed, reloading...');
    rawMarkdown = fs.readFileSync(filePath, 'utf-8');
    renderedHtml = renderMarkdown(rawMarkdown);

    // Re-anchor annotations
    const { annotations, changed } = annotationService.reanchor(rawMarkdown);

    broadcast({ type: 'file-changed', rawMarkdown, renderedHtml });
    if (changed) {
      broadcast({ type: 'annotations-changed', annotations });
    }
  });

  // Watch the sidecar file for external changes (e.g., Claude editing it)
  const sidecarPath = annotationService.getSidecarPath();
  let sidecarWriteTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastSidecarContent = '';

  const sidecarWatcher = watch(sidecarPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  });

  sidecarWatcher.on('change', () => {
    // Debounce to avoid reading partial writes
    if (sidecarWriteTimeout) clearTimeout(sidecarWriteTimeout);
    sidecarWriteTimeout = setTimeout(() => {
      try {
        const content = fs.readFileSync(sidecarPath, 'utf-8');
        if (content === lastSidecarContent) return;
        lastSidecarContent = content;
        console.log('Sidecar file changed externally, pushing update...');
        broadcastAnnotations();
      } catch {
        // File might be mid-write
      }
    }, 100);
  });

  sidecarWatcher.on('add', () => {
    console.log('Sidecar file created, pushing update...');
    broadcastAnnotations();
  });

  // Serve index.html for SPA routes (production only)
  if (fs.existsSync(clientDist)) {
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`md-annotate server running at ${url}`);
    console.log(`Watching: ${filePath}`);

    if (!noOpen) {
      open(url);
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    mdWatcher.close();
    sidecarWatcher.close();
    wss.close();
    server.close();
    process.exit(0);
  });
}
