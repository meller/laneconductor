# Track 1093: Sync Worker — Concurrent-Edit Grace Period Never Expires

**Lane**: implement
**Lane Status**: success
**Progress**: 100%
**Phase**: Fixed, verified live — all 5 affected workers restarted and confirmed clearing their stuck tracks
**Type**: dev
**Summary**: DB→FS sync permanently wedges for any track whose file/DB timestamps happened to land within 10s of each other — fixed the grace-period check to actually expire with wall-clock time.

## Problem

Reported live: "aitutor" (coachai, project 855) track 180 wasn't syncing.
Investigation (`conductor/.sync.log`, 3.7GB) showed the same 42 of 173
tracks logging `[SKIPPED] concurrent_edit_grace_period` on *every single*
5-second heartbeat cycle, for hours, with the exact same frozen timestamps
each time — 2.5 million occurrences of the line in that one log file alone.
Checking other currently-running projects' workers found the same pattern:
`tokentalos` (234M), `otralingo` (203M), `chesstrainer` (343M), `5elements`
(315M) logs, all almost certainly from the same loop.

## Root Cause

`isConcurrentEdit(fileMtime, dbLastUpdated)` in
`conductor/laneconductor.sync.mjs` (now `conductor/sync-timestamp-utils.mjs`)
only checked whether a track's file mtime and DB `last_updated` were within
a 10-second "grace period" *of each other* — never whether that pair of
events was itself recent. Once nothing else touches either side, both
timestamps are frozen forever; if they happened to land close together (the
normal case immediately after any successful two-way sync — exactly when
you'd expect them to be close), `Math.abs(fileMtime - dbTime) < 10000`
stays true indefinitely. The "grace period" intended as "wait one cycle,
the race will resolve" never actually resolves — it's permanent, silently
disabling DB→FS sync for that track from that point on, with no error, just
an infinite skip loop generating unbounded log growth as a side effect.

## Fix (committed)

- Extracted `compareTimestamps`/`isConcurrentEdit` out of
  `laneconductor.sync.mjs` into a new pure module,
  `conductor/sync-timestamp-utils.mjs` — the original file runs side effects
  (chokidar watchers, `setInterval`s) at import time, so wasn't safe to
  import directly just to unit-test a pure function; this codebase already
  has precedent for this exact move (`deploy-runner.mjs`, track 1085).
- `isConcurrentEdit` now also requires the pair to be *recent*
  (`now - max(fileMtime, dbTime) < gracePeriodMs`), not just close to each
  other. A stale-but-close pair from hours ago no longer reads as an active
  race.
- New regression test, `conductor/tests/sync-concurrent-edit-grace-period.test.mjs`
  — reproduces track 180's exact real-world shape (timestamps ~483ms apart,
  3+ hours old) as the primary bug case, plus the genuine-fresh-race case
  that must still correctly skip.

## Resolution (user-authorized, 2026-08-09)

- [x] Restarted all 5 affected project workers (`tokentalos`, `otralingo`,
      `chesstrainer`, `5elements`, `coachai`/aitutor) via `lc worker stop` +
      `lc worker start --sync-only`, matching each one's prior mode.
- [x] Truncated each project's oversized `conductor/.sync.log` before
      restart (coachai 3.5G, chesstrainer 343M, 5elements 315M, tokentalos
      234M, otralingo 203M).
- [x] **Verified live**, not just assumed: the first heartbeat cycle after
      each restart shows `conflicts` dropping from a nonzero steady-state to
      `0`, with exactly that many tracks pulling through in the same cycle —
      coachai (42 pulled, incl. track 180: `[PULLED] db_newer`), otralingo
      (11), tokentalos (6), chesstrainer (1), 5elements (1, already clean on
      its first post-restart cycle).

## Follow-up (not blocking, separate/smaller)

- [ ] Consider a log-rotation/size-cap safeguard in the sync worker itself,
      so a *future* stuck-loop bug (of any kind) can't silently grow a log
      file to multiple GB unbounded again.

## Verification

- `node --test conductor/tests/sync-concurrent-edit-grace-period.test.mjs` — 4/4 pass
- Full regression pass (1084/1085/worker-mode/deploy-runner suites) — 27/27 pass, no regressions from the extraction
