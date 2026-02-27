import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';

import { FileManager } from './services/file-manager.js';
import { createApiRouter } from './routes/api.js';
import type { WsClientMessage } from '../shared/types.js';

interface ServerOptions {
  port: number;
  noOpen: boolean;
}

export function startServer(options: ServerOptions): void {
  const { port, noOpen } = options;

  const fileManager = new FileManager();

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
  app.use('/api', createApiRouter(fileManager));

  // WebSocket — clients subscribe to specific files
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected' }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as WsClientMessage;
        if (msg.type === 'subscribe' && msg.filePath) {
          fileManager.subscribe(msg.filePath, ws, msg.session);
          console.log(
            `[WS] Client subscribed to ${msg.filePath}` +
              (msg.session ? ` (session ${msg.session.slice(0, 16)}...)` : '')
          );
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      fileManager.unsubscribe(ws);
    });
  });

  // Serve index.html for SPA routes (production only)
  if (fs.existsSync(clientDist)) {
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`md-annotate daemon running at ${url}`);
    console.log('Waiting for file connections...');
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    fileManager.shutdown();
    wss.close();
    server.close();
    process.exit(0);
  });
}
