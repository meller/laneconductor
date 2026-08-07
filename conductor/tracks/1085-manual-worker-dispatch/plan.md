# Plan: Manual Worker Dispatch (Track 1085)

## Phase 1: Schema

**Problem**: No way to address a command at a specific worker.
**Solution**: `worker_dispatch` table, separate from the general track queue.

- [ ] Task 1: Migration — `worker_dispatch` table (see spec REQ-1)
- [ ] Task 2: Index on `(worker_id, status)` for the polling query

## Phase 2: Worker Loop

**Problem**: Workers only ever act on the general queue (and only in
`sync+poll` mode); there's no per-worker inbox check.
**Solution**: Add an inbox check to the existing sync-tick interval,
unconditional on worker mode.

- [ ] Task 1: `checkDispatchInbox(workerId)` — query pending entries for this worker, oldest first
- [ ] Task 2: On match, mark `claimed`, run via existing `spawnCli` (reuse context injection, logging, timeout/kill handling as-is)
- [ ] Task 3: On process exit, mark `done`/`failed` matching the lane action's actual result
- [ ] Task 4: Wire the inbox check into the sync tick unconditionally (runs in both `sync-only` and `sync+poll`)

## Phase 3: API

**Problem**: Nothing can create a dispatch entry yet.
**Solution**: New endpoint on the collector API.

- [ ] Task 1: `POST /api/tracks/:id/dispatch { worker_id, action }` — validates action against track's current lane, inserts `pending` row
- [ ] Task 2: `GET /api/tracks/:id/dispatch` — list dispatch history for the track (for the UI's activity view)

## Phase 4: UI

**Problem**: No way to trigger dispatch from the app.
**Solution**: New control on the track detail panel.

- [ ] Task 1: `Run on worker: [worker ▾] [action ▾] [Run Now]` control — worker dropdown defaults to resolved assignee's pin (1084), action dropdown limited to current-lane-valid actions
- [ ] Task 2: Disable/hide when resolved worker is offline or no valid action exists
- [ ] Task 3: Show dispatch status/history somewhere on the track (activity or logs area)

## Phase 5: Tests

- [ ] Task 1: Dispatch to a `sync-only` worker runs the action, general queue untouched
- [ ] Task 2: Dispatch to a `sync+poll` worker also works
- [ ] Task 3: Dispatching an action invalid for the current lane is rejected
- [ ] Task 4: Two workers, dispatch targeted at worker A never runs on worker B
