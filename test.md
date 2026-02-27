# Test Document

This is a test markdown file for **md-annotate**.

## Features

- Inline annotations with Google Docs-style comments
- Real-time sync via WebSocket
- Claude Code integration via iTerm AppleScript

## Code Example

```typescript
function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

## Architecture

The system uses a sidecar JSON file to store annotations alongside the markdown file. When the markdown is edited externally (e.g., by Claude Code), annotations are automatically re-anchored to their new positions.

### Key Design Decisions

1. **Source offset mapping**: Custom markdown-it plugin adds `data-source-offset` attributes to rendered HTML, enabling precise mapping from browser selections back to raw markdown positions.

2. **Debounced Claude integration**: New annotations are batched with a 2.5-second debounce window before being sent to Claude, preventing rapid-fire prompts.

3. **Bidirectional communication**: Claude can reply by editing the sidecar JSON directly. The file watcher detects changes and pushes updates to the browser.

> This is a blockquote that you might want to comment on.

## TODO

- [ ] Add keyboard shortcuts
- [ ] Support for images
- [ ] Dark mode
