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

- [ ] Task 1: New `conductor/tests/track-10046-stale-lane-snapshot.test.mjs`.
    - [ ] Extract the exit handler's lane/status decision into a pure, importable helper so it can
          be tested without booting the worker (the whole-module-boots-on-import constraint is
          already documented in `track-10046-waiting-for-reply-conflation.test.mjs`'s header).
          Target: `conductor/services/conversation-run-write-scope.mjs` — pure, no I/O, mirroring
          `lane-regression-guard.mjs`'s style.
    - [ ] TC-1/TC-2/TC-3 (see `test.md`): the three uncovered quadrants of the guard table in
          `spec.md` — forward clobber, same-lane status clobber, and the already-covered
          backwards case as a non-regression check.
- [ ] Task 2: Pin the two *prompt-level* writers (W1, W2) with source assertions, the same
      technique TC-6 of the existing 10046 test already uses — these are string-construction
      bugs in `autoLaunchLocalFs`, not logic reachable without a spawn.
    - [ ] TC-4: the reply `customPrompt` must not interpolate `lane_status`.
    - [ ] TC-5: the `waitingForReply` branch must not assign `lane_status` to `cmd_type`.
- [ ] Task 3: Run the new file and **confirm every new case fails** against current `main` before
      writing any fix. Record the failing output in `conversation.md`.

**Impact**: A deterministic reproduction of a race that until now was only observable live.

---

## Phase 2: A conversation-reply run may not write Lane or Lane Status (REQ-1, REQ-2, REQ-5)

**Problem**: Three writers (W1 prompt, W2 `cmd_type` → skill step 0, W3 exit handler) all push
the dispatch-time snapshot back to disk.

**Solution**: Narrow a conversation run's write scope to exactly one marker —
`**Waiting for reply**` — plus `conversation.md` content.

- [ ] Task 1: Exit handler (`laneconductor.sync.mjs:5261-5366`) — when `isConversationRun`:
    - [ ] Skip `applyGuardedLaneWrite` entirely; do not compute `effectiveLane` from `laneStatus`.
    - [ ] Do not set `patchData.lane_status`.
    - [ ] Do not send `lane_action_status` derived from `resolveTransition(null, laneStatus, …)`.
          Either omit it from `patchData` or source it from a fresh read of the on-disk
          `**Lane Status**` at completion time (REQ-5).
    - [ ] Keep 3b (`**Waiting for reply**: no` + `patchData.waiting_for_reply = false`) exactly as
          it is — that is the one marker a reply legitimately owns, and AC-8 depends on it.
    - [ ] Keep `**Last Run**` and `last_run.log` writes; neither is part of the lane state machine.
- [ ] Task 2: Reply prompt (`:6145-6148`) — drop the
      `/laneconductor pulse ${track_number} ${lane_status} …` instruction. The worker already
      clears `**Waiting for reply**` in 3b, so the pulse was redundant as well as wrong. Replace
      with an explicit boundary line: post the reply via `/laneconductor comment`, and do not
      touch `**Lane**`, `**Lane Status**`, or `**Progress**`.
- [ ] Task 3: Pre-spawn write (`:6225-6226`) — do not write `**Lane Status**: running` when
      `waitingForReply`. Liveness comes from Phase 3's run marker instead.
- [ ] Task 4: Re-run Phase 1's TC-1..TC-5 — all green.

**Impact**: The stale snapshot stops reaching disk from all three writers. AC-1, AC-2, AC-3, AC-8.

---

## Phase 3: Serialize reply dispatch on the existing run marker (REQ-3, REQ-4)

**Problem**: Removing the `Lane Status: running` write (Phase 2 Task 3) removes the only thing
that stopped the same reply from being re-dispatched on the next 5s poll. And more fundamentally,
nothing today prevents a reply run and a lane action from running two agent sessions on one track
at once — the precondition for every symptom in `spec.md`.

**Solution**: Use `conductor/.runs/<track>.json`, which `spawnCli` already writes at `:5023` and
removes at `:5049-5055`, and which `isRunMarkerLive()` already validates against a live PID.

- [ ] Task 1: In `autoLaunchLocalFs`, before entering the `waitingForReply` dispatch branch, read
      the track's run marker; if `isRunMarkerLive(...)`, log and `continue` — defer to a later
      cycle (AC-6).
- [ ] Task 2: Confirm the marker is genuinely removed on every exit path (normal exit, crash,
      pre-spawn block) so a deferred reply is not deferred forever. `reconcileOrphanedDispatches`
      already reaps markers whose PID is dead; verify it covers the reply label too, and widen it
      if not.
- [ ] Task 3: TC-6/TC-7 — a reply is deferred while a marker is live, and dispatched once cleared.

**Impact**: Two concurrent agent sessions per track become structurally impossible. AC-6, and the
root cause of AC-1..AC-3 rather than just their symptom.

---

## Phase 4: Stop conflating waiting_for_reply with a lane-action retry (REQ-6, REQ-7, REQ-8)

**Problem**: `cmd_type = lane_status` runs the *actual lane action* (up to and including
`/laneconductor merge`) under the `local-fs-answer` label, with no human involved — and drags the
global main-mode git lock in with it via `resolveWorkspaceMode(laneStatus, …)`.

**Solution**: A conversation reply dispatches a non-lane command, always.

- [ ] Task 1: Replace `cmd_type = lane_status` / `cmd_type = 'implement'` (`:6128-6132`) with a
      single non-lane command for the non-brainstorm case. `cmd_type` reaches `spawnCli`'s
      `action` param and `buildCliArgs`'s `command`; since `customPrompt` overrides the prompt,
      the value's real effect is on workspace/lock resolution — so it must name something that is
      not a lane.
- [ ] Task 2: Make the reply run's workspace resolution reflect what it does — appends to
      `conversation.md` in the primary checkout — without taking the global main-mode lock
      (REQ-7). Check `resolveWorkspaceMode`'s inputs: `laneStatus` must stop being the driver for
      a reply run.
- [ ] Task 3: Give a blocked lane-action retry its own signal (REQ-8). `handlePreSpawnBlock`
      already produces the ⚠️/❌ comments via `prespawn-block.mjs`; the fix is that it must no
      longer be reached *under the `local-fs-answer` label*, and the "waiting to retry" state must
      read distinctly from "needs your reply" wherever `waiting_for_reply` currently drives the
      `needs_input` bucket (`ui/src/components/InboxPanel.jsx:168`,
      `ui/src/components/wizard/FollowBuildView.jsx:25`).
- [ ] Task 4: TC-8/TC-9/TC-10 — a `done` + `waiting_for_reply` track does not spawn merge under
      the answer label; no main-mode lock is taken; the two states render distinctly.

**Impact**: `waiting_for_reply` recovers its single documented meaning. AC-4, AC-5, AC-7.

---

## Phase 5: Audit every other claim-time-snapshot writer (REQ-9, REQ-10)

**Problem**: The stale-snapshot-wins pattern may not be unique to `local-fs-answer` — the
snapshot is `spawnCli`'s 8th argument, which *every* dispatch path passes.

**Solution**: Enumerate and classify each site; fix or document each.

- [ ] Task 1: Enumerate the `**Lane**` write sites in `laneconductor.sync.mjs`
      (`:5339`, `:6100`, `:6018-6019`, `:6295`, `:6381`, `:7106`, `:7834`) plus the DB→disk pull
      site, and classify each as fresh-read or snapshot-write.
    - [ ] Known-safe reference: `checkAutoCompleteProgress` re-reads `afterLane` fresh at `:6381`.
    - [ ] Known-suspect: the max-retries failure write at `:6097-6103` regex-patches `content`
          captured at the top of the same scan and bypasses `applyGuardedLaneWrite` entirely.
    - [ ] Known-suspect: the supervised-implement "done" transition at `:6016-6024`, same shape.
- [ ] Task 2: Close the guard's forward direction (REQ-9) in
      `conductor/services/lane-regression-guard.mjs` — a write of lane X over on-disk Y where
      `X !== Y` and the run did not execute in Y is illegitimate in either rank direction. Verify
      no legitimate transition is broken: `producedByThisRun` is exactly the flag that should
      permit them, and it is already computed from a fresh pre-write read at `:5339-5344`.
- [ ] Task 3: Route the sites found in Task 1 through `applyGuardedLaneWrite` rather than raw
      regex replacement.
- [ ] Task 4: TC-11/TC-12 — forward clobber blocked; every legitimate `on_success`/`on_failure`
      transition in `workflow.json` still passes the guard.

**Impact**: The class of bug is closed, not just this instance. AC-1, AC-2 held structurally.

---

## Notes

- Already landed for this track (commit `ab25d5f`): `hasGenuineUnansweredHumanComment()` clears a
  stale `**Waiting for reply**` flag before the answer branch (`:6118-6123`), with tests in
  `conductor/tests/track-10046-waiting-for-reply-conflation.test.mjs`. That closes the *stray
  flag* half of Finding 2. The structural conflation is Phase 4 and remains open.
- This track's own workspace is `main` (`**Track Kind**: bug`), so every commit must reference
  `track-10046` per `conductor/workflow.md`'s Commit Strategy.
- The worker must be **restarted** before any manual verification — it does not hot-reload, and
  this repo has produced false passes from exactly that (see `conductor/quality-gate.md`).
