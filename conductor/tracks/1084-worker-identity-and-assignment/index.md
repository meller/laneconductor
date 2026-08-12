# Track 1084: Worker Identity & Assignment

**Lane**: plan
**Lane Status**: running
**Progress**: 83%
**Phase**: Phases 0-5 complete for their achievable scope — 2 acceptance-criteria items (continuity-first routing, same-developer parallel claims) remain blocked on 1086's track_sessions table, not a defect. Phase 6 (worker lifecycle UI gaps) reopened 2026-08-12, needs planning.
**Type**: dev
**Summary**: Explicit track assignment to end random pickup; worker ownership resolved via workers.user_uid, not a separate pin table.

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
- A developer's workers for a project are resolved directly from
  `workers.user_uid` (set automatically at registration via API
  key/Firebase auth — see [1033](../1033-worker-identity-and-remote-api-keys/index.md)),
  not a separate pin table — a developer running workers on several
  machines under the same identity already gets all of them. (An earlier
  version of this design added a dedicated `worker_pins` table; removed
  2026-08-08 as redundant — see plan.md's "Design Simplification" note.
  Routing to a worker registered under a *different* developer's identity
  is a deliberate non-goal here — it's a machine-access security question
  that needs its own consent design, not something to fall out of a query
  change.)
- `tracks.assignee_uid` — nullable, identifies the responsible *developer*
  (not a specific machine); defaults to the track's creator (or project
  owner if creator unknown) when unset.
- Claim logic in `autoLaunchLocalFs` / the API-mode claim path resolves the
  assignee's own workers, then routes with continuity-first: if
  [1086](../1086-persistent-track-sessions/index.md)'s `track_sessions`
  already has a row for this track on one of those workers, only that
  worker may claim it; otherwise any idle one may. If the assignee has no
  workers registered at all, fall back to today's open-claim behavior —
  zero config needed for single-worker projects.
- UI: "Assignee" control on the track card/detail panel, reassignable to any
  project member, showing the resolved worker's live status.

Full design context: [docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md](../../../docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md)

## Phases
- [x] Phase 0: Stable worker identity — `--worker-number` flag, DB uniqueness moves off `pid`, per-instance pidfile
- [x] Phase 1: Schema — `tracks.assignee_uid` column (`worker_pins` table added then removed, see below)
- [x] Phase 2: Assignee resolution — creator/owner default, own-workers lookup helper (`workers.user_uid`-based)
- [x] Phase 3: Claim logic — assignee/ownership gating + open-claim fallback done; continuity-first routing itself blocked on 1086's track_sessions
- [x] Phase 4: UI — Assignee control on track detail panel, worker status badge on track cards; "Pin as mine" removed (no longer needed)
- [x] Phase 5: Tests — assignee resolution, claim gating, reassignment, restart-reuse, two-instance concurrency all covered; continuity routing / same-developer parallel claims remain blocked on 1086
- [ ] Phase 6 (reopened 2026-08-12): UI gaps for the multi-worker-per-project model this track already built — found live while testing tracks 1089/1091/1096. `WorkersList.jsx`'s worker lifecycle controls only really work for the "zero or one worker" case; `--worker-number` support (Phase 0) has no matching way to reach it from the UI.

## Depends on
None to start (schema/UI can land first) — but Phase 3's continuity check needs [1086](../1086-persistent-track-sessions/index.md)'s `track_sessions` table to exist. Foundation for [1085](../1085-manual-worker-dispatch/index.md).
