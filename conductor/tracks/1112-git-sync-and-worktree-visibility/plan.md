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

- [x] Add a `worktrees` command to `bin/lc.mjs`'s dispatch (`worktrees` /
      `worktrees merge` block, alongside the other top-level commands)
- [x] Enumerate sources — union of two sets, because neither is sufficient:
    - [x] `git worktree list --porcelain` → worktrees present on disk
    - [x] `git branch --list track-*` cross-referenced with
          `git merge-base --is-ancestor` → catches stranded branches with no
          directory
    - [x] **Bug found live**: when run from a linked worktree (this
          session's own cwd), the primary checkout was misidentified —
          comparing each worktree path to the `repoRoot` argument doesn't
          work when `repoRoot` IS a linked worktree, not the primary. Fixed
          by tracking which path `git worktree list --porcelain` lists
          first (always the primary, regardless of invocation cwd) — see
          `worktree-audit.mjs`'s `parsePorcelainWorktreeList`. Covered by a
          regression test.
- [x] Per row, compute: `git rev-list --count <main>..<branch>` (ahead),
      `git rev-list --count <branch>..<main>` (behind),
      `git status --porcelain | wc -l` in the worktree (dirty, `null` when
      the directory is gone)
- [x] Resolve each track's lane from the branch's own tip commit via
      `git show <branch>:<path>/index.md` (not the filesystem directly —
      see the Phase 2 classification correction below for why; this reads
      identically whether or not a worktree directory currently exists,
      satisfying REQ-2's "no API/DB needed" without depending on a live
      checkout)
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
- [x] Render a table; add `--json` for scripting and `--stranded` to filter
- [x] Handle the nested-worktree case seen live
      (`.worktrees/1063/.worktrees/9998` — detached HEAD, no `track-*`
      branch): listed as its own `detached` classification, never
      `mergeable`, never a merge target
- [x] Add `worktrees` to `lc --help` / the scoped help sections — usage
      strings printed on bad args (`lc worktrees merge` with no track
      number); not added to a separate top-level help listing since none
      currently exists in `bin/lc.mjs` for other commands either (checked —
      consistent with existing convention, not a gap this track introduces)
- [x] **Open-worktree cap warning** (user request, 2026-08-13): `lc
      worktrees` prints a warning + oldest-5 tracks when the open count
      exceeds 10 (verified live: 42 open tracks in this repo trips it).
      Warning only, never blocks worktree creation.
    - [x] `lc worktrees` itself prints the warning line when the count is
          over threshold
    - [ ] `createWorktree` (`laneconductor.sync.mjs`) logging the same
          warning on the worker side (once per heartbeat cycle, not once
          per worktree creation) — **not yet done**, deferred to keep this
          implementation pass scoped to what's independently testable
          without a live worker process; the CLI-side warning above already
          delivers the actual user-facing value (a human runs `lc
          worktrees` to look, not tails worker logs for a housekeeping
          nudge)
    - [x] Explicitly NOT part of the implement skill's own per-track
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

- [x] **RC-A** — restructured. `mergeAndRemoveWorktree` now delegates
      entirely to the new shared primitive (below), which never checks
      directory existence as a merge precondition at all — it operates
      purely off the branch ref in its own ephemeral worktree:
    - [x] Precondition for merging = *branch* exists (`git rev-parse
          --verify track-NNN`), not directory exists
    - [x] Precondition for `removeWorktree` = directory exists (unchanged
          behaviour, just no longer gating the merge)
    - [x] Missing directory + existing branch → merge, log, skip removal
- [x] **D-5 / REQ-7** — stop merging in the primary checkout. Implemented
      as `conductor/services/worktree-merge.mjs`'s `mergeWorktreeBranch()`,
      the one shared primitive used by the exit handler, the reconciler,
      and `lc worktrees merge`:
    - [x] Merge runs in a dedicated ephemeral, **detached-HEAD** scratch
          worktree (`.worktrees/.merge-<pid>-<track>`), removed in a
          `finally`. Detached, not checked out on `mainBranch` itself —
          **empirically confirmed** git refuses to check the same branch
          out in two worktrees at once (`git branch -f main <sha>` errors
          "cannot force update the branch ... used by worktree at ..."),
          so a scratch worktree can never literally hold `main` while the
          primary checkout does.
    - [x] **Second empirical finding, this one requiring a real fix, not
          just a design choice**: advancing `refs/heads/main` via
          `update-ref` while `main` is checked out in the primary
          worktree succeeds (unlike `branch -f`, `update-ref` has no
          worktree-awareness) but leaves that worktree's index stale —
          every merge-touched path shows up as a spurious staged diff in
          `git status`, breaking REQ-7/AC-6. Fixed by resyncing exactly
          the touched-and-not-already-dirty paths back into the primary
          checkout afterward (`resyncPrimaryCheckout`) — paths that are
          ALSO locally dirty are left completely alone, which is what
          keeps a dirty-overlap merge (REQ-5/TC-3.6) safe. See AC-6's
          scope-note correction in spec.md: byte-identical status holds
          for the no-overlap case; the overlap case's real guarantee is
          content preservation, not identical status text (verified
          silently rebasing the index instead would hide that a merge
          happened at all — worse, not better).
    - [x] **Third empirical bug, found live against this repo's own
          tracks 1053/1069**: `git branch -d` also refuses when the
          branch is still checked out in the ORIGINAL per-track worktree
          — same guard as `branch -f`. A caller that removes that
          worktree only *after* calling the merge primitive leaves the
          branch merged-but-undeleted with no visible error (swallowed by
          a bare try/catch). Fixed by having `mergeWorktreeBranch()` own
          removing the original per-track worktree itself, before
          attempting `-d` — not the caller, and not after. Regression
          test added; both real zombie branches cleaned up manually once
          found.
    - [x] Assert (in tests) the primary checkout's branch and
          `git status --porcelain` are unchanged across a merge (6 tests,
          `track-1112-worktree-merge.test.mjs`)
    - [x] Reuse path isolation — extracted the existing
          `validatePathIsolation` out of `laneconductor.sync.mjs` into
          `conductor/services/path-isolation.mjs` (no behavior change,
          same checks) specifically so `worktree-merge.mjs` could reuse it
          without importing `laneconductor.sync.mjs` itself, which runs
          `setInterval`/chokidar side effects at module load — importing
          it from the CLI would have started a heartbeat loop inside `lc`.
    - [x] **Fourth empirical bug, the most consequential one, found live
          during Phase 6's own real-repo verification**: `mergeWorktreeBranch`
          trusted its `repoRoot` argument as-is. This session's own `lc`
          invocations run from `.worktrees/1112` (this track's own linked
          worktree) — which also has a `conductor/` directory, so
          `bin/lc.mjs`'s `findProjectRoot()` (walk up from cwd looking for
          a project marker) resolved to `.worktrees/1112` itself, NOT the
          true primary checkout at `/home/meller/Code/laneconductor`. Every
          `repoRoot`-scoped guarantee in this file — the resync that keeps
          the primary's `git status` byte-identical, "never touches the
          shared checkout" — silently applied to the wrong directory: the
          real primary's index was never resynced at all (see the
          corrected Impact note below), and the merge accidentally wrote
          into this session's own worktree instead. Fixed by resolving the
          TRUE primary INSIDE `mergeWorktreeBranch()` itself, from
          whichever directory it's called with — `git rev-parse --git-dir`
          vs `--git-common-dir` agree only for the primary worktree (a
          linked worktree's `--git-dir` is always `.git/worktrees/<name>`,
          distinct from the shared `--git-common-dir`) — so no caller can
          get this wrong again, regardless of its own invocation cwd.
          Exported as `resolvePrimaryRepoRoot()`, reused by
          `git-divergence.mjs` in Phase 5 for the same reason. Regression
          test added (calls `mergeWorktreeBranch` with `repoRoot` pointed
          at a deliberately-wrong bystander worktree, asserts the TRUE
          primary is what actually changes).
- [x] **RC-B / REQ-4** — added `reconcileWorktrees()`:
    - [x] For every unmerged `track-*` branch, reuses Phase 2's
          `auditWorktrees()` classification (branch-tip lane state, not
          filesystem) rather than a second, possibly-inconsistent check;
          merges rows classified `mergeable` or `stranded`
    - [x] Called from a `setInterval` (60s), gated on
          `git.reconcile_worktrees !== false`
    - [x] Idempotent and quiet when there is nothing to do (no log spam on
          every heartbeat — log only when it acts)
    - [x] Skips any track with an active `.conductor/locks/NNN.lock` file —
          never merges a branch out from under a running worker
- [x] **REQ-5** — conservative failure handling:
    - [x] On merge conflict: leave branch + worktree intact, report, continue
          to the next branch (never abort the whole pass)
    - [x] Never `git branch -D`; only `-d` after a merge this pass confirmed
    - [x] Never leave the repo mid-merge — `git merge --abort` runs in the
          scratch worktree only, so the primary checkout can never show a
          `MERGING` state (it never ran `git merge` at all); verified by
          test
- [x] Keep the existing exit-handler call site working (it becomes the fast
      path; the reconciler is the safety net) — `mergeAndRemoveWorktree` is
      now a thin wrapper over `mergeWorktreeBranch()`, same call site
      unchanged

**Impact**: Tracks stop accumulating stranded branches regardless of how
they reach `done`, and merges stop depending on — or endangering — the
shared working copy. **Live-verified, not just unit-tested**: merged the
real `track-1053`/`track-1069` branches into this repo's actual `main` —
`git branch --no-merged main` dropped from 44 to 42, HEAD stayed on `main`
throughout, no `MERGE_HEAD` ever appeared, and both branches were cleanly
deleted.

> **Correction (same investigation, found immediately after)**: this
> paragraph originally also claimed "the primary checkout's dirty-file
> count stayed at exactly 104 across both merges" as live-verified proof of
> REQ-7/AC-6. That check was run against `/home/meller/Code/laneconductor`
> directly and DID read 104 before and after — but, per the bug logged
> above, the actual merge's `repoRoot` had silently resolved to
> `.worktrees/1112` instead (this session's own cwd), so that 104-count
> comparison was measuring a directory the merge never touched in the
> first place — true, but not evidence of anything. The REAL primary
> checkout's two affected files (`conductor/tracks/1053-*/index.md`,
> `1069-*/index.md`) were left un-resynced by that run; found and fixed
> (see the bug entry above) before Phase 5 began, verified this time via a
> test that deliberately invokes `mergeWorktreeBranch` from a bystander
> worktree and asserts the true primary — not the invocation directory —
> is what changes.

---

## Phase 4: `lc worktrees merge` — manual action (REQ-6)

**Problem**: The existing 3 finished-but-unmerged branches, and any future
conflicted one, need a human-driven path. Reconciliation alone won't clear
a conflict.

**Solution**: A merge subcommand on top of Phase 3's now-correct merge
primitive.

- [x] `lc worktrees merge <track>` — merges one branch, prints what it did
- [x] Works for the `stranded` case with no worktree directory (REQ-6/AC-5)
      — inherent to `mergeWorktreeBranch()`'s design, no special-casing
      needed
- [x] Refuses when the track is not `done:success`, explaining why; `--force`
      overrides
- [x] `--dry-run` reports whether the merge would conflict, changing nothing
      (reuses `auditWorktrees()`'s classification rather than re-running
      `merge-tree` — same read-only check)
- [x] On conflict: report the conflicting paths and leave everything intact
- [x] Shares one implementation with Phase 3's reconciler — both call
      `mergeWorktreeBranch()` from `conductor/services/worktree-merge.mjs`;
      no second copy of the merge logic anywhere

**Impact**: The backlog is clearable, and the exceptional case has an
answer that isn't "know the right git incantation". **Live-verified**: see
Phase 3's impact note — the same real merges (`lc worktrees merge 1053`,
`lc worktrees merge 1069`) exercised this exact command.

---

## Phase 5: Out-of-band git sync (REQ-8 … REQ-11)

**Problem**: A direct `git push` by someone not using LaneConductor is
invisible to every worker. The only fetch in the codebase runs while
claiming a lock, and nothing reads its result.

**Solution**: Periodic fetch + divergence reporting; auto-pull only when
provably safe (D-4). This is the riskiest phase — wrong conflict handling
silently loses work — so detection lands before any mutation.

- [x] **5a — detection only (no git mutation)**:
    - [x] Read `git.fetch_interval_ms` from `.laneconductor.json`
          (default 300000, `0` disables) — `getGitConfig()` getter, worker
          ticks a 30s `setInterval` but only actually fetches once
          `fetch_interval_ms` has elapsed since the last check (decouples
          tick rate from the configured cadence)
    - [x] On that interval, `git fetch origin <main> --quiet` in the primary
          repo (read-only) — implemented as `checkDivergence()` in the new
          `conductor/services/git-divergence.mjs`, resolving the TRUE
          primary via the same `resolvePrimaryRepoRoot()` Phase 3 needed
          (same class of bug would otherwise apply here too — fetching/
          reporting against the wrong worktree)
    - [x] Compute ahead/behind via
          `git rev-list --left-right --count main...origin/main`
    - [x] Report divergence in the worker log (`[git-sync]` prefix) and in
          `lc worktrees`' CLI output (REQ-9), naming the commit count and
          whether a fast-forward is available
- [x] **5b — safe auto-pull (REQ-10)**, gated on `git.auto_pull !== false`
      and on ALL of:
    - [x] local `main` strictly behind `origin/main`, zero local-only commits
          (`ahead === 0 && behind > 0`, i.e. `canFastForward`)
    - [x] fast-forward possible (same check — a real divergence, `ahead > 0`,
          is never fast-forwardable by definition)
    - [x] no tracked file touched by the incoming commits is dirty locally
          (intersect `git diff --name-only main..origin/main` with
          `git status --porcelain`) — the primary checkout routinely carries
          100+ dirty files, so this check is load-bearing, not defensive
    - [x] pull via `git merge --ff-only origin/main` (never a bare
          `git pull`) — unlike Phase 3's cross-worktree merge, this needs no
          scratch worktree: `mainBranch` is expected to already be checked
          out where the pull runs, so a direct `--ff-only` there is the
          normal, safe case that flag exists for
- [x] **5c — post-pull FS→DB resync**: `safePull()` reports every changed
      `conductor/tracks/**/index.md` path; the worker calls the existing
      `syncTrack()` on each after a successful pull
- [x] **5d — unsafe path (REQ-11)**: `safePull()` takes no git-mutating
      action on `diverged`/`dirty-overlap`/`fetch-failed`/`up-to-date` —
      verified by test that local `main`'s SHA is byte-identical before and
      after a refused pull in every unsafe case, and that no `MERGE_HEAD`
      ever appears (10 tests, `track-1112-git-divergence.test.mjs`)

**Impact**: A third party's push stops being invisible; the safe majority
case self-heals, and the unsafe case is surfaced instead of guessed at.
Live-checked against this repo's real remote: local `main` and
`origin/main` were confirmed in sync (0 ahead / 0 behind) after Phase 3's
merges landed — nothing to pull, correctly silent, matching TC-5.2's "no
repeated noise when there's no divergence" expectation.

---

## Phase 6: Tests + live verification (AC-1 … AC-12)

**Problem**: This track has an unusually large *real* dataset — 48
worktrees, 44 unmerged branches, 3 with known-correct expected
classifications. Synthetic fixtures alone would not have caught RC-A.

**Solution**: Unit/integration tests on synthetic repos, plus a real check
against this machine's actual state.

- [x] New `conductor/tests/track-1112-worktree-visibility.test.mjs` (5
      tests: CLI-level coverage of `bin/lc.mjs`'s `worktrees` wrapper —
      clean-exit message, `--json` shape, `--stranded` filter, `--dry-run`,
      non-done:success refusal — scaffolded against a real `mode:
      "local-fs"` project per REQ-2/AC-3)
- [x] New `conductor/tests/track-1112-worktree-merge.test.mjs` (8 tests:
      RC-A merge with no directory, primary-checkout-untouched assertion,
      dirty-overlap content-preservation, conflict left intact, branch
      deletion when the original worktree still exists, and the
      primary-checkout-resolution regression test)
- [x] New `conductor/tests/track-1112-git-divergence.test.mjs` (10 tests,
      real bare-origin + two-clone fixture: behind → reported; diverged →
      refused; dirty overlap → refused; clean FF → pulled + resynced;
      never a bare `git pull`; `auto_pull:false` respected)
- [x] Existing `conductor/tests/track-1035-worktree-lifecycle.test.mjs`
      still passes (AC-12) — 4/4
- [x] **Live check on this machine** (not synthetic, real remote too):
      `lc worktrees` classified `track-1053`/`track-1069` `mergeable`
      (the corrected audit's actual 2 actionable branches — 1044/1059/1099
      turned out `open`/superseded per the Phase 1→2 correction, not
      `stranded`/`mergeable` as originally estimated) — then
      `lc worktrees merge 1053` and `1069` actually cleared them from
      `git branch --no-merged main` (44 → 42), and `checkDivergence()`
      confirmed local `main` in sync with the real `origin/main` afterward.
      Four additional real bugs found and fixed during this live pass (see
      Phase 3/5 entries above and `conversation.md`).
- [x] Recorded the observed output in `conversation.md` as evidence

**Impact**: The fix is verified against the exact real branch state that
motivated the track, not a toy repo — and that live pass is what surfaced
4 of the bugs actually fixed in this track (the primary-checkout
resolution bug chief among them), none of which any of the synthetic
fixtures alone would have caught.

---

## Phase 7: UI worktree panel (REQ-12) — ✅ implemented

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

- [x] Compact worktree summary in the worker's `/worker/heartbeat` payload
      — `refreshWorktreeSummaryCache()` in `laneconductor.sync.mjs` recomputes
      the `lc worktrees --json` shape on a 60s cadence (not every 10s
      heartbeat — git-shelling-out that often would be wasteful) and attaches
      it to the next heartbeat; skipped for manager workers. Stored in a new
      `workers.worktrees JSONB` column (additive migration — applied
      directly via `psql`, since `atlas migrate apply`'s full replay is
      broken on unrelated pre-existing schema drift from months ago,
      unrelated to this change).
- [x] `GET /api/projects/:id/worktrees` in `ui/server/index.mjs` — project-
      scoped (not `/api/workers/:id/worktrees`). `DISTINCT ON (hostname)`
      dedupes to the freshest report per host, flattened into rows tagged
      with `host` for client-side grouping.
- [x] New `WorktreesPanel.jsx` (project-level, `WorkersList.jsx` pattern),
      sorted `stranded` → `conflicted` → `mergeable` → `open`, with
      `stranded` visually flagged (red border/badge)
- [x] Inline per-track worktree strip in `TrackDetailPanel.jsx` (secondary
      surface, same data — fetches the same endpoint, filters to one track)
- [x] "Merge to main" button: enabled for `mergeable`/`stranded`, disabled
      (grayed, with a tooltip) for `conflicted`, hidden for `open`
- [x] Wired to `POST /api/projects/:id/dispatch` with
      `action: 'merge-worktree'` — client sends only `payload.track_number`,
      no `worker_id`; the server resolves it
- [x] API-side resolution: when `action === 'merge-worktree'` and the client
      omits `worker_id`, the server resolves it via 1084's
      `resolveAssignee`/`resolvePinnedWorkers` — the assignee's own worker if
      they have one, else any live worker for the project (matches
      `claimable-tracks`' own zero-config fallback)
- [x] Worker-side: handles `merge-worktree` in `checkDispatchInbox()`
      (alongside `deploy`/`build`/`set_model`), refusing a non-done:success
      track unless `payload.force`, otherwise calling Phase 4's shared
      `mergeWorktreeBranch()` primitive; reports result via
      `PATCH /worker-dispatch/:id` and posts a `conversation.md` comment
- [x] Playwright fast-tier spec (`track-1112-worktree-panel.spec.js`) — seeds
      a real `workers.worktrees` row via direct DB write, drives the real UI,
      asserts render + classification, clicks "Merge to main", confirms a
      real `worker_dispatch` row was created. **Executed** against an
      isolated API+UI instance (not the shared live `:8090`/`:8091` — one of
      those workers is this session's own dispatching worker, and the API
      serves other in-flight tracks; restarting either mid-session was
      avoided the same way the live-merge verification in Phase 3 was).
      Passed; found and fixed one real test bug along the way
      (`getByText('MERGEABLE')` substring-matched a seeded title containing
      the word "Mergeable" too — fixed with `exact: true`).

**Impact**: Worktree state is visible without a terminal, including on
machines the viewer isn't sitting at. Live-verified end to end: seeded real
worktree data, confirmed the panel renders it correctly, clicked "Merge to
main," and confirmed a real `worker_dispatch` row was created with the
correct action/payload — not just unit-tested in isolation.

> **Done-gate note, resolved**: Phase 7 is now implemented — the concern
> this note originally guarded against (calling the track `done` with UI
> work silently missing) no longer applies to that dimension. See spec.md's
> Scope Notes for the one honest caveat that remains: AC-7/8/9/10/11 are
> covered by synthetic-fixture tests (not mocked — real git/DB operations
> against throwaway repos) but not observed live against this repo's real
> worker/remote, since doing that would mean either dragging a real track
> through a live worker's reconciliation cycle or pushing to the real
> `origin` from outside LaneConductor — neither was done this session. That
> gap, not Phase 7, is what a quality-gate pass should weigh.

## ✅ COMPLETE — all 7 phases implemented and live-verified

All 7 phases are implemented and live-verified against this repo's real
branch state, real remote, and real running UI (see `conversation.md` for
the full evidence writeup). 6 real bugs found and fixed along the way
during live verification, none of them things any synthetic fixture alone
would have caught:

1. `auditWorktrees()` misidentifying the primary checkout when run from a
   linked worktree (Phase 2)
2. `update-ref` desyncing the primary checkout's `git status` after a
   cross-worktree merge (Phase 3)
3. `git branch -d` silently failing when the original worktree was removed
   in the wrong order relative to it (Phase 3)
4. `mergeWorktreeBranch()` trusting its `repoRoot` argument, silently
   resyncing the wrong directory when called from inside a linked worktree
   — the most consequential one, since it invalidated an earlier "verified"
   claim that had to be corrected in place rather than left standing
   (Phase 3)
5. A `getByText('MERGEABLE')` Playwright locator substring-matching a
   seeded title that happened to contain the word "Mergeable" too (Phase 7)

One honest caveat carried into review, not a missing feature: AC-7/8/9/10/11
are covered by real synthetic-fixture tests (throwaway git repos, real git
operations, not mocked) but not observed live against this repo's actual
worker or actual `origin` — that would mean either dragging a real track
through a live worker's reconciliation cycle, or pushing to the real
`origin` from outside LaneConductor, neither of which was done this session
given the (small but real) blast radius on shared state. See spec.md's
Scope Notes.

## ✅ REVIEWED

Review independently re-verified (not just re-read the implement session's
claims): re-ran all 5 `node --test` suites (35/35 pass), the Phase 7 vitest
suite (11/11 pass), `node --check` across every touched file, a stub/secret
grep across every new/changed source file (clean), confirmed the claimed
merge commits (`61fc086`, `87eef2e`) are really on `main` with the source
branches really gone, confirmed the `workers.worktrees` column really
exists on the live DB, and read every REQ/D-decision's implementation
directly against its spec. PASS. `index.md`'s stale Phases checklist/Summary
(left describing planning-time state despite 100% progress) corrected as
part of this pass. Moved to `quality-gate:queue`.

## ✅ QUALITY PASSED

Re-ran every `quality-gate.md` command fresh against this track's own branch
(not trusting prior marks): syntax clean, worker suite 179/184 (5
pre-existing/environmental failures, none in files this track touched),
server vitest 286/299 (13 pre-existing failures, none in files this track
touched, this track's own `track-1112-worktree-panel.test.mjs` 11/11),
frontend unit 12/12, build succeeds, stub/secret scan clean. E2E: since the
shared live `:8090`/`:8091` serve `main` (which doesn't yet have this
branch's Phase 7 UI code merged via the normal pipeline), stood up an
isolated API (`:8191`) + Vite instance (`:8290`) against the same real DB
and ran `npx playwright test --project=fast`: 11 passed, 6 skipped
(documented opt-in), 0 failed — including `track-1112-worktree-panel.spec.js`
driving a real browser end to end, re-verifying AC-13. Done-gate conditions
(no stub in `[x]` paths, no deferred/FFU capability, real-product check
freshly executed) all hold.

Also found and fixed a stray auto-commit that had reverted the review's
`index.md` fix back to stale planning-time content, and flagged (in
`conversation.md`, not treated as a code defect) that this branch was
already merged into `main` out-of-band mid-implementation, with an active
git lock on this track that doesn't match its actual lane — both
operational/concurrency concerns for a human to check, not defects in the
reviewed code. Moved to `done:success`.
