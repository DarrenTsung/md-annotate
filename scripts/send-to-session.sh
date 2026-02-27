#!/bin/bash
# Send text to an iTerm session by UUID.
# Usage: ./scripts/send-to-session.sh <uuid> <text>

SESSION_UUID="$1"
TEXT="$2"

if [[ -z "$SESSION_UUID" || -z "$TEXT" ]]; then
  echo "Usage: send-to-session.sh <uuid> <text>" >&2
  exit 1
fi

# Escape for AppleScript
ESCAPED=$(echo "$TEXT" | sed 's/\\/\\\\/g; s/"/\\"/g')

osascript -e "
tell application \"iTerm\"
    repeat with aWindow in windows
        tell aWindow
            repeat with aTab in tabs
                tell aTab
                    repeat with aSession in sessions
                        if unique ID of aSession is \"$SESSION_UUID\" then
                            tell aSession to write text \"$ESCAPED\"
                            return
                        end if
                    end repeat
                end tell
            end repeat
        end tell
    end repeat
end tell
"
