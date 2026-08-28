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
// Track 1117 Bug 2: a lane/action mismatch was always treated as a genuine
// inconsistency — but the NORMAL shape of a successful run is exactly a lane
// that has advanced past the dispatched action (implement -> review, per
// workflow.json's on_success). Before flagging a mismatch as suspicious,
// check whether `lane` is a legal on_success/on_failure destination for
// `action` per workflow.json's own transition table. Returns which
// transition matched ('on_success' | 'on_failure'), or null if the
// mismatch isn't a recognized transition at all (still worth flagging).
function matchForwardTransition(action, lane, workflowConfig) {
  const laneConfig = workflowConfig?.lanes?.[action?.trim()];
  if (!laneConfig || !lane) return null;
  const targetLaneOf = (transition) => transition?.split(':')[0]?.trim().toLowerCase();
  const normalizedLane = lane.trim().toLowerCase();
  if (targetLaneOf(laneConfig.on_success) === normalizedLane) return 'on_success';
  if (targetLaneOf(laneConfig.on_failure) === normalizedLane) return 'on_failure';
  return null;
}

// Track 10020 Phase 3 (REQ-5): a CLI killed outright (SIGKILL, OOM) never
// writes a terminal **Lane Status** — the worktree stays at "running"
// forever, which this function otherwise reads as "still genuinely in
// progress" and never closes out. `runnerExited` is the run-marker's
// verdict (conductor/services/run-marker.mjs's isRunMarkerLive) that the
// process which would have written that terminal status is provably gone.
// Only the caller decides when it's safe to pass `true` — a marker existed
// AND was proven not-live (never for the no-marker case, so callers that
// don't pass it at all see byte-identical behavior to before this phase —
// REQ-6).
export function classifyOrphanedDispatch({ laneStatus, lane, action, workflowConfig, runnerExited }) {
  const status = laneStatus?.trim();
  const statusIsRunning = Boolean(status) && status.toLowerCase() === 'running';

  if (statusIsRunning && runnerExited === true) {
    return {
      orphaned: true,
      status: 'failed',
      skipArtifactCopy: true,
      flagForHuman: true,
      result: `The CLI running "${action}" exited without recording an outcome (crash or kill) — worktree still shows Lane Status "running". Re-run the ${action} action.`,
    };
  }

  if (!status || statusIsRunning) return { orphaned: false };

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
    const transition = matchForwardTransition(action, lane, workflowConfig);
    if (transition) {
      // Legitimate forward advance — this IS what a clean success (or a
      // handled failure) normally looks like. Trust the worktree's status
      // and let the caller copy artifacts back, same as the lane/action
      // agreement path below.
      const isFailure = transition === 'on_failure';
      return {
        orphaned: true,
        status: isFailure ? 'failed' : 'done',
        result: isFailure ? null : (status.toLowerCase() === 'success' ? null : `lane status: ${status} (see track for outcome)`),
      };
    }
    return {
      orphaned: true,
      status: 'failed',
      skipArtifactCopy: true,
      flagForHuman: true,
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
