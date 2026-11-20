---
description: Refresh the project board and publish only the files that changed (needs a stored board; /laneconductor:board refresh does a full publish)
---
Refresh the board with a partial publish. Only Claude can publish an artifact (a script or hook cannot), so this is your job; the script does the comparison.

1. Read `board.artifact_url` from `.laneconductor.json`. If there is none, say so, point to `/laneconductor:board` (it asks before creating a board) and stop.
2. Artifact tool, action `read` with that URL (a new conversation must read once before it may update), then `read` with `paths: ["manifest.json", "board.json"]`. If the board has no `manifest.json`, or a read fails, use `none` for both paths below.
3. From the project root (temp dir outside the repo): `site=$(mktemp -d) && node "${CLAUDE_PLUGIN_ROOT}/server/bin/lc-board.mjs" --repo . --site "$site" --json --previous <saved manifest.json or none> --live-board <saved board.json or none>`. If the script is not there or fails, report the error and stop; never build the page by hand.
4. Stdout is one JSON object: `page`, `root`, `files`, `mode` (`partial` or `full`), `changed`, `removed`, `pageChanged`, `publish`. Artifact tool, action `list` with `scope: "files"` and the URL; for each `docs/` or `ctx/` path it shows that is not in `files`, add `"<path>": null` to `publish` (a publish keeps files it is not told about).
5. Artifact tool, action `publish`, `url` set, `file_path` = `page`, `root` = `root`, `files` = the `publish` map and nothing more: the changed files, `null` for removed ones, `manifest.json` and `version.json`. Never edit the page or a file, never add one the script did not list.
6. A conflict or any failure: run step 3 again with `none` for both paths and publish that full `publish` map once; if that fails too, report the step and the error and publish nothing. Tell me if the artifact says I have no edit access; do not make a second board.
7. Report the link, `mode`, how many files were sent of how many, and when it was generated (`generated_at` in `board.json`). stderr lists the files the privacy scan withheld: name each by track number and file, never the matched text.

8. After a successful publish, from the project root: `node "${CLAUDE_PLUGIN_ROOT}/hooks/lc-board-hook.mjs" seen`. It prints nothing; it records that the board now shows the tracks as they are, so the end-of-turn check does not ask for this refresh again.

Privacy: every document goes through the secret, email and phone scan before it is written; a file with a match is withheld and sent with a placeholder. The board stays private; never share it. The board is a snapshot, never live; it changes only when this runs.
