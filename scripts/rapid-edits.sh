#!/bin/bash
# Rapidly edits a markdown file to test version history debouncing.
# Usage: ./scripts/rapid-edits.sh [file]
# Default: tests/fixtures/version-test.md

FILE="${1:-tests/fixtures/version-test.md}"
FILE="$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")"

echo "Making 5 rapid edits to $FILE (0.5s apart)..."
echo ""

# Save original
cp "$FILE" "$FILE.bak"

# Edit 1: add a line
echo "" >> "$FILE"
echo "## Edit 1" >> "$FILE"
echo "First rapid edit." >> "$FILE"
echo "  [$(date +%H:%M:%S)] Edit 1: added section"
sleep 0.5

# Edit 2: add another line
echo "" >> "$FILE"
echo "## Edit 2" >> "$FILE"
echo "Second rapid edit." >> "$FILE"
echo "  [$(date +%H:%M:%S)] Edit 2: added section"
sleep 0.5

# Edit 3: add another
echo "" >> "$FILE"
echo "## Edit 3" >> "$FILE"
echo "Third rapid edit." >> "$FILE"
echo "  [$(date +%H:%M:%S)] Edit 3: added section"
sleep 0.5

# Edit 4: add another
echo "" >> "$FILE"
echo "## Edit 4" >> "$FILE"
echo "Fourth rapid edit." >> "$FILE"
echo "  [$(date +%H:%M:%S)] Edit 4: added section"
sleep 0.5

# Edit 5: add another
echo "" >> "$FILE"
echo "## Edit 5" >> "$FILE"
echo "Fifth rapid edit." >> "$FILE"
echo "  [$(date +%H:%M:%S)] Edit 5: added section"

echo ""
echo "Done. Waiting 7s for debounce (1s) + auto-show (5s) to complete..."
sleep 7

echo "Restoring original file..."
mv "$FILE.bak" "$FILE"
echo "Restored. One more version will appear for the restore."
