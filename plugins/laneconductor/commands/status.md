---
description: Show where one track, or all tracks, stand
argument-hint: "[track number]"
---
Show status for: `$ARGUMENTS` (nothing given means every track not done). Read only; change nothing. The procedure is the skill file `ops/tracks.md` (`status`).

1. With a track number or title: read its `index.md` and the end of `conversation.md`, and report lane, lane status, progress, phase, summary and the last conversation entries, and whether a human comment is waiting for a reply.
2. With nothing: read every track's `index.md` under `conductor/tracks/` and print the tracks grouped by lane, one line each (id, title, lane status, progress).
3. End by saying that `next` names the one step to take.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__get_track`, `mcp__plugin_laneconductor-parallel_lc__list_tracks`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.
