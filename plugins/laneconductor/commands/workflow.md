---
description: Show the lane workflow, or change one lane setting
argument-hint: "[lane key value]"
---
Workflow: `$ARGUMENTS` (nothing given means show). The procedure is the skill file `ops/tracks.md` (`workflow`, `workflow set`).

1. Read `conductor/workflow.json` and print a table: lane, `on_success`, `on_failure` as the resolved `lane:status` (the reference is the skill file `ops/lanes-and-statuses.md`; a bare target is `queue` for another lane, `success` or `failure` for the same lane), retries, model.
2. If the file is still in the older format (bare targets, `auto_action`, the lane names `planning` and `in-progress`), say so and OFFER to rewrite the file to the current format: show the exact new file first, copy the old one to a backup next to it before anything is written, and write nothing until I say yes. Never rename lanes in existing tracks. It works as it is, so declining changes nothing.
3. With `lane key value`, confirm the one field with me, change only that field in the file, and print `workflow.json updated: lanes.<lane>.<key> = <value>`. Edit nothing else.
