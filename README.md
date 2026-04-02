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
```

## Usage

```bash
# Start the daemon
md-annotate

# Start and open a file
md-annotate test.md

# Open a file (daemon must be running)
md-annotate open ./path/to/file.md
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
```

### Development

```bash
npm run dev
# Open http://localhost:3456?file=/path/to/file.md
```
