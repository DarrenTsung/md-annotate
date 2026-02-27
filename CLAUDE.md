# md-annotate

Google Docs-style inline annotation tool for markdown files with Claude Code integration via iTerm AppleScript.

## Architecture

- **Server**: Express + WebSocket on port 3456. Renders markdown with `markdown-it` (custom source offset plugin), manages annotation sidecar JSON (`file.md.annotations.json`), watches both files with `chokidar`.
- **Client**: React + Vite on port 5174 (dev). Text selection → source offset mapping → annotation creation. Highlights via `<mark>` injection. Comment sidebar with threads.
- **Claude integration**: Inherits `ITERM_SESSION_ID` from the terminal that launched it. Auto-sends new annotations to that iTerm session via AppleScript after a 2.5s debounce. Claude responds by editing the sidecar JSON directly; file watcher pushes updates to browser via WebSocket.

## Key files

- `bin/md-annotate.ts` — CLI entry point
- `src/server/index.ts` — Express + WebSocket + file watchers
- `src/server/services/iterm-bridge.ts` — AppleScript integration
- `src/server/services/annotations.ts` — Sidecar CRUD + re-anchoring
- `src/server/services/markdown.ts` — markdown-it with source offset plugin
- `src/client/src/hooks/useTextSelection.ts` — Selection API → source offset
- `src/client/src/lib/offsets.ts` — Fuzzy matching selected text to raw markdown
- `src/client/src/lib/highlight.ts` — Inject `<mark>` elements into rendered HTML

## Running

```bash
# Dev (server + Vite HMR)
npm run dev -- test.md

# Or directly
npx concurrently --names server,client \
  "npx tsx watch bin/md-annotate.ts test.md --no-open --port 3456" \
  "npx vite"
```

Dev client: http://localhost:5174 (proxies `/api` and `/ws` to Express on 3456).

## Testing

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
# 1. Spawn a separate Claude session running md-annotate
SESSION=$(./scripts/test-e2e.sh)

# 2. Wait for servers to start, then test with Playwright
playwright-cli open http://localhost:5174
# ... interact with the UI, create annotations ...

# 3. Annotations auto-send to the spawned Claude session via AppleScript
#    Claude edits the sidecar JSON, changes push to browser via WebSocket

# 4. Cleanup
./scripts/close-session.sh "$SESSION"
```

**Important**: Do NOT run md-annotate from the same session you're developing in. The AppleScript bridge sends annotation text as input to the inherited `ITERM_SESSION_ID`, which would interfere with your current work. Always use a separate session (via the test scripts or a manual split).
