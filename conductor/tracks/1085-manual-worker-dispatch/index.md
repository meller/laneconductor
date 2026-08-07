# Track 1085: Manual Worker Dispatch

**Lane**: plan
**Lane Status**: success
**Progress**: 0%
**Phase**: Planning complete
**Type**: dev
**Summary**: Per-worker dispatch inbox to manually trigger a lane action in sync-only mode.

## Problem

A worker in `sync-only` mode (track 1042) does nothing but sync files and
heartbeat — there's no way to tell one specific worker "run `implement` on
track 1042 right now" without flipping it back to `sync+poll` and letting the
open-claim race happen.

## Solution

- `worker_dispatch (id, worker_id, track_number, action, status, created_at)`
  — a per-worker command inbox, separate from the general auto-launch queue.
- On every sync tick (same interval as heartbeat), regardless of worker mode,
  a worker checks its own pending dispatch entries and runs them immediately
  through the existing `spawnCli` path — the same mechanism auto-launch uses.
- In `sync-only` mode, this inbox check plus file sync is the *only*
  work-launching activity; the general queue is still never polled.
- UI: track detail panel gets `Run on worker: [assignee's worker] [action]
  [Run Now]`, scoped to actions valid for the track's current lane.
- Scope: standard lane actions only (plan/implement/review/quality-gate), no
  freeform custom prompts — this is manual triggering of existing automation,
  not a general remote-command feature.

Full design context: [docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md](../../../docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md)

## Phases
- [ ] Phase 1: Schema — `worker_dispatch` table
- [ ] Phase 2: Worker loop — check own inbox every sync tick, run via `spawnCli`, mark claimed/done
- [ ] Phase 3: API — endpoint to enqueue a dispatch entry for a worker+track+action
- [ ] Phase 4: UI — "Run on worker" control on track detail panel
- [ ] Phase 5: Tests — dispatch in sync-only mode, dispatch in sync+poll mode, invalid action for current lane rejected

## Depends on
[1084](../1084-worker-identity-and-assignment/index.md) — needs assignee/pinned-worker resolution to know which worker's inbox to target by default.
