#!/bin/bash

set -euo pipefail

LABEL="${MD_ANNOTATE_LAUNCH_AGENT_LABEL:-com.dtsung.md-annotate}"
DOMAIN="gui/$(id -u)"
SERVICE_TARGET="$DOMAIN/$LABEL"
PORT="${MD_ANNOTATE_PORT:-3456}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
ENTRYPOINT="$PACKAGE_DIR/bin/md-annotate.ts"
TSX_LOADER="$PACKAGE_DIR/node_modules/tsx/dist/loader.mjs"
NODE_BIN="$(command -v node || true)"

LAUNCH_AGENTS_DIR="${MD_ANNOTATE_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
PLIST_PATH="$LAUNCH_AGENTS_DIR/$LABEL.plist"
LOG_DIR="${MD_ANNOTATE_LOG_DIR:-$HOME/Library/Logs}"
ERROR_LOG_PATH="$LOG_DIR/md-annotate.error.log"

usage() {
  cat <<'EOF'
Usage: md-annotate daemon <install|uninstall|restart|status>

  install    Install and start the per-user LaunchAgent
  uninstall  Stop and remove the LaunchAgent
  restart    Restart the installed LaunchAgent
  status     Show whether the LaunchAgent and daemon are running
EOF
}

require_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Error: the md-annotate LaunchAgent is only supported on macOS." >&2
    exit 1
  fi
}

require_runtime() {
  if [[ -z "$NODE_BIN" ]]; then
    echo "Error: node was not found on PATH." >&2
    exit 1
  fi
  if [[ ! -f "$TSX_LOADER" ]]; then
    echo "Error: $TSX_LOADER does not exist. Run npm install first." >&2
    exit 1
  fi
}

is_loaded() {
  launchctl print "$SERVICE_TARGET" >/dev/null 2>&1
}

listener_pids() {
  lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
}

managed_pid() {
  launchctl print "$SERVICE_TARGET" 2>/dev/null \
    | awk '/^[[:space:]]*pid =/ { print $3; exit }' || true
}

managed_pid_owns_listener() {
  local pid="$1"
  [[ -n "$pid" ]] || return 1
  [[ "$(lsof -nP -a -p "$pid" -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)" == "$pid" ]]
}

endpoint_is_ready() {
  /usr/bin/curl --noproxy '*' --fail --silent --max-time 1 \
    "http://localhost:$PORT/api/claude/status" >/dev/null 2>&1
}

wait_for_ready() {
  local previous_pid="${1:-}"
  local attempts="${2:-150}"
  local pid
  while (( attempts > 0 )); do
    pid="$(managed_pid)"
    if [[ -n "$pid" && "$pid" != "$previous_pid" ]] \
      && managed_pid_owns_listener "$pid" \
      && endpoint_is_ready; then
      return 0
    fi
    sleep 0.1
    attempts=$((attempts - 1))
  done
  return 1
}

wait_for_unloaded() {
  local attempts=50
  while (( attempts > 0 )); do
    if ! is_loaded; then
      return 0
    fi
    sleep 0.1
    attempts=$((attempts - 1))
  done
  return 1
}

wait_for_pid_to_exit() {
  local pid="$1"
  local attempts=50
  [[ -n "$pid" ]] || return 0
  while (( attempts > 0 )); do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
    attempts=$((attempts - 1))
  done
  return 1
}

wait_for_port_to_close() {
  local attempts=50
  while (( attempts > 0 )); do
    if [[ -z "$(listener_pids)" ]]; then
      return 0
    fi
    sleep 0.1
    attempts=$((attempts - 1))
  done
  return 1
}

stop_unmanaged_daemon() {
  local pids pid command
  pids="$(listener_pids)"
  [[ -z "$pids" ]] && return 0

  for pid in $pids; do
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command" != *"md-annotate.ts"* ]]; then
      echo "Error: port $PORT is already used by another process (pid $pid):" >&2
      echo "  $command" >&2
      exit 1
    fi
  done

  echo "Stopping existing foreground md-annotate daemon..."
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && kill "$pid"
  done <<< "$pids"
  if ! wait_for_port_to_close; then
    echo "Error: the existing daemon did not stop within 5 seconds." >&2
    exit 1
  fi
}

write_plist() {
  local target="$1"

  /usr/bin/plutil -create xml1 "$target"
  /usr/bin/plutil -insert Label -string "$LABEL" "$target"
  /usr/bin/plutil -insert ProgramArguments -array "$target"
  /usr/bin/plutil -insert ProgramArguments.0 -string "$SCRIPT_DIR/launch-agent.sh" "$target"
  /usr/bin/plutil -insert ProgramArguments.1 -string "run" "$target"
  /usr/bin/plutil -insert ProgramArguments.2 -string "$ERROR_LOG_PATH" "$target"
  /usr/bin/plutil -insert ProgramArguments.3 -string "$NODE_BIN" "$target"
  /usr/bin/plutil -insert ProgramArguments.4 -string "--import" "$target"
  /usr/bin/plutil -insert ProgramArguments.5 -string "$TSX_LOADER" "$target"
  /usr/bin/plutil -insert ProgramArguments.6 -string "$ENTRYPOINT" "$target"
  /usr/bin/plutil -insert ProgramArguments.7 -string "--no-open" "$target"
  /usr/bin/plutil -insert ProgramArguments.8 -string "--port" "$target"
  /usr/bin/plutil -insert ProgramArguments.9 -string "$PORT" "$target"
  /usr/bin/plutil -insert WorkingDirectory -string "$PACKAGE_DIR" "$target"
  /usr/bin/plutil -insert RunAtLoad -bool true "$target"
  /usr/bin/plutil -insert KeepAlive -bool true "$target"
  /usr/bin/plutil -insert ThrottleInterval -integer 10 "$target"
  /usr/bin/plutil -insert StandardOutPath -string "/dev/null" "$target"
  /usr/bin/plutil -insert StandardErrorPath -string "/dev/null" "$target"
}

rotate_error_log() {
  local error_log="$1"
  local max_bytes=1048576
  local keep_bytes=262144
  local size=0

  if [[ -f "$error_log" ]]; then
    size="$(/usr/bin/stat -f '%z' "$error_log")"
  fi
  if (( size > max_bytes )); then
    local rotated_log
    rotated_log="$(mktemp "$(dirname "$error_log")/md-annotate.error.XXXXXX")"
    /usr/bin/tail -c "$keep_bytes" "$error_log" >"$rotated_log"
    /bin/mv "$rotated_log" "$error_log"
  fi
}

bounded_error_log() {
  local error_log="$1"
  local line=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s\n' "$line" >>"$error_log"
    rotate_error_log "$error_log"
    line=""
  done
}

run_agent() {
  local error_log="$1"
  shift

  rotate_error_log "$error_log"
  exec "$@" 2> >(bounded_error_log "$error_log")
}

print_failure_help() {
  echo "The daemon did not become ready within 15 seconds." >&2
  echo "Inspect $ERROR_LOG_PATH and run: launchctl print $SERVICE_TARGET" >&2
}

install_agent() {
  require_runtime
  mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"
  /usr/bin/touch "$ERROR_LOG_PATH"
  /bin/chmod 0600 "$ERROR_LOG_PATH"

  if is_loaded; then
    local previous_pid
    previous_pid="$(managed_pid)"
    launchctl bootout "$SERVICE_TARGET"
    if ! wait_for_unloaded || ! wait_for_pid_to_exit "$previous_pid"; then
      echo "Error: $LABEL did not stop within 5 seconds." >&2
      exit 1
    fi
  fi
  stop_unmanaged_daemon

  local temporary_plist
  temporary_plist="$(mktemp "${TMPDIR:-/tmp}/md-annotate.plist.XXXXXX")"
  trap 'rm -f "$temporary_plist"' EXIT
  write_plist "$temporary_plist"
  /usr/bin/plutil -lint "$temporary_plist" >/dev/null
  /usr/bin/install -m 0644 "$temporary_plist" "$PLIST_PATH"
  rm -f "$temporary_plist"
  trap - EXIT

  launchctl bootstrap "$DOMAIN" "$PLIST_PATH"

  if ! wait_for_ready; then
    print_failure_help
    exit 1
  fi

  echo "Installed and started $LABEL."
  echo "Errors: $ERROR_LOG_PATH"
}

uninstall_agent() {
  if is_loaded; then
    local previous_pid
    previous_pid="$(managed_pid)"
    launchctl bootout "$SERVICE_TARGET"
    if ! wait_for_unloaded || ! wait_for_pid_to_exit "$previous_pid"; then
      echo "Error: $LABEL did not stop within 5 seconds." >&2
      exit 1
    fi
  fi
  rm -f "$PLIST_PATH"
  echo "Uninstalled $LABEL."
}

restart_agent() {
  if ! is_loaded; then
    echo "Error: $LABEL is not installed. Run: md-annotate daemon install" >&2
    exit 1
  fi

  local previous_pid
  previous_pid="$(managed_pid)"
  launchctl bootout "$SERVICE_TARGET"
  if ! wait_for_unloaded || ! wait_for_pid_to_exit "$previous_pid"; then
    echo "Error: $LABEL did not stop within 5 seconds." >&2
    exit 1
  fi
  launchctl bootstrap "$DOMAIN" "$PLIST_PATH"
  if ! wait_for_ready "$previous_pid"; then
    print_failure_help
    exit 1
  fi
  echo "Restarted $LABEL."
}

status_agent() {
  if ! is_loaded; then
    echo "$LABEL is not installed."
    exit 1
  fi

  local pid
  pid="$(managed_pid)"
  if managed_pid_owns_listener "$pid" && endpoint_is_ready; then
    echo "$LABEL is running (pid $pid, http://localhost:$PORT)."
  else
    echo "$LABEL is loaded, but the daemon is not ready." >&2
    echo "Inspect $ERROR_LOG_PATH or run: md-annotate daemon restart" >&2
    exit 1
  fi
}

require_macos

case "${1:-}" in
  run)
    shift
    run_agent "$@"
    ;;
  install)
    install_agent
    ;;
  uninstall)
    uninstall_agent
    ;;
  restart)
    restart_agent
    ;;
  status)
    status_agent
    ;;
  --help|-h)
    usage
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
