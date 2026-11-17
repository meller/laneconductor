---
description: Add a comment to a track's conversation
argument-hint: <track number> <comment text>
---
Comment: `$ARGUMENTS` (a track, then the text). The procedure is the laneconductor skill's `ops/tracks.md` (`comment`).

1. With the `laneconductor-connector` plugin its tools (`mcp__plugin_laneconductor-connector_lc__*`) are available: use them, as the steps say. Resolve the track with `get_track` if the number is unclear, then call `append_conversation` with `author` `human` (this is my own text) and my words as `body`, without any `>` or `**author**` prefix; the connector formats the entry.
2. Without the connector, do the same by editing the track files directly, following the skill (`ops/tracks.md` has the formats): re-read a file right before editing it and change only the lines you mean to change. Append the entry to the track's `conversation.md` in the format the skill gives (`> **human**: ...`).
3. Confirm the entry was added. Do not answer it or change the track unless I ask.
