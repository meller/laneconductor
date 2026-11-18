# Track AM-10147: Owner steps: a track that stops at a real-world action, runs a window, and closes with a result

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Track Kind**: feature
**Type**: dev
**Merge Mode**: direct
**Auto Run**: no
**Author**: AM
**Problem**: Found 2026-11-18 on a real project with 11 marketing-type tracks: the agent finished the preparation (copy, page, tagged links, schedule), then the track stopped at a step only the owner can do (record a video, post in a group, choose a channel, approve spend). LaneConductor has no model for that step: the track sits in `waiting` with a one-line reason and no ready-to-use kit, nothing says when to look at it again, and nothing afterwards reads the result and closes the loop. Some tracks never started; others waited for weeks unseen.

The same stall exists for any track with a human step (our own: submit to a directory, approve a deploy), so this is not only marketing. Owner decision (2026-11-18): do it the LaneConductor way, with files in git, markers, lanes and statuses; no new lanes, no new infrastructure, no marketing tool.

Proposed design (to confirm in the plan lane, see spec.md): an owner step is a track in `waiting` that names ONE concrete action with a due date and a kit; a run window ends on a date; a readout reads the result; the track closes with a result. `next` and the board make the owner actions and the due readouts impossible to miss. The campaign template, channel kits and the readout format are skills (in the person's own library), not core.
**Summary**: Found 2026-11-18 on a real project with 11 marketing-type tracks: the agent finished the preparation (copy, page, tagged links, schedule), then the track stopped at a step only the owner can do (recor
