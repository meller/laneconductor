# Track 10081: Reconcile track 10067's blocked merge, and stop the unwinnable-merge retry loop

Five phases. Phase 1 lands 10067 onto this track's branch. Phase 2 stops the
loop that would otherwise re-attack any future merge in the same shape.
Phase 3 verifies both against running processes. Phase 4 lands the whole
thing on `main`. Phase 5 cleans up. Phase 2 does not depend on Phase 1, but
Phase 1 is the urgent half — 10067 is finished, reviewed, quality-gated work
sitting unmerged.

**Where each phase runs** (revised 2026-09-08 after human review — see
spec.md D5):

| Phase | Runs in | Why |
|---|---|---|
| 1. Reconcile 10067 | `.worktrees/10081` (branch) | The conflict set is identical whether `main` or `track-10081` is the "ours" side, and the branch keeps a half-merged tree out of the checkout 28 worktrees and two live processes share. |
| 2. Retry containment | `.worktrees/10081` (branch) | Ordinary code change. |
| 3. Live verification | Branch code, primary processes stopped and re-pointed | The worker and API do not hot-reload, so a running process is required — but no code is written into the primary checkout. |
| 4. Merge to `main` | Primary checkout | The `done` lane's merge action, already forced to `workspace: main` by track 10035. |
| 5. Cleanup | Primary checkout | Removing worktrees and deleting branches is repo administration, not a file change. |

Phases 1–3 are the `implement` lane's work. Phase 4 is the `done` lane.
Phase 5 runs once, after Phase 4, and is the only step a human may prefer to
run by hand.

---

## Phase 1: Land track 10067 onto `track-10081` via an explicit-base three-way merge

**Problem**: Track 10067's work is complete and gated but unmergeable by
the normal path, because `main` and `track-10067` share no common ancestor
after a history rewrite. Measured tip-to-tip it looks like a 243-file
change across the shared worker core. Measured against its real branch
point it is 27 files and five conflicting files.

**Solution**: Supply `1b164edf` as an explicit merge base, merge into
`track-10081` rather than into `main`, resolve the five known conflicts by
the rules already worked out in spec.md, and verify by running the suite.
The rewrite discontinuity is absorbed once here; `main` later receives this
as an ordinary merge with a real ancestor (`fa25857d`).

- [ ] **Task 1.1**: Re-confirm the branch point before touching anything.
  Verify `1b164edf` is `chore(track-10067): sync files before worktree`,
  that it is an ancestor of `track-10067`, and that
  `git diff --stat 1b164edf..track-10067` still reports 27 files. Then run
  `git merge-tree --write-tree --merge-base=1b164edf track-10081 track-10067`
  and confirm the conflict set is still the five files spec.md names. If it
  is not, re-derive the conflict list rather than trusting this plan's
  counts.
- [ ] **Task 1.2**: Confirm `git merge-base main track-10081` still returns
  a commit. This is what makes the branch approach work — if it ever stops
  being true, `track-10081` has been orphaned by the same rewrite and this
  plan needs rethinking before proceeding.
- [ ] **Task 1.3**: In `.worktrees/10081`, on `track-10081`, perform the
  merge with `git merge-tree`'s base supplied explicitly — either
  `git merge --no-commit` after `git replace --graft`-free setup is not
  available here, so use
  `git read-tree -m -u 1b164edf track-10081 track-10067` followed by
  `git merge-index git-merge-one-file -a`. Do not use a plain `git merge`,
  which has no ancestor to work from and will refuse or degrade to
  unrelated histories.
- [ ] **Task 1.4**: Resolve `conductor/services/manager-pseudo-track.mjs`
  additively per spec.md D2. Start from `main`'s file unchanged. Append
  10067's five new helpers (`pseudoTrackRelDir`, `buildPseudoTrackIndexMd`,
  `buildPseudoTrackConversationMd`, `formatFindingComment`,
  `reconcilePostedFindings`). Re-express 10067's
  `MANAGER_PSEUDO_TRACK_NAME` and `isReservedPseudoTrackName` as aliases of
  `main`'s `MANAGER_PSEUDO_TRACK` and `isManagerPseudoTrack`. Confirm by
  reading the resulting file that all four of 10069's exports survive
  verbatim: `MANAGER_PSEUDO_TRACK`, `isManagerPseudoTrack`,
  `shouldAdmitManagerPseudoTrack`, `ensureManagerPseudoTrack`.
- [ ] **Task 1.5**: Resolve `conductor/laneconductor.sync.mjs`. Keep
  `main`'s `isManagerPseudoTrack(trackNumber)` guard at the
  `syncConversation` site and drop 10067's duplicate. Take 10067's other
  additions (the `MANAGER_ESCALATION_ACTION` workspace bypass, the sweep
  loop wiring, the lock bypass) as-is, since those regions auto-merged.
- [ ] **Task 1.6**: Resolve `ui/server/index.mjs` by keeping both routes.
  10069's `GET /api/instance-state` and 10067's `GET /manager/workers` are
  adjacent, not overlapping.
- [ ] **Task 1.7**: Resolve the two track-bookkeeping conflicts in
  `TU-10067-.../index.md` and `TU-10067-.../plan.md`. These are marker
  churn. Take the side that reflects the track's real terminal state and
  keep the `## ✅ REVIEWED` block.
- [ ] **Task 1.8**: `node --check` every merged `.mjs` file, then run the
  full suite on the merged branch: `node --test conductor/tests/` plus
  `cd ui && npm test`. Record the real output. If anything fails, fix it
  here — a merge that breaks the suite is not a completed merge. After the
  Vitest run, check `ps aux | grep laneconductor.sync.mjs` for leaked
  worker processes and kill any that appear; this suite has leaked real
  workers against the primary checkout before.
- [ ] **Task 1.9**: Confirm the primary checkout was never touched:
  `git -C /home/meller/Code/laneconductor status --short` shows no
  unmerged paths.
- [ ] **Task 1.10**: Commit on `track-10081` as
  `Merge track-10067 into track-10081 (Track TU-10067: intelligent manager supervision)`,
  recording in the commit body that `1b164edf` was supplied as the explicit
  merge base and why.

**Impact**: Track 10067's supervision work sits on a branch that `main` can
absorb by an ordinary merge. Track 10069's chat surface is preserved. The
243-file figure is retired as a measurement artifact.

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

Runs on `track-10081` in `.worktrees/10081`, the same as Phase 1.

- [ ] **Task 2.1**: Write the failing tests first, in
  `conductor/tests/track-10081-structural-block.test.mjs`. Three cases: a
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

**Impact**: An unwinnable merge states its diagnosis once and stops.
Ordinary failures keep retrying. The board stops contradicting itself.

---

## Phase 3: Live verification against running processes

**Problem**: Everything above is verified by tests only. Unit tests cannot
show that a manager sweep actually writes a finding, that the chat surface
still replies, or that a parked track survives a real reaper cycle. The
worker and API server do not hot-reload, so verifying against the currently
running processes would test the pre-merge code and produce a false pass.

**Solution**: Temporarily run the *branch's* worker and API server in place
of the primary ones, on the same ports and the same config, perform every
live check, then restore the primary processes. No code is written into the
primary checkout at any point.

- [ ] **Task 3.1**: Record the current process state first —
  `lc worker status`, `ps aux | grep -E 'laneconductor.sync.mjs|ui/server'`,
  and the contents of `ui/.api.pid`, `ui/.ui.pid`, `conductor/.sync.pid` —
  so the restore in Task 3.7 has something to restore *to*.
- [ ] **Task 3.2**: Stop the primary worker and API server (`lc worker stop`,
  `make api-stop` or the equivalent `lc api stop`). Confirm both are gone
  from `ps aux` before continuing; a surviving process on port 8091 makes
  every check below meaningless.
- [ ] **Task 3.3**: Start the API server from `.worktrees/10081`. Confirm
  `GET /api/instance-state` (10069) and `GET /manager/workers` (10067) both
  return valid JSON and neither 404s. Record both responses. This is AC-5.
- [ ] **Task 3.4**: Open the Chat view in the browser, select the manager
  target, send a message, confirm a reply appears. Screenshot it. This is
  AC-4, and it is what an incorrect resolution of the pseudo-track conflict
  would break.
- [ ] **Task 3.5**: Start a manager worker from `.worktrees/10081` and let
  one layer-1 sweep interval elapse. Confirm at least one finding is
  written to the supervision pseudo-track's `conversation.md`, and record
  the file's contents. This is AC-3.
- [ ] **Task 3.6**: Verify Phase 2 live. Park a track at `done:failure`
  carrying the structurally-blocked marker, let three poll cycles elapse,
  invoke `POST /tracks/reset-stuck-actions` once, and confirm by reading
  both the DB row and `index.md` that it stayed put (AC-7). Then confirm an
  *unmarked* transient failure still retries and rests at `failure` after
  `max_retries` rather than looping (AC-9). Confirm a liveness-killed run's
  `.retry-count` incremented by reading the file (AC-8), and that the
  contention log line names the losing writer (AC-10).
- [ ] **Task 3.7**: Stop every process started from the worktree. Confirm
  with `ps aux | grep laneconductor.sync.mjs` that none survived — this
  repository has a documented history of leaked workers running at
  170–200% CPU against the primary checkout. Then restart the primary
  worker and API server from `/home/meller/Code/laneconductor` and confirm
  they are healthy. This is AC-14.

**Impact**: Every user-observable claim in this track is backed by a
recorded observation against a running process, made before anything
reaches `main`.

---

## Phase 4: Land on `main`

**Problem**: The reconciled work is on a branch and has to reach `main`.

**Solution**: This track's ordinary `done`-lane merge action. `**Merge
Mode**` is already `direct`, and `track-10081` shares an ancestor with
`main`, so there is nothing special about this merge — which is the entire
point of having done Phase 1 on the branch.

- [ ] **Task 4.1**: Confirm `git merge-base main track-10081` still
  resolves, and that `main` has not acquired a new conflicting change in
  the five files Phase 1 touched.
- [ ] **Task 4.2**: Let the `done`-lane merge action run
  (`lc worktrees merge 10081`). If it reports a real conflict against
  `main`-side drift that landed during Phases 1–3, resolve it in-session
  per the merge command's own rules.
- [ ] **Task 4.3**: Re-run `node --test conductor/tests/` and
  `cd ui && npm test` on `main` after the merge lands. Record the output.
  This is the second half of AC-6.
- [ ] **Task 4.4**: Restart the primary worker and API server so `main`'s
  code is what is actually running, and re-confirm both
  `GET /api/instance-state` and `GET /manager/workers` respond.
- [ ] **Task 4.5**: Confirm AC-1 and AC-2 — 10067's feature commits are
  reachable from `main`, and the path-scoped diff over its own 27 changed
  paths is empty.

**Impact**: 10067's supervision work and this track's containment fix are
both live on `main`.

---

## Phase 5: Clean up track 10067's artifacts

**Problem**: Track 10067 leaves behind a worktree, a branch, and an
orphaned scratch worktree from a prior failed merge attempt.

**Solution**: Remove them, but only after Phase 4's verification confirms
the content is genuinely on `main`. Runs in the primary checkout — this is
repository administration, and there is no branch on which it could be
staged.

- [ ] **Task 5.1**: Confirm 10067's content is on `main` — AC-2's
  path-scoped diff must be empty. Do not proceed on the existence of a
  merge commit alone.
- [ ] **Task 5.2**: Remove `/home/meller/Code/laneconductor/.worktrees/10067`.
- [ ] **Task 5.3**: Remove the orphaned `/tmp/scratch-merge-10067`
  worktree left by the earlier failed attempt, and run
  `git worktree prune`. Note: `/tmp/10065-merge-base-check` is also
  orphaned and belongs to track 10065 — report it, do not remove it here.
- [ ] **Task 5.4**: Delete the local `track-10067` branch, and the remote
  branch if one exists.
- [ ] **Task 5.5**: Note in `TU-10067`'s `conversation.md` that the merge
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
- **Merging into the branch is not a compromise.** It was measured: the
  conflict set with `track-10081` as the "ours" side is byte-identical to
  the one with `main`. The branch absorbs the rewrite discontinuity once,
  and `main` then sees an ordinary merge.
- **`manager-pseudo-track.mjs` is the only real judgment call.** The other
  four conflicts are mechanical. Two tracks independently created that
  filename with disjoint APIs; taking either side wholesale breaks the
  other's feature. Additive resolution, main's version first.
- **Restart before verifying.** The worker and API server do not
  hot-reload. This has produced false passes in this repository before.
  Phase 3 exists entirely because of that.
- **Kill what you start.** Both `node --test` and the Vitest suite have
  leaked real worker processes against the primary checkout in this repo.
  Check `ps aux | grep laneconductor.sync.mjs` after every full suite run
  and after Phase 3, not just when something looks wrong.
- **Phase 2's containment must not swallow ordinary failures.** AC-9
  exists specifically to catch an over-broad fix. A change that stops
  every failure from retrying is worse than the loop it replaces.

---

## ⚠️ Gaps (review, 2026-09-08)

Phase 1 Tasks 1.1–1.9 done; Task 1.10 (commit) not done — 27 resolved files sit uncommitted.
Task 1.8's suite triage (pre-existing vs introduced failures) never finished: 59/132 failing in
a targeted re-run, untriaged against a `main` baseline. Phases 2–5 entirely unstarted. Full
verdict in conversation.md. Sent back to `implement:queue`.
