---
description: Show or refresh the project board (asks which when unclear)
argument-hint: "[show | update]"
---
Board: `$ARGUMENTS`. `show` means the existing board, `update` means refresh it. If that is empty or unclear, ask me which one I want before doing anything: showing the existing board (never regenerates) or refreshing it (rebuild and republish).

To show:
Show the existing board. Read only: never regenerate or republish it.

1. Find the stored board URL (`board.artifact_url` in the optional settings file `.laneconductor.json`, see the skill file `ops/settings.md`; step 2 of `ops/board.md`).
2. Open the stored board and give me the link, when the snapshot was generated (its read time) and the privacy note: the board is private, it is a snapshot, and sharing it shares the documents of the tracks that are not done.
3. If no board URL is stored, say so and suggest `refresh-board`; do not create one.

To update:
Refresh the board: rebuild its page and data from the track files and republish them to the stored URL. The procedure is the skill file `ops/board.md`; follow it, including its privacy handling.

1. Generate the page and data (step 1) with the board script, found as step 1 of `ops/board.md` says. If it does not exist, say so and stop; do not build the page by hand.
2. Find the stored URL (step 2) and update that board in place (step 3a). If no URL is stored, ask me "Create a private board for this project?" and create nothing without my yes (step 3b).
3. Report the link, when it was generated, and anything the privacy scan withheld, by track number and file name.

Only Claude can publish an artifact (the Artifact tool, actions `read`, `list`, `publish`); no script does it, so this is your job.

Open it with the Artifact tool, action `open`, with the stored URL, and give me the link. Never call `publish` or regenerate anything here.

Generating the board needs the board script of the optional laneconductor-board add-on: find it with Glob `**/laneconductor-board/**/bin/lc-board.mjs` under `~/.claude/plugins/cache` and run `node <that path> --repo . --site "$site" --json`. If neither exists, the laneconductor-board add-on is not installed: say so in one sentence, then show me these commands as written (I run them myself; never run an install command yourself), and do nothing else: do not build the page by hand and do not publish anything. It installs a script (a Node.js program, no packages) and its page on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-board@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-board@laneconductor` instead (that opens the plugin's details for review).

More: https://github.com/meller/laneconductor
