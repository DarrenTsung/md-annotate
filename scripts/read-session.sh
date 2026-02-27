#!/bin/bash
# Read the visible contents of an iTerm session by UUID.
# Output is stripped of ANSI escape sequences for clean text.
# Usage: ./scripts/read-session.sh <uuid>

SESSION_UUID="$1"

if [[ -z "$SESSION_UUID" ]]; then
  echo "Usage: read-session.sh <uuid>" >&2
  exit 1
fi

osascript <<EOF | sed $'s/\x1b\[[0-9;]*[a-zA-Z]//g' | strings
tell application "iTerm"
    repeat with aWindow in windows
        tell aWindow
            repeat with aTab in tabs
                tell aTab
                    repeat with aSession in sessions
                        if unique ID of aSession is "$SESSION_UUID" then
                            tell aSession
                                return contents
                            end tell
                        end if
                    end repeat
                end tell
            end repeat
        end tell
    end repeat
end tell
EOF
