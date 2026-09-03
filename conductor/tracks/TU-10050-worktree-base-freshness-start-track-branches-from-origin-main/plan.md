# Track TU-10050: Worktree Base Freshness — Start Track Branches From The Freshest Safe Base

Five phases. Phase 1 is pure and test-first; Phases 2–3 wire it into the two live call
sites; Phase 4 proves the end-to-end behavior on real git repos; Phase 5 documents it.

Read `spec.md` first — in particular the "Why the obvious fix is wrong" section. Basing
unconditionally on `origin/main` is **not** the fix and would regress this repo badly
(local `main` is currently 27 commits ahead of `origin/main`).

---

## Phase 1: `resolveWorktreeStartPoint()` — the pure decision

**Problem**: The start point is a hardcoded literal `'HEAD'`. The decision of what a track
branch should be based on is safety-critical (it can drop local commits in one direction and
silently stale a branch in the other) and currently has nowhere to live and no way to be
tested.

**Solution**: Extract it as a pure function, exactly mirroring
`conductor/services/worktree-create-args.mjs` (track 1114) — the precedent in this repo for
"safety-critical git decision, no I/O, unit-tested in isolation".

- [x] Task 1.1: Write `conductor/tests/track-10050-worktree-start-point.test.mjs` **first**,
      one case per row of spec.md's resolution table (TC-1 … TC-8 in `test.md`). Run it,
      confirm it fails on the missing module — not on a typo.
- [x] Task 1.2: Create `conductor/services/worktree-start-point.mjs` exporting
      `resolveWorktreeStartPoint({ mainBranch, mainRefExists, fetchOk, ahead, behind, pullOutcome })`
      → `{ startPoint, reason, staleBy }`.
    - [x] Order the branches so the `no-main-ref` fallback is checked first — every other
          row returns a named ref that presumes `<main>` resolves.
    - [x] `staleBy` is `behind` for `diverged`, `0` for `refreshed` / `local-ahead` /
          `remote-ahead-pull-refused`, and `null` for `offline` / `no-main-ref` (unknown, not
          zero — the caller must be able to tell "known fresh" from "can't tell").
    - [x] No imports of `node:child_process`, `node:fs`, or anything else with side effects.
- [x] Task 1.3: Write the module header comment in this repo's established style — what the
      live defect was, why `origin/main` unconditionally is wrong, and the measured
      `27 0` divergence that proves it. Future readers must not "simplify" this back to
      `origin/main`.
- [x] Task 1.4: Re-run the test file; confirm green.

**Impact**: A tested, side-effect-free answer to "what should this branch be based on",
importable by both call sites. Nothing behavioral yet.

---

## Phase 2: Wire it into the live worker path (`createWorktree`)

**Problem**: `laneconductor.sync.mjs:3940` passes `startPoint: 'HEAD'` and renders it into a
literal `HEAD` in the command string on line 3943.

**Solution**: Gather divergence facts, optionally fast-forward local `<main>`, resolve, and
use the result. All new git I/O is best-effort and falls back to today's behavior.

- [x] Task 2.1: In `createWorktree()`, before the `resolveWorktreeAddArgs` call, add a
      `resolveStartPointForWorktree(repoRoot)` helper that:
    - [x] reads `mainBranch` from the existing `getMainBranch()`;
    - [x] probes `mainRefExists` with `git rev-parse --verify --quiet refs/heads/<main>`
          (same try/catch shape as the existing `branchExists` probe on line 3933);
    - [x] calls `checkDivergence({ repoRoot, mainBranch })` from
          `services/git-divergence.mjs` — no new fetch cost, `checkAndClaimGitLock()` already
          fetched `origin/<main>` at line 3796 (REQ-10);
    - [x] when `canFastForward` is true, calls the existing
          `safePull({ repoRoot, mainBranch, autoPull: getGitConfig().auto_pull !== false })`
          and threads `result.pulled ? 'pulled' : result.reason` through as `pullOutcome`;
    - [x] passes everything to `resolveWorktreeStartPoint()` and returns its result.
- [x] Task 2.2: Wrap the whole helper body in try/catch (REQ-8). On any throw, log a warning
      and return `{ startPoint: <main-or-HEAD>, reason: 'probe-failed', staleBy: null }`.
      A network outage, a corrupt ref, a missing `origin` — none of these may stop a track
      from running.
- [x] Task 2.3: Replace `startPoint: 'HEAD'` on line 3940 with the resolved `startPoint`,
      and — critically — fix line 3943, which currently **re-renders the command by hand and
      hardcodes `HEAD` again**, ignoring whatever `resolveWorktreeAddArgs` returned:
      ```js
      ? `git worktree add -B "${branchName}" "${worktreePath}" HEAD`
      ```
      Render from `addArgs` instead so the resolver's answer is actually what runs. Leaving
      this line as-is would make the entire track a no-op while every unit test passed.
- [x] Task 2.4: Log the resolution on every creation:
      `[worktree] Track N branch based on <startPoint> (<reason>)`, plus the ahead/behind
      counts when known.
- [x] Task 2.5 (REQ-7): When `staleBy > 0`, append one `> **system**: ⚠️ …` comment to the
      track's `conversation.md` in the **primary checkout**. Silent for `local-ahead` and
      `offline`.
    - **Deviation from plan**: posted AFTER the worktree genuinely exists, not before —
      warning about the base of a branch whose creation then failed would be noise. Also
      extracted into `writeStaleBaseNotice()`/`formatStaleBaseNotice()` in the service rather
      than left inline, so TC-12 can assert the real function instead of a replica.
- [x] Task 2.6: Verify by hand on a scratch repo — see Phase 4; do not mark this phase
      complete on a reasoned-about diff alone.

**Impact**: New track branches start from the freshest base that loses nothing, and stale
bases become visible at creation time instead of at merge time.

---


**Deviation from plan (Tasks 2.1/2.2)**: the git I/O landed in
`services/worktree-start-point.mjs` as `probeWorktreeStartPoint()` rather than inline in
`laneconductor.sync.mjs`, and the command rendering became `renderWorktreeAddCommand()` in
`services/worktree-create-args.mjs`. Reason: `laneconductor.sync.mjs` has no exports and runs
setIntervals/chokidar at import, so anything left inline there is unreachable from a test —
and Task 2.3's hazard (a hand-rolled command string silently disagreeing with the resolved
args) is precisely the bug a test that re-implements the composition cannot see. Phase 4's
TC-9…TC-14 now drive the same functions `createWorktree()` calls, plus a source guard against
the hand-rolled string returning.

## Phase 3: Align `conductor/lock.mjs`

**Problem**: `conductor/lock.mjs:138` runs `git worktree add "${worktreePath}" origin/main`
— three defects: hardcoded `origin/main` (breaks on a `master` repo), no `-b` so the
worktree is **detached** (commits land on no branch), and the same unconditional-`origin`
staleness/loss problem Phase 2 just fixed.

**Solution**: Route it through the same resolver. This is a small, self-contained entry
point (`node conductor/lock.mjs <track>`, invoked by the `/laneconductor lock` skill
command), not on the worker's hot path.

- [x] Task 3.1: Import `getMainBranch()` and `resolveWorktreeStartPoint()`; drop the
      hardcoded `origin/main`.
- [x] Task 3.2: Create on a named branch — mirror `createWorktree`'s branch-exists probe and
      reuse `resolveWorktreeAddArgs` so track 1114's no-reset guarantee applies here too.
      A `/laneconductor lock` worktree must not be detached.
- [x] Task 3.3: Drop the now-redundant `git fetch origin main --quiet` at
      `conductor/lock.mjs:151` — `checkDivergence()` fetches, and the hardcoded `main` there
      is wrong on a `master` repo anyway.
- [x] Task 3.4: Exercise `node conductor/lock.mjs <n>` against a scratch repo and confirm
      the resulting worktree is on `track-<n>`, not detached (`git -C <wt> symbolic-ref -q HEAD`
      must succeed). Then `node conductor/unlock.mjs <n>` and confirm clean teardown.

**Impact**: Both worktree-creating entry points agree on the base, and `/laneconductor lock`
stops producing detached worktrees.

---

**Deviation from plan (Task 3.1)**: `getMainBranch()` was duplicated three times already
(`laneconductor.sync.mjs`'s private copy, the dead `agent-runtime.mjs:42`, and `lock.mjs`
hardcoding `main` outright). Rather than add a fourth, it was extracted verbatim — same body,
same `GIT_ENV`, same process-lifetime cache — into `conductor/services/main-branch.mjs`, and
both live callers repointed at it. `agent-runtime.mjs` is still left alone (dead code, per
spec.md's Non-Goals).

**Verified against the old code** (`git show HEAD:conductor/lock.mjs`, run on scratch repos):
- `main` repo → `git symbolic-ref HEAD` in the created worktree: `fatal: ref HEAD is not a
  symbolic ref` — the detached-worktree defect, reproduced.
- `master` repo → `fatal: invalid reference: origin/main`, worktree creation fails outright.

## Phase 4: End-to-end verification on real git repos

**Problem**: Unit tests on a pure function cannot prove that the branch a worker actually
creates has the right base — and the Phase 2 Task 2.3 hazard (line 3943 re-hardcoding
`HEAD`) is exactly the class of bug a green unit suite hides.

**Solution**: An integration test that builds real repos with `git init` + a real `origin`
remote and asserts on real commit SHAs, following
`conductor/tests/track-1112-worktree-merge.test.mjs`'s existing scratch-repo pattern.

- [ ] Task 4.1: Write `conductor/tests/track-10050-worktree-base-e2e.test.mjs` with a
      helper that builds a bare `origin` plus a clone, and can drive local `<main>` into
      each of: behind, ahead, diverged, in-sync, offline.
- [ ] Task 4.2: Implement TC-9 … TC-14 from `test.md` — assert on
      `git -C <worktree> rev-parse HEAD` against the expected SHA in each state.
- [ ] Task 4.3: Include the track-1114 regression guard (TC-13): pre-create `track-N` with a
      distinct commit, create the worktree, assert the branch tip is **unchanged**.
- [ ] Task 4.4: Include the offline case (TC-14) by pointing `origin` at a nonexistent path —
      assert worktree creation still succeeds (REQ-8).
- [ ] Task 4.5: Run the full suite — `node --test conductor/tests/` — and confirm no
      regressions in the neighbouring worktree tests (1112 audit/merge/visibility, 1114,
      10045, `worktree-create-path-resolution`, `primary-root-normalization`). These share
      the code path being changed.
- [ ] Task 4.6: Restart the real worker (`lc worker restart`) and create one real track
      worktree, confirming from the log line added in Task 2.4 that the base resolved as
      `local-ahead` on this repo, and that `git -C .worktrees/<n> rev-parse HEAD` equals
      local `main`. The worker does not hot-reload — verifying against the running process
      would test the old code.

**Impact**: Evidence, on real repositories, that each row of the resolution table produces
the branch base it claims.

---

## Phase 5: Documentation

**Problem**: "Track branches are based on `origin/main`" is the intuitive reading and is
wrong. Without a written record, the next person to touch this reverts Phase 1.

**Solution**: Record the rule and its rationale where the worktree lifecycle is already
described.

- [ ] Task 5.1: Add a short "Worktree base resolution" subsection to `conductor/product.md`
      near the existing worktree/lock material — the resolution table plus the one-line
      reason `origin/main` alone is unsafe.
- [ ] Task 5.2: Note in `conductor/workflow.md`'s Workspace Modes section that `branch`-mode
      tracks are based on the freshest safe base at first worktree creation, and that a
      resumed branch is **not** re-based (REQ-6).
- [ ] Task 5.3: Confirm neither edit contradicts the existing fundamentals docs; if it does,
      raise it per the skill's fundamentals-conflict guardrail rather than editing around it.

**Impact**: The non-obvious decision survives the next reader.

---

## Open Items For Human Review

- **Local `main` is never pushed.** This repo sits permanently at `27 0` ahead of
  `origin/main` because `mergeWorktreeBranch()` advances `refs/heads/main` via `update-ref`
  and nothing ever pushes it. This track makes the consequence safe and visible but does not
  fix the cause — see spec.md's Non-Goals. Worth its own track: while local `main` is ahead,
  `checkOutOfBandGitSync()` can never pull, so a genuine incoming change from another
  machine stays invisible indefinitely.
- **`conductor/agent-runtime.mjs` is dead code.** Nothing imports it, yet it carries a
  second, divergent `createWorktree()` (line 95) that writes to a `.git/worktrees/conductor/`
  path convention nothing else uses. Left untouched here; a candidate for deletion in a
  cleanup track.
