---
description: File a feature request as a track (a feature form)
argument-hint: <the feature and why it is wanted>
---
File a feature track for: `$ARGUMENTS`. The procedure is the skill file `ops/tracks.md` (`featureRequest`).

1. Look through `conductor/tracks/` for a track that already covers the request; if one does, show it and ask whether to add a comment to it instead. Otherwise create the track by hand as `newTrack` describes, with `**Track Kind**: feature`, a short title and the need and the wanted outcome in my words, using the feature form in `ops/tracks.md` and `setup/templates.md` (The need, Who it is for, Wanted outcome, Acceptance criteria, Out of scope).
2. Report the number and folder. Do not start planning it unless I ask.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__list_tracks`, `mcp__plugin_laneconductor-parallel_lc__append_conversation`, `mcp__plugin_laneconductor-parallel_lc__create_track`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.
