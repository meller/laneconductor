# Tests: Track 10015 — Worktree dispatch reliability

## Test Commands
```bash
node --test conductor/tests/track-10015-*.test.mjs
```

## Test Cases

### Phase 1: refresh-worktrees fix
- [x] TC-1: A `refresh-worktrees` dispatch enqueued with no `track_number`
      (matching how the UI actually sends it) completes with
      `status: 'done'` against a real spawned worker.
- [x] TC-2: The fix doesn't regress `remove-worktree` — full conductor
      suite re-run after the fix, same 7 pre-existing flaky failures as
      before (confirmed unrelated by comparing the exact failing suite
      names), no new failures.

### Phase 2: duplicate worker process detection — superseded, see track 1084 Phase 8
- [x] TC-3: covered by `conductor/tests/worker-id-watchdog.test.mjs`
      (1084 Phase 8) — asserts the stale-`myWorkerId` warning fires and
      names the actual failure mode.
- [x] TC-4: covered by the same suite — asserts self-heal once
      registration starts succeeding again.

## Acceptance Criteria
- [x] Both bugs reproduced against a real spawned worker before fixing
      (per this codebase's TDD convention), not just asserted from code
      reading — Bug 1 via `track-10015-refresh-worktrees.test.mjs`
      (watched it fail, then pass); Bug 2 via 1084 Phase 8's own
      real-worker regression test.
- [x] No regressions in existing worktree/dispatch test suites — ran
      `worker-id-watchdog.test.mjs`, `track-10015-refresh-worktrees.test.mjs`,
      and `track-1102-f8-dispatch-failure-reporting.test.mjs` together
      (5/5 pass), plus a full conductor suite pass (same 7 pre-existing
      flaky failures, no new ones).
