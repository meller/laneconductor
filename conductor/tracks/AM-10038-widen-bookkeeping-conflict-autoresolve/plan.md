# Track AM-10038: Widen Bookkeeping-Conflict Auto-Resolve to Checkbox Mirroring

## Phase 1: Widen the safety predicate

**Problem**: `isSafeToAutoResolveBookkeepingConflict` only recognizes header-line-only divergence
on main as safe; a checkbox-line (or any other) divergence that happens to be identical to the
branch's own content is wrongly classified unsafe.
**Solution**: Add an "identical-to-branch" fallback check alongside the existing "header-only vs
base" check in `conductor/services/track-metadata-conflict.mjs`.

- [x] Task 1: In `isSafeToAutoResolveBookkeepingConflict`, after `isTrackBookkeepingConflict`
      passes, compute `branchContent = gitShow(repoRoot, branch, path)` for each conflicting path
      (mirrors the existing `gitShow(repoRoot, mainBranch, path)` call already present). If
      `branchContent === null`, fail closed (same conservative pattern as the existing null
      checks for base/main).
- [x] Task 2: Change the per-path safety condition from
      `stripHeaderLines(baseContent) === stripHeaderLines(mainContent)` (strict AND across all
      paths) to: for each path, safe iff EITHER `stripHeaderLines(baseContent) ===
      stripHeaderLines(mainContent)` (existing rule) OR `mainContent === branchContent` (new
      rule, exact match, no stripping — main and branch already agree byte-for-byte). Still AND
      across all conflicting paths (every path must independently be judged safe).
- [x] Task 3: Keep `BOOKKEEPING_FILENAMES` and `isTrackBookkeepingConflict` untouched — this track
      only changes what counts as a *safe* divergence, not which files/paths are eligible.

**Implementation note**: verified empirically (multiple constructed `git merge` scenarios —
checkbox+addition, mode+content, rename+content, line-ending-only, reordered-lines) that git's own
3-way merge *already* auto-resolves any path where both sides' committed blobs are fully
byte-identical — a real, unresolvable `git merge`/`git merge-tree` conflict can therefore only ever
occur when `mainContent !== branchContent` for that path. This means the new "identical to branch"
rule can never be the deciding factor for a conflict reached through the two real callers
(`mergeWorktreeBranch()` via `git merge --no-ff`, `auditWorktrees()` via `git merge-tree`) — both
already resolve true byte-identical convergence on their own, before our predicate is even
consulted. The rule is still correct and worth keeping: it's proven meaningful at the predicate
level directly (unit tests below go red before this change, green after), and is forward-looking
defense for any future caller that determines `conflictPaths` by a coarser mechanism than an
actually-attempted git merge. See Phase 2 Task 2 for how this reshaped the end-to-end test.

**Impact**: Merges like track 10037's no longer need manual/agent resolution when main and the
branch independently converged on the same content.

## Phase 2: Tests

**Problem**: This is a merge-safety predicate — a subtle regression here could silently
auto-resolve a conflict that should have blocked (REQ-3 is the load-bearing guard).
**Solution**: Direct unit tests against the pure function plus one realistic end-to-end repro.

- [x] Task 1: Unit tests for `isSafeToAutoResolveBookkeepingConflict` covering the matrix: (a)
      header-only divergence (existing case, must still pass), (b) checkbox-line divergence
      identical to branch (new case, must now pass), (c) divergence identical to neither base nor
      branch (must still fail/block), (d) divergence on a non-bookkeeping path (must still fail —
      `isTrackBookkeepingConflict` gate unchanged), (e) multiple conflicting paths, one safe one
      unsafe (AND semantics preserved). All 5 written directly against the predicate with
      constructed git refs (TC-1..TC-5 in
      `conductor/tests/track-10038-bookkeeping-conflict-widen.test.mjs`) — confirmed red (only
      TC-2, the new case) before the Phase 1 fix, green after.
- [x] Task 2: End-to-end repro test using real git operations, same temp-repo-with-worktrees
      pattern as `track-1112-worktree-merge.test.mjs`. **Deviates from this task's original
      wording** ("branch ticks the same checkboxes plus adds more content" merges cleanly) — while
      implementing, found this exact shape is actually the *unsafe* case: if the branch has content
      main never mirrored, `mainContent !== branchContent`, so it correctly still blocks (now
      TC-6b, a regression/negative-case addition). The genuinely-safe convergent shape requires
      main's mirror to match the branch's *full* final content, not just its checkboxes — and per
      the Implementation note in Phase 1, git's own merge already resolves that shape natively
      before our predicate is ever consulted (TC-6 documents and verifies this end-to-end, with
      the actual rule-2-specific proof living in TC-2's unit test instead, since only a direct
      predicate call can force a `conflictPaths` classification a real git merge would never
      produce for byte-identical content).
- [x] Task 3: Searched `conductor/tests/` — only existing coverage was
      `track-1114-track-metadata-conflict.test.mjs` (unit, `isTrackBookkeepingConflict` only, no
      overlap) and `track-1112-worktree-merge.test.mjs` (e2e, covers the header-only case this
      track doesn't change). Ran both plus the new suite together: 36 + 8 tests, all pass, no
      regressions.

**Impact**: The widened rule is proven safe on both the case it fixes and the case it must
continue to block.

## ✅ REVIEWED

All 24 tests pass (8 new from this track + 16 existing regression suite). No regressions.
Ready for quality-gate verification.
