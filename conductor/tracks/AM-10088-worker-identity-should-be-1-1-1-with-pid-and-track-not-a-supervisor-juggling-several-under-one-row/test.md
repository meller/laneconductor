# Tests: Track AM-10088 — Worker identity should be 1:1:1 with pid and track

## Test Commands
```bash
# Worker/auto-launch unit tests
cd ui && npm test -- WorkersList

# Full local-fs worker E2E (real spawned processes, zero mocks)
node --test conductor/tests/local-fs-e2e.test.mjs
```

## Test Cases

### Phase 0: Allocation scheme validation
- [ ] TC-1: Trace confirms `autoLaunchLocalFs`'s claim loop runs single-threaded per pass —
      documented in plan.md, not a runnable test, but must be written down before Phase 1 starts.

### Phase 1: Claim-scoped registration
- [ ] TC-2: With `parallel_limit: 2` on a lane and two tracks queued, claim both concurrently.
      Query the `workers` table (or `GET /api/workers`) and confirm TWO rows exist for this
      project, each with a distinct `pid` matching a real live process, and each `current_task`
      naming its own track (not both showing the same track, not one overwriting the other).
- [ ] TC-3: A single-claim run (only one track claimed) produces exactly the same row shape as
      before this track — same `worker_number`, same `pid` (the process's own), same
      `current_task` format. Diff against a baseline capture taken before implementation starts.

### Phase 2: Retirement on exit
- [ ] TC-4: With two concurrent claims running (per TC-2), let one finish naturally. Confirm its
      row disappears (or goes idle) while the OTHER claim's row is untouched — still `busy`,
      still correct `pid`/`current_task`. This is the core regression this track exists to fix;
      test it directly, not just via the single-claim path.

### Phase 3: Orphan detection
- [ ] TC-5: With two concurrent claims running, `kill -9` one claim's child pid directly
      (bypassing the graceful exit handler). Confirm the existing orphan-reconciliation sweep
      eventually reconciles that claim's row (removed or marked offline) within its normal
      cycle, without needing a process restart, and without touching the sibling claim's row.

### Phase 4: End-to-end UI verification
- [ ] TC-6: Live, non-mocked verification against a real two-concurrent-claim scenario (the
      livingwork AM-1018/AM-1019 reproduction from spec.md, or an equivalent constructed one) —
      confirm the Workers panel shows two distinct cards, each correct, with no manual UI code
      changes required (or, if a change WAS required, that this test now passes with it).

## Acceptance Criteria
- [ ] All test cases above pass against real spawned processes, not mocks — this track exists
      because a mocked/single-claim test suite would never have caught the original bug.
- [ ] No regression in the single-claim case (TC-3).
- [ ] No change in behavior for manager-driven subagent orchestration (out of scope per
      spec.md REQ-7 — confirmed by inspection, not a runnable test, since no subagent code path
      is touched).
