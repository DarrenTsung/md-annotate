# md-annotate

Google Docs-style inline annotations for markdown files, with built-in Claude Code integration.

Select text in the rendered markdown, leave comments, and Claude responds directly in the annotation thread, all without leaving the terminal.

https://github.com/user-attachments/assets/26def228-63a3-47b4-a444-a38e56474a15


## How it works

1. A local daemon serves rendered markdown with an annotation UI on port 3456
2. Select text in the browser to create annotations with comments
3. Annotations are sent to Claude's terminal session via iTerm AppleScript
4. Claude reads the comment, makes edits, and replies via CLI subcommands
5. Replies appear in the browser in real-time via WebSocket

## Setup

```bash
npm install
npm link
md-annotate daemon install
```

The macOS LaunchAgent starts md-annotate at login and restarts it after a crash. It waits at least 10 seconds between restart attempts if startup repeatedly fails.

## Usage

```bash
# Open a file
md-annotate open ./path/to/file.md

# Manage the auto-restarting daemon
md-annotate daemon status
md-annotate daemon restart
md-annotate daemon uninstall

# Run in the foreground instead of using the LaunchAgent
md-annotate daemon uninstall
md-annotate

# Or start in the foreground and open a file
md-annotate test.md
```

### Claude Code CLI

```bash
# Reply to an annotation
md-annotate reply <annotation-id> "response text"

# Reply and resolve
md-annotate reply --resolve <annotation-id> "done"

# Resolve without replying
md-annotate resolve <annotation-id>

# Mark annotation as in-progress (pulse animation in UI)
md-annotate start <annotation-id>

# Clear in-progress state
md-annotate end <annotation-id>

# Show pending annotations
md-annotate status

# Reprint an annotation's full body (read-only; does not change working state)
md-annotate show <annotation-id>
```

### Development

```bash
npm run dev
# Open http://localhost:3456?file=/path/to/file.md
```
