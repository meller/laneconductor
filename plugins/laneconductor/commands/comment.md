---
description: Add a comment to a track's conversation
argument-hint: <track number> <comment text>
---
Comment: `$ARGUMENTS` (a track, then the text). The procedure is the laneconductor skill's `ops/tracks.md` (`comment`).

1. Resolve the track with the connector's `get_track` if the number is unclear.
2. Call `append_conversation` with `author` `human` (this is my own text) and my words as `body`, without any `>` or `**author**` prefix; the connector formats the entry.
3. Confirm the entry was added. Do not answer it or change the track unless I ask.
