---
description: File a feature request as a track
argument-hint: <the feature and why it is wanted>
---
File a feature track for: `$ARGUMENTS`. The procedure is the laneconductor skill's `ops/tracks.md` (`featureRequest`).

1. Call the connector's `list_tracks` with a `query` from the request first; if a track already covers it, show it and ask whether to add to it (`append_conversation`) instead.
2. Otherwise call `create_track` with `track_kind` set to `feature`, a short `title` and a `problem` giving the need and the wanted outcome, in my words.
3. Report the number and folder. Do not start planning it unless I ask.
