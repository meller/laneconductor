---
description: Run the quality gate on a track (evaluates, never fixes)
argument-hint: <track number or title>
---
Work on track `$ARGUMENTS` in the quality-gate lane. The procedure is the laneconductor skill's `lanes/quality-gate.md`; follow it and do not restate it here.

1. Use the connector's tools (`mcp__plugin_laneconductor_lc__*`), as the steps say. Call `get_context` with lane `quality-gate`, then `get_track` for the track (`list_tracks` first if I gave a title). Change state only with `update_track`, passing the `base` from `get_track`; on a CONFLICT, re-read and retry.
2. If the connector's tools are unavailable (its MCP server failed to start), do the same by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.
3. Read `lanes/quality-gate.md` in the skill and work through it.
