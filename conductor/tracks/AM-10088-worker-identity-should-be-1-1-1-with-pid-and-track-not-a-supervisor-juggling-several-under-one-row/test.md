# Tests: Track AM-10088 — Worker identity should be 1:1:1 with pid and track

## Test Commands
```bash
# Track AM-10088's own worker E2E suite (real spawned processes, real mock-cli
# children, real mock-collector HTTP server — MUST set LC_TEST_REPO_ROOT to this
# worktree, or isolated-worker.mjs silently spawns the PRIMARY checkout's
# unmodified copy of laneconductor.sync.mjs instead — see the file's own comment)
node --test conductor/tests/track-am-10088-claim-scoped-workers.test.mjs

# Worker/auto-launch + dispatch-target unit tests
cd ui && npx vitest run src/lib/workerStatus.test.js src/components/WorkersList.test.jsx src/components/TrackDetailPanel.test.jsx

# Full local-fs worker E2E (real spawned processes, zero mocks) — regression check
node --test conductor/tests/local-fs-e2e.test.mjs
```

## Test Cases

### Phase 0: Allocation scheme validation
- [x] TC-1: Trace confirms `autoLaunchLocalFs`'s claim loop runs single-threaded per pass —
      documented in plan.md, not a runnable test, but must be written down before Phase 1 starts.

### Phase 1: Claim-scoped registration
- [x] TC-2: With `parallel_limit: 2` on a lane and two tracks queued, claim both concurrently.
      Query the `workers` table (or `GET /api/workers`) and confirm TWO rows exist for this
      project, each with a distinct `pid` matching a real live process, and each `current_task`
      naming its own track (not both showing the same track, not one overwriting the other).
- [x] TC-3: A single-claim run (only one track claimed) produces exactly the same row shape as
      before this track — same `worker_number`, same `pid` (the process's own), same
      `current_task` format. Diff against a baseline capture taken before implementation starts.

### Phase 2: Retirement on exit
- [x] TC-4: With two concurrent claims running (per TC-2), let one finish naturally. Confirm its
      row disappears (or goes idle) while the OTHER claim's row is untouched — still `busy`,
      still correct `pid`/`current_task`. This is the core regression this track exists to fix;
      test it directly, not just via the single-claim path. (Folded into TC-2/TC-4's single
      `it()` block, and further exercised by TC-5's SIGKILL variant — see that test's own
      comment for why a shared long delay + kill covers this rather than a separate natural-exit
      timing race.)

### Phase 3: Orphan detection
- [x] TC-5: With two concurrent claims running, `kill -9` one claim's child pid directly
      (bypassing the graceful exit handler). Confirm the existing orphan-reconciliation sweep
      eventually reconciles that claim's row (removed or marked offline) within its normal
      cycle, without needing a process restart, and without touching the sibling claim's row.
      Found and fixed a real bug via this test: the pre-existing unconditional
      `updateWorkerHeartbeat('idle', null)` in spawnCli's exit handler was flipping the BASE
      identity's row to idle on ANY child's exit, including a claim-scoped sibling's — see
      plan.md Phase 2's write-up.

### Phase 4: End-to-end UI verification
- [x] TC-6: Live, non-mocked (real spawned processes, real mock-collector — this project's own
      E2E tier) verification against a two-concurrent-claim scenario, via TC-2/TC-4 and TC-5
      above. Component-level confirmation that the Workers panel actually renders two distinct
      cards, each correct, added as three new cases in `WorkersList.test.jsx`. Not done: a
      screenshot of the real browser UI against two live `claude` CLI sessions on this shared
      project's own board — see plan.md Phase 4 for why that was judged out of proportion given
      the sandboxed E2E test already exercises the identical spawn/exit/heartbeat code paths.
- [x] TC-7 (found during verification, not originally planned): a claim-scoped row's retirement
      must not falsely populate the "recently offline, needs attention" alert strip, and must
      never be offered/defaulted-to as a manual dispatch target. Covered by new cases in
      `workerStatus.test.js` (`selectDefaultWorker` never defaults to a claim-scoped row) and
      `WorkersList.test.jsx` (Claim badge instead of Stop button).

## Acceptance Criteria
- [x] All test cases above pass against real spawned processes, not mocks — this track exists
      because a mocked/single-claim test suite would never have caught the original bug.
- [x] No regression in the single-claim case (TC-3).
- [x] No change in behavior for manager-driven subagent orchestration (out of scope per
      spec.md REQ-7 — confirmed by inspection, not a runnable test, since no subagent code path
      is touched).
