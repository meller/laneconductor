# Spec: Worktree dispatch reliability

## Problem Statement

Two independent bugs found live while investigating a "Remove worktree
button does nothing" report:

1. `refresh-worktrees` dispatches unconditionally fail with `missing
   track_number`, despite the enqueue side deliberately not requiring one
   for this action.
2. Two worker processes can end up registered under the same
   `(project_id, hostname, worker_number)` identity, silently racing for
   one dispatch inbox — with no detection, no error, and no visible
   signal that dispatches addressed to that identity may go unserviced.

## Requirements

- REQ-1: A `refresh-worktrees` dispatch must succeed (or fail with a
  reason *other than* a missing track number) when enqueued without a
  `track_number`, matching what the enqueue-side validation already
  promises.
- REQ-2: On worker registration/heartbeat, detect when the identity
  `(project_id, hostname, worker_number)` being upserted already has a
  live row (recent heartbeat) with a **different** `pid` than the one
  registering. Log this loudly at minimum.
- REQ-3: Decide and implement a concrete mitigation for REQ-2's
  detection — options include refusing to start a second process for a
  live identity, or surfacing a "duplicate worker" warning in the UI —
  not just logging.
- REQ-4 (stretch, may stay open): explain why `checkDispatchInbox()` on
  the orphaned process stopped producing any output at all (no fetch
  attempt, no caught-error log) rather than erroring visibly. If a root
  cause can't be pinned down (the original process was gone before it
  could be inspected), add enough logging that a future recurrence is
  diagnosable without a live debugging session.

## Acceptance Criteria

- [x] A live (or test-harness) `refresh-worktrees` dispatch with no
      `track_number` completes with `status: 'done'`, not `'failed':
      'missing track_number'`. — Met by this track's own fix
      (`conductor/laneconductor.sync.mjs`), verified by
      `track-10015-refresh-worktrees.test.mjs`.
- [x] Starting a second worker process for an identity that already has
      a live, heartbeating process produces a clear, loud signal
      (log at minimum; ideally also visible from the UI) instead of
      silent dual registration. — Met by track 1084 Phase 8's
      `myWorkerId`-stale watchdog (same incident, sharper root cause than
      this spec's "detect duplicate PIDs" framing — see index.md's Bug 2
      section), verified by `worker-id-watchdog.test.mjs`.
- [x] Regression test(s) proving both fixes against a real spawned
      worker (matching this codebase's existing e2e test conventions —
      see `conductor/tests/track-1102-f8-dispatch-failure-reporting.test.mjs`
      for the pattern). — `track-10015-refresh-worktrees.test.mjs` and
      `worker-id-watchdog.test.mjs`, both re-run and passing as part of
      this quality-gate pass.
