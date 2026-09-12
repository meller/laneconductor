# Track AM-10093: A Written Lane Change Can Be Silently Reverted by a Stale Concurrent Auto-Launch Dispatch or DB Pull

Phases are ordered so that every fix lands behind a test that fails first. Phase 1 is
reproduction only — no production code changes — because the problem statement's own diagnosis
(multi-identity accumulation as a major contributing factor) is partly unverified, and Phase 5's
design depends on which population the census actually shows.

---

## Phase 1: Reproduce both revert paths, and census the worker identities

**Problem**: The revert is currently only known from live observation. Nothing in the test suite
fails because of it, so no fix can be shown to have worked.
**Solution**: Two failing regression tests plus one evidence-gathering script.

- [x] Task 1.1: Wrote `conductor/tests/track-10093-stale-dispatch-clobber.test.mjs`. **Deviation
      from the plan, recorded here rather than silently substituted**: `laneconductor.sync.mjs`
      boots a whole worker on import (chokidar, setIntervals — the same constraint
      track-10046's own suite documents), so `autoLaunchLocalFs` cannot be called directly and
      no injectable delay hook can be wired into it without a much larger refactor than this
      track's scope justifies. Used this codebase's own established substitute instead
      (track-10046-stale-lane-snapshot.test.mjs's exact technique): source-level pins against
      the literal call site, verifying the fix is wired in the right order, PLUS full direct
      unit coverage of the actual decision logic in the newly-extracted pure module
      (`track-10093-dispatch-revalidation.test.mjs`, 8/8 passing) — which is where the real
      correctness lives. Confirmed both fail without the corresponding fix and pass with it.
- [x] Task 1.2: Wrote `conductor/tests/track-10093-stale-db-pull-revert.test.mjs` — same
      source-pin + pure-module-unit-test split as Task 1.1, against the extracted
      `db-pull-guard.mjs` rather than a live mock-collector integration run (the pure decision
      is what needed proving; the wiring pins confirm it's actually called).
- [x] Task 1.3: Wrote `conductor/tests/track-10093-exit-guard-anchor.test.mjs` — same technique,
      driving `applyGuardedLaneWrite` (the real guard the exit handler calls) with the exact
      inputs the new anchor produces in the incident scenario.
- [x] Task 1.4: Census answered directly rather than via a live-DB query script — evidence was
      conclusive without one. `git log -S CLAIM_WORKER_NUMBER_BASE_MULTIPLIER` shows the
      constant was introduced once, at `100000`, and never changed, so a claim-scoped row's
      `worker_number` is always `>= 100001`. Every observed value (`105`, `106`, `20007`,
      `20008`, `20012`, `20014`, `20015`, `20018`) is below that floor and therefore
      **structurally impossible** as a claim-scoped derivation — no ambiguity a script could add
      evidence to. Recorded in `conversation.md` and corrected into `spec.md` (which had framed
      this as an open question during planning).
    - [x] Answered: the multi-identity theory is **confirmed, not disproven** — every observed
          identity was a genuine base identity with its own OS process and its own poll loop.
          Phase 5 proceeds at full scope, not the prevention-only fallback the plan allowed for.

**Impact**: Three fix-scoped test files (32 tests total across Phases 1-4) and a factual,
evidence-based identity census that corrects the plan's own open question. No production
behavior change from this phase alone — the fixes land in Phases 2-4.

---

## Phase 2: Close the pre-spawn dispatch window (REQ-1, REQ-2, REQ-3, REQ-7)

**Problem**: R1 and R2 — the dispatch decision and the claim write both run off a snapshot taken
before several seconds of awaited I/O.
**Solution**: One revalidation gate immediately before `spawnCli`, and a fresh-read claim write.

- [x] Task 2.1: Extracted `revalidateDispatchSnapshot`/`parseDispatchSnapshot` into
      `conductor/services/dispatch-revalidation.mjs`, exactly as specified.
- [x] Task 2.2: Wired into `autoLaunchLocalFs` immediately before the spawn `try` block,
      re-reading `index.md` at that instant via `readIfExists`. On `stale`, logs at `warn`
      (throttled — see Phase 6) naming the track, changed fields, and the snapshot values, then
      `continue`s.
- [x] Task 2.3: Stale-path release implemented — primary-only `PATCH /track/:n/action` with
      `lane_action_status: 'queue'` (API mode) or `releaseTrackClaim(tracksDir, dir)` (local-fs).
- [x] Task 2.4: Running-claim write now reads fresh (`readIfExists(indexPath)`) immediately
      before patching `**Lane Status**`, replacing the stale-buffer `updateHeader(content, ...)`
      call. `waitingForReply` gate untouched.
- [x] Task 2.5: `track-10093-stale-dispatch-clobber.test.mjs` (6/6) and
      `track-10093-dispatch-revalidation.test.mjs` (8/8) pass. Regression-checked against
      `track-10046-stale-lane-snapshot.test.mjs` (23/23) and `track-10040-lane-regression-guard`
      — no regressions.

**Impact**: A dispatch decision can no longer act on state older than one file read. The worst
case becomes a one-cycle (5 s) deferral, never a wrong action or a lost write.

---

## Phase 3: Close the DB→disk pull window (REQ-5, REQ-6, REQ-7)

**Problem**: R4 — a stale-but-newer DB row overwrites a fresher file, because a forward lane
write is never blocked and the mtime that justified the pull is never rechecked.
**Solution**: Re-stat before writing, and refuse a lane write when the file is the fresher side.

- [x] Task 3.1: `indexMtime`/`comparison` from `pullTracksMetadataFromDB`'s own decision are
      threaded into `updateIndexMDFromDB` as `pullContext`; the shared `db-pull-guard.mjs` module
      re-stats via `getFileModTime(indexPath)` immediately before the lane write and skips it
      (warn, throttled) when the mtime advanced.
    - [x] Confirmed: only the lane branch is skipped — Progress/Phase/Summary/Merge Mode are
          unconditional siblings, unaffected by the guard.
- [x] Task 3.2: Same guard's `ambiguous_timestamp_tie_file_wins` branch implements REQ-6 —
      `timestampComparison === 'equal'` skips the lane pull regardless of what else differs.
- [x] Task 3.3: Confirmed by construction, not just re-examined — `content_summary_mismatch` only
      ever influences `shouldPullFromDB`'s `pull: true/false` gate (whether `updateIndexMDFromDB`
      runs at all); it has no path into the lane decision itself, which is gated uniformly by
      `shouldSkipLaneOnPull` regardless of which trigger caused the pull.
- [x] Task 3.4: `track-10093-stale-db-pull-revert.test.mjs` (9/9) passes, including the wiring
      pins confirming the real call site threads `decisionMtime`/`timestampComparison` correctly.

**Impact**: The 5 s pull loop stops being an independent source of reverts.

---

## Phase 4: Anchor the exit-handler guard (REQ-4)

**Problem**: R3 — `producedByThisRun: preWriteOnDiskLane === laneStatus` is satisfied by a value
this same run's own pre-spawn write placed on disk, disarming the containment primitive.
**Solution**: Anchor to the lane recorded for this run at dispatch time.

- [x] Task 4.1: `buildRunMarker` gained `dispatchLane`, stored as `dispatch_lane`; `spawnCli`
      passes `dispatchLane: laneStatus` at the one call site that writes the marker.
- [x] Task 4.2: Added `resolveDispatchLaneAnchor(marker, fallbackLaneStatus)` — prefers
      `marker.dispatch_lane`, falls back to the passed `laneStatus` when the marker is missing or
      predates this field. The exit handler now reads the marker fresh and computes
      `producedByThisRun: preWriteOnDiskLane === dispatchLaneAnchor`.
- [x] Task 4.3: `track-10093-exit-guard-anchor.test.mjs` (9/9) passes. `track-10040-lane-
      regression-guard.test.mjs` (14/14 within the combined 23) and `track-10046-stale-lane-
      snapshot.test.mjs` pass unchanged — confirmed no regression, strictly additive.

**Impact**: Defence in depth is restored: even if a future change reopens a pre-spawn window, the
exit handler independently refuses the write.

---

## Phase 5: Bound worker-identity accumulation (REQ-8, REQ-9)

**Scope is set by Phase 1 Task 1.4's census** — do not start this phase before reading it.

**Problem**: Nothing prevents N base identities from registering and polling one project.
**Solution**: Prevent accumulation at start time; count only base identities.

- [x] Task 5.1: Added `classifyWorkerIdentity(workerNumber)` to `orphan-worker-detection.mjs`.
      **Revised finding, see Task 1.4**: there are no "historical multipliers" — the constant
      never changed — so this is a single fixed threshold (`>= 100000` → claim-scoped), not the
      multi-era logic originally anticipated. Simpler than planned, and exact rather than
      heuristic.
- [x] Task 5.2: Added the check at the "── Startup ──" section, immediately before
      `await upsertWorker();` (after the lock, before registration or the poll loop). Queries
      `GET /api/workers`, counts via `findLiveBaseIdentities`, applies
      `decideWorkerIdentityCap` with `LC_MAX_BASE_WORKERS_PER_PROJECT` (default 1) and
      `LC_ALLOW_DUPLICATE_WORKER`. A collector/network failure during the check fails open
      (warns, proceeds) rather than blocking startup on an unrelated fault.
    - [x] Exempted `getIsLocalFs()` and `isManager` explicitly.
- [x] Task 5.3: **Revised from the earlier note in this file** — `cwd` does not need a DB column
      at all. The check already only ever matches identities on `hostname === os.hostname()`
      (this very host), so a matched pid's cwd is a direct, local `/proc/<pid>/cwd` read — the
      same technique `reapOrphanedWorkerProcesses`'s `cwdExists` probe already uses — not
      something that needs to travel through the collector/DB. `describeIdentity()` now composes
      `worker_number`/`pid`/`cwd` (best-effort; falls back to `unknown` if the pid is already
      gone or `/proc` is unreadable) for both the warning and the refusal message.
- [x] Task 5.4: `track-10093-worker-identity-cap.test.mjs` (19/19) — cap enforced, override
      honoured, cap-disable honoured, claim-scoped rows excluded from the count, manager/local-fs
      exemptions pinned, fail-open on collector error pinned, the refusal message's
      worker_number/pid/cwd content pinned, and the stale-heartbeat exemption (TC-5.7) confirmed
      satisfied by `/api/workers`'s own existing SQL filter.

**Impact**: The accumulation that multiplied every window above cannot build up silently across a
long session of restarts. This is the marketplace/managed-app hardening the problem statement
calls for: a customer instance restarted repeatedly during upgrades stops compounding the fault.

---

## Phase 6: Observability for suppressed writes (REQ-7)

**Problem**: Every revert in the live incident was invisible — no error, no log line, just a card
that moved. The fixes above must not be invisible in the same way when they fire.
**Solution**: Structured, greppable evidence for every suppression, and a UI signal for
duplicates.

- [x] Task 6.1: Both suppression sites (dispatch-abandon, DB-pull-skip) log via the shared
      `logger`/`console.warn` with the track number and the specific reason/changed-fields.
      Confirmed neither writes to `conversation.md` (`track-10093-suppression-throttle.test.mjs`
      TC-6.3).
- [x] Task 6.2: Added `conductor/services/suppression-log-throttle.mjs`
      (`createSuppressionLogThrottle`, `LC_SUPPRESSION_LOG_INTERVAL_MS`, default 60000ms — same
      pattern as `collector-health.mjs`'s `LC_COLLECTOR_FAILURE_LOG_INTERVAL_MS`), keyed per
      `${trackNumber}:${kind}:${reason}` so different suppression kinds for the same track are
      throttled independently. One shared instance guards both sites; the underlying
      release/skip logic itself is confirmed (by test) to run every cycle regardless of whether
      that cycle logs.
- [ ] Task 6.3: **Deferred — not implemented in this pass.** A Workers-view UI badge is
      front-end work (`ui/src/components/WorkersList.jsx` plus a way to surface the count, likely
      piggybacking on the existing `collector_health`-style per-worker heartbeat payload) that
      this implementation pass did not reach. `findLiveBaseIdentities`/`decideWorkerIdentityCap`
      already compute everything a badge would need; wiring them into a heartbeat field and a UI
      element is left for a follow-up. This is a genuinely separable enhancement — Phase 5's
      startup refusal is what actually *prevents* the accumulation Task 6.3 would only make more
      visible after the fact — so leaving it open does not block this track's core acceptance
      criteria (none of spec.md's ACs reference a UI badge).

**Impact**: The next occurrence of anything in this family is diagnosable from the log alone,
instead of requiring live `ps aux` archaeology.

---

## Notes for the implementer

- **Restart the worker before believing any manual verification.** The running worker holds the
  old code in memory; a fix on disk changes nothing until restart. This repo has produced several
  false passes this way (`conductor/quality-gate.md`).
- **Phase 1 before everything.** If Task 1.1's test does not fail against current `main`, the
  mechanism in `spec.md` is wrong and the plan must be revised before any fix is written.
- **Do not weaken `lane-regression-guard.mjs`.** Phases 2–4 narrow the windows *feeding* it; the
  guard's own semantics stay as track 10040 and AM-10046 left them.

## Implementation status (this pass)

Phases 1-5 complete in full, including their tests (59 new tests across 6 files, all passing).
Phase 6: Tasks 6.1-6.2 complete; Task 6.3 (UI badge) explicitly deferred — see its own entry
above for why that doesn't block this track's core acceptance criteria.

**What could not be verified from this session, and why (structural, not an oversight):**
This branch runs in a track worktree (`workspace: branch`), while the fixed code is for
`conductor/laneconductor.sync.mjs` — the sync worker **currently running and serving this very
project on `main`**. spec.md's own "Open Items for Human Review" flagged this during planning:
verifying `test.md`'s E2E-1 through E2E-4 (does a real, restarted worker actually stop
dispatching `/laneconductor merge` for a track a human just moved to `plan`?) requires this fix
to be running as the live worker, which is only possible after merge + restart, or if a human
sets `**Workspace**: main` on this track before implementation. Neither happened before this
implement run, so:
- All Phase 1-6 unit/wiring tests were run and pass, proving the fix logic is correct and wired
  into the real code paths.
- E2E-1 through E2E-4 (live-worker verification) were **not** performed and cannot be from here.
- Regression suites (`track-10040-lane-regression-guard`, `track-10046-stale-lane-snapshot`,
  `track-10046-run-marker-defer`, `track-1084-worker-identity`) all pass with no changes.
  `track-10083-claim-mirror-guard`'s 2 flaky subtests were confirmed, by swapping in the
  pristine pre-change file and re-running, to fail identically on unmodified code — pre-existing,
  unrelated to this branch.

This is exactly the kind of gap `review`/`quality-gate` exists to catch and route on — flagging
it here rather than claiming full verification that didn't happen.

## ⏳ IMPLEMENTATION COMPLETE FOR THIS PASS — PENDING LIVE-WORKER VERIFICATION

Phases 1–5 fully implemented and tested (59 new tests across 6 files, all passing). Phase 6:
Tasks 6.1–6.2 implemented and tested; Task 6.3 (Workers-view UI badge) explicitly deferred as a
separable, non-blocking enhancement — see its own entry above.

**Deliberately not marked 100% / `## ✅ COMPLETE`**: `test.md`'s own Acceptance Criteria require
E2E-1 through E2E-4 — observing a real, restarted worker actually stop mis-dispatching against
a live human edit — and that cannot be performed from this branch-mode worktree. The code fix
targets `conductor/laneconductor.sync.mjs`, the very worker currently serving this project on
`main`; a fix on a branch has no observable effect until merged and the worker restarted. This
was flagged in spec.md's "Open Items for Human Review" during planning and remains open — no
human set `**Workspace**: main` on this track before this implement run. Passing every unit and
wiring-pin test (which this pass did, in full) is necessary but not sufficient evidence that the
live incident is actually fixed; that verification belongs to `review`/`quality-gate`, run either
after merge or with a human's explicit workspace override.
