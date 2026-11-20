# settings: the optional `.laneconductor.json`

`.laneconductor.json` is an optional settings file at the root of a project. It is personal, not shared: a handful of choices,
one of them (the board URL) private. Nothing needs it. Setup never creates, looks for or reads it; a project works the same with
or without it. Only the commands that read a key below open it.

A file is created only when a person makes a choice that belongs in it (a different push policy), when Claude first stores the
board URL ([board.md](board.md), step 3b, which asks first), when a person asks to keep a `next` level ([next.md](next.md), which asks first), or when a person says "don't ask again" to a skill offer (which asks first). Keep the file valid JSON and every key you did not mean to change as it was.

## Keys

| Key | Values | Default | Read by |
|-----|--------|---------|---------|
| `connector.state_branch` | a safe git branch name | the default branch from `origin/HEAD`, else the current branch if it is `main` or `master`, else `main` | the parallel add-on's connector, the board script |
| `connector.push` | `ask`, `auto-state` | `ask` (never push; always ask the human) | the parallel add-on's connector |
| `board.artifact_url` | the URL of the board artifact | none (no board published yet) | the board commands ([board.md](board.md)) |
| `board.include_docs` | `false` turns every document off, project definition files included | on | the board script |
| `board.include_conversation` | `true` adds `conversation.md` to the board documents | off | the board script |
| `board.auto_update` | `false` turns off the board add-on's end-of-turn prompt to refresh a stored board | on when a board is stored | the board add-on's hooks |
| `project.name` | a string | the folder name | the board script |
| `next.level` | `auto`, `explain`, `short` | `auto` | the `next` command only ([next.md](next.md)) |
| `skills.declined` | a list of skill-catalog entry names | none | the skill offers ([suggest-skills.md](suggest-skills.md)) |

Example:

```json
{ "project": { "name": "My project" }, "connector": { "push": "ask" }, "board": { "artifact_url": "https://..." } }
```

## Rules

- Unknown keys are ignored and never rewritten or removed, so an older file keeps working untouched.
- A value that is not valid for its key (an unsafe state branch, an unlisted push policy), or a file that is not valid JSON, is
  reported once by the tool that reads it, and the default is used.
- `board.artifact_url` is private, so the file belongs in `.gitignore`. The board procedure adds the line `.laneconductor.json`
  before it stores a URL, after asking. Setup adds nothing for it.
- A missing or unreadable file or an unknown `next.level` means `auto`.
- `next.level` (the person asks to keep a level) and `skills.declined` (the person says "don't ask again") are written only after a yes to the exact change shown, with the `.gitignore` line first, as for the board URL. The older `.git/skill-advisor-declined.txt` is still read.
- To remove the file: delete it. Every key falls back to its default.
