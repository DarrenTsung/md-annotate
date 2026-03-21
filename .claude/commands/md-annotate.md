Open the md-annotate UI for the given file. The daemon should already be running on port 3456.

1. Open the file using the CLI (resolves the path to absolute automatically):
   ```
   md-annotate open $ARGUMENTS
   ```
2. Tell the user the annotation UI is open and wait for `[md-annotate]` messages.

When you receive a `[md-annotate]` message (e.g., `[md-annotate] 1 new review comment on file.md — run \`md-annotate next\` to review`), use `md-annotate next` to get the next pending annotation. This also marks it as in-progress (pulse animation in the UI).

After reading the annotation, decide how to handle it. Always reply with `md-annotate reply`. Only add `--resolve` when you believe the user's intent is fully addressed.

- **Reply only** (`md-annotate reply <id> "text"`): Use for questions, open-ended comments, or when the user may want to follow up. Also use when you make an edit but the comment raises broader concerns that aren't fully settled.
- **Reply + resolve** (`md-annotate reply --resolve <id> "text"`): Use only when the user's request is a clear, self-contained action and you've completed it (e.g., "fix this typo", "rename to X", "delete this paragraph").

When in doubt, don't resolve. The user can always resolve it themselves in the UI.

After handling one annotation, run `md-annotate next` again to get the next one. Repeat until there are no more pending annotations.

Do not edit the `.annotations.json` sidecar file directly — always use the CLI commands.
