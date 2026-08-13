# Track 1112: Out-of-band git sync + worktree visibility/merge

Phases are ordered so each one is independently shippable and verifiable.
Phase 1 is already complete — it was performed at planning time and its
findings are written into `spec.md`.

---

## Phase 1: Audit — why are 44 branches unmerged? ✅

**Problem**: Before designing anything, establish whether this is a
lifecycle bug or a visibility gap. Three candidate causes (tracks
legitimately open / merge step failing silently / lifecycle configured so
it never merges) need different fixes.

**Solution**: Classify all 44 unmerged branches against their track's
`index.md` lane state, and sweep every branch for orphaned source changes.

- [x] Enumerate worktrees and unmerged branches (48 / 44 confirmed)
- [x] Cross-reference each branch against its track's `**Lane**` /
      `**Lane Status**`
- [x] Classify: 41 legitimately open, 2 stranded (RC-A), 1 never-attempted
      (RC-B)
- [x] Sweep all branches for non-track-file (source) changes — exactly one
      (`track-1059`), and its work is already in `main` via another route
      (`TrackDetailPanel.jsx:529`)
- [x] Identify RC-A: `mergeAndRemoveWorktree` early-returns on missing
      worktree dir before ever attempting the merge
      (`conductor/laneconductor.sync.mjs:3334`)
- [x] Identify RC-B: merge only fires from `spawnCli`'s exit handler under
      `targetLane === 'done' && isSuccess`
      (`conductor/laneconductor.sync.mjs:3912`)
- [x] Record findings in `spec.md` → Audit Findings

**Impact**: The fix is ~93% visibility, ~7% lifecycle bug. No code is
*currently* unrecovered — but commit `902ee2f` (`.worktrees/1104`,
60% recovered) proves the loss mode is real, and invisibility is what made
it expensive.

---

## Phase 2: `lc worktrees` — visibility (REQ-1, REQ-2)

**Problem**: 48 worktrees and 44 unmerged branches with zero visibility
anywhere except raw git. Stranded branches (worktree gone, branch left) are
invisible even to `git worktree list`.

**Solution**: A local `lc worktrees` command that joins git state to track
lane state. No API, no DB, works in `local-fs` (D-1).

- [ ] Add a `worktrees` command to `bin/lc.mjs`'s dispatch (same style as the
      existing `worker` block at `bin/lc.mjs:1679`)
- [ ] Enumerate sources — union of two sets, because neither is sufficient:
    - [ ] `git worktree list --porcelain` → worktrees present on disk
    - [ ] `git branch --no-merged <main> --format=%(refname:short)` filtered
          to `track-*` → catches stranded branches with no directory
- [ ] Per row, compute: `git rev-list --count <main>..<branch>` (ahead),
      `git rev-list --count <branch>..<main>` (behind),
      `git -C <worktree> status --porcelain | wc -l` (dirty, `-` when the
      directory is gone)
- [ ] Resolve each track's lane from `conductor/tracks/NNN-*/index.md`
      (`**Lane**`, `**Lane Status**`, title) — filesystem only, per REQ-2
- [x] Classify each row — **corrected during implementation**: the
      "done:success" check must read the **branch's own tip commit**
      (`git show <branch>:<path>`), not the working directory or main's
      current state — checking main's current lane state was the exact
      mistake the Phase 1 audit itself made (see spec.md's correction).
      Additionally, a branch can say `done:success` on its own tip yet
      still be stale if main independently re-progressed the *same
      track's lane* since the merge-base — checked by comparing the
      merge-base's lane/laneStatus against main's current lane/laneStatus
      for that track (not "did any byte in the directory change", which
      is too broad and swallows genuine conflicts):
    - `mergeable` — branch tip `done:success`, worktree present, clean
      3-way merge, AND main hasn't independently re-progressed the same
      track's lane since the merge-base
    - `stranded` — same, but worktree directory absent
    - `conflicted` — same, but `git merge-tree --write-tree` reports a
      real conflict (read-only, no working-tree/index mutation)
    - `open` — branch tip not `done:success`, OR main has independently
      re-progressed the track's lane since the merge-base (superseded)
    - Implemented as `conductor/services/worktree-audit.mjs` (pure,
      testable, no `lc` process needed) — `bin/lc.mjs worktrees` is a
      thin formatter over it
    - [x] 6 tests (`conductor/tests/track-1112-worktree-audit.test.mjs`):
          mergeable, stranded, open, conflicted, superseded-not-mergeable
          (the corrected case), and read-only (asserts main's ref and
          working tree are byte-unchanged after an audit run)
    - [x] Re-run against this repo's real 44 branches, corrected numbers:
          **42 open, 2 mergeable (1053, 1069), 0 stranded, 0 conflicted**
          — see spec.md's corrected Audit Findings for the full
          reconciliation against the original (wrong) 41/2/1 numbers
- [ ] Render a table; add `--json` for scripting and `--stranded` to filter
- [ ] Handle the nested-worktree case seen live
      (`.worktrees/1063/.worktrees/9998` — detached HEAD, no `track-*`
      branch): list it, do not classify it as mergeable, never try to merge
      a detached HEAD
- [ ] Add `worktrees` to `lc --help` / the scoped help sections
- [ ] **Open-worktree cap warning** (user request, 2026-08-13): when the
      total *open* count (not stranded/mergeable — those are Phase
      3/4's job) for a project crosses a threshold (default suggestion:
      10 — tune once real usage is observed), print a warning naming the
      oldest open tracks and suggesting the user run their review/
      quality-gate lanes to close some out. **Warning, never a block** —
      does not prevent a new worktree from being created. Two surface
      points, both CLI/log for now (no UI panel exists yet — that's
      Phase 7, already scoped as possibly deferred; this task does not
      pull it forward):
    - [ ] `lc worktrees` itself prints the warning line when the count is
          over threshold (it already computes the full count for the
          table)
    - [ ] `createWorktree` (`laneconductor.sync.mjs`) logs the same
          warning once per heartbeat cycle (not once per worktree
          creation — would spam) when a NEW worktree would cross the
          threshold
    - [ ] Explicitly NOT part of the implement skill's own per-track
          flow (`SKILL.md`'s `/laneconductor implement`) — this is a
          whole-project housekeeping signal, not something one track's
          implementation should reason about or be blocked by

**Impact**: The 48/44 backlog becomes visible in one command, in every
operating mode, correctly distinguishing genuinely-actionable branches (2)
from working-as-designed ones (42) — the wrong 41/2/1 split is what a UI
panel built directly on the original audit would have shown users. Also
gives project owners an early, non-blocking nudge before open-worktree
count becomes its own problem.

---

## Phase 3: Fix the lifecycle bugs (REQ-3, REQ-4, REQ-5, REQ-7)

**Problem**: RC-A strands a branch permanently the moment its worktree
disappears. RC-B means any route to `done` other than one specific worker
exit path never merges at all. Both are in
`conductor/laneconductor.sync.mjs`.

**Solution**: Split the worktree-existence check from the branch-merge
check, move the merge off the shared primary checkout, and add a
state-driven reconciliation pass.

- [ ] **RC-A** — restructure `mergeAndRemoveWorktree`
      (`laneconductor.sync.mjs:3327`):
    - [ ] Precondition for merging = *branch* exists (`git rev-parse
          --verify track-NNN`), not directory exists
    - [ ] Precondition for `removeWorktree` = directory exists (unchanged
          behaviour, just no longer gating the merge)
    - [ ] Missing directory + existing branch → merge, log, skip removal
- [ ] **D-5 / REQ-7** — stop merging in the primary checkout:
    - [ ] Replace `git checkout <main>` + `git merge` in `process.cwd()`
          with a merge performed in a dedicated ephemeral worktree
          (`.worktrees/.merge-<pid>`), removed in a `finally`
    - [ ] Assert (in tests) the primary checkout's branch and
          `git status --porcelain` are unchanged across a merge
    - [ ] Reuse `validatePathIsolation` (`laneconductor.sync.mjs:3183`) for
          the scratch path
- [ ] **RC-B / REQ-4** — add `reconcileWorktrees()`:
    - [ ] For every `track-*` branch unmerged into main, read the track's
          lane from `index.md`; merge only when `done` + `success` (D-2)
    - [ ] Call it from the heartbeat loop, gated on
          `git.reconcile_worktrees !== false`
    - [ ] Idempotent and quiet when there is nothing to do (no log spam on
          every heartbeat — log only when it acts)
    - [ ] Skip any track currently git-locked / claimed by a running worker
          (check the existing lock mechanism — do not merge a branch that is
          being actively written)
- [ ] **REQ-5** — conservative failure handling:
    - [ ] On merge conflict: leave branch + worktree intact, report, continue
          to the next branch (never abort the whole pass)
    - [ ] Never `git branch -D`; only `-d` after a merge this pass confirmed
    - [ ] Never leave the repo mid-merge — `git merge --abort` in the scratch
          worktree on any failure path
- [ ] Keep the existing exit-handler call site working (it becomes the fast
      path; the reconciler is the safety net)

**Impact**: Tracks stop accumulating stranded branches regardless of how
they reach `done`, and merges stop depending on — or endangering — the
shared working copy.

---

## Phase 4: `lc worktrees merge` — manual action (REQ-6)

**Problem**: The existing 3 finished-but-unmerged branches, and any future
conflicted one, need a human-driven path. Reconciliation alone won't clear
a conflict.

**Solution**: A merge subcommand on top of Phase 3's now-correct merge
primitive.

- [ ] `lc worktrees merge <track>` — merges one branch, prints what it did
- [ ] Works for the `stranded` case with no worktree directory (REQ-6/AC-5)
- [ ] Refuses when the track is not `done:success`, explaining why; `--force`
      overrides
- [ ] `--dry-run` reports whether the merge would conflict, changing nothing
- [ ] On conflict: report the conflicting paths and leave everything intact
- [ ] Shares one implementation with Phase 3's reconciler — no second copy of
      the merge logic

**Impact**: The backlog is clearable, and the exceptional case has an
answer that isn't "know the right git incantation".

---

## Phase 5: Out-of-band git sync (REQ-8 … REQ-11)

**Problem**: A direct `git push` by someone not using LaneConductor is
invisible to every worker. The only fetch in the codebase runs while
claiming a lock, and nothing reads its result.

**Solution**: Periodic fetch + divergence reporting; auto-pull only when
provably safe (D-4). This is the riskiest phase — wrong conflict handling
silently loses work — so detection lands before any mutation.

- [ ] **5a — detection only (no git mutation)**:
    - [ ] Read `git.fetch_interval_ms` from `.laneconductor.json`
          (default 300000, `0` disables)
    - [ ] On that interval, `git fetch origin <main> --quiet` in the primary
          repo (read-only; already the established call, see
          `laneconductor.sync.mjs:3108`)
    - [ ] Compute ahead/behind via
          `git rev-list --left-right --count main...origin/main`
    - [ ] Report divergence in the worker log and in the CLI output (REQ-9),
          naming the commit count and whether a fast-forward is available
- [ ] **5b — safe auto-pull (REQ-10)**, gated on `git.auto_pull !== false`
      and on ALL of:
    - [ ] local `main` strictly behind `origin/main`, zero local-only commits
    - [ ] fast-forward possible
    - [ ] no tracked file touched by the incoming commits is dirty locally
          (intersect `git diff --name-only main..origin/main` with
          `git status --porcelain`) — the primary checkout routinely carries
          100+ dirty files, so this check is load-bearing, not defensive
    - [ ] pull via `git merge --ff-only origin/main` (never a bare
          `git pull`, which can start a merge)
- [ ] **5c — post-pull FS→DB resync**: for each
      `conductor/tracks/**/index.md` changed by the pulled commits, run the
      existing `syncTrack` path so out-of-band lane changes reach the DB
- [ ] **5d — unsafe path (REQ-11)**: take no git-mutating action; state the
      reason (diverged / dirty overlap); assert the repo is never left in a
      `MERGING` state

**Impact**: A third party's push stops being invisible; the safe majority
case self-heals, and the unsafe case is surfaced instead of guessed at.

---

## Phase 6: Tests + live verification (AC-1 … AC-12)

**Problem**: This track has an unusually large *real* dataset — 48
worktrees, 44 unmerged branches, 3 with known-correct expected
classifications. Synthetic fixtures alone would not have caught RC-A.

**Solution**: Unit/integration tests on synthetic repos, plus a real check
against this machine's actual state.

- [ ] New `conductor/tests/track-1112-worktree-visibility.test.mjs`
      (classification, stranded detection, local-fs mode, JSON output)
- [ ] New `conductor/tests/track-1112-worktree-merge.test.mjs` (RC-A merge
      with no directory, primary-checkout-untouched assertion, conflict
      left intact, idempotent reconciler)
- [ ] New `conductor/tests/track-1112-git-divergence.test.mjs` (two-repo
      fixture with a real remote: behind → reported; diverged → refused;
      dirty overlap → refused; clean FF → pulled + resynced)
- [ ] Existing `conductor/tests/track-1035-worktree-lifecycle.test.mjs`
      still passes (AC-12)
- [ ] **Live check on this machine** (not synthetic): `lc worktrees` output
      classifies 1044/1059 `stranded` and 1099 `mergeable`, computed — then
      `lc worktrees merge 1099` and `1044` actually clear them from
      `git branch --no-merged main`
- [ ] Record the observed output in `conversation.md` as evidence

**Impact**: The fix is verified against the exact 44-branch state that
motivated the track, not a toy repo.

---

## Phase 7: UI worktree panel (REQ-12) — may be deferred

**Problem**: The CLI covers the developer at a terminal; the Kanban UI
still shows nothing about worktrees. The visibility gap this track exists to
fix is specifically that 44 unmerged branches go unnoticed because nobody is
looking at any *one* track — so the primary surface has to be project-wide,
not per-track.

**UX decisions (resolved 2026-08-13, in response to a direct question)**:

- **Project-level Worktrees panel is primary**, same pattern as
  `WorkersList.jsx` — one list per project, sorted stranded-first. This is
  what actually surfaces the "44 unmerged, zero visibility" problem; a
  per-track-only view would require clicking into every track.
- **Per-track strip is secondary.** Since each worktree already maps 1:1 to
  a track (`.worktrees/<trackNumber>`), `TrackDetailPanel` gets a small
  inline block (ahead/behind/dirty/class) when that track has one. Detail
  view, not the fix.
- **Data ownership nuance**: `.worktrees/` lives at the shared repo
  checkout's `process.cwd()`, not inside any one worker process's private
  state — every worker for a project on the same host sees the identical
  list. So the heartbeat is just a transport (whichever worker happens to
  report it), not a per-worker-scoped resource; the panel is keyed by
  project (optionally sub-grouped by host for multi-machine setups), not by
  worker.
- **Merge button routing keeps 1084 stickiness.** No new dispatch
  infrastructure — add `action: 'merge-worktree'` (payload: `{track_number,
  force?}`) to the *existing* `POST /api/projects/:id/dispatch` (same table,
  same poll loop, same `PATCH /worker-dispatch/:id` result path already used
  by `deploy`/`build`/`provision-worker` — see `ui/server/index.mjs:3187`).
  Resolve the target `worker_id` via 1084's existing
  `resolveAssignee`/`resolvePinnedWorkers` (the same functions
  `claimable-tracks` uses, `ui/server/index.mjs:3801`) rather than picking
  an arbitrary idle worker, so it lands on the worker already holding that
  track's session — consistent with continuity-first routing everywhere
  else it applies, even though a pure git merge needs no LLM context itself.

**Solution**:

- [ ] Include a compact worktree summary in the worker's
      `/worker/heartbeat` payload (`laneconductor.sync.mjs:877`) — reuses
      Phase 2's `lc worktrees --json` output as the payload shape
- [ ] `GET /api/projects/:id/worktrees` in `ui/server/index.mjs` — project-
      scoped (not `/api/workers/:id/worktrees`), per the data-ownership
      nuance above; dedupes if multiple workers on one host report the same
      list, groups by host if more than one host has reported
- [ ] New `WorktreesPanel.jsx` (project-level, `WorkersList.jsx` pattern),
      sorted `stranded` → `conflicted` → `mergeable` → `open`, with
      `stranded` visually flagged
- [ ] Inline per-track worktree strip in `TrackDetailPanel.jsx` (secondary
      surface, same data)
- [ ] "Merge to main" button: enabled for `mergeable`/`stranded`, disabled
      with a tooltip for `conflicted`, hidden for `open`
- [ ] Wire the button to `POST /api/projects/:id/dispatch` with
      `action: 'merge-worktree'`, worker resolved per the routing decision
      above
- [ ] Worker-side: handle `merge-worktree` in the dispatch poll loop
      (alongside `deploy`/`build`/`set_model`, `laneconductor.sync.mjs`
      ~4600–4750), calling Phase 4's shared merge primitive; report result
      via `PATCH /worker-dispatch/:id` and post a `conversation.md` comment
- [ ] Playwright fast-tier spec covering the panel + merge button

**Impact**: Worktree state is visible without a terminal, including on
machines the viewer isn't sitting at.

> **Done-gate note**: if Phase 7 is not implemented, this track does **not**
> reach `done` at 100%. Per the quality-gate done-gate, it lands in `review`
> with Phase 7 named as the remaining work. Deferring is allowed; calling it
> complete is not.
