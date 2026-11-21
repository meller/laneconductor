---
description: Open the project board, or refresh it with the argument refresh
argument-hint: "[refresh]"
---
Board: `$ARGUMENTS` (nothing given means open the existing board). This one command covers the board: no argument opens the existing board, `refresh` rebuilds and republishes it. If the argument is anything else, ask me which one I mean before doing anything.

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

If it is empty, open:
Open the existing board. Read only: never regenerate or republish it.

1. Find the stored board URL (`board.artifact_url` in the optional settings file `.laneconductor.json`, see the skill file `ops/settings.md`; step 2 of `ops/board.md`).
2. Open the stored board and give me the link, when the snapshot was generated (its read time) and the privacy note: the board is private, it is a snapshot, and sharing it shares the documents of the tracks that are not done. If it is more than an hour old, say so and suggest refreshing it (this command with the argument `refresh`; the page also has a Refresh board button that copies it).
3. If no board URL is stored, first look for the board of this project among the artifacts (step 2 of `ops/board.md`: match the `project` in the `board.json` of each board; never ask which one). With no match there is no board yet and running this command means I want one: do not ask. Follow the refresh procedure below, which builds and publishes it (step 3b of `ops/board.md`), store the link and open it. If the board add-on is not installed, say that it has to be installed first and show the install commands, as below.

If it is `refresh`, refresh:
Refresh the board: rebuild its page and data from the track files and republish them to the stored URL. The procedure is the skill file `ops/board.md`; follow it, including its privacy handling.

1. Generate the page and data (step 1) with the board script, found as step 1 of `ops/board.md` says. If it does not exist, say so and stop; do not build the page by hand.
2. Find the stored URL (step 2) and update that board in place (step 3a). If no URL is stored, find the board of this project by the `project` in the `board.json` of each board (step 2), else create it now without asking (step 3b), store the URL and open it. With a stored URL it is a partial publish: read the live `manifest.json` and `board.json`, pass them to the script as `--previous` and `--live-board`, send only what `publish` lists, then record the state with the `seen` step of the hook script (3a). When the check at a lane start or at the end of a turn asked for it, say nothing unless it failed.
3. Report the link, when it was generated, and anything the privacy scan withheld, by track number and file name. For a board created now, also say what it holds: private, a snapshot, the documents of every track that is not done, and that `board.include_docs: false` turns the documents off.

In Claude Code, type the refresh as `/laneconductor:board refresh`.

Only Claude can publish an artifact (the Artifact tool, actions `read`, `list`, `publish`); no script does it, so this is your job.

To open it, use the Artifact tool, action `open`, with the stored URL, and give me the link. Opening never calls `publish` or regenerates anything; only `refresh` does.

Generating the board needs the board script of the optional laneconductor-board add-on: find it with Glob `**/laneconductor-board/**/bin/lc-board.mjs` under `~/.claude/plugins/cache` and run `node <that path> --repo . --site "$site" --json`. If neither exists, the laneconductor-board add-on is not installed: say so in one sentence, then show me these commands as written (I run them myself; never run an install command yourself), and do nothing else: do not build the page by hand and do not publish anything. It installs a script (a Node.js program, no packages) and its page on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-board@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-board@laneconductor` instead (that opens the plugin's details for review).

More: https://github.com/meller/laneconductor

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `ops/board.md`

For `/laneconductor:board` (no argument opens the board; `refresh` rebuilds and republishes it), "board", "show the board", "update the board" or "refresh the board".
The board is a private Claude artifact: a static page that reads a snapshot (`board.json`) of this
project's tracks. Only Claude can create or update an artifact (a script or the connector cannot),
so this is your job; the code does the deterministic part. Never call the board live: it is as
fresh as its "generated at" time.

#### 1. Generate

The page is built by the board script of the optional `laneconductor-board` add-on. Find it with Glob
`**/laneconductor-board/**/bin/lc-board.mjs` under `~/.claude/plugins/cache`, or `connector/bin/lc-board.mjs` in the
LaneConductor repository. From the project root:

```
site=$(mktemp -d) && node <that path> --repo . --site "$site" --json
```

When you update a stored board (step 3a) add `--previous` and `--live-board`, described there.

If the script is not found, the laneconductor-board add-on is not installed: say so in a sentence, show the commands in "If the board script is missing" at the end of this file, and stop. The temp dir stays outside the repo (the script refuses a folder
under `conductor/`). Stdout is one JSON object and nothing else: `{ "page": "<dir>/board.html",
"root": "<dir>", "files": ["board.json", "ctx/overview.json", "docs/1.json", ...] }`. `board.html` is the page (identical
every time, no data in it); `board.json` is the data (project, generated_at, tracks, attn); each
`docs/<number>.json` holds the documents (index, plan, spec, tests) of one track that is not done,
shown when a track is opened. Each `ctx/<key>.json` holds one project definition file (product, tech stack, workflow, quality gate, KPIs, guidelines, stories), shown under the Project button; it is read from the conductor folder when the board is built. Pass `page` as `file_path` and `root` as `root` to the Artifact tool,
and `files` as a map from each listed path to itself (`{"board.json": "board.json", "ctx/overview.json": "ctx/overview.json", "docs/1.json": "docs/1.json", ...}`; the
sources resolve against `root`).

stderr lists anything the privacy scan withheld, one line per file (`board: withheld track 10106
spec.md: 2 possible secret or personal data matches (lines 3, 4); not published`), and any tracks
left without documents because of the 200-file limit. Report each withheld file to the human by
track number and file name (never repeat or look for the matched text), except when quiet (3a, step 8). A site has at most 200 ctx and docs
files together, plus `board.json` and the page, well under the Artifact tool's 255 files per publish; if you
ever see more files than that, stop and say so instead of publishing part of the set.

#### 2. Find the URL

Read `board.artifact_url` in `.laneconductor.json`, the optional personal settings file (`ops/settings.md`), at the project root; in a git worktree that has none, in the main checkout's (the first path of `git worktree list`). The file may be missing or have no `board` key.

With no stored URL, look for this project's board before creating one, and never ask which one: Artifact tool, action `list`; for each artifact titled like a board (`<project> Board` or `LaneConductor Board`), `read` its `board.json` and compare its `project` with this project's name (`project.name` in the settings file, else the folder name). One match: use it as the stored URL (store it as in 3b, step 3) and update it (3a). Several: use the most recently updated and name the others in one line. None: create (3b).

#### 3a. URL exists: update (a partial publish: only the files that changed)

1. Artifact tool, action `read`, with that URL (a new conversation must read once before it may update), then `read` with `paths: ["manifest.json", "board.json"]`; keep the saved paths, or use `none` for both when the board has no `manifest.json` or a read fails.
2. Run step 1 with `--previous <saved manifest.json or none> --live-board <saved board.json or none>`. Stdout then also has `mode` (`partial` or `full`), `changed`, `removed`, `pageChanged` and `publish`, the map to send.
3. Artifact tool, action `list` with `scope: "files"` and that `url`: every `docs/<n>.json` or `ctx/<key>.json` it shows that is not in `files` belongs to a track that is now done, dropped or withheld entirely, or to a project file that is gone; add it to `publish` as `"<path>": null` (a publish keeps files it is not told about).
4. Artifact tool, action `publish`, with `url` set, `file_path` = `page`, `root` = `root` and `files` = the `publish` map and nothing more: the changed files, the `null`s, `manifest.json` and `version.json`. Never edit the page or add a file the script did not list.
5. A conflict or any failure: run step 2 again with `none` for both and publish that map once; if that fails too, report the step and the error and publish nothing.
6. If the read says you have no edit access, say so, do not create a second board silently: ask.
7. After a success, from the project root run `node <path> seen`, with `<path>` found by Glob `**/laneconductor-board/**/hooks/lc-board-hook.mjs` under `~/.claude/plugins/cache` (skip it if not found). It prints nothing: it records that the board shows the tracks as they are, so the end-of-turn check does not ask for this refresh again.
8. **Quiet.** When the check at a lane start or at the end of a turn asked for this (its message says quietly), report nothing, not the link, the counts or the withheld files, unless a step failed: then one line with the step and the error.

#### 3b. No URL: create

1. Do not ask: running the board command means the human wants a board, and a private one changes nothing outside the Claude artifact and the settings file. (Only if the board script is missing, stop as step 1 says and name the install commands.)
2. Artifact tool, action `publish`, `file_path` = `page`, `root` = `root`, `files` = the map from step 1,
   `icon: "board"`, `description`: one sentence, e.g. "Tracks by lane for <project>, a snapshot read from the track files."
   Load the artifact-design skill only if you must change the page (normally you do not).
3. Merge the returned URL into `.laneconductor.json` as `board.artifact_url`, keeping the file valid
   JSON and every other key as it was (create the file if it does not exist). The URL is private, so
   first make sure `.laneconductor.json` is listed in `.gitignore`; if it is not, say that you will add
   the line and ask first, because it changes a project file.
4. After step 4 (show), say what the board holds: it is private, a snapshot, it includes the index, plan, spec and test documents of every track that is not done (name a few), what the privacy scan withheld (by track number and file), and that `board.include_docs: false` in the settings file turns the documents off.

#### 4. Show

Artifact tool, action `open`, with the URL; give the human the link. Say: it is private, it is a
snapshot, and when it was generated (`generated_at`). Name the project(s) included (this board
covers this repo's project only). If `generated_at` is more than an hour old, suggest `/laneconductor:board refresh`.

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
- Never claim the board is live or updates by itself; to refresh it, run this procedure again (`/laneconductor:board refresh`). The page shows how old it is, and in the Claude desktop app with the local connector it can check whether the repository has moved on (a read only check); its Refresh board button only copies that command, because only Claude can rebuild and republish a board.
- If a step fails, report which step and the error; do not publish a partial board.

#### If the board script is missing

The board page is built by a small script from the laneconductor-board add-on, which is optional and not part of this plugin. Without it,
say that in a sentence or two, then show these commands as written. The person runs them; never run an install command yourself.
It installs a script (a Node.js program, no packages) and its page on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory. Do not look for another way to build the board, do not write the page by hand, and do not publish anything.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-board@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-board@laneconductor` instead (that opens the plugin's details for review).

Everything else in LaneConductor works without it. More: https://github.com/meller/laneconductor

### `ops/settings.md`

`.laneconductor.json` is an optional settings file at the root of a project. It is personal, not shared: a handful of choices,
one of them (the board URL) private. Nothing needs it. Setup never creates, looks for or reads it; a project works the same with
or without it. Only the commands that read a key below open it.

A file is created only when a person makes a choice that belongs in it (a different push policy), when Claude first stores the
board URL (`ops/board.md`, step 3b, which asks first), when a person asks to keep a `next` level (`ops/next.md`, which asks first), or when a person says "don't ask again" to a skill offer (which asks first). Keep the file valid JSON and every key you did not mean to change as it was.

#### Keys

| Key | Values | Default | Read by |
|-----|--------|---------|---------|
| `connector.state_branch` | a safe git branch name | the default branch from `origin/HEAD`, else the current branch if it is `main` or `master`, else `main` | the parallel add-on's connector, the board script |
| `connector.push` | `ask`, `auto-state` | `ask` (never push; always ask the human) | the parallel add-on's connector |
| `board.artifact_url` | the URL of the board artifact | none (no board published yet) | the board commands (`ops/board.md`) |
| `board.include_docs` | `false` turns every document off, project definition files included | on | the board script |
| `board.include_conversation` | `true` adds `conversation.md` to the board documents | off | the board script |
| `board.auto_update` | `false` turns off the board add-on's end-of-turn prompt to refresh a stored board | on when a board is stored | the board add-on's hooks |
| `project.name` | a string | the folder name | the board script |
| `next.level` | `auto`, `explain`, `short` | `auto` | the `next` command only (`ops/next.md`) |
| `skills.declined` | a list of skill-catalog entry names | none | the skill offers (`ops/suggest-skills.md`) |

Example:

```json
{ "project": { "name": "My project" }, "connector": { "push": "ask" }, "board": { "artifact_url": "https://..." } }
```

#### Rules

- Unknown keys are ignored and never rewritten or removed, so an older file keeps working untouched.
- A value that is not valid for its key (an unsafe state branch, an unlisted push policy), or a file that is not valid JSON, is
  reported once by the tool that reads it, and the default is used.
- `board.artifact_url` is private, so the file belongs in `.gitignore`. The board procedure adds the line `.laneconductor.json`
  before it stores a URL, after asking. Setup adds nothing for it.
- A missing or unreadable file or an unknown `next.level` means `auto`.
- `next.level` (the person asks to keep a level) and `skills.declined` (the person says "don't ask again") are written only after a yes to the exact change shown, with the `.gitignore` line first, as for the board URL. The older `.git/skill-advisor-declined.txt` is still read.
- To remove the file: delete it. Every key falls back to its default.
