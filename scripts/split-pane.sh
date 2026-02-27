#!/bin/bash
# Split the current iTerm session vertically and print the new session's UUID.
# Usage: ./scripts/split-pane.sh

UUID="${ITERM_SESSION_ID##*:}"
if [[ -z "$UUID" ]]; then
  echo "Error: ITERM_SESSION_ID not set" >&2
  exit 1
fi

NEW_UUID=$(osascript -e "
tell application \"iTerm\"
    repeat with aWindow in windows
        tell aWindow
            repeat with aTab in tabs
                tell aTab
                    repeat with aSession in sessions
                        if unique ID of aSession is \"$UUID\" then
                            set newSession to (split vertically with default profile)
                            return unique ID of newSession
                        end if
                    end repeat
                end tell
            end repeat
        end tell
    end repeat
end tell
")

echo "$NEW_UUID"
