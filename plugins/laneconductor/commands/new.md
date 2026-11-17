---
description: Create a new track from a title and a problem statement
argument-hint: <title: what and why>
---
Create a track for: `$ARGUMENTS`. The procedure is the laneconductor skill's `ops/tracks.md` (`newTrack`).

1. Use the connector's tools (`mcp__plugin_laneconductor_lc__*`), as the steps say. Call `list_tracks` with a `query` from the title first, so you extend an existing track instead of duplicating it; if one matches, show it and ask whether to use it. Otherwise call `create_track` with a short `title` and a `problem` in my words (add `type` only if it is not dev); it returns the track number and a `base`.
2. If the connector's tools are unavailable (its MCP server failed to start), do the same by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change. Create the folder and its files as `ops/tracks.md` describes, after checking `conductor/tracks/` for an existing track.
3. Report the number and folder. Do not plan it unless I ask; `/laneconductor:plan` is the next step.
