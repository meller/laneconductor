# Track 1093: Sync Worker — Concurrent-Edit Grace Period Never Expires

**Lane**: implement
**Lane Status**: running
**Progress**: 80%
**Phase**: Root cause fixed, code committed; live worker restarts + log cleanup pending user confirmation
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

## Remaining (not yet done — needs confirmation, these touch live processes)

- [ ] Restart the 5 currently-running project workers (`tokentalos`,
      `otralingo`, `chesstrainer`, `5elements`, `coachai`/aitutor) so they
      pick up the fix — they're all still running the old buggy code in
      memory; the fix alone doesn't help until they restart.
- [ ] Decide what to do with the existing multi-hundred-MB/GB
      `conductor/.sync.log` files in each affected project — truncate,
      rotate, or leave as-is.
- [ ] Consider a log-rotation/size-cap safeguard in the sync worker itself,
      so a *future* stuck-loop bug (of any kind) can't silently grow a log
      file unbounded again — separate, smaller follow-up, not blocking this
      fix.

## Verification

- `node --test conductor/tests/sync-concurrent-edit-grace-period.test.mjs` — 4/4 pass
- Full regression pass (1084/1085/worker-mode/deploy-runner suites) — 27/27 pass, no regressions from the extraction
