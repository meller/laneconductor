---
description: File a feature request as a track
argument-hint: <the feature and why it is wanted>
---
File a feature track for: `$ARGUMENTS`. The procedure is the laneconductor skill's `ops/tracks.md` (`featureRequest`).

1. Use the connector's tools (`mcp__plugin_laneconductor_lc__*`), as the steps say. Call `list_tracks` with a `query` from the request first; if a track already covers it, show it and ask whether to add to it (`append_conversation`) instead. Otherwise call `create_track` with `track_kind` set to `feature`, a short `title` and a `problem` giving the need and the wanted outcome, in my words.
2. If the connector's tools are unavailable (its MCP server failed to start), do the same by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change. Create the folder and its files as `ops/tracks.md` describes, after checking `conductor/tracks/` for a track that already covers it.
3. Report the number and folder. Do not start planning it unless I ask.
