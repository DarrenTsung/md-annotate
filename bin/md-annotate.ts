#!/usr/bin/env tsx

import path from 'path';
import fs from 'fs';
import { startServer } from '../src/server/index.js';

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: md-annotate <file.md> [options]

Options:
  --port <port>    Server port (default: 3456)
  --no-open        Don't auto-open browser
  --help, -h       Show this help

Environment:
  ITERM_SESSION_ID   Inherited from terminal for Claude Code integration
`);
  process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

const filePath = path.resolve(args[0]);
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

if (!filePath.endsWith('.md')) {
  console.error(`File must be a .md file: ${filePath}`);
  process.exit(1);
}

const portIdx = args.indexOf('--port');
const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3456;
const noOpen = args.includes('--no-open');
const itermSessionId = process.env.ITERM_SESSION_ID || null;

if (itermSessionId) {
  console.log(`Claude Code integration: connected (session ${itermSessionId})`);
} else {
  console.log('Claude Code integration: not connected (no ITERM_SESSION_ID)');
}

startServer({ filePath, port, noOpen, itermSessionId });
