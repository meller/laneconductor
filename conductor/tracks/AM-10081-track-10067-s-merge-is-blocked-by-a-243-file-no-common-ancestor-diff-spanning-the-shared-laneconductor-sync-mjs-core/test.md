# Tests: Track 10081 — Reconcile track 10067's blocked merge, and stop the unwinnable-merge retry loop

## Test Commands

```bash
# Worker + service tests (node:test, zero deps)
node --test conductor/tests/

# Just this track's new retry-containment tests
node --test conductor/tests/track-10081-structural-block.test.mjs

# Track 10067's own suite, which must pass on main after the merge
node --test conductor/tests/manager-sweep.test.mjs \
             conductor/tests/manager-sweep-runner.test.mjs \
             conductor/tests/manager-escalation.test.mjs \
             conductor/tests/manager-pseudo-track.test.mjs \
             conductor/tests/track-10067-manager-supervision.test.mjs \
             conductor/tests/track-10067-manager-sweep-e2e.test.mjs \
             conductor/tests/track-10067-manager-pseudo-track-e2e.test.mjs \
             conductor/tests/track-10067-manager-escalation-workspace-bypass.test.mjs

# UI + API server tests (Vitest)
cd ui && npm test
```

## Test Cases

### Phase 1: Explicit-base three-way merge

- [ ] **TC-1**: `git merge-base main track-10067` exits non-zero, and
      `git merge-base --is-ancestor 1b164edf track-10067` exits 0 —
      expected: confirms there is no natural ancestor and that the
      branch-point marker is the right substitute.
- [ ] **TC-2**: `git diff --stat 1b164edf..track-10067` — expected: 27
      files, ~3893 insertions, ~54 deletions. A materially different count
      means `main` moved and the conflict list must be re-derived.
- [ ] **TC-3**: `git merge-tree 1b164edf main track-10067` — expected:
      exactly 6 conflict hunks, in the 5 files spec.md names. More than
      that means a new conflict landed on `main` since planning and needs
      its own resolution rule.
- [ ] **TC-4**: `manager-pseudo-track.test.mjs` (10067's) and
      `track-10069-manager-pseudo-track.test.mjs` (main's) both pass
      against the merged file — expected: green. This is the direct test
      of the additive resolution; either one failing means one side was
      clobbered.
- [ ] **TC-5**: `grep -c 'isManagerPseudoTrack\|isReservedPseudoTrackName' conductor/laneconductor.sync.mjs`
      at the `syncConversation` guard site — expected: exactly one guard
      call, not two.
- [ ] **TC-6**: `node --check` on every merged `.mjs` file — expected: no
      syntax errors. Cheap, and catches a botched conflict resolution
      immediately.
- [ ] **TC-7**: Full `node --test conductor/tests/` on the merged tree —
      expected: all pass, including 10067's five new files. Record the real
      output.
- [ ] **TC-8**: `cd ui && npm test` on the merged tree — expected: all
      pass, no regressions in the API server route tests.

### Phase 1 live verification (not satisfiable by unit tests)

- [ ] **TC-9**: Restart the worker, then start a manager worker and let one
      layer-1 sweep interval elapse — expected: at least one finding
      written to the supervision pseudo-track's `conversation.md`. Record
      the file content.
- [ ] **TC-10**: Restart the API server, then
      `curl localhost:8091/api/instance-state` and
      `curl localhost:8091/manager/workers` with worker auth — expected:
      both return valid JSON, neither 404s.
- [ ] **TC-11**: Open the Chat view in the browser, select the manager
      target, send a message — expected: a reply appears. Screenshot
      recorded. This is 10069's feature, and it is what an incorrect
      resolution of the pseudo-track conflict would break.

### Phase 2: Structurally-blocked containment

Written before any fix, and each must fail against current `main` first.

- [ ] **TC-12**: A track row at `lane_action_status = 'running'` with a
      stale heartbeat AND the structurally-blocked marker, put through
      `POST /tracks/reset-stuck-actions` — expected: not reset, stays out
      of `queue`. Fails today.
- [ ] **TC-13**: The same track row WITHOUT the marker — expected: reset to
      `queue` with `stuck_timeout`, exactly as today. Guards against an
      over-broad fix.
- [ ] **TC-14**: `findPhantomRunningTracks` given a phantom carrying the
      structurally-blocked fact — expected: excluded from the returned
      phantom set.
- [ ] **TC-15**: `findPhantomRunningTracks` given an ordinary phantom —
      expected: still returned, and `classifyPhantom` still reconciles it
      on first sighting.
- [ ] **TC-16**: A spawned run killed by the liveness timeout — expected:
      `.retry-count` incremented by one. Fails today, because the
      increment lives in the exit handler the SIGTERM bypasses.
- [ ] **TC-17**: A run that exits non-zero normally — expected:
      `.retry-count` incremented by one, unchanged from today. Confirms
      Task 2.6 moved the accounting without double-counting it.
- [ ] **TC-18**: A track at `done:failure` with the marker, across three
      full `autoLaunchLocalFs` cycles — expected: never claimed.
- [ ] **TC-19**: A track at `done:failure` without the marker, with
      `.retry-count` below `max_retries` — expected: still claimed and
      retried. This is AC-9's regression guard.
- [ ] **TC-20**: Concurrent reaper write and live-session write to the same
      track row — expected: a log line naming the losing writer.

### Phase 2 live verification

- [ ] **TC-21**: Park a real track at `done:failure` with the marker
      against a running worker and API server. Let three poll cycles
      elapse, invoke `/tracks/reset-stuck-actions` once — expected: the DB
      row and `index.md` both still read `failure`. Read both directly.
- [ ] **TC-22**: Park an unmarked track at `done:queue` with a deliberately
      failing merge — expected: it retries and then rests at `failure`
      after `max_retries`, rather than looping.

### Phase 3: Cleanup

- [ ] **TC-23**: `git diff main track-10067` restricted to 10067's own 27
      paths — expected: empty, confirming content landed before anything
      is deleted.
- [ ] **TC-24**: `git worktree list` — expected: neither `.worktrees/10067`
      nor `/tmp/scratch-merge-10067` present.
- [ ] **TC-25**: `git branch --list 'track-10067'` — expected: empty
      output.

## Acceptance Criteria

- [ ] All unit tests pass (`node --test conductor/tests/` and `cd ui && npm test`)
- [ ] Track 10067's five new test files pass on `main`
- [ ] Track 10069's manager chat surface verified working in a browser after the merge
- [ ] No regressions in the pre-existing suite
- [ ] Ordinary transient failures still retry (TC-13, TC-19, TC-22)
- [ ] Live verification performed against restarted worker and API processes, with recorded observations
