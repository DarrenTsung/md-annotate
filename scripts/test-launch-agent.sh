#!/bin/bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Skipping LaunchAgent smoke test: macOS is required."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
LAUNCH_AGENT_SCRIPT="$SCRIPT_DIR/launch-agent.sh"
CLI="$PACKAGE_DIR/bin/md-annotate"
NODE_BIN="$(command -v node)"
TSX_LOADER="$PACKAGE_DIR/node_modules/tsx/dist/loader.mjs"
ENTRYPOINT="$PACKAGE_DIR/bin/md-annotate.ts"

TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/md-annotate-launch-agent.XXXXXX")"
LABEL="com.dtsung.md-annotate.test.$$"
DOMAIN="gui/$(id -u)"
SERVICE_TARGET="$DOMAIN/$LABEL"
PORT=$((40000 + ($$ % 20000)))

while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

export MD_ANNOTATE_LAUNCH_AGENT_LABEL="$LABEL"
export MD_ANNOTATE_PORT="$PORT"
export MD_ANNOTATE_LAUNCH_AGENTS_DIR="$TEST_DIR/LaunchAgents"
export MD_ANNOTATE_LOG_DIR="$TEST_DIR/Logs"

foreground_pid=""
managed_pid=""
restarted_pid=""
kickstarted_pid=""

listener_pid() {
  lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

is_ready() {
  /usr/bin/curl --noproxy '*' --fail --silent --max-time 1 \
    "http://localhost:$PORT/api/claude/status" >/dev/null 2>&1
}

wait_for_new_pid() {
  local previous_pid="$1"
  local attempts=150
  local current_pid
  while (( attempts > 0 )); do
    current_pid="$(listener_pid)"
    if [[ -n "$current_pid" && "$current_pid" != "$previous_pid" ]] && is_ready; then
      echo "$current_pid"
      return 0
    fi
    sleep 0.1
    attempts=$((attempts - 1))
  done
  return 1
}

cleanup() {
  if launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
    launchctl bootout "$SERVICE_TARGET" || true
  fi
  local pid
  for pid in "$foreground_pid" "$managed_pid" "$restarted_pid" "$kickstarted_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

bounded_log="$TEST_DIR/bounded.error.log"
"$LAUNCH_AGENT_SCRIPT" run "$bounded_log" \
  /usr/bin/perl -e 'print STDERR "x" x (2 * 1024 * 1024), "\n"'
bounded_log_size=0
previous_bounded_log_size=-1
stable_bounded_log_checks=0
for _ in {1..50}; do
  if [[ -f "$bounded_log" ]]; then
    bounded_log_size="$(/usr/bin/stat -f '%z' "$bounded_log")"
    if (( bounded_log_size > 0 && bounded_log_size <= 1048576 && bounded_log_size == previous_bounded_log_size )); then
      stable_bounded_log_checks=$((stable_bounded_log_checks + 1))
    else
      stable_bounded_log_checks=0
    fi
    if (( stable_bounded_log_checks >= 3 )); then
      break
    fi
    previous_bounded_log_size="$bounded_log_size"
  fi
  sleep 0.1
done
if (( stable_bounded_log_checks < 3 )); then
  echo "Error log did not settle within its 1 MiB bound ($bounded_log_size bytes)." >&2
  exit 1
fi

mkdir -p "$TEST_DIR/foreground"
"$NODE_BIN" --import "$TSX_LOADER" "$ENTRYPOINT" --no-open --port "$PORT" \
  >"$TEST_DIR/foreground/stdout.log" 2>"$TEST_DIR/foreground/stderr.log" &
foreground_pid=$!

for _ in {1..50}; do
  is_ready && break
  sleep 0.1
done
if ! is_ready; then
  echo "Foreground daemon did not become ready." >&2
  exit 1
fi

"$CLI" daemon install
managed_pid="$(listener_pid)"
if [[ -z "$managed_pid" || "$managed_pid" == "$foreground_pid" ]]; then
  echo "Install did not replace the foreground daemon." >&2
  exit 1
fi
"$CLI" daemon status

launchctl kill SIGKILL "$SERVICE_TARGET"
if ! restarted_pid="$(wait_for_new_pid "$managed_pid")"; then
  echo "Daemon did not recover after SIGKILL." >&2
  launchctl print "$SERVICE_TARGET" >&2 || true
  if [[ -f "$MD_ANNOTATE_LOG_DIR/md-annotate.error.log" ]]; then
    echo "Error log:" >&2
    tail -100 "$MD_ANNOTATE_LOG_DIR/md-annotate.error.log" >&2
  fi
  exit 1
fi

"$CLI" daemon restart
kickstarted_pid="$(listener_pid)"
if [[ -z "$kickstarted_pid" || "$kickstarted_pid" == "$restarted_pid" ]]; then
  echo "Restart did not replace the managed daemon." >&2
  exit 1
fi

"$CLI" daemon uninstall
if launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
  echo "LaunchAgent remained loaded after uninstall." >&2
  exit 1
fi
if [[ -e "$MD_ANNOTATE_LAUNCH_AGENTS_DIR/$LABEL.plist" ]]; then
  echo "LaunchAgent plist remained after uninstall." >&2
  exit 1
fi
if [[ -n "$(listener_pid)" ]]; then
  echo "Daemon remained running after uninstall." >&2
  exit 1
fi

echo "LaunchAgent smoke test passed ($managed_pid -> $restarted_pid -> $kickstarted_pid)."
