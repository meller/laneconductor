---
description: Rebuild the board from the track files and republish it to its stored URL
---
Refresh the board: rebuild its page and data from the track files and republish them to the stored URL. The procedure is the skill file `ops/board.md`; follow it, including its privacy handling.

1. Generate the page and data (step 1): `lc board --site <dir> --json`, or the board script when `lc` is missing. If neither exists, say so and stop; do not build the page by hand.
2. Find the stored URL (step 2) and update that board in place (step 3a). If no URL is stored, ask me "Create a private board for this project?" and create nothing without my yes (step 3b).
3. Report the link, when it was generated, and anything the privacy scan withheld, by track number and file name.

Only Claude can publish an artifact (the Artifact tool, actions `read`, `list`, `publish`); no script does it, so this is your job.

Generating the board needs the board script of the optional laneconductor-board add-on: find it with Glob `**/laneconductor-board/**/bin/lc-board.mjs` under `~/.claude/plugins/cache` and run `node <that path> --repo . --site "$site" --json`, or use `lc board --site "$site" --json` when `lc` is on PATH. If neither exists, the laneconductor-board add-on is not installed: say so in one sentence, then show me these commands as written (I run them myself; never run an install command yourself), and do nothing else: do not build the page by hand and do not publish anything. It installs a script (a Node.js program, no packages) and its page on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-board@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-board@laneconductor` instead (that opens the plugin's details for review).

More: https://github.com/meller/laneconductor
