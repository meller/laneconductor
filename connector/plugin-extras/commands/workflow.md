---
description: Show the lane workflow, or change one lane setting
argument-hint: "[lane key value]"
---
Workflow: `$ARGUMENTS` (empty means show). The procedure is the laneconductor skill's `ops/tracks.md` (`workflow`, `workflow set`).

1. Read `conductor/workflow.json` and print a table: lane, auto action, `on_success`, `on_failure`, retries, model.
2. With `lane key value`, confirm the one field with me, change only that field in the file, and print `workflow.json updated: lanes.<lane>.<key> = <value>`. Edit nothing else.
