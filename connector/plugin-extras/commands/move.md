---
description: Move a track to another lane, or set its status markers
argument-hint: <track number> <lane[:status]>
---
Move: `$ARGUMENTS` (a track and a `lane` or `lane:status`; a bare lane means `queue`). The procedure is the laneconductor skill's `ops/tracks.md` (`move`, `pulse`, `updateTrack`).

1. Check `conductor/workflow.json` for a `lane:status` that lane defines.
2. Use the connector's tools (`mcp__plugin_laneconductor_lc__*`), as the steps say. Call `get_track`, then `update_track` with the `base` from `get_track` and `markers` such as `{"Lane": "implement", "Lane Status": "queue"}`; a progress or phase update is the same call with `Progress` or `Phase`. On a CONFLICT, re-read with `get_track`, merge, and retry; never work around it.
3. If the connector's tools are unavailable (its MCP server failed to start), do the same by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change. Here that means changing only the marker lines in the track's `index.md`.
4. Say what changed. Moving a track only sets markers; it starts no work.
