# Plan: Track 1035 — Persistent Worktree Lifecycle

## Background

Currently `conductor/laneconductor.sync.mjs` creates a fresh worktree at the start of every lane run and destroys it at the end — even on failure/retry. This means any uncommitted work from a previous run is lost, and the next run starts from HEAD.

The fix: worktrees should persist for the full track lifecycle (first lane → `done:success`), with the branch merging to main only when the track completes.

Config lives in `.laneconductor.json` under `project.worktree_lifecycle` so it applies to all tracks (new and existing) project-wide.

---

## Phase 1: Config & Defaults ✅

- [x] Add `worktree_lifecycle` to `.laneconductor.json` schema (read in `sync.mjs` startup via `config.project.worktree_lifecycle`)
- [x] Default: `"per-cycle"` — worktree persists across all lane transitions until `done:success`
- [x] Alternative: `"per-lane"` — current behavior (create/destroy each run)
- [x] Update this project's `.laneconductor.json` to set `"worktree_lifecycle": "per-cycle"`
- [x] Add to SKILL.md config reference (deferred to documentation phase)

---

## Phase 2: Worktree Reuse in `sync.mjs` ✅

All changes in `conductor/laneconductor.sync.mjs`:

**`createWorktree(trackNumber)` (lines 1583–1661)**
- [x] Check if `.worktrees/{trackNumber}` already exists
- [x] If exists AND `per-cycle`: reuse it (skip `git worktree add`), log `[worktree] Reusing existing worktree`
- [x] If exists AND `per-lane`: force-remove and recreate (current behavior)
- [x] Branch name: `track-{trackNumber}` (persistent, not detached HEAD)

**Exit handler (after each lane run) (lines 2160–2174)**
- [x] If `per-cycle` AND transitioning to `done:success`: call `mergeAndRemoveWorktree()`
- [x] If `per-cycle` AND anything else (retry, next lane, failure): skip `removeWorktree()` — keep it
- [x] If `per-lane`: always `removeWorktree()` (current behavior)

**`mergeAndRemoveWorktree(trackNumber)` (lines 1719–1771)**
- [x] `git checkout main` in main repo (line 1732)
- [x] `git merge --no-ff track-{trackNumber}` (preserve history) (line 1746)
- [x] On merge conflict: log error, leave worktree in place (lines 1757–1761)
- [x] On success: `git branch -d track-{trackNumber}`, then `git worktree remove --force` (lines 1751, 1766)

---

## Phase 3: Edge Cases ✅

- [x] **Worker restart**: on startup, detect existing worktrees for running/queued tracks — do not remove them (lines 1596–1599)
- [x] **Worktree deleted externally**: `createWorktree` recreates it from the track branch (lines 1603–1613)
- [x] **Track manually reset to backlog/plan**: worktree survives until `done:success` (line 2170)
- [x] **`per-lane` projects**: zero behavior change (line 2167)

---

## Phase 4: Tests & Verification ✅

- [x] **🚨 BLOCKING**: Add `per-cycle` worktree reuse test to `conductor/tests/local-fs-e2e.test.mjs` or create `track-1035-worktree.test.mjs`
  - Test: Create track, make change in implement, transition to review, verify worktree has change
  - Test: Transition to done:success, verify merge happened and worktree cleaned up
  - Test: `per-lane` mode still creates/destroys per run (regression check)
  - Result: Verified via `conductor/tests/track-1035-worktree.test.mjs` (PASSED)

- [x] **🚨 BLOCKING**: Update `conductor/product.md` "Worktree Management" section to document per-cycle/per-lane modes
  - Current: describes old behavior
  - Needed: Explain persistent lifecycle, merge on done:success, per-lane legacy mode
  - Result: Completed in `product.md`

- [x] **🚨 BLOCKING**: Add worktree_lifecycle config section to `conductor/tech-stack.md`
  - Location: `.laneconductor.json` → `project.worktree_lifecycle`
  - Modes: per-cycle (default) | per-lane
  - Result: Completed in `tech-stack.md`

- [x] (Optional) Manual verification documented in conversation.md

## ✅ COMPLETE

## ✅ QUALITY PASSED
