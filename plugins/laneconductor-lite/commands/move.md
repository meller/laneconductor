---
description: Move a track to another lane, or set its status markers
argument-hint: <track number> <lane[:status]>
---
Arguments: `$ARGUMENTS` (track number, then lane[:status]).

Move track <track> to <lane> (a `lane` or `lane:status`; a bare lane means `queue`). The procedure is the skill file `ops/tracks.md` (`move`, `pulse`, `updateTrack`).

1. Check `conductor/workflow.json` for a `lane:status` that lane defines.
2. Re-read the track's `index.md` right before editing, then change only the marker lines: `**Lane**` and `**Lane Status**` (a progress or phase update is `**Progress**` or `**Phase**`).
3. Say what changed. Moving a track only sets markers; it starts no work.
