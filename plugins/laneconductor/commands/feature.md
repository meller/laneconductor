---
description: File a feature request as a track (a feature form)
argument-hint: <the feature and why it is wanted>
---
File a feature track for: `$ARGUMENTS`. The procedure is the skill file `ops/tracks.md` (`featureRequest`).

1. Call `list_tracks` with a `query` from the request first; if a track already covers it, show it and ask whether to add to it (`append_conversation`) instead. Otherwise call `create_track` with `track_kind` set to `feature`, a short `title` and a `problem` giving the need and the wanted outcome, in my words. The connector writes the feature form (The need, Who it is for, Wanted outcome, Acceptance criteria, Out of scope).
2. Report the number and folder. Do not start planning it unless I ask.

Use the connector's tools (`mcp__plugin_laneconductor_lc__*`) when they are present. If the connector's tools are unavailable (its MCP server failed to start), do the same by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.
