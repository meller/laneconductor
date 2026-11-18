# Track 10136: Parking and resume without a daemon

Nothing resumes a parked track by itself in the plugin world. What the plugin can do: say which parked tracks are ready, make parking explainable, refuse nonsense, and clean up on resume.

Design: a track's dependencies are the union of `Depends On` and `Waiting On Tracks`. A dependency is met when that track is `done:success`. `blocked_by` lists the unmet ones (an unknown number counts as unmet). `ready_to_resume` is true for a track at `waiting` (not in the done lane, `Waiting for reply` not yes) that has dependencies and no unmet one. Resuming is a person or agent calling update_track; nothing here does it.

## Phase 1: text
- [ ] SKILL.md parking paragraph: remove the false reconciler sentence, say how a parked track is resumed; marker table gets Waiting Reason
- [ ] regenerate the plugins; no daemon wording in the base

## Phase 2: connector
- [ ] `connector/src/dependencies.mjs` (pure) + `waiting_on` in the track row
- [ ] list_tracks rows carry `blocked_by` / `ready_to_resume` when they apply, data carries `ready_to_resume` ids; get_track carries `dependencies`; get_context carries `ready_to_resume` ids
- [ ] create_track rejects unknown dependency numbers
- [ ] update_track: setting a Lane Status other than waiting clears Waiting Reason and Waiting On Tracks; warns when a track becomes waiting without Waiting Reason; warns on running with unmet dependencies
- [ ] summary lint: waiting without Waiting Reason (not in the done lane)

## Phase 3: verify
- [ ] `cd connector && npm test` green (KC-8 included); build-plugin --check clean
