---
description: Open the existing board and give its link (never regenerates it)
---
Show the existing board. Read only: never regenerate or republish it.

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

1. Find the stored board URL (`board.artifact_url` in the optional settings file `.laneconductor.json`, see the skill file `ops/settings.md`; step 2 of `ops/board.md`).
2. Open the stored board and give me the link, when the snapshot was generated (its read time) and the privacy note: the board is private, it is a snapshot, and sharing it shares the documents of the tracks that are not done.
3. If no board URL is stored, say so and suggest `refresh-board`; do not create one.

Open it with the Artifact tool, action `open`, with the stored URL, and give me the link. Never call `publish` or regenerate anything here.

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `ops/board.md` (2. Find the URL; 4. Show; Rules)

#### 2. Find the URL

Read `board.artifact_url` in `.laneconductor.json`, the optional personal settings file (`ops/settings.md`). The file may be missing or have no `board` key; then there is no stored URL.

#### 4. Show

Artifact tool, action `open`, with the URL; give the human the link. Say: it is private, it is a
snapshot, and when it was generated (`generated_at`). Name the project(s) included (this board
covers this repo's project only).

#### Rules

- Publish only what the script generated: `board.html`, `board.json` and the `ctx/*.json` and `docs/*.json` files it
  listed. Never add, edit or hand-write a file, and never put anything else on the board.
- What the board holds: `board.json` has titles, lanes, status, progress, phase and check reasons.
  The docs files hold the index, plan, spec and test text of every track that is not done (plus
  `conversation.md` only when the settings file has `board.include_conversation: true`; it is off
  by default). The `ctx/*.json` files hold the project definition files (product, tech stack, workflow, quality gate, KPIs, guidelines, stories, deployment) that exist and are not only the untouched scaffold text; `.laneconductor.json` is never one of them. `board.include_docs: false` turns all documents, project files included, off, and then the board is the header
  data only. Each document goes through a secret, email and phone scan first; a file with a match is
  withheld (the page says "withheld: possible secret or personal data" in its place). Tell the human
  what was withheld, by track and file, as in step 1.
- Say so plainly: the documents and the project definition files are on the board, so sharing the board shares them. The page footer
  says the same. Do not turn `board.include_conversation` on yourself; it is the human's choice.
- The board stays private. Sharing is the human's choice from the page's Share menu; never share it.
- Never claim the board is live or updates by itself; to refresh it, run this procedure again.
- If a step fails, report which step and the error; do not publish a partial board.

### `ops/settings.md`

`.laneconductor.json` is an optional settings file at the root of a project. It is personal, not shared: it holds at most a
handful of choices, and one of them (the board URL) is private. Nothing in LaneConductor needs it. Setup never creates it, never
looks for it and never reads it; a project works the same with or without it, and so does a project that still has an older
file with other keys in it. Only the commands that read a key in the table below open it.

A file is created only when a person makes a choice that belongs in it (a different push policy), when Claude first stores the
board URL (`ops/board.md`, step 3b, which asks first), or when a person asks to keep a `next` level (`ops/next.md`, which asks first). Keep the file valid JSON and every key you did not mean to change as it was.

#### Keys

| Key | Values | Default | Read by |
|-----|--------|---------|---------|
| `connector.state_branch` | a safe git branch name | the default branch from `origin/HEAD`, else the current branch if it is `main` or `master`, else `main` | the parallel add-on's connector, the board script |
| `connector.push` | `ask`, `auto-state` | `ask` (never push; always ask the human) | the parallel add-on's connector |
| `board.artifact_url` | the URL of the board artifact | none (no board published yet) | the board commands (`ops/board.md`) |
| `board.include_docs` | `false` turns every document off, project definition files included | on | the board script |
| `board.include_conversation` | `true` adds `conversation.md` to the board documents | off | the board script |
| `project.name` | a string | the folder name | the board script |
| `next.level` | `auto`, `explain`, `short` | `auto` | the `next` command only (`ops/next.md`) |

Example:

```json
{ "project": { "name": "My project" }, "connector": { "push": "ask" }, "board": { "artifact_url": "https://..." } }
```

#### Rules

- Unknown keys are ignored without a message and are never rewritten or removed: an older file keeps working untouched.
- A value that is not valid for its key (a state branch that is not a safe branch name, a push policy that is not listed) is
  reported once by the tool that reads it, and the default is used.
- A file that is not valid JSON is reported once by the tools that read it, and the defaults are used.
- `board.artifact_url` is private, so the file belongs in `.gitignore`. The board procedure adds the line `.laneconductor.json`
  before it stores a URL, after asking. Setup adds nothing for it.
- A missing file, an unreadable file or an unknown `next.level` means `auto`; `next` works the same with no settings file at all.
- `next.level` is written only when the person asks to keep a level, after asking; the `.gitignore` line is added first, as for the board URL.
- To remove the file: delete it. Every key falls back to its default.
