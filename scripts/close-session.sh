#!/bin/bash
# Close an iTerm session by UUID (sends "exit").
# Usage: ./scripts/close-session.sh <uuid>

SESSION_UUID="$1"

if [[ -z "$SESSION_UUID" ]]; then
  echo "Usage: close-session.sh <uuid>" >&2
  exit 1
fi

osascript -e "
tell application \"iTerm\"
    repeat with aWindow in windows
        tell aWindow
            repeat with aTab in tabs
                tell aTab
                    repeat with aSession in sessions
                        if unique ID of aSession is \"$SESSION_UUID\" then
                            tell aSession to write text \"exit\"
                            return
                        end if
                    end repeat
                end tell
            end repeat
        end tell
    end repeat
end tell
"
