// Track 1110 Phase 6: if the sync worker process restarts while a
// dispatch's spawned CLI child is still running, the child keeps running
// and finishes on its own — but the worker's in-memory `on('exit')`
// listener for it is gone, so the dispatch row stays `claimed` forever and
// the primary checkout never learns the run actually finished.
//
// Detection deliberately does NOT look for a specific commit message. The
// first version of this fix did exactly that (matching the exit handler's
// own `Track <N>: success (exit: N)` commit) and was wrong: that commit is
// written BY the exit handler, which is precisely the code that never runs
// in this bug — so the signal it was checking for can never exist in the
// case it's meant to catch. The reliable signal is the WORKTREE's own
// index.md `**Lane Status**` marker: the agent doing the actual lane work
// writes this itself as part of finishing (documenting the track's own
// outcome), independent of whether the wrapping exit-handler machinery
// ever gets a chance to run. This mirrors reconcileActiveDispatch()'s
// existing in-memory-only version of the same idea (laneconductor.sync.mjs)
// — same semantics, just sourced from a DB-persisted `claimed` dispatch
// instead of a Map that doesn't survive a restart.
export function classifyOrphanedDispatch({ laneStatus, lane, action }) {
  const status = laneStatus?.trim();
  if (!status || status.toLowerCase() === 'running') return { orphaned: false };

  // track 10014's own incident: the worktree's Lane Status can be a real,
  // terminal-looking value (success/failure/queue) while still belonging
  // to an EARLIER lane than the one this dispatch was actually for — a
  // worker restart can orphan a dispatch before its own action ever wrote
  // anything, leaving only the prior phase's markers on disk. Trusting
  // that status as this dispatch's own outcome, and copying/syncing the
  // worktree's index.md on the strength of it, silently regresses the
  // primary's more-advanced lane_status back to the worktree's stale
  // snapshot (main went implement:queue -> plan:success). Only compared
  // when both are supplied, so existing call sites that don't pass them
  // keep today's behavior unchanged.
  if (action && lane && lane.trim().toLowerCase() !== action.trim().toLowerCase()) {
    return {
      orphaned: true,
      status: 'failed',
      skipArtifactCopy: true,
      result: `Worker restart interrupted this before "${action}" made any recorded progress — worktree still shows lane "${lane}" (status "${status}"), not "${action}". Re-run the ${action} action.`,
    };
  }

  // Same ambiguity reconcileActiveDispatch() already lives with: a lane
  // with a configured on_success/on_failure transition can land on 'queue'
  // either because the action succeeded and moved to the next lane, or
  // because it failed but hasn't hit max_retries yet — indistinguishable
  // from this field alone. Only the literal 'failure' is unambiguous.
  const isFailure = status.toLowerCase() === 'failure';
  return {
    orphaned: true,
    status: isFailure ? 'failed' : 'done',
    result: isFailure ? null : (status.toLowerCase() === 'success' ? null : `lane status: ${status} (see track for outcome)`),
  };
}
