#!/usr/bin/env tsx

import path from 'path';
import fs from 'fs';
import open from 'open';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const PORT = 3456;

// --- Subcommands: reply, resolve (lightweight CLI clients) ---

async function cliReply(): Promise<void> {
  const subArgs = args.slice(1); // after "reply"
  const resolve = subArgs.includes('--resolve');
  const positional = subArgs.filter((a) => a !== '--resolve');

  if (positional.length < 2) {
    console.error('Usage: md-annotate reply [--resolve] <annotation-id> "text"');
    process.exit(1);
  }

  const [annotationId, ...textParts] = positional;
  const text = textParts.join(' ');
  const session = process.env.ITERM_SESSION_ID;
  if (!session) {
    console.error('Error: $ITERM_SESSION_ID is not set');
    process.exit(1);
  }

  const url = `http://localhost:${PORT}/api/reply?session=${encodeURIComponent(session)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ annotationId, text, resolve }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    console.error(`Error: ${(err as { error: string }).error}`);
    process.exit(1);
  }

  const data = (await res.json()) as { annotationId: string; status: string };
  console.log(`${data.annotationId} — ${resolve ? 'replied + resolved' : 'replied'} (${data.status})`);
}

async function cliResolve(): Promise<void> {
  const annotationId = args[1];
  if (!annotationId) {
    console.error('Usage: md-annotate resolve <annotation-id>');
    process.exit(1);
  }

  const session = process.env.ITERM_SESSION_ID;
  if (!session) {
    console.error('Error: $ITERM_SESSION_ID is not set');
    process.exit(1);
  }

  const url = `http://localhost:${PORT}/api/resolve?session=${encodeURIComponent(session)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ annotationId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    console.error(`Error: ${(err as { error: string }).error}`);
    process.exit(1);
  }

  console.log(`${annotationId} — resolved`);
}

if (args[0] === 'reply') {
  cliReply().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (args[0] === 'resolve') {
  cliResolve().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else {

// --- Daemon / open-file mode ---

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: md-annotate [file.md] [options]

Subcommands:
  md-annotate reply [--resolve] <id> "text"   Reply to an annotation
  md-annotate resolve <id>                     Resolve an annotation

Daemon mode:
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

// Start the Vite dev server (with API + WS embedded via plugin)
const server = await createServer({
  configFile: path.resolve(import.meta.dirname, '../vite.config.ts'),
  server: { port },
});
await server.listen();

console.log(`md-annotate daemon running at http://localhost:${port}`);
console.log('Waiting for file connections...');

// If a file was specified, open the browser to it
if (filePath && !noOpen) {
  const session = process.env.ITERM_SESSION_ID || '';
  const params = new URLSearchParams({ file: filePath });
  if (session) params.set('session', session);
  const url = `http://localhost:${port}?${params.toString()}`;
  open(url);
}

} // end else (daemon mode)
