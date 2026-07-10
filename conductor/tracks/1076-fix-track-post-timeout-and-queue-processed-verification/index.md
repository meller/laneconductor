# Track 1076: Fix `/track` POST timeouts + unverified "processed" marking in file_sync_queue

**Lane**: review
**Lane Status**: queue
**Progress**: 100%
**Phase**: Implementation complete
**Type**: dev
**Summary**: Fixed both bugs. Root cause of the timeout: chokidar's `ignoreInitial: false` fires an 'add' event per existing file on worker start — ~400 near-simultaneous syncTrack() calls for this project's ~100 tracks, overwhelming the API's 10-connection Postgres pool. Added a bounded-concurrency gate (max 8) in the worker; zero real timeouts across a full ~150-track reconcile afterward. Also found and fixed a second, deeper bug: syncTrack() swallowed its own collector-POST failures internally and never rejected, so the "processed" guard's try/catch around it was dead code — syncTrack() now returns a boolean. Verified live: a queue entry stays pending through repeated failures while the API is down, then gets processed and lands in the DB once it's back up.

## Problem

Found live while registering Tracks 1074/1075 in this session:

1. **`/track` POST timeout**: with the worker running a full reconcile of every track in
   the `laneconductor` project (~100 tracks), every single `POST http://127.0.0.1:8091/track`
   logged `POST timeout after 15000ms`. Checked `pg_stat_activity` for
   `datname='laneconductor'` during this window — no blocking queries, no long-running
   transactions, nothing waiting on a lock. The slowness is in the API handler itself
   (`ui/server/index.mjs`'s `/track` route), not the database. A full reconcile of ~100
   tracks at worst-case 15s/track would take 20+ minutes.
2. **Unverified "processed" marking**: `laneconductor.sync.mjs` moved two brand-new
   `file_sync_queue.md` entries (Tracks 1074 and 1075) from "pending" to "processed" in the
   Completed Queue **while the API was down/unreachable** — the log showed
   `[sync warning] Failed to post to collector for <n>: fetch failed` immediately before the
   entry was marked processed, and neither track existed in the `tracks` table afterward.
   The queue-processing logic appears to mark an entry "processed" once it's *attempted*
   the POST, not once the POST has *succeeded* — silently dropping track-creation requests
   whenever the collector is briefly unavailable.
3. **Compounding factor**: the worker reconciles *every* track on a fresh start/restart
   (not an incremental diff against what's already synced), so issue #1's cost is paid in
   full on every worker restart, and issue #2's window of vulnerability (API down or slow)
   is hit far more often than it would be with incremental syncing.

## Impact

Combined, these two bugs mean: (a) a worker restart in a project with many tracks is very
slow, and (b) any track-creation request that lands during that slow window — or during any
brief API outage — is silently lost with no retry and no visible error to the user (only a
buried line in `.sync.log`). This directly caused confusion in this session: two newly
created tracks appeared to vanish after being "queued," requiring manual DB inspection to
even notice they weren't created.
