---
description: Create a new track from a title and a problem statement
argument-hint: <title: what and why>
---
Create a track for: `$ARGUMENTS`. The procedure is the laneconductor skill's `ops/tracks.md` (`newTrack`).

1. Call the connector's `list_tracks` with a `query` from the title first, so you extend an existing track instead of duplicating it; if one matches, show it and ask whether to use it.
2. Otherwise call `create_track` with a short `title` and a `problem` in my words (add `type` only if it is not dev). It returns the track number and a `base`.
3. Report the number and folder. Do not plan it unless I ask; `/laneconductor:plan` is the next step.
