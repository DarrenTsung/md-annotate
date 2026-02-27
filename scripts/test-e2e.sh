#!/bin/bash
# End-to-end test setup: start daemon, split pane, launch Claude, then invoke
# the /md-annotate skill inside that Claude session.
#
# The daemon must run independently so both the test harness and Claude can
# interact with it. The /md-annotate skill just opens the browser URL — it
# doesn't start the server.
#
# Usage:
#   SESSION_UUID=$(./scripts/test-e2e.sh [file.md])
#   # ... create annotations via API or playwright-cli ...
#   ./scripts/close-session.sh "$SESSION_UUID"

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MD_FILE="$(cd "$PROJECT_DIR" && realpath "${1:-test.md}")"

# 1. Start the daemon if not already running
if ! curl -s http://localhost:3456/api/claude/status >/dev/null 2>&1; then
  echo "Starting md-annotate daemon..." >&2
  cd "$PROJECT_DIR"
  npx tsx bin/md-annotate.ts --no-open &
  DAEMON_PID=$!

  # Wait for daemon to be ready
  for i in $(seq 1 15); do
    if curl -s http://localhost:3456/api/claude/status >/dev/null 2>&1; then
      echo "Daemon ready (pid $DAEMON_PID)" >&2
      break
    fi
    sleep 1
  done

  if ! curl -s http://localhost:3456/api/claude/status >/dev/null 2>&1; then
    echo "Failed to start daemon" >&2
    exit 1
  fi
else
  echo "Daemon already running" >&2
fi

# 2. Split pane
NEW_UUID=$("$SCRIPT_DIR/split-pane.sh")
if [[ -z "$NEW_UUID" ]]; then
  echo "Failed to split pane" >&2
  exit 1
fi
echo "Split pane created: $NEW_UUID" >&2

# 3. cd to project dir, then start Claude
"$SCRIPT_DIR/send-to-session.sh" "$NEW_UUID" "cd $PROJECT_DIR"
sleep 1
"$SCRIPT_DIR/send-to-session.sh" "$NEW_UUID" "claude"
echo "Waiting for Claude to start..." >&2

# 4. Wait for Claude to be ready
"$SCRIPT_DIR/wait-for-session.sh" "$NEW_UUID" "for shortcuts" 30 >/dev/null
echo "Claude is ready" >&2

# 5. Invoke the md-annotate skill with absolute path
"$SCRIPT_DIR/send-to-session.sh" "$NEW_UUID" "/md-annotate $MD_FILE"
echo "Sent /md-annotate $MD_FILE" >&2

# 6. Wait for Claude to acknowledge (it prints a watching message)
"$SCRIPT_DIR/wait-for-session.sh" "$NEW_UUID" "watching for" 30 >/dev/null
echo "Claude is watching for annotations" >&2

# Print UUID to stdout for the caller
echo "$NEW_UUID"
