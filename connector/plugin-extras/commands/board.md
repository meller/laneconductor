---
description: Show or refresh the project's board (every track by lane)
argument-hint: "[show | update]"
---
Board: `$ARGUMENTS` (empty means show, creating it if there is none). The procedure is the laneconductor skill's `ops/board.md`; read it and follow it, including its privacy handling.

Generating the board needs the `laneconductor-board` plugin or the `lc` command on PATH. If neither exists, say so plainly and stop; do not try to build the page by hand.

1. Generate the page and data as `ops/board.md` step 1 says, then find the stored URL (step 2).
2. Publish or update the private artifact as steps 3a/3b say. Only Claude can publish an artifact, so this is your job; no connector tool does it.
3. Report the URL and anything the privacy scan withheld, by track number and file name.
