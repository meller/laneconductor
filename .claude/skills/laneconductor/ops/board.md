# board: show or update the project's board

For "board", "show the board", "update the board", "refresh the board" or `/laneconductor board`.
The board is a private Claude artifact: a static page that reads a snapshot (`board.json`) of this
project's tracks. Only Claude can create or update an artifact (a script or the connector cannot),
so this is your job; the code does the deterministic part. Never call the board live: it is as
fresh as its "generated at" time.

## 1. Generate

From the project root:

```
site=$(mktemp -d) && lc board --site "$site"
```

No `lc` on PATH but the LaneConductor plugin is installed: `node ${CLAUDE_PLUGIN_ROOT}/server/bin/lc-board.mjs --repo . --site "$site"`.
Neither exists: say so and stop. The temp dir stays outside the repo (the command refuses a folder
under `conductor/`). It prints two absolute paths, one per line: `board.html` (the page, identical
every time, no data in it) and `board.json` (the data: project, generated_at, tracks, attn).

## 2. Find the URL

Read `board.artifact_url` in `.laneconductor.json` (the file is gitignored; it may have no `board` key).

## 3a. URL exists: update

1. Artifact tool, action `read`, with that URL. A new conversation must read once before it may update.
2. Artifact tool, action `publish`, with `url` set, `file_path` = the `board.html` path and
   `files: {"board.json": "<the board.json path>"}`. If the read showed a page identical to the
   generated `board.html`, the page is already right; the publish still passes both so `board.json`
   is replaced. Never edit the page to put data in it.
3. If the read says you have no edit access, say so, do not create a second board silently: ask.

## 3b. No URL: create

1. Ask the human: "Create a private board for this project?" Wait for a yes. Create nothing without it.
2. Artifact tool, action `publish`, `file_path` = the `board.html` path, `files: {"board.json": "<path>"}`,
   `icon: "board"`, `description`: one sentence, e.g. "Tracks by lane for <project>, a snapshot read from the track files."
   Load the artifact-design skill only if you must change the page (normally you do not).
3. Merge the returned URL into `.laneconductor.json` as `board.artifact_url`, keeping the file valid
   JSON and every other key as it was.

## 4. Show

Artifact tool, action `open`, with the URL; give the human the link. Say: it is private, it is a
snapshot, and when it was generated (`generated_at`). Name the project(s) included (this board
covers this repo's project only).

## Rules

- Publish only the two generated files. Never put conversation text, spec/plan bodies or any other
  file content on the board: the data holds titles, lanes, status, progress, phase and check reasons only.
- The board stays private. Sharing is the human's choice from the page's Share menu; never share it.
- Never claim the board is live or updates by itself; to refresh it, run this command again.
- If a step fails, report which step and the error; do not publish a partial board.
