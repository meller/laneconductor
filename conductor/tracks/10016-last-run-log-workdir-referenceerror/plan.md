# Track 10016: last_run.log workDir ReferenceError

## Phase 1: Fix the scoping bug

**Problem**: `workDir` is declared inside `if (updated) { ... }` but
referenced earlier inside the sibling `if (lastRunLog) { ... }` block —
a `ReferenceError` silently swallowed by an empty catch, so
`last_run.log` is written but never `git add`ed.

**Solution**: Not yet designed in detail — the mechanical fix is to
hoist `const workDir = worktreePath || process.cwd();` to before both
blocks that need it. Needs care around exactly where in the function
that hoist should live (it must still see the same `worktreePath` that
Phase 5's other writes use, and shouldn't be computed any earlier than
necessary).

- [ ] Task 1: Hoist `workDir`'s declaration to a scope visible to both
      the `if (lastRunLog)` and `if (updated)` blocks
- [ ] Task 2: Regression test — real spawned worker run, assert
      `last_run.log` is actually staged/committed, not just written to
      disk (the current bug proves "no exception observed" isn't
      sufficient — the exception IS happening, just swallowed)
- [ ] Task 3: Consider whether the empty `catch (e) {}` around this
      `git add` call should log a warning on genuine failures (e.g. git
      not available, permissions) rather than staying fully silent —
      separate judgment call from the scoping fix itself, don't bundle
      unless it's trivial
