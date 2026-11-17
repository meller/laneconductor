---
description: Show where one track, or all tracks, stand
argument-hint: "[track number]"
---
Show status for: `$ARGUMENTS` (nothing given means every track not done). Read only; change nothing. The procedure is the skill file `ops/tracks.md` (`status`).

1. With a track number or title: call `get_track` and report lane, lane status, progress, phase, summary and the last conversation entries, and whether a human comment is waiting for a reply.
2. With nothing: call `list_tracks` and print the tracks grouped by lane, one line each (id, title, lane status, progress).
3. If a result says it is stale or possibly stale, say so before relying on it.

Use the connector's tools (`mcp__plugin_laneconductor_lc__*`) when they are present. If the connector's tools are unavailable (its MCP server failed to start), do the same by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.
