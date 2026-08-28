# Tests: Track 10020 — Bug Fixes Round 2

## Test Commands

```bash
# Pure-module unit tests (Phases 1 & 3)
node --test conductor/tests/track-10020-run-marker.test.mjs
node --test conductor/tests/track-10020-orphan-classify-crashed.test.mjs

# End-to-end, real worker + mock collector (Phases 2 & 4)
node --test conductor/tests/track-10020-orphan-reconcile-periodic.test.mjs
node --test conductor/tests/track-10020-dispatch-running-patch.test.mjs

# Full worker suite — regression check
node --test conductor/tests/

# UI/server unit + integration
cd ui && npm test
```

E2E tests use the existing harness from
`conductor/tests/track-10020-reconcile-premature-finalize.test.mjs`: `mock-collector.mjs` for the
collector, `mock-cli.mjs` for the spawned CLI, `LC_*_POLL_MS` env overrides to compress timing.

---

## Test Cases

### Phase 1 — `conductor/services/run-marker.mjs` (unit)

- [x] TC-1.1: `runMarkerPath('/repo', '10020')` — expected: `/repo/conductor/.runs/10020.json`
- [x] TC-1.2: `buildRunMarker(...)` round-trips through `JSON.stringify` → `parseRunMarker` — expected: every field preserved (`pid`, `pgid`, `worker_pid`, `track_number`, `dispatch_id`, `action`, `command`, `started_at`)
- [x] TC-1.3: `parseRunMarker('{ truncated')` and `parseRunMarker('{}')` — expected: `null`, no throw (a corrupt marker must never take down the reconcile loop)
- [x] TC-1.4: `isRunMarkerLive` with `isPidAlive → true` and `readProcessCommand → 'claude --print ...'` for a marker recording `command: 'claude'` — expected: `{ live: true }`
- [x] TC-1.5: `isRunMarkerLive` with `isPidAlive → false` — expected: `{ live: false, reason: 'pid-gone' }` (`readProcessCommand` must not even be consulted)
- [x] TC-1.6: pid-reuse guard — `isPidAlive → true` but `readProcessCommand → '/usr/bin/vim notes.txt'` — expected: `{ live: false, reason: 'command-mismatch' }`. **This is the case that would otherwise block a track's reconciliation forever.**
- [x] TC-1.7: `readProcessCommand → null` (ps unavailable/failed) with pid alive — expected: `{ live: false, reason: 'command-unreadable' }` — fail open toward reconciling, never block forever
- [x] TC-1.8: `isRunMarkerLive(null, ...)` — expected: `{ live: false }`, no throw

### Phase 1 — `spawnCli` marker lifecycle (integration)

- [x] TC-1.9: spawn a lane action via the worker with a slow `mock-cli` — expected: `conductor/.runs/<track>.json` exists **in the primary checkout** (not the worktree) while it runs, and its `pid` matches a live process
- [x] TC-1.10: let that CLI exit normally — expected: the marker file is gone
- [x] TC-1.11: SIGKILL the worker's child mid-run — expected: the marker file is still gone (exit handler runs on kill too)
- [x] TC-1.12: `git check-ignore conductor/.runs/10020.json` — expected: exit 0 (ignored)

### Phase 2 — periodic reconciliation

- [x] TC-2.1: worker boots with a `claimed` dispatch already stale — expected: reconciled on the immediate post-registration run, as today (no regression to the existing track-1110 behavior). Own describe block in `track-10020-orphan-reconcile-periodic.test.mjs` with a deliberately slow (60s) periodic interval, proving the immediate call (not the tick) is what resolves it in <1s.
- [x] TC-2.2: dispatch becomes orphaned **after** boot (worker A killed, worker B started, child still running, then child finishes) — expected: worker B finalizes it within ≤2 poll intervals. **This is the bug**; must fail before the fix. Covered by TC-4.1 (identical mechanism, direct-state-seeded rather than a literal two-process kill/restart — see that file's header comment).
- [x] TC-2.3: this process's own in-flight dispatch (in `runningTrackMap` + `activeDispatch`) sits through many orphan ticks — expected: never PATCHed by the orphan path; exactly one outcome PATCH total for that dispatch, from `reconcileActiveDispatch()`
- [x] TC-2.4: dispatch with `claimed_at` 2s ago and no marker yet (claim→worktree→spawn window) — expected: skipped, not finalized
- [x] TC-2.5: a live run marker exists for the track — expected: skipped regardless of what the worktree's `**Lane Status**` currently says. Covered by TC-4.2 (same guard, exercised with a live marker + terminal-looking worktree state).
- [x] TC-2.6: after a dispatch is reconciled — expected: its stale run marker file is deleted. Folded into TC-4.3.

### Phase 3 — crashed-run detection

- [x] TC-3.1: `classifyOrphanedDispatch({ laneStatus: 'running', runnerExited: true, lane: 'implement', action: 'implement' })` — expected: `{ orphaned: true, status: 'failed', skipArtifactCopy: true, flagForHuman: true }` with a re-run message naming the action
- [x] TC-3.2: same input with `runnerExited: false` — expected: `{ orphaned: false }` (today's behavior, unchanged)
- [x] TC-3.3: same input with `runnerExited` omitted entirely — expected: `{ orphaned: false }` (REQ-6: no-marker callers see zero change)
- [x] TC-3.4: `runnerExited: true` with `laneStatus: 'success'` — expected: normal success classification, **not** the crash path (a finished run that merely lost its exit handler is not a crash)
- [x] TC-3.5: existing lane/action-mismatch cases (tracks 10014/1117) with `runnerExited: true` — expected: unchanged results; the mismatch branch still wins

### Phase 4 — end-to-end

- [x] TC-4.1 (the live 10018 incident): direct-state-seeded equivalent of worker A claims a quality-gate dispatch → spawns slow mock CLI → kill worker A only → start worker B (same worker number) → child writes `Lane: done` / `Lane Status: success` to the **worktree's** `index.md` and exits — expected: within ≤2 ticks, dispatch status `done`, artifacts copied to the primary's track folder. Asserts the primary's `index.md` actually reads `Lane: quality-gate` afterwards and exactly one finalizing PATCH.
- [x] TC-4.2: same setup, but while the orphaned child is **still alive**, the worktree already reads a terminal `Lane Status` — expected: dispatch stays `claimed` across several ticks (this is `track-10020-reconcile-premature-finalize`'s guarantee, extended across a process restart via the run-marker liveness check, since this worker's own `runningTrackMap`/`activeDispatch` are empty for the track)
- [x] TC-4.3: same setup, SIGKILL the orphaned child (worktree keeps `Lane Status: running`) — expected: dispatch `failed`, and the track's `conversation.md` gains one `> **system**: ⚠️ ...` comment naming the action to re-run; the stale run marker is deleted
- [x] TC-4.4 (REQ-7, bug 2): dispatch a lane action to a running worker — expected: the mock collector records `PATCH /track/<n>/action` with `lane_action_status: 'running'` at spawn time, **before** the CLI exits
- [x] TC-4.5: no dispatches claimed at all — expected: the periodic tick is a cheap no-op (one GET, no PATCHes, no error logs); worker logs stay quiet across several ticks

### Regression

- [x] TC-R.1: `node --test conductor/tests/*.test.mjs` — 544-545/566 pass; the 13 pre-existing failing suites (auto-launch, runDeploy, lock-unlock, local-api E2E, Track 10017/10024/10035/1086/1102 subprocess E2Es, per-lane-model dispatch E2E, `lc worktrees` CLI) are identical by name before and after this track's changes — confirmed by name comparison, not just count. `track-10020-reconcile-premature-finalize`, `track-1110-*`, `track-1117-*` all still pass.
- [ ] TC-R.2: `cd ui && npm test` — not run this pass; this track's changes are entirely in `conductor/` (sync worker + its own services/tests), never touching `ui/`.
- [x] TC-R.3: worker running in `local-fs` mode — `node --test conductor/tests/local-fs-e2e.test.mjs` (7/7 pass): a real local-fs worker runs several full auto-launch scenarios with no orphan-reconcile errors, and `reconcileOrphanedDispatches()`'s existing `if (getIsLocalFs() || !myWorkerId) return;` guard (unchanged by this track, only wrapped in the new re-entrancy guard) short-circuits by construction before any network call or marker read.

---

## Manual Verification (required before quality-gate)

Unit tests cannot show a cross-process restart works. Perform once, on a real worker:

- [ ] Dispatch a lane action from the UI; confirm the card shows **running**, not queued (bug 2)
- [ ] `lc worker restart` while that CLI is still alive (`ps` shows the child); confirm the card
      keeps showing running, and the marker file is present with a live pid
- [ ] Let the CLI finish; confirm the card advances on the board on its own within ~30s, with no
      manual intervention, and the marker file is gone
- [ ] Record the observation (screenshot or the collector's dispatch row) in `conversation.md`

## Acceptance Criteria

- [ ] All unit tests pass (TC-1.x, TC-3.x)
- [ ] All E2E tests pass (TC-2.x, TC-4.x)
- [ ] TC-2.2 and TC-4.1 demonstrably **fail** against the pre-fix code and pass after
- [ ] No regressions (TC-R.1, TC-R.2, TC-R.3)
- [ ] Manual verification performed and recorded
