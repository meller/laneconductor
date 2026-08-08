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
project might grab it first. Separately, a worker's DB identity today is
`(project_id, hostname, pid)` — since `pid` is ephemeral, a restart mints a
new `workers` row, and the local pidfile is singular per project directory
so only one worker process can run per project per machine. Both of these
need fixing before "pin a worker" can mean anything durable.

## Solution

- **Stable identity first**: a `--worker-number` flag + DB uniqueness on
  `(project_id, hostname, worker_number)` instead of `pid`, so a worker's
  identity (and everything pinned/sessioned against it) survives restarts,
  and multiple worker processes can run for one project on one machine.
- `worker_pins (project_id, user_uid, worker_id)` — a developer can pin
  *multiple* workers to one project ("Pin as mine" per worker in the Workers
  list), not just one — this is what lets one developer plan and implement
  in parallel across different machines.
- `tracks.assignee_uid` — nullable, identifies the responsible *developer*
  (not a specific machine); defaults to the track's creator (or project
  owner if creator unknown) when unset.
- Claim logic in `autoLaunchLocalFs` / the API-mode claim path resolves the
  assignee's candidate pinned workers, then routes with continuity-first:
  if [1086](../1086-persistent-track-sessions/index.md)'s `track_sessions`
  already has a row for this track on one of those candidates, only that
  worker may claim it; otherwise any idle candidate may. If the assignee has
  no pin at all, fall back to today's open-claim behavior — zero config
  needed for single-worker projects.
- UI: "Assignee" control on the track card/detail panel, reassignable to any
  project member, showing the resolved worker's live status.

Full design context: [docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md](../../../docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md)

## Phases
- [ ] Phase 0: Stable worker identity — `--worker-number` flag, DB uniqueness moves off `pid`, per-instance pidfile
- [ ] Phase 1: Schema — `worker_pins` table (many pins per developer), `tracks.assignee_uid` column
- [ ] Phase 2: Assignee resolution — creator/owner default, candidate-pins lookup helper
- [ ] Phase 3: Claim logic — continuity-first routing among assignee's candidate workers, with open-claim fallback
- [ ] Phase 4: UI — Assignee control on track card/detail panel, "Pin as mine" on Workers list (supports multiple pins)
- [ ] Phase 5: Tests — pin resolution, continuity routing, parallel claims across a developer's workers, fallback behavior, reassignment

## Depends on
None to start (schema/UI can land first) — but Phase 3's continuity check needs [1086](../1086-persistent-track-sessions/index.md)'s `track_sessions` table to exist. Foundation for [1085](../1085-manual-worker-dispatch/index.md).
