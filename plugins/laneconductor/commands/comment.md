---
description: Add a comment to a track's conversation
argument-hint: <track number> <comment text>
---
Arguments: `$ARGUMENTS` (track number, then comment text).

Add a comment to track <track>: <text>. The procedure is the skill file `ops/tracks.md` (`comment`).

1. Find the track's folder if the number is unclear, then append my words to its `conversation.md` as `> **human**: <my words>` (every further line also starts with `> `); create the file if it is missing.
2. Confirm the entry was added. Do not answer it or change the track unless I ask.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__get_track`, `mcp__plugin_laneconductor-parallel_lc__append_conversation`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.
