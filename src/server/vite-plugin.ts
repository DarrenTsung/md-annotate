import type { Plugin } from 'vite';
import type { Server } from 'http';
import express from 'express';
import { WebSocketServer } from 'ws';

import { FileManager } from './services/file-manager.js';
import { createApiRouter } from './routes/api.js';
import type { WsClientMessage } from '../shared/types.js';

export function mdAnnotatePlugin(): Plugin {
  let fileManager: FileManager;

  return {
    name: 'md-annotate',

    configureServer(server) {
      fileManager = new FileManager();

      // Express sub-app for API routes only
      const app = express();
      app.use(express.json());
      app.use('/api', createApiRouter(fileManager));

      // Only pass /api requests through Express — let everything else
      // fall through to Vite's middleware untouched.
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api/') || req.url === '/api') {
          app(req as any, res as any, next);
        } else {
          next();
        }
      });

      // Use noServer mode so we manually handle upgrades only for /ws,
      // avoiding any interference with Vite's HMR WebSocket.
      const wss = new WebSocketServer({ noServer: true });

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

      const httpServer = server.httpServer as Server;
      httpServer.on('upgrade', (req, socket, head) => {
        const { pathname } = new URL(req.url!, `http://${req.headers.host}`);
        if (pathname === '/ws') {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
          });
        }
        // Non-/ws upgrades fall through to Vite's HMR handler
      });

      // Graceful shutdown
      process.on('SIGINT', () => {
        console.log('\nShutting down...');
        fileManager.shutdown();
        wss.close();
        process.exit(0);
      });
    },
  };
}
