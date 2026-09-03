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
export function classifyAutoCompleteOutcome({ beforeLane, afterLane, afterStatus, waitingReason }) {
  if (afterStatus === 'running') return { action: 'wait' };

  // Track 10055: a lane action that parked at `<lane>:waiting` stopped on
  // purpose and needs a human — it is neither a failure nor a stall. Checked
  // BEFORE the done-lane block below so the ordering reads as "waiting is the
  // general rule, done:waiting is its PR-shaped instance", and before the
  // same-lane guard, which would otherwise report a deliberate pause as
  // "<lane> did not advance … stopping rather than retrying automatically" —
  // wording that sends a human hunting for a bug that isn't there.
  //
  // `done` keeps its own completion semantics: a pr-mode merge that opened a
  // PR genuinely FINISHED the autopilot sequence (there is no further stage
  // to run), whereas a pause on any other lane suspends a sequence that still
  // has stages left. Same status, different sequencing consequence.
  if (afterStatus === 'waiting' && afterLane !== 'done') {
    const detail = (typeof waitingReason === 'string' && waitingReason.trim())
      ? waitingReason.trim()
      : 'no reason recorded — check the conversation and the run log';
    return { action: 'pause', reason: `${afterLane} paused for human input: ${detail}` };
  }

  // Track 10035: quality-gate's on_success is now done:queue, not
  // done:success — reaching done:queue hands off to the done lane's own
  // merge lane action, so it's just another stage to advance into (the
  // caller's buildCliArgs maps lane 'done' to /laneconductor merge), not a
  // terminal outcome. done:success (direct-mode merge, or a pr-mode track
  // the reconciler flipped after a real GitHub merge) and done:waiting
  // (pr-mode merge action just opened a PR) are the two genuine terminal
  // outcomes now — both "complete" the sequence successfully, just with
  // different resulting states.
  //
  // Checked BEFORE the generic same-lane-didn't-advance guard below,
  // because a successful merge run also has beforeLane === afterLane ===
  // 'done' (the done lane's own on_success has no lane change, only a
  // status change) — without this ordering, every genuine merge success
  // would be misclassified as a same-lane retry-without-progress "stop".
  if (afterLane === 'done') {
    if (afterStatus === 'success') return { action: 'complete', reason: 'merged — track shipped to main' };
    if (afterStatus === 'waiting') return { action: 'complete', reason: 'PR opened — waiting for human review/merge on GitHub' };
    if (afterStatus === 'queue') {
      // beforeLane !== 'done' means quality-gate just handed off — a real
      // advance. beforeLane === 'done' means the merge action itself came
      // back requeued without merging/opening a PR — same "didn't
      // genuinely succeed" signal as any other lane's same-lane retry.
      return beforeLane === 'done'
        ? { action: 'stop', reason: `done did not advance (status: queue) — stopping rather than retrying automatically` }
        : { action: 'advance', nextLane: 'done' };
    }
    return { action: 'stop', reason: `reached done but status is "${afterStatus}" — stopping` };
  }

  if (afterLane === beforeLane) {
    return { action: 'stop', reason: `${beforeLane} did not advance (status: ${afterStatus}) — stopping rather than retrying automatically` };
  }

  return { action: 'advance', nextLane: afterLane };
}
