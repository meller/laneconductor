---
description: File a bug as a track
argument-hint: <what is broken, and how to reproduce it>
---
File a bug track for: `$ARGUMENTS`. The procedure is the laneconductor skill's `ops/tracks.md` (`reportaBug`).

1. With the `laneconductor-connector` plugin its tools (`mcp__plugin_laneconductor-connector_lc__*`) are available: use them, as the steps say. Call `list_tracks` with a `query` from the symptom first; if a track already covers it, show it and ask whether to add to it (`append_conversation`) instead. Otherwise call `create_track` with `track_kind` set to `bug`, a short `title` and a `problem` giving the symptom, the steps to reproduce and the expected result, in my words.
2. Without the connector, do the same by editing the track files directly, following the skill (`ops/tracks.md` has the formats): re-read a file right before editing it and change only the lines you mean to change. Create the folder and its files as `ops/tracks.md` describes, after checking `conductor/tracks/` for a track that already covers it.
3. Report the number and folder. Do not start fixing it unless I ask.
