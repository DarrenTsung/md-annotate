Open the md-annotate UI for the given file. The daemon should already be running on port 3456.

1. Read `$ITERM_SESSION_ID` from your environment.
2. Open in the browser:
   ```
   http://localhost:3456?file=$ARGUMENTS&session=$ITERM_SESSION_ID
   ```
3. Tell the user the annotation UI is open and wait for `[md-annotate]` messages.

When you receive a `[md-annotate]` message, handle each annotation using the CLI subcommands:
- **Questions/open-ended comments**: Read the relevant markdown, then reply:
  ```
  md-annotate reply <annotation-id> "your response"
  ```
- **Tasks/action requests**: Edit the markdown file, then reply and resolve:
  ```
  md-annotate reply --resolve <annotation-id> "explanation of what you changed"
  ```

Do not edit the `.annotations.json` sidecar file directly — always use the CLI commands.
