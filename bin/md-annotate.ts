#!/usr/bin/env tsx

import path from 'path';
import fs from 'fs';
import open from 'open';
import { startServer } from '../src/server/index.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: md-annotate [file.md] [options]

Modes:
  md-annotate              Start the daemon (no file required)
  md-annotate file.md      Start daemon and open file in browser

Options:
  --port <port>    Server port (default: 3456)
  --no-open        Don't auto-open browser
  --help, -h       Show this help
`);
  process.exit(0);
}

const portIdx = args.indexOf('--port');
const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3456;
const noOpen = args.includes('--no-open');

// Find file arg (first arg that isn't a flag or flag value)
const flagsWithValues = new Set(['--port']);
let fileArg: string | null = null;
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    if (flagsWithValues.has(args[i])) i++; // Skip next arg (the value)
    continue;
  }
  fileArg = args[i];
  break;
}

// Validate file arg if provided
let filePath: string | null = null;
if (fileArg) {
  filePath = path.resolve(fileArg);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  if (!filePath.endsWith('.md')) {
    console.error(`File must be a .md file: ${filePath}`);
    process.exit(1);
  }
}

// Start the daemon
startServer({ port, noOpen });

// If a file was specified, open the browser to it
if (filePath && !noOpen) {
  const session = process.env.ITERM_SESSION_ID || '';
  const params = new URLSearchParams({ file: filePath });
  if (session) params.set('session', session);
  const url = `http://localhost:${port}?${params.toString()}`;

  // Small delay to let server start
  setTimeout(() => open(url), 500);
}
