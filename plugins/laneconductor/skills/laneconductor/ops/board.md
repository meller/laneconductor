# board: show or update the project's board

For "board", "show the board", "update the board", "refresh the board" or `/laneconductor board`.
The board is a private Claude artifact: a static page that reads a snapshot (`board.json`) of this
project's tracks. Only Claude can create or update an artifact (a script or the connector cannot),
so this is your job; the code does the deterministic part. Never call the board live: it is as
fresh as its "generated at" time.

## 1. Generate

From the project root:

```
site=$(mktemp -d) && lc board --site "$site" --json
```

No `lc` on PATH but the `laneconductor-board` plugin is installed: find its `server/bin/lc-board.mjs` (Glob `**/laneconductor-board/**/server/bin/lc-board.mjs` under `~/.claude/plugins`) and run `node <that path> --repo . --site "$site" --json`.
Neither exists (the main `laneconductor` plugin alone cannot generate the board; `laneconductor-board` can): say so and stop. The temp dir stays outside the repo (the command refuses a folder
under `conductor/`). Stdout is one JSON object and nothing else: `{ "page": "<dir>/board.html",
"root": "<dir>", "files": ["board.json", "docs/1.json", ...] }`. `board.html` is the page (identical
every time, no data in it); `board.json` is the data (project, generated_at, tracks, attn); each
`docs/<number>.json` holds the documents (index, plan, spec, tests) of one track that is not done,
shown when a track is opened. Pass `page` as `file_path` and `root` as `root` to the Artifact tool,
and `files` as a map from each listed path to itself (`{"board.json": "board.json", "docs/1.json": "docs/1.json", ...}`; the
sources resolve against `root`).

stderr lists anything the privacy scan withheld, one line per file (`lc board: withheld track 10099
spec.md: 2 possible secret or personal data matches (lines 3, 4); not published`), and any tracks
left without documents because of the 200-file limit. Report each withheld file to the human by
track number and file name (never repeat or look for the matched text). A site has at most 200 docs
files, plus `board.json` and the page, well under the Artifact tool's 255 files per publish; if you
ever see more files than that, stop and say so instead of publishing part of the set.

## 2. Find the URL

Read `board.artifact_url` in `.laneconductor.json` (the file is gitignored; it may have no `board` key).

## 3a. URL exists: update

1. Artifact tool, action `read`, with that URL. A new conversation must read once before it may update.
2. Artifact tool, action `list` with `scope: "files"` and that `url`: every `docs/<n>.json` it shows
   that is not in the new `files` list belongs to a track that is now done, dropped or withheld
   entirely; add it to the map as `"docs/<n>.json": null` so the old documents are removed (a
   publish keeps files it is not told about).
3. Artifact tool, action `publish`, with `url` set, `file_path` = `page`, `root` = `root` and the
   `files` map. If the read showed a page identical to the generated `board.html`, the page is
   already right; the publish still passes the files so the data and documents are replaced. Never
   edit the page to put data in it.
4. If the read says you have no edit access, say so, do not create a second board silently: ask.

## 3b. No URL: create

1. Ask the human: "Create a private board for this project?" Wait for a yes. Create nothing without it.
2. Artifact tool, action `publish`, `file_path` = `page`, `root` = `root`, `files` = the map from step 1,
   `icon: "board"`, `description`: one sentence, e.g. "Tracks by lane for <project>, a snapshot read from the track files."
   Load the artifact-design skill only if you must change the page (normally you do not).
3. Merge the returned URL into `.laneconductor.json` as `board.artifact_url`, keeping the file valid
   JSON and every other key as it was.

## 4. Show

Artifact tool, action `open`, with the URL; give the human the link. Say: it is private, it is a
snapshot, and when it was generated (`generated_at`). Name the project(s) included (this board
covers this repo's project only).

## Rules

- Publish only what the command generated: `board.html`, `board.json` and the `docs/*.json` files it
  listed. Never add, edit or hand-write a file, and never put anything else on the board.
- What the board holds: `board.json` has titles, lanes, status, progress, phase and check reasons.
  The docs files hold the index, plan, spec and test text of every track that is not done (plus
  `conversation.md` only when `.laneconductor.json` has `board.include_conversation: true`; it is off
  by default). `board.include_docs: false` turns all documents off, and then the board is the header
  data only. Each document goes through a secret, email and phone scan first; a file with a match is
  withheld (the page says "withheld: possible secret or personal data" in its place). Tell the human
  what was withheld, by track and file, as in step 1.
- Say so plainly: the documents are on the board, so sharing the board shares them. The page footer
  says the same. Do not turn `board.include_conversation` on yourself; it is the human's choice.
- The board stays private. Sharing is the human's choice from the page's Share menu; never share it.
- Never claim the board is live or updates by itself; to refresh it, run this command again.
- If a step fails, report which step and the error; do not publish a partial board.
