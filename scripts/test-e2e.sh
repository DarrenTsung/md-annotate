#!/bin/bash
# End-to-end test setup: split pane, launch claude, run md-annotate from it.
# Prints the new session UUID so the caller can clean up later.
#
# Usage:
#   SESSION_UUID=$(./scripts/test-e2e.sh)
#   # ... run playwright tests against http://localhost:5174 ...
#   ./scripts/close-session.sh "$SESSION_UUID"

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# 1. Split pane
NEW_UUID=$("$SCRIPT_DIR/split-pane.sh")
if [[ -z "$NEW_UUID" ]]; then
  echo "Failed to split pane" >&2
  exit 1
fi

echo "$NEW_UUID" >&2
echo "Split pane created: $NEW_UUID" >&2

# 2. Launch claude in the new pane, telling it to run md-annotate
"$SCRIPT_DIR/send-to-session.sh" "$NEW_UUID" \
  "cd $PROJECT_DIR && claude -p 'Run the md-annotate dev server on test.md: npx concurrently --names server,client \"npx tsx watch bin/md-annotate.ts test.md --no-open --port 3456\" \"npx vite\". Then wait for review comments.'"

echo "Launched claude in session $NEW_UUID" >&2

# Print UUID to stdout for the caller
echo "$NEW_UUID"
