# Track 1084: Worker Identity & Assignment

**Lane**: plan
**Lane Status**: success
**Progress**: 0%
**Phase**: Planning complete
**Type**: dev
**Summary**: Per-user worker pinning + explicit track assignment to end random pickup.

## Problem

In remote mode (app + API connected), every worker registered to a project polls
the same shared queue and races to claim any track in `queue` status. There's no
way for a developer to say "this track is mine" — any online worker for the
project might grab it first.

## Solution

- `worker_pins (project_id, user_uid, worker_id)` — each project member picks
  their own worker for a project ("Pin as mine" in the Workers list).
- `tracks.assignee_uid` — nullable, defaults to the track's creator (or project
  owner if creator unknown) when unset.
- Claim logic in `autoLaunchLocalFs` / the API-mode claim path only lets a
  worker claim a track if the resolved assignee is pinned to that worker. If
  the assignee has no pin at all, fall back to today's open-claim behavior —
  zero config needed for single-worker projects.
- UI: "Assignee" control on the track card/detail panel, reassignable to any
  project member, showing the resolved worker's live status.

Full design context: [docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md](../../../docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md)

## Phases
- [ ] Phase 1: Schema — `worker_pins` table, `tracks.assignee_uid` column
- [ ] Phase 2: Assignee resolution — creator/owner default, pin lookup helper
- [ ] Phase 3: Claim logic — scope auto-launch claiming to the resolved assignee's pinned worker, with open-claim fallback
- [ ] Phase 4: UI — Assignee control on track card/detail panel, "Pin as mine" on Workers list
- [ ] Phase 5: Tests — pin resolution, fallback behavior, reassignment, offline-assignee handling

## Depends on
None — this is the foundation for [1085](../1085-manual-worker-dispatch/index.md) and informs the session key in [1086](../1086-persistent-track-sessions/index.md).
