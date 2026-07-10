# Spec: Fix `/track` POST timeouts + unverified queue "processed" marking

## Problem Statement

Two compounding reliability bugs observed live in this session while registering new tracks
in the `laneconductor` project itself:

1. `POST /track` (the endpoint the sync worker uses to create/update a track's DB row)
   consistently times out at 15s during a full reconcile pass, for every track — confirmed
   not a database-side issue (`pg_stat_activity` showed no blocking queries/locks at the
   time).
2. `laneconductor.sync.mjs`'s `file_sync_queue.md` processing marks a `track-create` entry
   "processed" regardless of whether the resulting `POST /track` actually succeeded — so a
   collector outage (or the timeout in #1) silently loses the track-creation request with no
   retry.
3. The worker's reconcile pass appears to touch every track file on every start/restart
   rather than diffing against last-known-synced state, multiplying the cost of #1.

## Requirements

- REQ-1: Root-cause the `/track` POST timeout in `ui/server/index.mjs` — likely candidates
  to check first: a DB connection/pool leak (each request opening a new client without
  releasing it back to the pool), an accidental synchronous/blocking operation in the
  request handler, or a missing `await` causing unbounded concurrent in-flight requests to
  pile up. Confirm with evidence (e.g. instrumenting pool size over time, or a targeted
  reproduction) rather than guessing.
- REQ-2: Fix the root cause so `/track` POSTs complete quickly (sub-second, matching
  `GET /api/projects`'s observed fast response) under the same reconcile-pass load that
  currently times out.
- REQ-3: `file_sync_queue.md` entries must only be marked "processed" after confirming the
  corresponding DB write succeeded (e.g. check the collector POST's response status/body,
  not just that the request was attempted). On failure, leave the entry "pending" (or move
  to a distinct "failed — will retry" state) so the next heartbeat cycle retries it instead
  of silently dropping it.
- REQ-4: (Stretch, discuss before committing to scope) Make the worker's reconcile pass
  incremental — skip tracks whose on-disk mtime hasn't changed since the last successful
  sync — so a restart doesn't re-POST every track in a large project. This directly reduces
  how often REQ-1's failure mode gets triggered in practice, independent of whether REQ-2
  fully resolves it.

## Acceptance Criteria

- [x] Root cause of the `/track` POST timeout identified and documented: chokidar's
      `ignoreInitial: false` fires an `add` event per pre-existing file on worker start,
      producing a thundering herd of ~400 concurrent `syncTrack()` calls against a
      10-connection Postgres pool for this project's ~100 tracks.
- [x] `/track` POSTs complete quickly during a full-project reconcile — verified zero real
      timeout log lines across a full ~150-track reconcile after adding a bounded-concurrency
      gate (max 8) in the worker, plus a pool-size increase and explicit connection timeout
      in the API as defense-in-depth.
- [x] A `track-create` queue entry is only marked "processed" after a verified-successful
      DB write; a failed attempt stays retryable on the next cycle. (Required a second,
      deeper fix: `syncTrack()` itself never threw on failure, so the initial try/catch-based
      guard was dead code — `syncTrack()` now returns a boolean instead.)
- [x] Reproduced the original failure live: killed the API, confirmed a pending queue entry
      stayed pending through repeated retries with no DB row created, brought the API back
      up, confirmed it was picked up on the next cycle and the track landed in the DB.
- [ ] REQ-4 (incremental reconcile) — not taken on; the concurrency gate addresses the
      practical impact without needing to change what gets synced, and the total reconcile
      wall-clock time is now dominated by an unrelated pre-existing issue (`runJiraSync()`'s
      sequential gcloud calls — see plan.md's "Not fixed" section), not by `/track` itself.
