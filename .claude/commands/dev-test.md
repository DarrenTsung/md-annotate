---
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch
description: Run local dev tests for md-annotate using Playwright and iTerm scripts
---

Run an interactive local dev test for md-annotate. Use the test fixture at `tests/fixtures/test.md` unless $ARGUMENTS specifies a different file.

## Environment

- **Daemon**: Express + WebSocket on port 3456
- **Dev client**: Vite on port 5174 (proxies `/api` and `/ws` to 3456)
- **Scripts**: `scripts/` directory has iTerm session management helpers
- **Playwright**: Use the `/playwright-cli` skill for all browser automation — never install or run Playwright directly

## Setup

1. Check if the daemon is already running:
   ```
   curl -s http://localhost:3456/api/claude/status
   ```
2. If not running, start dev mode in the background:
   ```
   cd /Users/dtsung/Documents/md-annotate && npm run dev &
   ```
   Wait for both the Express server (port 3456) and Vite (port 5174) to be ready.

3. Resolve the absolute path to the test file:
   ```
   FILE=$(realpath tests/fixtures/test.md)
   ```

4. Set up a separate iTerm session for Claude (simulates the user's Claude session):
   ```
   SESSION_UUID=$(./scripts/split-pane.sh)
   ```
   This is the "Claude session" that will receive annotation messages. Register it with the daemon by opening the browser URL (done in the Playwright step).

## Test flow

Use `/playwright-cli` to automate the browser. The URL to open is:

```
http://localhost:5174?file=$FILE&session=w0tty0:$SESSION_UUID
```

The `session` param format is `w0tty0:<uuid>` — this registers the iTerm session with the file in the daemon's FileManager.

### Core scenarios to test

**1. Create an annotation**
- Navigate to the URL above
- Select text in the rendered markdown (e.g. "paragraph text that we can select")
- The annotation popover should appear — type a comment and submit
- Verify the annotation appears in the sidebar

**2. Verify Claude receives the annotation**
- After creating an annotation, wait ~3 seconds (debounce window)
- Read the iTerm session to check that the `[md-annotate]` message was delivered:
  ```
  ./scripts/read-session.sh "$SESSION_UUID"
  ```
- Verify the message contains the annotation ID and selected text

**3. Reply via CLI**
- Extract the annotation ID from the iTerm session output (or from the API):
  ```
  curl -s "http://localhost:3456/api/annotations?filePath=$FILE"
  ```
- Simulate Claude replying by running the CLI command in the split session:
  ```
  ./scripts/send-to-session.sh "$SESSION_UUID" 'md-annotate reply <annotation-id> "test response from claude"'
  ```
  Or call the API directly:
  ```
  curl -X POST "http://localhost:3456/api/reply?session=w0tty0:$SESSION_UUID" \
    -H "Content-Type: application/json" \
    -d '{"annotationId":"<id>","text":"test response from claude"}'
  ```
- Use Playwright to verify the reply appears in the browser sidebar

**4. Reply + resolve**
- Create another annotation via Playwright
- Reply and resolve via API:
  ```
  curl -X POST "http://localhost:3456/api/reply?session=w0tty0:$SESSION_UUID" \
    -H "Content-Type: application/json" \
    -d '{"annotationId":"<id>","text":"done","resolve":true}'
  ```
- Verify the annotation shows as resolved in the browser

**5. Resolve without replying**
- Create another annotation, then resolve it:
  ```
  curl -X POST "http://localhost:3456/api/resolve?session=w0tty0:$SESSION_UUID" \
    -H "Content-Type: application/json" \
    -d '{"annotationId":"<id>"}'
  ```
- Verify resolved state in the browser

## Cleanup

Always clean up at the end, even if tests fail:

```bash
./scripts/close-session.sh "$SESSION_UUID"
```

Also remove any sidecar files created during testing:
```bash
rm -f tests/fixtures/test.md.annotations.json
```

## Reporting

After running, report which scenarios passed/failed and include any error details or screenshots captured by Playwright.
