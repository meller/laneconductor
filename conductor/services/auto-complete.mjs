// Track 1114: sequencing decision for "Complete & Merge" autopilot
// dispatches. Pure function, no I/O — the caller reads the track's lane
// state before/after a stage run and hands both here.
//
// The lane VALUE (not just Lane Status) is the only reliable success
// signal: a lane's own on_failure config can requeue the SAME lane on a
// retry-eligible failure, which reads identically to a genuine success
// from Lane Status alone ('queue' either way). Per the explicit decision
// this session (stop and surface a real failure, don't auto-retry), any
// outcome that doesn't advance the lane halts the sequence — whether it's
// an explicit 'failure' or a same-lane retry queue, both get treated the
// same: something didn't genuinely succeed, so a human should look.
export function classifyAutoCompleteOutcome({ beforeLane, afterLane, afterStatus }) {
  if (afterStatus === 'running') return { action: 'wait' };

  if (afterLane === beforeLane) {
    return { action: 'stop', reason: `${beforeLane} did not advance (status: ${afterStatus}) — stopping rather than retrying automatically` };
  }

  if (afterLane === 'done') {
    return afterStatus === 'success'
      ? { action: 'merge' }
      : { action: 'stop', reason: `reached done but status is "${afterStatus}", not success — stopping` };
  }

  return { action: 'advance', nextLane: afterLane };
}
