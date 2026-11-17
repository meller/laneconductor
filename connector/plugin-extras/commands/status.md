---
description: Show where one track, or all tracks, stand
argument-hint: "[track number]"
---
Show status for `$ARGUMENTS` (empty means every track not done). Read only; change nothing. The procedure is the laneconductor skill's `ops/tracks.md` (`status`).

1. Use the connector's tools (`mcp__plugin_laneconductor_lc__*`), as the steps say. If the connector's tools are unavailable (its MCP server failed to start), read the track files directly, following the skill's `ops/tracks.md`.
2. With a track number or title: call `get_track` (or read the track's `index.md` and the end of `conversation.md`) and report lane, lane status, progress, phase, summary and the last conversation entries, and whether a human comment is waiting for a reply.
3. With nothing: call `list_tracks` (or read each `index.md`) and print the tracks grouped by lane, one line each (id, title, lane status, progress).
4. If a connector result says it is stale or possibly stale, say so before relying on it.
