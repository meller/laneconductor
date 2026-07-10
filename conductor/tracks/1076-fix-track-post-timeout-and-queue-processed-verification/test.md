# Tests: Track 1076 — `/track` timeout + queue "processed" verification

## Test Commands
```bash
node --check ui/server/index.mjs
node --check conductor/laneconductor.sync.mjs
```

## Results (this pass)

- `node --check`: clean on both files.
- Full reconcile of `laneconductor`'s own ~150 tracks after a fresh `lc worker start`
  (cleared `.sync.log` first): grep for the literal `[sync warning] ... timeout after` log
  line (not just the substring, which also appears inside this track's own synced
  index_content) → **zero matches**. Before the fix, every single request during the same
  scenario logged a timeout.
- Live scratch-track tests (3 iterations, tracks 9990/9991/9992, all cleaned up afterward):
  - API down → queue entry created the track folder (idempotent) but stayed correctly
    "pending" through repeated retries; confirmed via direct DB query that no row existed.
  - API restored → the pending entry was retried automatically on the next cycle, marked
    "processed", and the track row now exists in the DB (confirmed via `psql`).
  - First two iterations caught real bugs in the fix-in-progress (a stale worker process
    still running old code, then `syncTrack()`'s own swallowed exception) before the third
    iteration passed cleanly — see plan.md for the full story.

## Test Cases

### Feature: `/track` responds quickly under load
- [x] TC-1: A single, isolated `POST /track` (no concurrent reconcile happening) completes
      quickly (confirmed via `GET /api/projects` health checks throughout testing, all
      near-instant).
- [x] TC-2: `POST /track` during a full-project reconcile pass (~150 tracks) — zero real
      timeouts logged after the concurrency-gate fix (previously: every single request).
- [x] TC-3: Postgres connection count stayed reasonable — no evidence of unbounded growth;
      the concurrency gate caps client-side concurrent requests at 8, well under the raised
      pool max of 20.

### Feature: queue "processed" only after verified success
- [x] TC-4: With the API stopped (confirmed via `curl` → connection refused), a
      `track-create` entry stayed "pending" through multiple retry cycles — never silently
      marked "processed" with no corresponding DB row.
- [x] TC-5: API started back up — the pending entry was picked up on the next cycle, marked
      "processed", and the track now exists in the `tracks` table.
- [x] TC-6: Normal happy-path track creation (Tracks 1074/1075/1076 themselves, and the
      scratch tests once the API was up) still gets marked "processed" promptly — no
      regression.

## Acceptance Criteria
- [x] `node --check` clean on all touched files.
- [x] All 6 test cases pass via live manual verification (no existing automated test suite
      covers this project's own worker/API lifecycle as of this track).
- [x] Root cause of the original timeout documented in spec.md/plan.md — including a second,
      independent bug (`syncTrack()` never throwing) found and fixed during verification,
      not just the first hypothesis.
