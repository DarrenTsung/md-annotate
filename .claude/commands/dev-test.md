---
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch
description: Run local dev tests for md-annotate using Playwright and iTerm scripts
---

Run an end-to-end dev test for md-annotate. Use the test fixture at `tests/fixtures/test.md` unless $ARGUMENTS specifies a different file.

You will actually execute each step — use Bash for shell commands, `/playwright-cli` for browser automation, and the scripts in `scripts/` for iTerm session management.

## Setup

1. Check if the daemon is already running:
   ```
   curl -s http://localhost:3456/api/claude/status
   ```
   If not running, start dev mode in the background (`npm run dev &` from the project root) and wait for port 3456 to respond.

2. Clean any leftover sidecar: `rm -f tests/fixtures/test.md.annotations.json`

3. Resolve the absolute path to the test file: `realpath tests/fixtures/test.md`

4. Split an iTerm pane to get a session UUID for the "Claude" side:
   ```
   ./scripts/split-pane.sh
   ```

5. Launch Claude **with edit permissions** in the split pane:
   ```
   ./scripts/send-to-session.sh "$SESSION_UUID" "cd $(pwd)"
   sleep 1
   ./scripts/send-to-session.sh "$SESSION_UUID" "claude --allowedTools 'Edit,Write,Bash(md-annotate *)'"
   ```
   Wait for Claude to be ready:
   ```
   ./scripts/wait-for-session.sh "$SESSION_UUID" "for shortcuts" 5
   ```

6. Invoke the `/md-annotate` skill in the split Claude session:
   ```
   ./scripts/send-to-session.sh "$SESSION_UUID" "/md-annotate $FILE"
   ```
   Wait for acknowledgment:
   ```
   ./scripts/wait-for-session.sh "$SESSION_UUID" "watching|waiting|annotation" 5
   ```

## Test flow

Use `/playwright-cli` for all browser interaction. Open:
```
http://localhost:3456?file=$FILE&session=w0tty0:$SESSION_UUID
```

The `session` param format is `w0tty0:<uuid>` — this registers the iTerm session with the file in the daemon's FileManager. To find the actual prefix, read `$ITERM_SESSION_ID` — it's `<prefix>:<uuid>`. But since we split from our own session, the new pane inherits the same `w0t` prefix format. Check via `read-session.sh` if needed.

### Selecting text in Playwright

Use `run-code` to click-drag over text:
```js
async page => {
  const p = page.locator('p:has-text("target text")').first();
  const box = await p.boundingBox();
  await page.mouse.move(box.x + startX, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + endX, box.y + 12, { steps: 10 });
  await page.mouse.up();
}
```
Then take a snapshot to find the popover's textbox and button refs.

### Scenario 1: Create annotation + verify Claude receives it

1. Select text in the rendered markdown via Playwright click-drag
2. Fill the comment textbox and click the "Comment" button
3. Screenshot to verify annotation appears in sidebar with yellow highlight
4. Wait ~3s for debounce, then check the split session:
   ```
   ./scripts/read-session.sh "$SESSION_UUID"
   ```
   Verify the `[md-annotate]` message contains the annotation ID

### Scenario 2: Verify Claude replies via CLI

1. Wait for Claude to process (poll the API every few seconds):
   ```
   curl -s "http://localhost:3456/api/annotations?filePath=$FILE"
   ```
   Check that the annotation has a second comment with `author: "claude"`
2. Screenshot the browser to verify Claude's reply appears in the sidebar

### Scenario 3: Reply + resolve (task request)

1. Create a second annotation asking Claude to make a change (e.g. "Please rename this to Section Beta")
2. Wait for Claude to edit the file, reply, and resolve
3. Screenshot to verify:
   - The markdown content updated in the document
   - The annotation shows as "RESOLVED" in the sidebar
   - Claude's reply explains what was changed

### Scenario 4: Resolve without replying (via API)

1. Create a third annotation
2. Get the annotation ID from the API
3. Resolve it directly via API:
   ```
   curl -X POST "http://localhost:3456/api/resolve?session=w0tty0:$SESSION_UUID" \
     -H "Content-Type: application/json" \
     -d '{"annotationId":"<id>"}'
   ```
4. Verify resolved state in browser via Playwright snapshot

## Cleanup

Always clean up at the end, even if tests fail:

```bash
./scripts/close-session.sh "$SESSION_UUID"
playwright-cli close
rm -f tests/fixtures/test.md.annotations.json
git checkout tests/fixtures/test.md  # restore if Claude edited it
```

## Reporting

After running, report which scenarios passed/failed with screenshots at each step.
