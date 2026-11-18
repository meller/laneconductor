---
description: Merge a finished track, or open its PR
argument-hint: <track number or title>
---
Work on track `$ARGUMENTS` in the merge lane. The procedure is the merge lane guide (skill file `lanes/merge.md`); follow it and do not restate it here.

1. Find the track's folder under `conductor/tracks/` (Glob `conductor/tracks/*<number>*/`; both naming conventions exist, see "Finding a track" in the skill index) and read its `index.md`, `spec.md`, `plan.md`, `test.md` and `conversation.md`. Read the lane guide, and `conductor/workflow.json` for where each lane goes next. The guide is advice.
2. Work through the guide. Change state by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.
3. Ask me before any merge or push; do neither without my yes.
