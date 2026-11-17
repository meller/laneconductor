---
description: Merge a finished track, or open its PR
argument-hint: <track number or title>
---
Work on track `$ARGUMENTS` in the merge lane. The procedure is the laneconductor skill's `lanes/merge.md`; follow it and do not restate it here.

1. Call the connector's `get_context` with lane `merge`, then `get_track` for the track (look it up with `list_tracks` first if I gave a title).
2. Read `lanes/merge.md` in the skill and work through it.
3. Change track state only with the connector's `update_track`, passing the `base` from `get_track`; never hand-edit index.md markers when the connector is available. On a CONFLICT, re-read and retry.
4. Ask me before any merge or push; do neither without my yes.
