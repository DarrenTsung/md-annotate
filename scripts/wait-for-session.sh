#!/bin/bash
# Wait until an iTerm session's content matches a pattern.
# Usage: ./scripts/wait-for-session.sh <uuid> <grep-pattern> [timeout_seconds]
#
# Polls every second. Exits 0 on match, 1 on timeout.
# Max timeout is 5 seconds — if you need longer, call in a loop.
# Prints the matched line(s) to stdout.

SESSION_UUID="$1"
PATTERN="$2"
TIMEOUT="${3:-5}"

if [[ -z "$SESSION_UUID" || -z "$PATTERN" ]]; then
  echo "Usage: wait-for-session.sh <uuid> <pattern> [timeout_seconds]" >&2
  exit 1
fi

# Cap at 5 seconds
if [[ $TIMEOUT -gt 5 ]]; then
  TIMEOUT=5
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELAPSED=0

while [[ $ELAPSED -lt $TIMEOUT ]]; do
  CONTENT=$("$SCRIPT_DIR/read-session.sh" "$SESSION_UUID" 2>/dev/null)
  MATCH=$(echo "$CONTENT" | grep -E "$PATTERN")
  if [[ -n "$MATCH" ]]; then
    echo "$MATCH"
    exit 0
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

echo "Timeout after ${TIMEOUT}s waiting for: $PATTERN" >&2
exit 1
