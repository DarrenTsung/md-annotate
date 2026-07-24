#!/usr/bin/env tsx

import path from 'path';
import fs from 'fs';
import { spawnSync } from 'node:child_process';
import open from 'open';
import { createServer } from 'vite';
import type { MermaidLabelTarget } from '../src/shared/types.js';

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

interface AnnotationBody {
  id: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  embedLabel?: string;
  mermaidLabel?: MermaidLabelTarget;
  comments: Array<{ author: string; text: string; kind?: 'comment' | 'question'; createdAt: string }>;
  createdAt: string;
}

// Prints the shared annotation body (file, context, selected text, comments)
// used by both `next` and `show`. Returns whether the latest user comment is a
// question, so callers can tailor the instructions block.
function printAnnotationBody(filePath: string, a: AnnotationBody): boolean {
  const sep = '─'.repeat(60);
  const lastUserComment = [...a.comments].reverse().find((c) => c.author === 'user');
  const isQuestion = lastUserComment?.kind === 'question';

  console.log(sep);
  console.log(`File: ${filePath}`);
  console.log(`ID: ${a.id}`);
  if (isQuestion) {
    console.log(`Kind: QUESTION — respond in the comment thread only. Do NOT edit the document.`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const startLine = content.slice(0, a.startOffset).split('\n').length;

  if (a.mermaidLabel) {
    const label = a.mermaidLabel.text.slice(
      a.mermaidLabel.selectionStart,
      a.mermaidLabel.selectionEnd
    );
    console.log(sep);
    console.log(`Target: Mermaid diagram text "${label}" (line ${startLine}).`);
    console.log(`  Open ${filePath} around line ${startLine} to read or edit the diagram source.`);
    console.log(sep);
  } else if (a.embedLabel) {
    // Embedded HTML widget: the user is commenting on the whole widget, not a
    // text selection. Don't dump the raw HTML — just point Claude at it.
    console.log(sep);
    console.log(`Target: embedded HTML widget "${a.embedLabel}" (line ${startLine}).`);
    console.log(`  Open ${filePath} around line ${startLine} to read/edit the widget's markup.`);
    console.log(sep);
  } else {
    // Show context with XML tags around the exact selected text
    const lines = content.split('\n');
    const selectedLines = a.selectedText.split('\n').length;
    const endLine = startLine - 1 + selectedLines - 1;
    const ctxStart = Math.max(0, startLine - 1 - 3);
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
    console.log(`Selected text:`);
    console.log(`    ${a.selectedText}`);
    console.log(sep);
  }
  console.log(`Comments:`);
  for (const c of a.comments) {
    const tag = c.author === 'user' && c.kind === 'question' ? ' [question]' : '';
    console.log(`  ${c.author}${tag}: ${c.text}`);
  }
  console.log(sep);
  return isQuestion;
}

// Prints the reply/resolve guidance block shared by `next` and `show`.
function printAnnotationInstructions(a: AnnotationBody, isQuestion: boolean): void {
  const sep = '─'.repeat(60);
  // Instruct the LLM to keep its full response inside `md-annotate reply` so
  // the user (who is reading in the md-annotate UI, not the terminal) sees it.
  // Terminal prose here is double-writing — keep it minimal.
  console.log(`Instructions:`);
  console.log(`  - Put your full response inside \`md-annotate reply ${a.id} "..."\`.`);
  console.log(`  - The user is reading in md-annotate, not this terminal. Do NOT repeat or summarize`);
  console.log(`    your reply as prose here — just run the reply command. Brief tool-prep notes are fine.`);
  if (isQuestion) {
    console.log(`  - This is a [question]. Reply only; do NOT edit the source document.`);
  } else {
    console.log(`  - If you edit the document to address the comment, mention what you changed in the reply.`);
  }
  console.log(`  - Use --resolve when the comment is fully addressed: \`md-annotate reply --resolve ${a.id} "..."\`.`);
  console.log(sep);
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
    annotation: AnnotationBody | null;
    remaining: number;
  };

  if (!data.annotation) {
    console.log('No pending annotations.');
    return;
  }

  const isQuestion = printAnnotationBody(data.filePath, data.annotation);
  printAnnotationInstructions(data.annotation, isQuestion);
  console.log(`Remaining: ${data.remaining}`);
}

async function cliShow(): Promise<void> {
  const annotationId = args[1];
  if (!annotationId) {
    console.error('Usage: md-annotate show <annotation-id>');
    process.exit(1);
  }

  const session = process.env.ITERM_SESSION_ID;
  if (!session) {
    console.error('Error: $ITERM_SESSION_ID is not set');
    process.exit(1);
  }

  const url = `http://localhost:${PORT}/api/show?session=${encodeURIComponent(session)}&annotationId=${encodeURIComponent(annotationId)}`;
  const res = await fetch(url);

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    console.error(`Error: ${(err as { error: string }).error}`);
    process.exit(1);
  }

  const data = (await res.json()) as { filePath: string; annotation: AnnotationBody };
  const isQuestion = printAnnotationBody(data.filePath, data.annotation);
  printAnnotationInstructions(data.annotation, isQuestion);
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
      embedLabel?: string;
      mermaidLabel?: MermaidLabelTarget;
      comments: Array<{ author: string; text: string; kind?: 'comment' | 'question'; createdAt: string }>;
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
    const text = a.mermaidLabel
      ? `◇ diagram: ${a.mermaidLabel.text.slice(
          a.mermaidLabel.selectionStart,
          a.mermaidLabel.selectionEnd
        )}`
      : a.embedLabel
      ? `🧩 widget: ${a.embedLabel}`
      : a.selectedText.length > 40
      ? a.selectedText.slice(0, 37) + '...'
      : a.selectedText;
    const ago = formatRelativeTime(lastUserComment?.createdAt || a.createdAt);
    const working = a.working ? ' [working]' : '';
    const kindTag = lastUserComment?.kind === 'question' ? ' [question]' : '';
    console.log(`  ${a.id}  "${text}"${kindTag}${working} (${ago})`);
  }
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function cliDaemon(): void {
  const script = path.resolve(import.meta.dirname, '../scripts/launch-agent.sh');
  const result = spawnSync(script, args.slice(1), { stdio: 'inherit' });
  if (result.error) {
    console.error(`Error: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
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
    let res: Response;
    try {
      // Pre-initialize the file state and link the session immediately,
      // so CLI commands (next, reply, etc.) work right away without
      // waiting for the browser's WebSocket to connect.
      const qs = new URLSearchParams({ filePath });
      if (session) qs.set('session', session);
      res = await fetch(`http://localhost:${PORT}/api/file?${qs.toString()}`);
    } catch {
      console.error(
        `Error: daemon is not running on port ${PORT}. ` +
          'Run: md-annotate daemon restart (or daemon install if it is not installed)'
      );
      process.exit(1);
    }
    if (!res.ok) {
      // Some other service is on this port, or the daemon is unhealthy.
      console.error(
        `Error: daemon is not running on port ${PORT} (got HTTP ${res.status}). ` +
          'Run: md-annotate daemon restart (or daemon install if it is not installed)'
      );
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
} else if (args[0] === 'show') {
  cliShow().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (args[0] === 'daemon') {
  cliDaemon();
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
  md-annotate show <id>                        Reprint an annotation's full body (read-only)
  md-annotate start <id>                       Mark annotation as being worked on
  md-annotate end <id>                         Clear working state
  md-annotate status                           Show pending annotation summary
  md-annotate daemon <action>                  Manage the auto-restarting LaunchAgent

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
  // logLevel 'warn': suppress Vite's info-level dev-server chatter ("vite ready",
  // HMR updates, "optimized dependencies") that otherwise interleaves with the CLI
  // subcommands' stdout — you'd have to grep it out downstream, which risks eating
  // real content lines. Warnings + errors still surface.
  logLevel: 'warn',
  // strictPort: refuse to start if `port` is already in use, instead of silently
  // falling back to a random port (which would make the CLI subcommands talk to
  // the wrong server).
  server: { port, strictPort: true },
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
