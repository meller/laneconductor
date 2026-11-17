# Tests: Track AM-10046 — Conversation Reply Overwrites Lane With Stale Snapshot

## Test Commands

```bash
# This track's new regression suite (Phases 1-5)
node --test conductor/tests/track-10046-stale-lane-snapshot.test.mjs

# Already-landed half of Finding 2 (must stay green)
node --test conductor/tests/track-10046-waiting-for-reply-conflation.test.mjs

# The guard this track hardens in Phase 5
node --test conductor/tests/track-10040-lane-regression-guard.test.mjs

# Worker E2E — dispatch/auto-launch regressions
node --test conductor/tests/local-fs-e2e.test.mjs
node --test conductor/tests/auto-launch.test.mjs

# Vitest (UI + server) — Phase 4 Task 3 touches InboxPanel / FollowBuildView
cd ui && npm test
```

## Test Cases

### Phase 1 — Reproduce the race (each must FAIL before Phases 2-4 land)

- [ ] **TC-1** (forward clobber, REQ-1/REQ-5): reply run's snapshot is `implement`; disk is
      `plan` at completion (quality-gate's `on_failure` moved it while the reply was in flight).
      Expected: `**Lane**` still reads `plan` afterwards. Current behaviour: `implement` —
      `applyGuardedLaneWrite` does not block a forward write (`intendedRank 2 > onDiskRank 1`).
- [ ] **TC-2** (same-lane status clobber, REQ-2): reply run's snapshot is `plan`; disk is
      `plan` / `**Lane Status**: running` (concurrent lane action live). Expected: `running`
      survives. Current behaviour: forced to `success` — the guard short-circuits on
      `onDiskLane === intendedLane` and writes `intendedStatus` unchecked.
- [ ] **TC-3** (non-regression): reply run's snapshot is `plan`; disk is `implement`. Expected:
      write blocked, `**Lane**` stays `implement`. This quadrant is already covered by track
      10040's guard — assert it stays covered after Phase 5 Task 2 changes the guard.
- [ ] **TC-4** (W1, REQ-1): the reply `customPrompt` built in `autoLaunchLocalFs` must not
      interpolate `lane_status` — source assertion, no `/laneconductor pulse <track> <lane>`
      instruction reachable from the `waitingForReply` branch.
- [ ] **TC-5** (W2, REQ-6): the `waitingForReply` branch must not assign `lane_status` (or any
      `CLAIMABLE_LANES` member) to `cmd_type` — source assertion.

### Phase 2 — Narrowed write scope

- [ ] **TC-2a**: `conversation-run-write-scope` helper reports Lane and Lane Status as
      not-writable for a conversation run, for every lane in `CLAIMABLE_LANES`.
- [ ] **TC-2b** (AC-8): a completed reply run still flips `**Waiting for reply**: yes → no`
      exactly once, so the next poll cycle does not re-fire the same reply.
- [ ] **TC-2c**: a completed reply run still writes `**Last Run**` and `last_run.log` — narrowing
      the scope must not silently drop unrelated bookkeeping.
- [ ] **TC-2d**: a *non*-conversation run (a real lane action) is unaffected — it still writes
      Lane and Lane Status through the guard exactly as before.

### Phase 3 — Run-marker serialization

- [ ] **TC-6** (AC-6): with a live run marker at `conductor/.runs/<track>.json` (PID of a live
      process), a `waiting_for_reply` track is **not** dispatched; the worker logs the deferral.
- [ ] **TC-7**: with the marker absent (or its PID dead, per `isRunMarkerLive`), the same track
      **is** dispatched on the next cycle — deferral is not permanent.

### Phase 4 — waiting_for_reply vs. lane-action retry

- [ ] **TC-8** (AC-4): a track at `done` with `**Waiting for reply**: yes` and a genuine
      unanswered human comment does not produce a `/laneconductor merge` spawn under the
      `local-fs-answer` label. Assert on the resolved `cmd_type`, which must not be `done`.
- [ ] **TC-9** (AC-5): a conversation-reply dispatch does not acquire the global main-mode git
      lock — assert `resolveWorkspaceMode`'s inputs for a reply run no longer key off the
      observed `laneStatus`.
- [ ] **TC-10** (AC-7): a track blocked waiting to retry a lane action and a track waiting on a
      human's reply produce distinct signals. Vitest side: `InboxPanel`'s bucket classification
      and `FollowBuildView`'s `needsInput()` do not report the retry case as `needs_input`.

### Phase 5 — Audit and forward-guard

- [ ] **TC-11** (REQ-9): `shouldBlockLaneWrite` blocks a *forward* write (`intendedRank >
      onDiskRank`) when `producedByThisRun` is false — the direction TC-1 exposed.
- [ ] **TC-12** (REQ-9 non-regression): every `on_success`/`on_failure` transition declared in
      `conductor/workflow.json` — including the backwards ones (`review → implement:queue`,
      `quality-gate → plan:queue`, `plan → backlog`) — still passes the guard when
      `producedByThisRun` is true. Read the transitions from `workflow.json` rather than
      hardcoding them, so a workflow edit cannot silently invalidate the test.
- [ ] **TC-13** (REQ-10): the max-retries failure write (`laneconductor.sync.mjs:6097-6103`) and
      the supervised-implement "done" transition (`:6016-6024`) route their `**Lane**` writes
      through `applyGuardedLaneWrite` — source assertion plus a behavioural case for each.

## Verification beyond unit tests

Per `conductor/quality-gate.md`'s real-product check — unit tests cannot prove the live race is
gone:

- [ ] Restart the worker (`lc worker restart`) before any manual verification. It does not
      hot-reload; this repo has produced false passes from exactly that.
- [ ] Drive the live scenario once: set `**Waiting for reply**: yes` on a scratch track with a
      genuine unanswered human comment, dispatch a lane action for the same track, and confirm
      from `conductor/.sync.log` + the track's `index.md` git history that `**Lane**` records
      **no** flap — a single monotonic transition, not the six-flip oscillation of 2026-08-31.
- [ ] Record the observed `git log -p` of `index.md` across that window in `conversation.md` as
      the evidence for AC-1.

## Acceptance Criteria

- [ ] TC-1 … TC-13 all pass
- [ ] `conductor/tests/track-10046-waiting-for-reply-conflation.test.mjs` still passes (the
      already-landed half of Finding 2 is not regressed)
- [ ] `local-fs-e2e.test.mjs` and `auto-launch.test.mjs` pass — no dispatch-path regressions
- [ ] `cd ui && npm test` passes — Phase 4 Task 3's Inbox/FollowBuild changes are covered
- [ ] The live verification above was actually performed, with its observation recorded
