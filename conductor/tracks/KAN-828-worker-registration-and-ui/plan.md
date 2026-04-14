**Status**: done
**Progress**: 100%

# Track 014: Worker Registration and UI

## Phase 1: DB Schema and API Support
**Problem**: No storage or retrieval mechanism for worker status.
**Solution**: Create the `workers` table and add API endpoints to the Express server.

- [x] Task 1: Create `workers` table in Postgres (see `conductor/workers_schema.sql`).
- [x] Task 2: Add `GET /api/projects/:id/workers` endpoint to `ui/server/index.mjs`.
- [x] Task 3: Ensure the API handles "offline" filtering (currently set to 60s).

## Phase 2: Worker Registration and Heartbeat
**Problem**: Workers don't report their existence or health.
**Solution**: Update `laneconductor.sync.mjs` to register on startup and send heartbeats.

- [x] Task 1: Add `hostname` detection using `os` module.
- [x] Task 2: Implement `upsertWorker()` function called on startup.
- [x] Task 3: Implement periodic heartbeat update for the worker row (every 10s).
- [x] Task 4: Add `process.on('SIGTERM/SIGINT')` cleanup to remove row.

## Phase 3: Status and Task Reporting
**Problem**: Workers don't report what they are doing.
**Solution**: Update worker status when spawning/completing CLI actions.

- [x] Task 1: Update status to `busy` and set `current_task` when `spawnCli` is called.
- [x] Task 2: Revert status to `idle` when a spawned process exits.
- [x] Task 3: Ensure task descriptions are clear (e.g., "implement track 014").

## Phase 4: UI Implementation
**Problem**: Users cannot see worker status in the dashboard.
**Solution**: Add a Workers panel or view to the dashboard.

- [x] Task 1: Create `WorkersList` component to display worker badges in the header.
- [x] Task 2: Integrate `WorkersList` into `App.jsx`.
- [x] Task 3: Add visual indicators for `idle` vs `busy` states (amber pulse for busy).
- [x] Task 4: Use WebSockets (via `internal/sync-event`) to push worker updates to the UI in real-time.

## Phase 5: Verification and Hardening
- [x] Task 1: Verify multiple workers on same/different projects.
- [x] Task 2: Verify automatic cleanup of stale workers via API filter.
- [x] Task 3: Hardening: Add `process.on('uncaughtException')` and `unhandledRejection` to ensure worker de-registration on crash.
- [x] Task 4: Final review against product guidelines.

## ✅ REVIEWED
Ready for review.

## ✅ REVIEWED
## ✅ QUALITY PASSED
