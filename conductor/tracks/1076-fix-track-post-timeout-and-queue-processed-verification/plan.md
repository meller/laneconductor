# Track 1076: Fix `/track` POST timeouts + unverified queue "processed" marking

## Phase 1: Root-cause the `/track` timeout

- [x] Read `ui/server/index.mjs`'s `/track` POST handler — no missing awaits or
      unreleased clients found (checked all 3 manual `pool.connect()` usages;
      all release via `finally`).
- [x] Found the real root cause in `conductor/laneconductor.sync.mjs`:
      `watch('conductor/tracks', { ignoreInitial: false, depth: 2 })` fires an
      `add` event for **every pre-existing file** when the worker starts.
      Each `add` schedules `debounce(f, () => syncTrack(f))` with an
      independent 250ms timer per file. For this project (~100 tracks × ~4
      files each), that's ~400 timers armed within milliseconds of each other
      at startup, all firing `syncTrack()` at roughly the same moment —a
      thundering herd of concurrent `POST /track` requests hitting a `pg.Pool`
      capped at the client library's default of 10 connections.
- [x] Confirmed via live reproduction: before the fix, every single request
      logged `POST timeout after 15000ms` during a full reconcile.

## Phase 2: Fix the timeout

- [x] Added a bounded-concurrency gate (`withConcurrencyLimit`, max 8
      concurrent) in `laneconductor.sync.mjs`, wrapping the `syncTrack`/
      `syncConversation` calls triggered by the `conductor/tracks` watcher —
      the actual source of the burst.
- [x] Defense-in-depth on the API side (`ui/server/index.mjs`): raised the
      Postgres pool's `max` from the client default of 10 to 20, and set
      `connectionTimeoutMillis: 5000` so a genuinely exhausted pool fails fast
      and visibly instead of hanging silently for as long as the caller's own
      timeout.
- [x] Verified: full reconcile of the `laneconductor` project's ~150 real
      tracks (cleared `.sync.log`, fresh `lc worker start`) — **zero** real
      `POST timeout` occurrences (grep for the literal `[sync warning] ...
      timeout after` log line, not just the substring, which also appears
      inside this track's own index_content when it gets synced). Total
      wall-clock for the reconcile was ~244s, but that time is now entirely
      attributable to the *separate*, pre-existing `runJiraSync()` polling
      loop's sequential `execSync('gcloud secrets versions access ...')`
      calls per track (one per track, each spawning a slow synchronous gcloud
      subprocess that fails since the Jira secret isn't configured) — not to
      `/track` POSTs, which now complete quickly. Noted as a candidate
      follow-up, out of scope for this track (see "Not fixed" below).

## Phase 3: Fix unverified "processed" marking

- [x] Initial fix attempt wrapped `await syncTrack(...)` in `handleTrackCreate`
      in a try/catch — **this didn't work**. Root cause: `syncTrack()` has its
      own internal try/catch around the collector POST that only
      `console.warn`s on failure and never rethrows, so it **never rejects**
      under any circumstance. The wrapping try/catch was dead code; the entry
      always got marked "processed" regardless of whether the DB write
      actually happened. Caught this via a live scratch-track test (API down,
      no DB row existed, entry still marked "processed").
- [x] Real fix: changed `syncTrack()` to **return a boolean** (`true` if the
      collector POST succeeded or wasn't needed, `false` if it failed),
      preserving all of its existing side effects (Jira push, notifyApi,
      logging) unchanged — only the return value is new. All existing callers
      either ignore the return value or `.catch()` the promise, so this is a
      non-breaking change.
- [x] Updated both `handleTrackCreate` branches (existing-folder and
      new-folder) to check `syncTrack()`'s actual return value instead of a
      try/catch that could never fire. On failure, `updateFileSyncQueueEntry`
      resets the entry back to "pending" instead of moving it to "processed".
- [x] Verified live, end-to-end, three times (first two attempts caught real
      bugs in my own fix before it worked):
      1. API down → entry created the track folder (idempotent) but correctly
         stayed "pending" through repeated retry cycles, logging "both DB sync
         attempts failed — leaving entry pending for retry"; confirmed via
         direct DB query that no row existed the whole time.
      2. API restored → the pending entry was retried automatically, marked
         "processed", and the track row now exists in the DB.
      3. Scratch test tracks/DB rows cleaned up afterward.

## Not fixed (explicitly out of scope, noted for follow-up)

- **`runJiraSync()`'s sequential `execSync` gcloud calls**: makes every
  60-second Jira poll cycle (and the reconcile pass generally) slow when the
  Jira secret isn't configured, since each of ~150 tracks triggers a blocking
  subprocess spawn that fails. Blocks the worker's entire event loop for the
  duration of each call (synchronous, not `execAsync`). Separate bug, separate
  subsystem — not part of `/track` POST timeout or queue-verification scope.
- **Stale-"processing" reset heuristic** (`QUEUE_PROCESSING_TIMEOUT_MS`) keys
  off `entry.created` (when the queue entry was originally created) rather
  than when it actually entered the "processing" state — noticed during
  testing when a scratch entry with an artificially-old `Created` timestamp
  triggered the stale-reset logic within seconds. Didn't affect correctness
  of this track's fix (the entry still correctly ended up "pending", just via
  an extra reset cycle), but the heuristic itself seems like it could produce
  confusing behavior for old-but-legitimately-pending entries. Worth a look
  in a future track.
- **`lc worker restart`'s exit-code swallowing** — already noted in Track
  1074's plan.md.

## ✅ COMPLETE
