---
description: Add a comment to a track's conversation
argument-hint: <track number> <comment text>
---
Arguments: `$ARGUMENTS` (track number, then comment text).

Add a comment to track <track>: <text>. The procedure is the skill file `ops/tracks.md` (`comment`).

1. Resolve the track with `get_track` if the number is unclear, then call `append_conversation` with `author` `human` (this is my own text) and my words as `body`, without any `>` or `**author**` prefix; the connector formats the entry.
2. Confirm the entry was added. Do not answer it or change the track unless I ask.

Use the connector's tools (`mcp__plugin_laneconductor_lc__*`) when they are present. If the connector's tools are unavailable (its MCP server failed to start), do the same by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.
