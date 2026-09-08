# Tests: Track 10081 — Reconcile track 10067's blocked merge, and stop the unwinnable-merge retry loop

## Test Commands

```bash
# Worker + service tests (node:test, zero deps)
node --test conductor/tests/

# Just this track's new retry-containment tests
node --test conductor/tests/track-10081-structural-block.test.mjs

# Track 10067's own suite, which must pass on the merged branch and again on main
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

# After ANY full suite run — this repo leaks real workers
ps aux | grep '[l]aneconductor.sync.mjs'
```

## Test Cases

### Phase 1: Explicit-base three-way merge, on the branch

- [ ] **TC-1**: `git merge-base main track-10067` exits non-zero, and
      `git merge-base --is-ancestor 1b164edf track-10067` exits 0 —
      expected: confirms there is no natural ancestor and that the
      branch-point marker is the right substitute.
- [ ] **TC-2**: `git diff --stat 1b164edf..track-10067` — expected: 27
      files, ~3893 insertions, ~54 deletions. A materially different count
      means `track-10067` moved and the conflict list must be re-derived.
- [ ] **TC-3**: `git merge-tree --write-tree --merge-base=1b164edf track-10081 track-10067`
      — expected: conflicts in exactly the 5 files spec.md names
      (`conductor/laneconductor.sync.mjs`,
      `conductor/services/manager-pseudo-track.mjs`, `ui/server/index.mjs`,
      and TU-10067's `index.md` and `plan.md`). More than that means a new
      conflict landed since planning and needs its own resolution rule.
- [ ] **TC-3b**: The same command with `main` substituted for
      `track-10081` as the "ours" side — expected: the identical conflict
      file list and identical stage blob hashes. This is the evidence that
      doing the merge on the branch costs nothing (spec.md D5). If the two
      ever diverge, the branch approach needs re-justifying.
- [ ] **TC-3c**: `git merge-base main track-10081` — expected: resolves to
      a commit (`fa25857d` at planning time). This is what makes Phase 4 an
      ordinary merge; if it ever exits non-zero, `track-10081` has been
      orphaned too.
- [ ] **TC-4**: `manager-pseudo-track.test.mjs` (10067's) and
      `track-10069-manager-pseudo-track.test.mjs` (main's) both pass
      against the merged file — expected: green. This is the direct test
      of the additive resolution; either one failing means one side was
      clobbered.
- [ ] **TC-4b**: `grep -E '^export' conductor/services/manager-pseudo-track.mjs`
      on the merged file — expected: all four of main's exports
      (`MANAGER_PSEUDO_TRACK`, `isManagerPseudoTrack`,
      `shouldAdmitManagerPseudoTrack`, `ensureManagerPseudoTrack`) present
      verbatim, plus 10067's five new helpers, plus the two aliases.
- [ ] **TC-5**: `grep -c 'isManagerPseudoTrack\|isReservedPseudoTrackName' conductor/laneconductor.sync.mjs`
      at the `syncConversation` guard site — expected: exactly one guard
      call, not two.
- [ ] **TC-6**: `node --check` on every merged `.mjs` file — expected: no
      syntax errors. Cheap, and catches a botched conflict resolution
      immediately.
- [ ] **TC-7**: Full `node --test conductor/tests/` on the merged branch —
      expected: all pass, including 10067's five new files. Record the real
      output.
- [ ] **TC-8**: `cd ui && npm test` on the merged branch — expected: all
      pass, no regressions in the API server route tests.
- [ ] **TC-8b**: `git -C /home/meller/Code/laneconductor status --short`
      after Phase 1 — expected: no unmerged paths, no unexpected
      modifications. The primary checkout must be untouched (AC-13).

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

### Phase 3: Live verification (not satisfiable by unit tests)

Every check below runs against the **branch's** worker and API server,
started after the primary ones are stopped. Verifying against a process
that was running before the merge is a false pass.

- [ ] **TC-9**: Start a manager worker from `.worktrees/10081` and let one
      layer-1 sweep interval elapse — expected: at least one finding
      written to the supervision pseudo-track's `conversation.md`. Record
      the file content. (AC-3)
- [ ] **TC-10**: With the API server running from `.worktrees/10081`,
      `curl localhost:8091/api/instance-state` and
      `curl localhost:8091/manager/workers` with worker auth — expected:
      both return valid JSON, neither 404s. (AC-5)
- [ ] **TC-11**: Open the Chat view in the browser, select the manager
      target, send a message — expected: a reply appears. Screenshot
      recorded. This is 10069's feature, and it is what an incorrect
      resolution of the pseudo-track conflict would break. (AC-4)
- [ ] **TC-21**: Park a real track at `done:failure` with the marker
      against the running worker and API server. Let three poll cycles
      elapse, invoke `/tracks/reset-stuck-actions` once — expected: the DB
      row and `index.md` both still read `failure`. Read both directly.
      (AC-7)
- [ ] **TC-22**: Park an unmarked track at `done:queue` with a deliberately
      failing merge — expected: it retries and then rests at `failure`
      after `max_retries`, rather than looping. (AC-9)
- [ ] **TC-22b**: After stopping the worktree-run processes,
      `ps aux | grep '[l]aneconductor.sync.mjs'` — expected: none of them
      survived, and the primary worker and API server are running again
      from `/home/meller/Code/laneconductor`. (AC-14)

### Phase 4: Landing on main

- [ ] **TC-23**: `git log main --oneline | grep 'track-10067'` — expected:
      10067's Phase 1–7 feature commits reachable from `main`. (AC-1)
- [ ] **TC-23b**: `git diff main track-10067` restricted to 10067's own 27
      paths — expected: empty, confirming content landed rather than a
      merge commit merely existing. (AC-2)
- [ ] **TC-23c**: `node --test conductor/tests/` and `cd ui && npm test`
      re-run on `main` after the merge — expected: all pass. (AC-6, second
      half)

### Phase 5: Cleanup

- [ ] **TC-24**: `git worktree list` — expected: neither `.worktrees/10067`
      nor `/tmp/scratch-merge-10067` present. `/tmp/10065-merge-base-check`
      may still be present; it belongs to track 10065 and is out of scope.
- [ ] **TC-25**: `git branch --list 'track-10067'` — expected: empty
      output.

## Acceptance Criteria

- [ ] All unit tests pass (`node --test conductor/tests/` and `cd ui && npm test`)
      on the merged branch, and again on `main` after Phase 4
- [ ] Track 10067's five new test files pass in both places
- [ ] Track 10069's manager chat surface verified working in a browser
- [ ] No regressions in the pre-existing suite
- [ ] Ordinary transient failures still retry (TC-13, TC-19, TC-22)
- [ ] Live verification performed against processes started from the
      branch, with recorded observations
- [ ] The primary checkout is never left in a conflicted or half-merged
      state (TC-8b), and no worker processes leak (TC-22b)
