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
  // Strip shell backslash escapes (e.g., \! → !) that some environments inject
  const text = textParts.join(' ').replace(/\\([!$`"\\])/g, '$1');
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

async function cliStart(): Promise<void> {
  const annotationId = args[1];
  if (!annotationId) {
    console.error('Usage: md-annotate start <annotation-id>');
    process.exit(1);
  }

  const session = process.env.ITERM_SESSION_ID;
  if (!session) {
    console.error('Error: $ITERM_SESSION_ID is not set');
    process.exit(1);
  }

  const url = `http://localhost:${PORT}/api/start?session=${encodeURIComponent(session)}`;
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

  console.log(`${annotationId} — working`);
}

async function cliEnd(): Promise<void> {
  const annotationId = args[1];
  if (!annotationId) {
    console.error('Usage: md-annotate end <annotation-id>');
    process.exit(1);
  }

  const session = process.env.ITERM_SESSION_ID;
  if (!session) {
    console.error('Error: $ITERM_SESSION_ID is not set');
    process.exit(1);
  }

  const url = `http://localhost:${PORT}/api/end?session=${encodeURIComponent(session)}`;
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

  console.log(`${annotationId} — stopped working`);
}

async function cliNext(): Promise<void> {
  const session = process.env.ITERM_SESSION_ID;
  if (!session) {
    console.error('Error: $ITERM_SESSION_ID is not set');
    process.exit(1);
  }

  const url = `http://localhost:${PORT}/api/next?session=${encodeURIComponent(session)}`;
  const res = await fetch(url, { method: 'POST' });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    console.error(`Error: ${(err as { error: string }).error}`);
    process.exit(1);
  }

  const data = (await res.json()) as {
    filePath: string;
    annotation: {
      id: string;
      selectedText: string;
      startOffset: number;
      endOffset: number;
      comments: Array<{ author: string; text: string; createdAt: string }>;
      createdAt: string;
    } | null;
    remaining: number;
  };

  if (!data.annotation) {
    console.log('No pending annotations.');
    return;
  }

  const a = data.annotation;
  const sep = '─'.repeat(60);

  console.log(sep);
  console.log(`File: ${data.filePath}`);
  console.log(`ID: ${a.id}`);

  // Show context with XML tags around the exact selected text
  const content = fs.readFileSync(data.filePath, 'utf-8');
  const lines = content.split('\n');
  const beforeContent = content.slice(0, a.startOffset);
  const startLine = beforeContent.split('\n').length - 1;
  const selectedLines = a.selectedText.split('\n').length;
  const endLine = startLine + selectedLines - 1;
  const ctxStart = Math.max(0, startLine - 3);
  const ctxEnd = Math.min(lines.length - 1, endLine + 3);

  // Build context with <selected> tags injected at exact offsets
  const ctxLineStart = content.split('\n').slice(0, ctxStart).join('\n').length + (ctxStart > 0 ? 1 : 0);
  const selStart = a.startOffset - ctxLineStart;
  const selEnd = a.endOffset - ctxLineStart;
  const ctxText = lines.slice(ctxStart, ctxEnd + 1).join('\n');
  const tagged = ctxText.slice(0, selStart) + '<selected>' + ctxText.slice(selStart, selEnd) + '</selected>' + ctxText.slice(selEnd);
  console.log(sep);
  console.log(`Context (lines ${ctxStart + 1}-${ctxEnd + 1}):`);
  for (const line of tagged.split('\n')) {
    console.log(`    ${line}`);
  }
  console.log(sep);
  console.log(`Selected text: ${a.selectedText}`);
  console.log(sep);
  console.log(`Comments:`);
  for (const c of a.comments) {
    console.log(`  ${c.author}: ${c.text}`);
  }
  console.log(sep);
  console.log(`Remaining: ${data.remaining}`);
}

async function cliStatus(): Promise<void> {
  const session = process.env.ITERM_SESSION_ID;
  if (!session) {
    console.error('Error: $ITERM_SESSION_ID is not set');
    process.exit(1);
  }

  const url = `http://localhost:${PORT}/api/status?session=${encodeURIComponent(session)}`;
  const res = await fetch(url);

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    console.error(`Error: ${(err as { error: string }).error}`);
    process.exit(1);
  }

  const data = (await res.json()) as {
    filePaths: string[];
    annotations: Array<{
      id: string;
      selectedText: string;
      startOffset: number;
      endOffset: number;
      comments: Array<{ author: string; text: string; createdAt: string }>;
      working: boolean;
      createdAt: string;
    }>;
  };

  if (data.annotations.length === 0) {
    console.log('No pending annotations.');
    return;
  }

  console.log(`Files: ${data.filePaths.map((f) => f.split('/').pop()).join(', ')}`);
  console.log(`${data.annotations.length} pending annotation(s):\n`);
  for (const a of data.annotations) {
    const lastUserComment = [...a.comments].reverse().find((c) => c.author === 'user');
    const text = a.selectedText.length > 40
      ? a.selectedText.slice(0, 37) + '...'
      : a.selectedText;
    const ago = formatRelativeTime(lastUserComment?.createdAt || a.createdAt);
    const working = a.working ? ' [working]' : '';
    console.log(`  ${a.id}  "${text}"${working} (${ago})`);
  }
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

async function cliOpen(): Promise<void> {
  const fileArgs = args.slice(1);
  if (fileArgs.length === 0) {
    console.error('Usage: md-annotate open <file.md> [file2.md ...]');
    process.exit(1);
  }

  const filePaths: string[] = [];
  for (const fileArg of fileArgs) {
    const filePath = path.resolve(fileArg);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    if (!filePath.endsWith('.md')) {
      console.error(`File must be a .md file: ${filePath}`);
      process.exit(1);
    }
    filePaths.push(filePath);
  }

  const session = process.env.ITERM_SESSION_ID || '';

  for (const filePath of filePaths) {
    try {
      // Pre-initialize the file state and link the session immediately,
      // so CLI commands (next, reply, etc.) work right away without
      // waiting for the browser's WebSocket to connect.
      const qs = new URLSearchParams({ filePath });
      if (session) qs.set('session', session);
      await fetch(`http://localhost:${PORT}/api/file?${qs.toString()}`);
    } catch {
      console.error(`Error: daemon is not running on port ${PORT}. Start it with: md-annotate`);
      process.exit(1);
    }

    const params = new URLSearchParams({ file: filePath });
    if (session) params.set('session', session);
    const url = `http://localhost:${PORT}?${params.toString()}`;
    open(url);
    console.log(`Opened ${filePath}`);
  }
}

if (args[0] === 'open') {
  cliOpen().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (args[0] === 'reply') {
  cliReply().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (args[0] === 'resolve') {
  cliResolve().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (args[0] === 'start') {
  cliStart().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (args[0] === 'end') {
  cliEnd().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (args[0] === 'next') {
  cliNext().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (args[0] === 'status') {
  cliStatus().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else {

// --- Daemon / open-file mode ---

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: md-annotate [file.md] [options]

Subcommands:
  md-annotate open <file.md>                   Open a file in the browser
  md-annotate reply [--resolve] <id> "text"   Reply to an annotation
  md-annotate resolve <id>                     Resolve an annotation
  md-annotate next                              Get next pending annotation (marks working)
  md-annotate start <id>                       Mark annotation as being worked on
  md-annotate end <id>                         Clear working state
  md-annotate status                           Show pending annotation summary

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
