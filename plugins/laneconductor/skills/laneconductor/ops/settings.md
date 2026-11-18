# settings: the optional `.laneconductor.json`

`.laneconductor.json` is an optional settings file at the root of a project. It is personal, not shared: it holds at most a
handful of choices, and one of them (the board URL) is private. Nothing in LaneConductor needs it. Setup never creates it, never
looks for it and never reads it; a project works the same with or without it, and so does a project that still has an older
file with other keys in it.

A file is created only when a person makes a choice that belongs in it (a different push policy) or when Claude first stores the
board URL ([board.md](board.md), step 3b, which asks first). Keep the file valid JSON and every key you did not mean to change as it was.

## Keys

| Key | Values | Default | Read by |
|-----|--------|---------|---------|
| `connector.state_branch` | a safe git branch name | the default branch from `origin/HEAD`, else the current branch if it is `main` or `master`, else `main` | the parallel add-on's connector, the board script |
| `connector.push` | `ask`, `auto-state` | `ask` (never push; always ask the human) | the parallel add-on's connector |
| `board.artifact_url` | the URL of the board artifact | none (no board published yet) | the board commands ([board.md](board.md)) |
| `board.include_docs` | `false` turns every document off | on | the board script |
| `board.include_conversation` | `true` adds `conversation.md` to the board documents | off | the board script |
| `project.name` | a string | the folder name | the board script |

Example:

```json
{ "project": { "name": "My project" }, "connector": { "push": "ask" }, "board": { "artifact_url": "https://..." } }
```

## Rules

- Unknown keys are ignored without a message and are never rewritten or removed: an older file keeps working untouched.
- A value that is not valid for its key (a state branch that is not a safe branch name, a push policy that is not listed) is
  reported once by the tool that reads it, and the default is used.
- A file that is not valid JSON is reported once by the tools that read it, and the defaults are used.
- `board.artifact_url` is private, so the file belongs in `.gitignore`. The board procedure adds the line `.laneconductor.json`
  before it stores a URL, after asking. Setup adds nothing for it.
- To remove the file: delete it. Every key falls back to its default.
