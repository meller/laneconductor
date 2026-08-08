# Plan: Manual Worker Dispatch (Track 1085)

## Phase 1: Schema

**Problem**: No way to address a command at a specific worker.
**Solution**: `worker_dispatch` table, separate from the general track queue.

- [ ] Task 1: Migration — `worker_dispatch` table, `track_number` nullable, generic `payload JSONB` column (see spec REQ-1)
- [ ] Task 2: Index on `(worker_id, status)` for the polling query

## Phase 2: Worker Loop

**Problem**: Workers only ever act on the general queue (and only in
`sync+poll` mode); there's no per-worker inbox check.
**Solution**: Add an inbox check to the existing sync-tick interval,
unconditional on worker mode.

- [ ] Task 1: `checkDispatchInbox(workerId)` — query pending entries for this worker, oldest first
- [ ] Task 2: On a lane-action match, mark `claimed`, run via existing `spawnCli` (reuse context injection, logging, timeout/kill handling as-is)
- [ ] Task 3: On a `deploy` match, mark `claimed`, run via the new shared deploy-runner (Phase 6)
- [ ] Task 4: On process exit, mark `done`/`failed` matching the actual result
- [ ] Task 5: Wire the inbox check into the sync tick unconditionally (runs in both `sync-only` and `sync+poll`)

## Phase 3: API

**Problem**: Nothing can create a dispatch entry yet.
**Solution**: New endpoints on the collector API — one track-scoped (lane
actions), one project-scoped (deploy).

- [ ] Task 1: `POST /api/tracks/:id/dispatch { worker_id, action }` — validates action against track's current lane, inserts `pending` row
- [ ] Task 2: `GET /api/tracks/:id/dispatch` — list dispatch history for the track (for the UI's activity view)
- [ ] Task 3: `POST /api/projects/:id/dispatch { worker_id, action: 'deploy', payload: { environment } }` — validates `payload.environment` exists in that project's `deploy.json`, inserts `pending` row with `track_number: null`

## Phase 4: UI

**Problem**: No way to trigger dispatch from the app.
**Solution**: New controls on the track detail panel (lane actions) and a
project-level surface (deploy).

- [ ] Task 1: `Run on worker: [worker ▾] [action ▾] [Run Now]` control — worker dropdown defaults to resolved assignee's pin (1084), action dropdown limited to current-lane-valid actions
- [ ] Task 2: Disable/hide when resolved worker is offline or no valid action exists
- [ ] Task 3: Show dispatch status/history somewhere on the track (activity or logs area)
- [ ] Task 4: `Deploy: [worker ▾] [environment ▾] [Deploy Now]` control on the Workers list (or a project actions panel) — worker dropdown limited to workers pinned to the project
- [ ] Task 5: Show deploy dispatch history/status (reuse the same activity view pattern as Task 3)

## Phase 5: Deploy Runner (shared)

**Problem**: Deploy execution logic (`bin/lc.mjs`'s `deploy` command) only
runs from a human's terminal; the worker needs to run the same logic itself.
**Solution**: Extract the existing `lc deploy <env>` logic into a shared
function both the CLI and the worker call, instead of duplicating it.

- [ ] Task 1: Extract `runDeploy(projectRoot, env)` from `bin/lc.mjs`'s inline `deploy` command handler — reads `conductor/deploy.json`, runs configured command(s) for `env`, logs to `conductor/logs/deploy-<env>-<timestamp>.log`
- [ ] Task 2: `bin/lc.mjs`'s `deploy` command calls the shared function (no behavior change for the existing CLI path)
- [ ] Task 3: `conductor/laneconductor.sync.mjs`'s dispatch handler (Phase 2 Task 3) calls the same shared function

## Phase 6: Tests

- [ ] Task 1: Dispatch to a `sync-only` worker runs the action, general queue untouched
- [ ] Task 2: Dispatch to a `sync+poll` worker also works
- [ ] Task 3: Dispatching an action invalid for the current lane is rejected
- [ ] Task 4: Two workers, dispatch targeted at worker A never runs on worker B
- [ ] Task 5: Deploy dispatch runs the correct `deploy.json` command for the chosen environment and produces the same log file the existing `lc deploy` CLI path produces
- [ ] Task 6: Deploy dispatch to an unconfigured environment fails clearly (API rejects before enqueueing)
