---
description: Show or refresh the project board (asks which when unclear)
argument-hint: "[show | update]"
---
Board: `$ARGUMENTS`. `show` means the existing board, `update` means refresh it. If that is empty or unclear, ask me which one I want before doing anything: showing the existing board (never regenerates) or refreshing it (rebuild and republish).

To show:
Show the existing board. Read only: never regenerate or republish it.

1. Find the stored board URL (`board.artifact_url` in `.laneconductor.json`; step 2 of the skill file `ops/board.md`).
2. Open the stored board and give me the link, when the snapshot was generated (its read time) and the privacy note: the board is private, it is a snapshot, and sharing it shares the documents of the tracks that are not done.
3. If no board URL is stored, say so and suggest `refresh-board`; do not create one.

To update:
Refresh the board: rebuild its page and data from the track files and republish them to the stored URL. The procedure is the skill file `ops/board.md`; follow it, including its privacy handling.

1. Generate the page and data (step 1): `lc board --site <dir> --json`, or the board script when `lc` is missing. If neither exists, say so and stop; do not build the page by hand.
2. Find the stored URL (step 2) and update that board in place (step 3a). If no URL is stored, ask me "Create a private board for this project?" and create nothing without my yes (step 3b).
3. Report the link, when it was generated, and anything the privacy scan withheld, by track number and file name.

Only Claude can publish an artifact (the Artifact tool, actions `read`, `list`, `publish`); no connector tool does it, so this is your job.

Open it with the Artifact tool, action `open`, with the stored URL, and give me the link. Never call `publish` or regenerate anything here.

Generating the board needs the plugin's own board script or the `lc` command on PATH. The script is `server/bin/lc-board.mjs` in this plugin: find it with Glob `**/laneconductor/**/server/bin/lc-board.mjs` under `~/.claude/plugins` (the `${CLAUDE_PLUGIN_ROOT}` variable may not be substituted in command text) and run `node <that path> --repo . --site "$site" --json`, or use `lc board --site "$site" --json` when `lc` is on PATH. If neither exists, say so plainly and stop; do not try to build the page by hand.
