# Track 10081: Reconcile track 10067's blocked merge, and stop the unwinnable-merge retry loop

Three phases, deliberately ordered. Phase 1 lands 10067. Phase 2 stops the
loop that would otherwise re-attack any future merge in the same shape.
Phase 3 cleans up. Phase 2 does not depend on Phase 1, but Phase 1 is the
urgent half — 10067 is finished, reviewed, quality-gated work sitting
unmerged.

**Every phase runs in the primary checkout** (`/home/meller/Code/laneconductor`),
not in a track worktree. See spec.md D5.

---

## Phase 1: Land track 10067 via an explicit-base three-way merge

**Problem**: Track 10067's work is complete and gated but unmergeable by
the normal path, because `main` and `track-10067` share no common ancestor
after a history rewrite. Measured tip-to-tip it looks like a 243-file
change across the shared worker core. Measured against its real branch
point it is 27 files and six conflict hunks.

**Solution**: Supply `1b164edf` as an explicit merge base, resolve the six
known conflicts by the rules already worked out in spec.md, and verify the
merged tree by running the product rather than by inspecting the diff.

- [ ] **Task 1.1**: Re-confirm the branch point before touching anything.
  Verify `1b164edf` is `chore(track-10067): sync files before worktree`,
  that it is an ancestor of `track-10067`, and that
  `git diff --stat 1b164edf..track-10067` still reports 27 files. If `main`
  has moved and the numbers shifted, re-run `git merge-tree` and re-derive
  the conflict list rather than trusting this plan's counts.
- [ ] **Task 1.2**: Take the project's global main-mode lock, then perform
  the merge in the primary checkout with
  `git read-tree -m -u 1b164edf main track-10067` followed by
  `git merge-index git-merge-one-file -a`. Do not use `git merge`, which
  has no ancestor to work from and will refuse or degrade to unrelated
  histories.
- [ ] **Task 1.3**: Resolve `conductor/services/manager-pseudo-track.mjs`
  additively per spec.md D2. Start from `main`'s file unchanged. Append
  10067's five new helpers. Re-express 10067's `MANAGER_PSEUDO_TRACK_NAME`
  and `isReservedPseudoTrackName` as aliases of `main`'s
  `MANAGER_PSEUDO_TRACK` and `isManagerPseudoTrack`. Confirm by reading the
  resulting file that all four of 10069's exports survive verbatim.
- [ ] **Task 1.4**: Resolve `conductor/laneconductor.sync.mjs`. Keep
  `main`'s `isManagerPseudoTrack(trackNumber)` guard at the
  `syncConversation` site and drop 10067's duplicate. Take 10067's other
  additions (the `MANAGER_ESCALATION_ACTION` workspace bypass, the sweep
  loop wiring, the lock bypass) as-is, since those regions auto-merged.
- [ ] **Task 1.5**: Resolve `ui/server/index.mjs` by keeping both routes.
  10069's `GET /api/instance-state` and 10067's `GET /manager/workers` are
  adjacent, not overlapping.
- [ ] **Task 1.6**: Resolve the three track-bookkeeping conflicts in
  `TU-10067-.../index.md` and `plan.md`. These are marker churn. Take the
  side that reflects the track's real terminal state and keep the
  `## ✅ REVIEWED` block.
- [ ] **Task 1.7**: Run the full suite on the merged tree before
  committing: `node --test conductor/tests/` plus `cd ui && npm test`.
  Record the real output. If anything fails, fix it here — a merge that
  breaks the suite is not a completed merge.
- [ ] **Task 1.8**: Restart the worker and the API server, then verify the
  three live behaviors: a manager layer-1 sweep writes a finding to the
  supervision pseudo-track's `conversation.md`; the Chat view's manager
  target still replies; both `GET /api/instance-state` and
  `GET /manager/workers` return valid responses. Restarting first is not
  optional — neither process hot-reloads, and verifying against a
  pre-merge process is a false pass.
- [ ] **Task 1.9**: Commit the merge as
  `Merge track-10067 into main (Track TU-10067: intelligent manager supervision)`,
  and set `TU-10067`'s `**Lane Status**: success`.

**Impact**: Track 10067's supervision work becomes reachable from `main`.
Track 10069's chat surface keeps working. The 243-file figure is retired
as a measurement artifact.

---

## Phase 2: Stop structurally-blocked failures from being auto-retried

**Problem**: A `done:failure` outcome whose own diagnosis says "a human
must act" was found back at `done:queue` within minutes. Two components
flip `failure` to `queue` without consulting the retry counter, and the
retry counter itself never advances when a run is killed rather than
exiting. The loop has no termination condition, and concurrent writes from
the reaper and the live session produce three contradictory reports of one
track's state.

**Solution**: Give a lane action a way to record that it is structurally
blocked, teach both reset paths to honor that marker, and move retry
accounting ahead of the kill so an ordinary failure still bounds itself.

- [ ] **Task 2.1**: Write the failing tests first. Three cases: a
  structurally-blocked track survives `/tracks/reset-stuck-actions`; a
  liveness-killed run increments `.retry-count`; an ordinary transient
  failure still retries. All three must fail against current `main` before
  any fix is written.
- [ ] **Task 2.2**: Define the structurally-blocked marker. It belongs on
  the track, read by both consumers, not encoded in either of them
  (spec.md D3). Follow the existing marker conventions in
  `.claude/skills/laneconductor/SKILL.md`'s marker table, and add it there.
- [ ] **Task 2.3**: Make `/laneconductor merge`'s unresolvable-conflict
  path in `conductor/laneconductor.sync.mjs` set that marker alongside
  `done:failure`. This is the write site that produces the diagnosis in
  the first place.
- [ ] **Task 2.4**: Add the marker check to
  `POST /tracks/reset-stuck-actions`'s default branch in
  `ui/server/index.mjs`. The `immediate=true` branch is a worker
  reclaiming its own prior claims on startup and is a different case —
  leave it alone.
- [ ] **Task 2.5**: Add the same check to
  `findPhantomRunningTracks` in `conductor/services/stuck-track-sweep.mjs`.
  It is a pure module with injected facts, so the marker arrives as
  another injected fact rather than as a filesystem read.
- [ ] **Task 2.6**: Move the `.retry-count` increment ahead of the kill in
  the liveness-timeout handler (spec.md D4). A SIGTERM'd process cannot be
  relied on to run its own bookkeeping, which is why the counter never
  advanced.
- [ ] **Task 2.7**: Log the losing writer whenever the reaper and a live
  session contend for the same row, so a future contradiction is
  diagnosable from the log instead of by comparing three surfaces by hand.
- [ ] **Task 2.8**: Confirm all three tests from Task 2.1 now pass, and
  that the pre-existing suite has no regressions.
- [ ] **Task 2.9**: Verify against a real worker. Park a track at
  `done:failure` with the marker, let the worker run at least three poll
  cycles, invoke `/tracks/reset-stuck-actions`, and confirm by reading the
  row and the file that it stayed put. Then confirm an unmarked transient
  failure still retries.

**Impact**: An unwinnable merge states its diagnosis once and stops.
Ordinary failures keep retrying. The board stops contradicting itself.

---

## Phase 3: Clean up track 10067's artifacts

**Problem**: Track 10067 leaves behind a worktree, a branch, and an
orphaned scratch worktree from a prior failed merge attempt.

**Solution**: Remove them, but only after Phase 1's verification confirms
the content is genuinely on `main`.

- [ ] **Task 3.1**: Confirm 10067's content is on `main` — AC-2's
  path-scoped diff must be empty. Do not proceed on the existence of a
  merge commit alone.
- [ ] **Task 3.2**: Remove `/home/meller/Code/laneconductor/.worktrees/10067`.
- [ ] **Task 3.3**: Remove the orphaned `/tmp/scratch-merge-10067`
  worktree left by the earlier failed attempt, and prune stale worktree
  metadata.
- [ ] **Task 3.4**: Delete the local `track-10067` branch, and the remote
  branch if one exists.
- [ ] **Task 3.5**: Note in `TU-10067`'s `conversation.md` that the merge
  landed via this track and by what method, so the next person who hits a
  rewrite-orphaned branch finds the branch-point technique instead of
  re-deriving it.

**Impact**: No stale worktrees or branches. The reconciliation technique
is written down where the next occurrence will look for it.

---

## Notes for the implementer

- **The 243-file number is wrong, and the reason matters.** It came from
  diffing two tips with no merge base. Any future rewrite-orphaned branch
  will produce an equally alarming and equally meaningless number. Look
  for the `chore(track-NNN): sync files before worktree` commit — that is
  the branch point, and it is present on the branch even when `main` no
  longer shares it.
- **`manager-pseudo-track.mjs` is the only real judgment call.** The other
  five conflicts are mechanical. Two tracks independently created that
  filename with disjoint APIs; taking either side wholesale breaks the
  other's feature. Additive resolution, main's version first.
- **Restart before verifying.** The worker and API server do not
  hot-reload. This has produced false passes in this repository before.
- **Phase 2's containment must not swallow ordinary failures.** AC-9
  exists specifically to catch an over-broad fix. A change that stops
  every failure from retrying is worse than the loop it replaces.
