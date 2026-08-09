# Track 1085: Manual Worker Dispatch

**Lane**: review
**Lane Status**: success
**Progress**: 95%
**Phase**: Phases 1-6 complete, verified live end-to-end against the real DB/API (real dispatch, real deploy run, real bug found+fixed); Phase 6 Task 4 (two-real-workers isolation test) is the only known gap
**Type**: dev
**Summary**: Per-worker dispatch inbox to manually trigger a lane action or a deploy in sync-only mode.

## Problem

A worker in `sync-only` mode (track 1042) does nothing but sync files and
heartbeat — there's no way to tell one specific worker "run `implement` on
track 1042 right now" without flipping it back to `sync+poll` and letting the
open-claim race happen. Separately, deploying (`lc deploy <env>`) today only
runs from whoever's terminal has the repo checked out — there's no UX for
triggering it from the app at all, even though the full plan → implement →
review → quality-gate → done cycle should end in an actual deploy.

## Solution

- `worker_dispatch (id, worker_id, track_number NULL, action, payload
  JSONB NULL, status, created_at)` — a per-worker command inbox, separate
  from the general auto-launch queue. `track_number` is null for
  project-level actions (deploy); `payload` carries per-action parameters
  (e.g. `{"environment": "prod"}` for deploy) so future action types don't
  need their own dedicated column.
- On every sync tick (same interval as heartbeat), regardless of worker mode,
  a worker checks its own pending dispatch entries and runs them immediately:
  lane actions through the existing `spawnCli` path (same mechanism
  auto-launch uses); `deploy` through a new shared deploy-runner (extracted
  from `bin/lc.mjs`'s existing `lc deploy` logic, so both paths run identical
  code).
- In `sync-only` mode, this inbox check plus file sync is the *only*
  work-launching activity; the general queue is still never polled.
- UI: track detail panel gets `Run on worker: [assignee's worker] [action]
  [Run Now]`, scoped to actions valid for the track's current lane. A
  separate, project-level `Deploy: [worker ▾] [environment ▾] [Deploy Now]`
  control (Workers list or a project actions panel) covers deploy, since
  it's not tied to any one track's lane — worker dropdown limited to the
  calling developer's own workers for the project (`workers.user_uid`, per
  1084 — needs the repo checkout).
- Scope: standard lane actions (plan/implement/review/quality-gate) plus
  deploy — no freeform custom prompts. This is manual triggering of existing
  automation, not a general remote-command feature.

Full design context: [docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md](../../../docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md)

## Phases
- [x] Phase 1: Schema — `worker_dispatch` table (nullable track_number, generic payload JSONB)
- [x] Phase 2: Worker loop — check own inbox every sync tick, run lane actions via `spawnCli` and deploy via the shared deploy-runner, mark claimed/done
- [x] Phase 3: API — enqueue + worker-facing dispatch endpoints (pulled forward into Phase 2, see plan.md); `GET .../dispatch` history endpoint deferred to Phase 4
- [x] Phase 4: UI — "Run on worker" control on track detail panel, "Deploy" control on Workers list; verified live end-to-end (real worker, real dispatch, real deploy run — found and fixed a real stdin-hang bug in the process, see plan.md)
- [x] Phase 5: Deploy runner — extract `bin/lc.mjs`'s `lc deploy` logic into a shared function the CLI and worker both call (pulled forward, Phase 2's deploy dispatch needs it)
- [x] Phase 6: Tests — dispatch in sync-only mode, dispatch in sync+poll mode, invalid action for current lane rejected, deploy dispatch runs the correct command and logs correctly (Task 4, two-real-workers isolation, still open)

## Depends on
[1084](../1084-worker-identity-and-assignment/index.md) — needs assignee resolution (`resolveAssignee` + `workers.user_uid` ownership) to know which worker's inbox to target by default.

## Follow-up
[1092](../1092-deploy-config-ui/index.md) — the "Deploy Now" control here can only dispatch environments that already exist in `conductor/deploy.json`; nothing in this track lets you create/edit that file from the app (CLI-only via `lc setup-deploy`, or hand-editing). 1092 adds that.
