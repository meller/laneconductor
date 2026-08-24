# Tests: Track 10016 — last_run.log workDir ReferenceError

## Test Commands
```bash
node --test conductor/tests/track-10016-*.test.mjs
```

## Test Cases

### Phase 1: fix the scoping bug
- [ ] TC-1: A real spawned worker run (worktree-enabled, real git)
      that produces log output results in `last_run.log` appearing in
      the commit spawnCli's exit handler makes (`git show --stat` on
      that commit), not just present as an untracked file on disk.
- [ ] TC-2: No exception is silently swallowed in this code path —
      verify by temporarily removing the empty `catch` during
      development to confirm the `ReferenceError` actually fires
      before the fix, then confirm it's gone after.

## Acceptance Criteria
- [ ] Bug reproduced against a real spawned worker before fixing (per
      this codebase's TDD convention), not just asserted from code
      reading.
- [ ] No regressions in existing spawnCli/exit-handler test coverage
      (`conductor/tests/track-1102-f9-index-producer.test.mjs` and
      similar).
