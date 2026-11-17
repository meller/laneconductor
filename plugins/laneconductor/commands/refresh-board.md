---
description: Rebuild the board from the track files and republish it to its stored URL
---
Refresh the board: rebuild its page and data from the track files and republish them to the stored URL. The procedure is the skill file `ops/board.md`; follow it, including its privacy handling.

1. Generate the page and data (step 1): `lc board --site <dir> --json`, or the board script when `lc` is missing. If neither exists, say so and stop; do not build the page by hand.
2. Find the stored URL (step 2) and update that board in place (step 3a). If no URL is stored, ask me "Create a private board for this project?" and create nothing without my yes (step 3b).
3. Report the link, when it was generated, and anything the privacy scan withheld, by track number and file name.

Only Claude can publish an artifact (the Artifact tool, actions `read`, `list`, `publish`); no connector tool does it, so this is your job.

Generating the board needs the plugin's own board script or the `lc` command on PATH. The script is `server/bin/lc-board.mjs` in this plugin: find it with Glob `**/laneconductor/**/server/bin/lc-board.mjs` under `~/.claude/plugins` (the `${CLAUDE_PLUGIN_ROOT}` variable may not be substituted in command text) and run `node <that path> --repo . --site "$site" --json`, or use `lc board --site "$site" --json` when `lc` is on PATH. If neither exists, say so plainly and stop; do not try to build the page by hand.
