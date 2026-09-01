# Track AM-10046: local-fs-answer Overwrites Lane With a Stale Snapshot

Five phases. Phase 1 is a reproduction that must **fail** before Phases 2–4 land, per the TDD
protocol. Phases 2 and 3 are the core fix; Phase 4 is Finding 2; Phase 5 is the audit.

Every phase's test cases are enumerated in `test.md`.

---

## Phase 1: Reproduce the race with a failing regression test

**Problem**: The defect is a timing race across two processes. Nothing in the suite currently
exercises "a reply run completes while the lane has moved underneath it", so any fix would be
unverifiable.

**Solution**: A `node:test` harness (real filesystem, no DB — matching
`conductor/tests/local-fs-e2e.test.mjs`'s style) that drives the three writers directly rather
than racing real wall-clock spawns, so the test is deterministic.

- [x] Task 1: New `conductor/tests/track-10046-stale-lane-snapshot.test.mjs`.
    - [x] Extract the exit handler's lane/status decision into a pure, importable helper:
          `conductor/services/conversation-run-write-scope.mjs` — pure, no I/O, mirroring
          `lane-regression-guard.mjs`'s style. `getConversationRunWriteScope()` gates Lane/Lane
          Status writes; `CONVERSATION_REPLY_ACTION` is the non-lane sentinel for Phase 4.
    - [x] TC-1/TC-2/TC-3: implemented as source-pinned/pure-function tests against the real,
          already-existing `shouldBlockLaneWrite` (no reason to re-mirror exit-handler logic that
          can't itself change behavior once frozen in a test file — see the test file's header
          comment for why source-pin was chosen over a duplicated mirror). TC-1 turned out to be
          a Phase 5 fix (general guard gap, REQ-9), not Phase 2 — corrected in this file's Phase 5
          section below.
- [x] Task 2: Pin the two *prompt-level* writers (W1, W2) with source assertions, the same
      technique TC-6 of the existing 10046 test already uses — these are string-construction
      bugs in `autoLaunchLocalFs`, not logic reachable without a spawn.
    - [x] TC-4: the reply `customPrompt` must not interpolate `lane_status`.
    - [x] TC-5: the `waitingForReply` branch must not assign `lane_status` to `cmd_type`
          (confirmed Phase 4, not Phase 2 — see TC-5's own comment in the test file).
- [x] Task 3: Ran the new file against current `main` — **4 of 7 fail as expected**
      (TC-1, TC-2, TC-4, TC-5); TC-2a/TC-2b (new module's own contract) and TC-3 (already-correct
      non-regression) pass immediately, as designed. Full output recorded in `conversation.md`.
      Confirmed no regression: `track-10046-waiting-for-reply-conflation.test.mjs` (15/15) and
      `track-10040-lane-regression-guard.test.mjs` still pass unchanged.

**Impact**: A deterministic reproduction of a race that until now was only observable live.

---

## Phase 2: A conversation-reply run may not write Lane or Lane Status (REQ-1, REQ-2, REQ-5)

**Problem**: Three writers (W1 prompt, W2 `cmd_type` → skill step 0, W3 exit handler) all push
the dispatch-time snapshot back to disk.

**Solution**: Narrow a conversation run's write scope to exactly one marker —
`**Waiting for reply**` — plus `conversation.md` content.

- [x] Task 1: Exit handler — when `isConversationRun` (via `getConversationRunWriteScope`):
    - [x] Skip `applyGuardedLaneWrite` entirely when `!writeScope.canWriteLane`; `effectiveLane`
          is now computed inside that same guard, never reached for a conversation run.
    - [x] `patchData.lane_status` unaffected — confirmed already never set for a conversation run
          even pre-fix (`targetLane === laneStatus` for `isConversationRun`, so the existing
          `targetLane !== laneStatus` guard already excluded it); the `!laneWriteGuard.blocked`
          default (`blocked: true`) is extra insurance now that the call is skipped.
    - [x] `patchData.lane_action_status` now only set `if (writeScope.canWriteLaneStatus)` —
          omitted entirely from the DB patch for a conversation run (REQ-5's "omit" branch).
    - [x] Kept 3b (`**Waiting for reply**: no` + `patchData.waiting_for_reply = false`) unchanged
          — AC-8 verified via TC-2's source assertion plus the unchanged 3b block.
    - [x] Kept `**Last Run**` and `last_run.log` writes unconditional — TC-2c pins this.
- [x] Task 2: Reply prompt — dropped the
      `/laneconductor pulse ${track_number} ${lane_status} …` instruction. The worker already
      clears `**Waiting for reply**` in 3b (runs regardless of what the agent does), so the pulse
      was redundant as well as wrong. Replaced
      with an explicit boundary line: post the reply via `/laneconductor comment`, and do not
      touch `**Lane**`, `**Lane Status**`, or `**Progress**`.
- [x] Task 3: Pre-spawn write — gated `**Lane Status**: running` behind `!waitingForReply`.
      Note: liveness for a reply run is NOT yet covered by Phase 3's run marker — that phase is
      still open below. Between Phase 2 and Phase 3 landing, a reply dispatch has no running-state
      marker at all (acceptable: Phase 2's fix means nothing reads it as authoritative anyway, and
      Phase 3 closes the actual serialization gap).
- [x] Task 4: Re-ran Phase 1's file — TC-2/TC-2c/TC-3/TC-4 green (6/8 total, including TC-2a/TC-2b
      which were already green). TC-1 (Phase 5) and TC-5 (Phase 4) stay red as expected. Verified
      no regression: `track-10046-waiting-for-reply-conflation.test.mjs` (15/15) and
      `track-10040-lane-regression-guard.test.mjs` unaffected;
      `conductor/tests/local-fs-e2e.test.mjs` has 2 pre-existing failures
      (`on_success: in-progress → review`, `full pipeline`) confirmed present on unmodified `main`
      via the same run against a stash of these changes — not caused by this phase.

**Impact**: The stale snapshot stops reaching disk from all three writers. AC-1, AC-2, AC-3, AC-8.

---

## Phase 3: Serialize reply dispatch on the existing run marker (REQ-3, REQ-4)

**Problem**: Removing the `Lane Status: running` write (Phase 2 Task 3) removes the only thing
that stopped the same reply from being re-dispatched on the next 5s poll. And more fundamentally,
nothing today prevents a reply run and a lane action from running two agent sessions on one track
at once — the precondition for every symptom in `spec.md`.

**Solution**: Use `conductor/.runs/<track>.json`, which `spawnCli` already writes at `:5023` and
removes at `:5049-5055`, and which `isRunMarkerLive()` already validates against a live PID.

- [x] Task 1: Inside the `if (waitingForReply)` branch, before assigning `label`/`cmd_type`, read
      the track's run marker via `parseRunMarker(readIfExists(runMarkerPath(process.cwd(),
      track_number)))` and `isRunMarkerLive(...)`; if live, log and `continue` (AC-6).
- [x] Task 2: Confirmed, not widened — already correct as-is:
      - Normal/crash exit: `proc.on('exit', ...)` removes the marker unconditionally
        (`rmSync(markerPath)`), regardless of run type — a reply run's marker is cleaned up the
        same as any other spawn's.
      - Pre-spawn block: the marker is only ever written AFTER a successful spawn (inside
        `proc.on('exit')`'s sibling code, past `proc.unref()`) — a pre-spawn-blocked run never
        writes one in the first place, so there is nothing to leak.
      - `reconcileOrphanedDispatches` is already action-generic (keys off PID liveness, not
        `action`/label), so it reaps a reply run's stale marker after a worker restart exactly
        like any other.
- [x] Task 3: `conductor/tests/track-10046-run-marker-defer.test.mjs` — a real end-to-end test via
      the isolated-worker helper (never a hand-rolled sandbox, per track 10045's own incident):
      plants a live marker (a real long-sleeping child process) before starting the worker,
      confirms the deferral log line appears and the mock CLI is never invoked (TC-6), then clears
      the marker and confirms the mock CLI runs on the next cycle (TC-7). Both green on a real
      spawned worker, ~10.5s. No regressions: `track-10046-stale-lane-snapshot`/
      `waiting-for-reply-conflation`/`lane-regression-guard` unaffected;
      `local-fs-e2e.test.mjs` shows the same 2 pre-existing failures as Phase 2, nothing new.

**Impact**: Two concurrent agent sessions per track become structurally impossible. AC-6, and the
root cause of AC-1..AC-3 rather than just their symptom.

---

## Phase 4: Stop conflating waiting_for_reply with a lane-action retry (REQ-6, REQ-7, REQ-8)

**Problem**: `cmd_type = lane_status` runs the *actual lane action* (up to and including
`/laneconductor merge`) under the `local-fs-answer` label, with no human involved — and drags the
global main-mode git lock in with it via `resolveWorkspaceMode(laneStatus, …)`.

**Solution**: A conversation reply dispatches a non-lane command, always.

- [x] Task 1: Replaced `cmd_type = lane_status` / `cmd_type = 'implement'` with the single
      non-lane sentinel `CONVERSATION_REPLY_ACTION` for the non-brainstorm case (the brainstorm
      case already correctly used `cmd_type = 'brainstorm'`, untouched). Removed the now-dead
      `CLAIMABLE_LANES` import (its only use was the removed branch).
- [x] Task 2: `spawnCli` now computes `isConversationRun = action === CONVERSATION_REPLY_ACTION`
      and, when true, sets `workspaceMode = null` instead of calling `resolveWorkspaceMode(...)` —
      bypassing it entirely rather than trying to teach it a laneStatus-shaped exception. `null`
      falls through every downstream `=== 'main'` / `=== 'branch'` check as neither, so a reply
      gets no worktree, no main-mode lock, no dirty-checkout guard — it simply operates in
      `process.cwd()`, already the primary checkout for every local-fs dispatch.
- [x] Task 3: Turned out to need no code change — see spec.md's REQ-8 correction note.
      `handlePreSpawnBlock` never touched `**Waiting for reply**` and its comment text was already
      textually distinct ("blocked... will retry" / "Permanently blocked... needs human
      attention"); Finding 2's actual defect was that path becoming reachable *mislabeled* as a
      conversation reply, which Tasks 1-2 already close structurally. Verified, not implemented.
- [x] Task 4: TC-8 (new e2e test, `track-10046-run-marker-defer.test.mjs`) — a `done`-lane track
      with a genuine unanswered comment dispatches with `conversation-reply` in argv, never
      `done`. TC-9 — `resolveWorkspaceMode` sanity-checked to really force `'main'` for
      `plan`/`done` when called normally (proving the bypass isn't moot), plus a source pin that
      `spawnCli` actually takes the `isConversationRun ? null : ...` branch. TC-10 — pins
      `handlePreSpawnBlock` never sets `waiting_for_reply` and its comment text never reads as
      "needs your reply". All green; TC-1 (Phase 5) is the only case still red.

**Impact**: `waiting_for_reply` recovers its single documented meaning. AC-4, AC-5, AC-7.

---

## Phase 5: Audit every other claim-time-snapshot writer (REQ-9, REQ-10)

**Problem**: The stale-snapshot-wins pattern may not be unique to `local-fs-answer` — the
snapshot is `spawnCli`'s 8th argument, which *every* dispatch path passes.

**Solution**: Enumerate and classify each site; fix or document each.

- [x] Task 1: Enumerated every raw `**Lane**` write site in `laneconductor.sync.mjs` (line
      numbers as of this commit):
    - **Fixed this phase** (Task 3): max-retries failure write (`~6192-6215`); supervised-implement
      "done" transition (`~6083-6135`) — both previously regex-patched `content` captured earlier
      in the same loop iteration and bypassed `applyGuardedLaneWrite` entirely.
    - **Already safe, unchanged**: the exit handler's own write (`~5426`, now
      `requireProducedForAnyChange: true`); the DB→disk pull (`~1966`, permanently
      `producedByThisRun: false`, deliberately still permissive of forward pulls — see
      `requireProducedForAnyChange`'s own doc comment for why); `handlePreSpawnBlock`'s status
      write (`~4556`, always same-lane, `producedByThisRun: true`); `startNextAutoCompleteStage`/
      `checkAutoCompleteProgress` (re-reads `afterLane` fresh from disk, `~6485`).
    - **Reviewed, classified safe, out of scope**: `~2382` (additive-only — fires only when
      `**Lane**` is entirely absent, nothing to clobber); `~2688` (`conv-command`'s replan/bug-flow
      handler — fresh-read immediately before write, same synchronous block, and a deliberate
      human-issued command rather than an accidental stale-snapshot write); `~7647`
      (`discard-track` dispatch action — same shape: fresh-read, human-initiated, deliberate).
      Neither of the latter two routes through `applyGuardedLaneWrite`, and that's correct as-is:
      both are explicit human overrides that may legitimately need to move even a `done` track,
      which the terminal-lane rule would otherwise refuse — not this track's problem to solve.
- [x] Task 2: Closed the guard's forward direction via an **opt-in** flag,
      `requireProducedForAnyChange` (see `lane-regression-guard.mjs`'s own doc comment for the
      full reasoning) — NOT a change to the guard's default behavior. Discovered mid-implementation
      that a blanket close (no opt-in) would have broken the DB→disk pull's legitimate permissive
      handling of forward moves (e.g. a human dragging a card forward in the UI, which passes
      `producedByThisRun: false` UNCONDITIONALLY by design). Only the exit handler's own call site
      — where `producedByThisRun` genuinely means "did this run execute in the on-disk lane,"
      freshly recomputed every call — opts in.
    - **Also found and fixed while wiring this** (not originally scoped, but directly necessary):
      `rank()` didn't normalize lane names through `LaneAliases` before ranking, so an
      alias-named lane (`in-progress`, `planning`, etc. — a real, existing concept elsewhere in
      this file via `extractLaneFromIndex`) was treated as "unknown lane" and fail-closed-blocked
      even a same-value no-op. Caught because Phase 5's own new call sites (Task 3) were the
      first to route THROUGH this guard for tracks using those names, at which point it
      regressed a previously-passing e2e test. Fixing `rank()` itself (the shared primitive) was
      required to avoid that regression, and turned out to also fix two pre-existing,
      independently-confirmed e2e failures (`on_success: in-progress → review`,
      `full pipeline`) that had nothing to do with this track originally — see `test.md`'s
      verification notes.
- [x] Task 3: Both suspect sites now re-read `index.md` fresh (`readIfExists(indexPath) ??
      content`, never reusing the loop-scoped `content`) and route through
      `applyGuardedLaneWrite` with `producedByThisRun: true` (this cycle's own retry-exhaustion /
      "done"-reply-detected decision is the legitimate producer, same as review/quality-gate's
      own `on_failure` transitions).
- [x] Task 4: TC-11 (renamed from the original plan — folded into TC-1, now exercised WITH
      `requireProducedForAnyChange`), TC-12 (every `on_success`/`on_failure` transition in the
      real `conductor/workflow.json` passes the guard when produced), TC-13 (both Task-3 sites
      route through `applyGuardedLaneWrite` with a fresh read — source-pinned). All green.

**Impact**: The class of bug is closed, not just this instance. AC-1, AC-2 held structurally.

---

## Notes

- Already landed for this track (commit `ab25d5f`): `hasGenuineUnansweredHumanComment()` clears a
  stale `**Waiting for reply**` flag before the answer branch (`:6118-6123`), with tests in
  `conductor/tests/track-10046-waiting-for-reply-conflation.test.mjs`. That closes the *stray
  flag* half of Finding 2. The structural conflation was closed by Phase 4 below.
- This track's own workspace is `main` (`**Track Kind**: bug`), so every commit must reference
  `track-10046` per `conductor/workflow.md`'s Commit Strategy.
- The worker must be **restarted** before any manual verification — it does not hot-reload, and
  this repo has produced false passes from exactly that (see `conductor/quality-gate.md`).

## ✅ COMPLETE

All 5 phases implemented, tested, and committed (`d4f1f58`, `798b411`, `6922240`, `60d1947`, and
this phase's commit). Full suite green: `track-10046-stale-lane-snapshot` (12/12),
`track-10046-run-marker-defer` (2/2), `track-10046-waiting-for-reply-conflation` (15/15),
`track-10040-lane-regression-guard` (9/9), `local-fs-e2e.test.mjs` (7/7 — including 2 tests
independently pre-existing-broken before this track, fixed as a side effect of Phase 5's
`LaneAliases` normalization). See `test.md` for the final, accurate test inventory and
acceptance-criteria mapping — the version committed during planning drifted from what was
actually built (Phase 5 in particular changed shape mid-implementation once the DB→disk pull
site's differing semantics were discovered) and was rewritten to match reality during Phase 5.

## ✅ REVIEWED

All acceptance criteria verified. Moved to quality-gate lane.
