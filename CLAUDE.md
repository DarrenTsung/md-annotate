# md-annotate

Google Docs-style inline annotation tool for markdown files with Claude Code integration via iTerm AppleScript.

## Architecture

- **Daemon**: A single Vite dev server on port 3456 with Express API + WebSocket embedded via a Vite plugin. Start with `md-annotate` (no args). Per-file state (watchers, annotations, markdown cache) is created lazily when a client connects.
- **URL-driven routing**: Clients open `http://localhost:3456?file=/path/to/file.md&session=ITERM_SESSION_ID`. The server associates the iTerm session with that file for annotation routing.
- **FileManager**: Central service managing `Map<filePath, FileState>`. Each `FileState` holds markdown/HTML caches, `AnnotationService`, chokidar watchers, connected WebSocket clients, and associated iTerm sessions. Cleans up after last client disconnects.
- **Client**: React + Vite (served from the same port 3456). Reads `file` and `session` from URL search params. Text selection → source offset mapping → annotation creation. Highlights via `<mark>` injection. Comment sidebar with threads.
- **Claude integration**: When annotations are created, they're sent to all iTerm sessions watching that file via AppleScript (per-session debounce queues). Claude responds via CLI subcommands (`md-annotate reply`, `md-annotate resolve`) that call the daemon API; the server handles JSON bookkeeping and broadcasts updates to browser clients via WebSocket.

## Key files

- `bin/md-annotate.ts` — CLI entry point (daemon mode, `open`/`reply`/`resolve` subcommands)
- `src/server/vite-plugin.ts` — Vite plugin embedding Express API + WebSocket
- `src/server/services/file-manager.ts` — Per-file state management (watchers, caches, client sets)
- `src/server/services/iterm-bridge.ts` — Multi-session AppleScript integration
- `src/server/services/annotations.ts` — Sidecar CRUD + re-anchoring
- `src/server/services/markdown.ts` — markdown-it with source offset plugin
- `src/server/routes/api.ts` — REST API (`filePath`-based routes + session-based `/api/reply` and `/api/resolve`)
- `src/client/src/hooks/useAnnotations.ts` — Data fetching + WebSocket subscription (file-scoped)
- `src/client/src/lib/api.ts` — API client (parameterized by filePath + session)
- `src/client/src/hooks/useTextSelection.ts` — Selection API → source offset
- `src/client/src/lib/offsets.ts` — Fuzzy matching selected text to raw markdown
- `src/client/src/lib/highlight.ts` — Inject `<mark>` elements into rendered HTML

## Running

```bash
# Start the daemon (no file arg needed)
md-annotate

# Or start daemon and open a file
md-annotate test.md

# Open a file (daemon must be running, resolves relative paths)
md-annotate open ./path/to/file.md

# Reply to an annotation (uses $ITERM_SESSION_ID to find the file)
md-annotate reply <annotation-id> "response text"

# Reply and resolve in one shot
md-annotate reply --resolve <annotation-id> "done"

# Resolve without replying
md-annotate resolve <annotation-id>

# Dev (single server with HMR)
npm run dev
# Then open http://localhost:3456?file=/path/to/test.md
```

## Using with Claude Code

The `/md-annotate` skill runs `md-annotate open <file>` which resolves the path to absolute and opens the browser with the file path and `$ITERM_SESSION_ID`. The daemon must be running first.

## Testing

### E2E browser tests

Always use the `/playwright-cli` skill for running Playwright e2e tests. Never install or run Playwright directly.

Test files live in `tests/`. Fixture markdown files in `tests/fixtures/`.

The Playwright config (`playwright.config.ts`) starts the dev server (`npm run dev`) automatically via `webServer`.

### E2E test scripts (`scripts/`)

These use AppleScript to manage iTerm sessions for testing the Claude integration loop without polluting the current session:

| Script | Usage | Purpose |
|--------|-------|---------|
| `split-pane.sh` | `./scripts/split-pane.sh` | Split current pane, print new session UUID |
| `send-to-session.sh` | `./scripts/send-to-session.sh <uuid> <text>` | Send text to a session by UUID |
| `close-session.sh` | `./scripts/close-session.sh <uuid>` | Send `exit` to close a session |
| `test-e2e.sh` | `SESSION=$(./scripts/test-e2e.sh)` | Full setup: split, launch claude + md-annotate |

Typical test workflow:
```bash
# 1. Start daemon if not already running
md-annotate &

# 2. Open annotation UI for a file
open "http://localhost:3456?file=$(pwd)/test.md&session=$ITERM_SESSION_ID"

# 3. Or use E2E test scripts for a separate Claude session
SESSION=$(./scripts/test-e2e.sh)

# 4. Cleanup
./scripts/close-session.sh "$SESSION"
```
