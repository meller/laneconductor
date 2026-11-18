---
description: Move a track to another lane, or set its status markers
argument-hint: <track number> <lane[:status]>
---
Arguments: `$ARGUMENTS` (track number, then lane[:status]).

Move track <track> to <lane> (a `lane` or `lane:status`; a bare lane means `queue`). The procedure is the skill file `ops/tracks.md` (`move`, `pulse`, `updateTrack`).

1. Check `conductor/workflow.json` for a `lane:status` that lane defines; use the lane names of that file (a project may call a lane `planning` or `in-progress`).
2. Re-read the track's `index.md` right before editing, then change only the marker lines: `**Lane**` and `**Lane Status**` (a progress or phase update is `**Progress**` or `**Phase**`).
3. Say what changed. Moving a track only sets markers; it starts no work.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__get_context`, `mcp__plugin_laneconductor-parallel_lc__get_track`, `mcp__plugin_laneconductor-parallel_lc__update_track`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.
