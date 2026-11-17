---
description: File a bug as a track
argument-hint: <what is broken, and how to reproduce it>
---
File a bug track for: `$ARGUMENTS`. The procedure is the laneconductor skill's `ops/tracks.md` (`reportaBug`).

1. Call the connector's `list_tracks` with a `query` from the symptom first; if a track already covers it, show it and ask whether to add to it (`append_conversation`) instead.
2. Otherwise call `create_track` with `track_kind` set to `bug`, a short `title` and a `problem` giving the symptom, the steps to reproduce and the expected result, in my words.
3. Report the number and folder. Do not start fixing it unless I ask.
