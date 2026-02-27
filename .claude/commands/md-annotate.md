Open the md-annotate UI for the given file. The daemon should already be running on port 3456.

1. Read `$ITERM_SESSION_ID` from your environment.
2. Open in the browser:
   ```
   http://localhost:3456?file=$ARGUMENTS&session=$ITERM_SESSION_ID
   ```
3. Tell the user the annotation UI is open and wait for `[md-annotate]` messages.

When you receive a `[md-annotate]` message, read the annotations sidecar file it references. For each annotation:
- **Questions/open-ended comments**: Read the relevant markdown, add a reply with `"author": "claude"`, keep status `"open"`.
- **Tasks/action requests**: Edit the markdown file, add a reply with `"author": "claude"` explaining what you changed, set status to `"resolved"`.

Write the updated JSON back to the sidecar file. Only modify the specific annotation(s) mentioned.
