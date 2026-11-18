---
description: Create a new track from a title and a problem statement
argument-hint: "<title: what and why>"
---
Create a track for: `$ARGUMENTS`. The procedure is the skill file `ops/tracks.md` (`newTrack`).

1. Search first; update is the default, create is the fallback. Read `conductor/tracks-summary.md` if it exists (every track, every lane, the backlog and done too), otherwise Glob `conductor/tracks/*/index.md` and read the titles, lanes and summaries; look for the key words of the title (several words, one at a time). Read the best matches. If one fits, say so and ask me "Update track N (title, lane) with this? [default: yes]". On yes, or no answer, extend that track (its `spec.md` or `plan.md`, and a comment in `conversation.md`) and do NOT create a track; a done track is reopened only on my explicit yes. Only if I say no, or nothing fits, create the track by hand as `newTrack` describes, and say which tracks you looked at and why none fit. Several small gaps from one session go into one fitting track, an epic or one backlog track, not one track each. The track you create gets its folder and files by hand as `newTrack` describes, a short title and the problem in my words (set `**Type**` only if it is not dev).
2. Report the number and folder of the track you updated or created. Do not plan it unless I ask; `plan` is the next step.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__list_tracks`, `mcp__plugin_laneconductor-parallel_lc__update_track`, `mcp__plugin_laneconductor-parallel_lc__get_track`, `mcp__plugin_laneconductor-parallel_lc__create_track`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.
