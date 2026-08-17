# Track 10015: Worktree dispatch reliability

## Phase 1: Fix `refresh-worktrees`'s "missing track_number" failure ✅ COMPLETE

**Problem**: Every `refresh-worktrees` dispatch fails immediately with
`missing track_number`, even though `POST /api/projects/:id/dispatch`
deliberately doesn't require one for this action. Confirmed live: 7
consecutive real dispatches (ids 657-663), all failed identically.

**Root cause found**: `checkDispatchInbox()` had no dedicated branch for
`entry.action === 'refresh-worktrees'` at all — it fell through to the
generic "Lane action dispatch" fallback at the bottom of the loop, which
unconditionally requires `track_number` and fails with the literal
string `missing track_number` when absent. `remove-worktree` works
because it has its own dedicated branch earlier in the same function
that never touches `track_number`; `refresh-worktrees` was simply
missing the equivalent.

**Solution**: Added a dedicated `refresh-worktrees` branch
(`conductor/laneconductor.sync.mjs`, right after `remove-worktree`'s)
that calls `refreshWorktreeSummaryCache()` — the same function that
already runs on a 60s interval and gets attached to the next heartbeat —
forcing an immediate re-audit instead of waiting, then reports the
dispatch `done`.

- [x] Task 1: Locate the worker-side `refresh-worktrees` handler and
      identify where it requires/reads `track_number` — found it has
      none; falls through to the generic lane-action branch instead
- [x] Task 2: Fix the handler to not require `track_number` — added a
      dedicated branch instead of fixing the fallback (the fallback
      correctly requiring a track number for genuine lane actions is
      not itself wrong)
- [x] Task 3: Regression test against a real spawned worker
      (`conductor/tests/track-10015-refresh-worktrees.test.mjs`) —
      watched it fail with the exact real error (`'failed' !== 'done'`)
      before the fix, pass after. Full conductor test suite re-run
      afterward: same 7 pre-existing flaky failures as before this
      change (confirmed unrelated), no new failures.

## Phase 2: Detect and surface duplicate worker processes racing one identity ⚪ SUPERSEDED — fixed same-day by track 1084 Phase 8

**Problem**: Two live processes registered under the same
`(project_id, hostname, worker_number)` identity, each heartbeating
independently, both eligible to claim dispatches addressed to that
shared `workers.id`. No detection, no error, no UI signal — the only
symptom was dispatches sitting `pending` far longer than expected, which
looks identical to "the button does nothing."

**Not implemented here — same incident already fixed elsewhere**: while
this section was still open, concurrent work on
[1084](../1084-worker-identity-and-assignment/index.md) Phase 8
(commit `ded81ee`, same day) independently diagnosed and fixed the exact
same incident, with a sharper root cause than this track's own
"detect duplicate PIDs" framing: `worker-lock.mjs` (track 1110) already
makes a second live process for the same identity structurally
impossible going forward, so the real gap was that a worker whose
`/worker/register` call never resolves (`myWorkerId` stays `null`) looks
completely healthy — heartbeating, visible in the UI — while
`checkDispatchInbox()` silently no-ops forever. Their fix: a watchdog
(`LC_WORKER_ID_STALE_GRACE_MS`/`LC_WORKER_ID_WATCHDOG_MS`) that logs once
loudly after a grace period and retries registration until it self-heals.
Tested in `conductor/tests/worker-id-watchdog.test.mjs`. No separate
implementation needed here — see index.md's Bug 2 section for the full
cross-reference.

- [x] Task 1: Decide the mitigation approach — decided in 1084 Phase 8
      (watchdog + retry, not a second pidfile-liveness guard duplicating
      `worker-lock.mjs`'s existing exclusivity)
- [x] Task 2: Implement detection on the registration/heartbeat path —
      done in 1084 Phase 8
- [x] Task 3: Implement the chosen mitigation — done in 1084 Phase 8
- [x] Task 4: Regression test — `conductor/tests/worker-id-watchdog.test.mjs`,
      done in 1084 Phase 8

## Phase 3: Explain the silent polling stall ✅ ANSWERED (as a side effect of track 1084 Phase 8's diagnosis)

**Problem**: The orphaned process's `checkDispatchInbox()` produced zero
log output for ~9 minutes — not even the "Failed to fetch inbox"
warning its own catch block would log on a real error. The process died
before it could be inspected further, so the actual mechanism was
unconfirmed at the time this was written.

**Answer**: `checkDispatchInbox()`'s first line is
`if (getIsLocalFs() || !myWorkerId) return;` — a silent, unlogged early
return. Track 1084 Phase 8's diagnosis confirms this is exactly what was
happening: the orphaned process's own worker-identity resolution never
completed (`myWorkerId` stayed `null`), so every single poll tick
returned immediately with zero log output, indistinguishable from "no
dispatches to process" from the logs alone. The watchdog added there
now makes this specific condition loud instead of silent.

- [x] Task 1: Add a periodic "still polling" log line (or similar
      liveness signal) — superseded by 1084 Phase 8's more targeted
      watchdog (fires specifically on the `myWorkerId` stale condition,
      not a generic liveness ping)
- [x] Task 2: Root-cause why the poll loop stopped producing output —
      answered above
