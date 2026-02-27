#!/bin/bash
# Send text to an iTerm session by UUID.
# Usage: ./scripts/send-to-session.sh <uuid> <text>
#
# Sends the text without a trailing newline, then sends a separate newline
# to trigger submission. This is needed for TUI apps like Claude Code where
# text + newline in a single write text doesn't submit.

set +H  # Disable history expansion so ! doesn't get mangled

SESSION_UUID="$1"
TEXT="$2"

if [[ -z "$SESSION_UUID" || -z "$TEXT" ]]; then
  echo "Usage: send-to-session.sh <uuid> <text>" >&2
  exit 1
fi

# Escape for AppleScript string literal (backslashes and double quotes)
ESCAPED="${TEXT//\\/\\\\}"
ESCAPED="${ESCAPED//\"/\\\"}"

# Send text without newline, then send a separate empty write to trigger Enter.
# Single write text "foo" sends foo+newline atomically which some TUIs don't
# handle as a submit.
osascript <<EOF
tell application "iTerm"
    repeat with aWindow in windows
        tell aWindow
            repeat with aTab in tabs
                tell aTab
                    repeat with aSession in sessions
                        if unique ID of aSession is "$SESSION_UUID" then
                            tell aSession
                                write text "$ESCAPED" newline NO
                                write text ""
                            end tell
                            return
                        end if
                    end repeat
                end tell
            end repeat
        end tell
    end repeat
end tell
EOF
