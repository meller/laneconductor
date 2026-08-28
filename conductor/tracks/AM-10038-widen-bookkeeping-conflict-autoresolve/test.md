# Tests: Track AM-10038 — Widen Bookkeeping-Conflict Auto-Resolve

## Test Commands
```bash
node --check conductor/services/track-metadata-conflict.mjs
node --test conductor/tests/track-10038-bookkeeping-conflict-widen.test.mjs
```

## Test Cases

### Phase 1: Predicate widening
- [ ] TC-1: Header-only divergence (base→main touches only `**Lane**:`/`**Progress**:` etc.) →
      `isSafeToAutoResolveBookkeepingConflict` returns true — expected: unchanged from today
      (AC-2).
- [ ] TC-2: Checkbox-line divergence where main's content exactly equals the branch's content for
      that path → returns true — expected: new case now passes (AC-1).
- [ ] TC-3: Divergence where main's content matches NEITHER base (stripped) NOR branch (e.g. a
      human hand-edited plan.md prose directly on main) → returns false — expected: still blocks
      (AC-3).
- [ ] TC-4: Conflict path outside the bookkeeping whitelist (e.g. a source file) → returns false
      regardless of content — expected: `isTrackBookkeepingConflict` gate still enforced.
- [ ] TC-5: Multiple conflicting paths where one is safe (identical to branch) and another is
      unsafe (real divergence) → returns false overall — expected: AND semantics preserved across
      all paths.

### Phase 2: End-to-end
- [ ] TC-6: Real temp-repo repro of track 10037's exact shape (base → main ticks boxes via a
      "sync" commit, branch ticks the same boxes independently plus adds content) →
      `mergeWorktreeBranch` merges cleanly, no `conflict` result — expected: matches AC-1/AC-4.
- [ ] TC-7: Real temp-repo repro where main's plan.md has a genuine unrelated hand-edit → merge
      still reports `conflict` with the correct `conflictPaths` — expected: matches AC-3.

## Acceptance Criteria
- [ ] All new unit tests pass
- [ ] Full existing suite (`node --test conductor/tests/*.test.mjs`) shows no new regressions
      versus the pre-change baseline
