---
description: Create a new track from a title and a problem statement
argument-hint: "<title: what and why>"
---
Create a track for: `$ARGUMENTS`. The procedure is the skill file `ops/tracks.md` (`newTrack`).

1. Look through `conductor/tracks/` first (Glob, then the titles in the `index.md` files) so you extend an existing track instead of duplicating it; if one matches, show it and ask whether to use it. Otherwise create the track's folder and files by hand as `newTrack` describes, with a short title and the problem in my words (set `**Type**` only if it is not dev).
2. Report the number and folder. Do not plan it unless I ask; `plan` is the next step.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__list_tracks`, `mcp__plugin_laneconductor-parallel_lc__create_track`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.
