# Version History Test

This document is for testing the version history feature.

## Introduction

The version history tracks changes to markdown files over time, showing diffs inline when hovering version dots in the toolbar.

## How It Works

A chokidar watcher detects file changes and diffs the old content against the new using the `diff` npm package. A snapshot of the previous state is saved to `/tmp/md-annotate/`, and the version entry is broadcast to all connected browser clients via WebSocket. Hovering a version dot fetches a cumulative diff from the server, computed on-the-fly from the stored snapshot.

## Features

- Cumulative diffs from any point in history to the current state
- Auto-show overlay for 5 seconds on each new edit
- Red strikethrough for deleted content
- Green highlight for added content
- Version dots in toolbar with hover-to-preview
- Snapshots stored in `/tmp/md-annotate/` for crash recovery
- Deduplication prevents spurious versions from double file-write events

## Notes

This is a placeholder section for testing edits and deletions.
