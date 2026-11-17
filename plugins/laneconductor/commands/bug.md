---
description: File a bug as a track (a bug form with a regression-test case)
argument-hint: <what is broken, and how to reproduce it>
---
File a bug track for: `$ARGUMENTS`. The procedure is the skill file `ops/tracks.md` (`reportaBug`).

1. Call `list_tracks` with a `query` from the symptom first; if a track already covers it, show it and ask whether to add to it (`append_conversation`) instead. Otherwise call `create_track` with `track_kind` set to `bug`, a short `title` and a `problem` giving the symptom, the steps to reproduce and the expected result, in my words. The connector writes the bug form (Symptom, Steps to reproduce, Expected result, Actual result, Suspected area, Environment) and a regression-test case first in test.md.
2. Report the number and folder. Do not start fixing it unless I ask.

Use the connector's tools (`mcp__plugin_laneconductor_lc__*`) when they are present. If the connector's tools are unavailable (its MCP server failed to start), do the same by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.
