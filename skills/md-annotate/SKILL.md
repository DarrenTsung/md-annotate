---
name: md-annotate
description: Open Markdown files in the local md-annotate browser UI and handle inline review threads through the md-annotate CLI. Use when the user asks to review, annotate, approve, or discuss a .md file in md-annotate, or when a terminal agent receives a `[md-annotate]` notification telling it to run `md-annotate next`.
---

# Review Markdown with md-annotate

Use the local `md-annotate` daemon and CLI to conduct browser-based inline review while keeping the Markdown file as the source of truth.

## Supported hosts

- Support Claude Code and Codex CLI when they run inside iTerm and inherit `ITERM_SESSION_ID`. The notification bridge sends plain text to the owning iTerm session, so both terminal agents use the same workflow.
- Do not assume support in Codex Desktop, a remote/cloud agent, or Figma's Cortex service. Those hosts do not discover this local skill through the home-directory symlinks and cannot receive iTerm AppleScript notifications.
- If `ITERM_SESSION_ID` is absent, the browser UI can still open, but automatic notification routing and the session-scoped `next`, `reply`, `resolve`, `start`, `end`, `show`, and `status` commands will not work.

## Open a file for review

1. Resolve the user's invocation input to one or more existing `.md` files. In Claude Code command mode, use `$ARGUMENTS` when supplied; in Codex skill mode, use the path from the user's request.
2. Verify that the CLI resolves to a live executable:

   ```bash
   command -v md-annotate
   test -e "$(command -v md-annotate)"
   ```

   If the command is missing or the symlink is dangling, repair the local installation from the source repository:

   ```bash
   cd ~/code/md-annotate
   npm link
   ```

3. Open the file:

   ```bash
   md-annotate open <file.md>
   ```

   If the command reports that the daemon is not running, start `md-annotate --no-open` in a persistent/background terminal session, wait for port 3456 to become ready, and retry `open`. Do not start a second daemon when port 3456 is already serving md-annotate.
4. Tell the user the annotation UI is open. Wait for either a `[md-annotate]` notification or an explicit message that they added comments.

## Handle annotation notifications

When a message says to run `md-annotate next`, do so immediately:

```bash
md-annotate next
```

Treat the CLI output as authoritative. It prints the target file, selected source context, the full comment thread, whether the latest item is a question, and the exact reply commands.

- `next` marks the returned annotation as working. Finish, reply, resolve, or explicitly abandon it before advancing.
- For a question, answer in the annotation thread without editing the document.
- For a requested change, inspect the current file, make the smallest justified edit, verify it, and mention the change in the annotation reply.
- Put the complete user-facing response in `md-annotate reply`. Do not duplicate that response in terminal/chat prose.
- Reply without resolving when the discussion remains open:

  ```bash
  md-annotate reply <id> "<complete response>"
  ```

- Reply and resolve only when the request is fully addressed:

  ```bash
  md-annotate reply --resolve <id> "<complete response>"
  ```

- If the working annotation scrolls away, reprint it without changing state:

  ```bash
  md-annotate show <id>
  ```

- If abandoning an annotation without replying, clear its working state explicitly:

  ```bash
  md-annotate end <id>
  ```

After each reply, run `md-annotate next` again until it prints `No pending annotations.`

## Concurrency and freshness

- If `reply` or `resolve` reports new user comments, do not force the old response through. Run `md-annotate next`, reread the updated thread, and answer the latest context.
- Never edit `<file>.annotations.json` directly. Use the CLI or browser UI so read cursors, working state, WebSocket updates, and stale-selection handling remain consistent.
- Do not resolve a thread before replying. The daemon intentionally rejects resolution when the last comment is not from the agent.
- Use `md-annotate status` to inspect the pending queue without advancing it.

## Action buttons

Markdown comments such as `<!-- @actions: elaborate, fix -->` render as buttons. A click creates a normal annotation and removes only the clicked action from the Markdown source. Handle the resulting notification through the same `next` and `reply` loop.
