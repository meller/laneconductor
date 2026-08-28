# Track AM-10038: Widen Bookkeeping-Conflict Auto-Resolve to Checkbox Mirroring

## Phase 1: Widen the safety predicate

**Problem**: `isSafeToAutoResolveBookkeepingConflict` only recognizes header-line-only divergence
on main as safe; a checkbox-line (or any other) divergence that happens to be identical to the
branch's own content is wrongly classified unsafe.
**Solution**: Add an "identical-to-branch" fallback check alongside the existing "header-only vs
base" check in `conductor/services/track-metadata-conflict.mjs`.

- [ ] Task 1: In `isSafeToAutoResolveBookkeepingConflict`, after `isTrackBookkeepingConflict`
      passes, compute `branchContent = gitShow(repoRoot, branch, path)` for each conflicting path
      (mirrors the existing `gitShow(repoRoot, mainBranch, path)` call already present). If
      `branchContent === null`, fail closed (same conservative pattern as the existing null
      checks for base/main).
- [ ] Task 2: Change the per-path safety condition from
      `stripHeaderLines(baseContent) === stripHeaderLines(mainContent)` (strict AND across all
      paths) to: for each path, safe iff EITHER `stripHeaderLines(baseContent) ===
      stripHeaderLines(mainContent)` (existing rule) OR `mainContent === branchContent` (new
      rule, exact match, no stripping — main and branch already agree byte-for-byte). Still AND
      across all conflicting paths (every path must independently be judged safe).
- [ ] Task 3: Keep `BOOKKEEPING_FILENAMES` and `isTrackBookkeepingConflict` untouched — this track
      only changes what counts as a *safe* divergence, not which files/paths are eligible.

**Impact**: Merges like track 10037's no longer need manual/agent resolution when main and the
branch independently converged on the same content.

## Phase 2: Tests

**Problem**: This is a merge-safety predicate — a subtle regression here could silently
auto-resolve a conflict that should have blocked (REQ-3 is the load-bearing guard).
**Solution**: Direct unit tests against the pure function plus one realistic end-to-end repro.

- [ ] Task 1: Unit tests for `isSafeToAutoResolveBookkeepingConflict` covering the matrix: (a)
      header-only divergence (existing case, must still pass), (b) checkbox-line divergence
      identical to branch (new case, must now pass), (c) divergence identical to neither base nor
      branch (must still fail/block), (d) divergence on a non-bookkeeping path (must still fail —
      `isTrackBookkeepingConflict` gate unchanged).
- [ ] Task 2: End-to-end repro test using real git operations (temp repo, like the existing
      `track-1110-stop-confirms-death.test.mjs` pattern of spawning real processes/temp
      directories): construct the exact track-10037 shape (base → main ticks checkboxes, branch
      independently ticks the same checkboxes plus adds more content) and confirm
      `mergeWorktreeBranch` now merges cleanly without manual intervention.
- [ ] Task 3: Confirm no regression in any existing test referencing
      `track-metadata-conflict.mjs` or `worktree-merge.mjs` (search `conductor/tests/` for
      current coverage before writing new tests, to avoid duplicating an existing case).

**Impact**: The widened rule is proven safe on both the case it fixes and the case it must
continue to block.
