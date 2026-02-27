#!/bin/bash
# End-to-end test setup: split pane, launch Claude interactively, then invoke
# the /md-annotate skill inside that Claude session.
#
# The md-annotate server runs from Claude's session, so ITERM_SESSION_ID is
# inherited automatically — annotations get sent back to that Claude instance.
#
# Usage:
#   SESSION_UUID=$(./scripts/test-e2e.sh [file.md])
#   # ... wait for servers, test with Playwright against http://localhost:3456 ...
#   ./scripts/close-session.sh "$SESSION_UUID"

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MD_FILE="$(cd "$PROJECT_DIR" && realpath "${1:-test.md}")"

# 1. Split pane
NEW_UUID=$("$SCRIPT_DIR/split-pane.sh")
if [[ -z "$NEW_UUID" ]]; then
  echo "Failed to split pane" >&2
  exit 1
fi
echo "Split pane created: $NEW_UUID" >&2

# 2. cd to project dir, then start Claude
"$SCRIPT_DIR/send-to-session.sh" "$NEW_UUID" "cd $PROJECT_DIR"
sleep 1
"$SCRIPT_DIR/send-to-session.sh" "$NEW_UUID" "claude"
echo "Waiting for Claude to start..." >&2

# 3. Wait for Claude to be ready
"$SCRIPT_DIR/wait-for-session.sh" "$NEW_UUID" "for shortcuts" 30 >/dev/null
echo "Claude is ready" >&2

# 4. Invoke the md-annotate skill with absolute path
"$SCRIPT_DIR/send-to-session.sh" "$NEW_UUID" "/md-annotate $MD_FILE"
echo "Sent /md-annotate $MD_FILE" >&2

# 5. Wait for the md-annotate server to start
"$SCRIPT_DIR/wait-for-session.sh" "$NEW_UUID" "md-annotate server running" 30 >/dev/null
echo "md-annotate server is running" >&2

# Print UUID to stdout for the caller
echo "$NEW_UUID"
