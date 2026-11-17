---
description: Move a track to another lane, or set its status markers
argument-hint: <track number> <lane[:status]>
---
Move: `$ARGUMENTS` (a track and a `lane` or `lane:status`; a bare lane means `queue`). The procedure is the laneconductor skill's `ops/tracks.md` (`move`, `pulse`, `updateTrack`).

1. Call the connector's `get_track`, and check `conductor/workflow.json` for a `lane:status` that lane defines.
2. Call `update_track` with the `base` from `get_track` and `markers` such as `{"Lane": "implement", "Lane Status": "queue"}`; a progress or phase update is the same call with `Progress` or `Phase`. Never hand-edit index.md markers when the connector is available.
3. On a CONFLICT, re-read with `get_track`, merge, and retry; never work around it.
4. Say what changed. Moving a track only sets markers; it starts no work.
