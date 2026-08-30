// conductor/services/resting-state.mjs
// Track 10040 Phase 4 (REQ-16, REQ-17, Finding 7): workers only ever claim
// lane_action_status = 'queue'. A track resting at
// <non-terminal-lane>:success is therefore polled by nothing, escalated by
// nothing, and — because 'success' reads as good news — looks healthy at a
// glance. Confirmed live 2026-08-30: 10038 (implement:success, already
// merged to main), 1100 (quality-gate:success), 10039 (implement:success)
// were all stranded this way.
//
// The valid resting-state set is DERIVED from workflow.json's own
// transition table (REQ-16), never hardcoded — a project configuring
// `plan.on_success: "implement:queue"` must get `plan:success` flagged,
// while THIS project (which deliberately sets `plan.on_success:
// "plan:success"`) must not.
//
// Pure module, no I/O — mirrors lane-regression-guard.mjs's style.

import { LANE_ORDER } from './lane-regression-guard.mjs';

// Statuses that are never a "hidden" resting state regardless of lane —
// queue/running are actively poll-able-or-in-progress, failure/blocked are
// already-escalated terminal states, and waiting is done-lane pr-mode's
// own legitimate "outside this system" park (done:waiting).
const ALWAYS_VALID_STATUSES = ['queue', 'running', 'failure', 'blocked', 'waiting'];

/**
 * Derives the set of "lane:status" pairs a configured workflow can
 * actually produce and legitimately leave alone, as `Set<string>`.
 *
 * @param {object} workflow - parsed workflow.json (only `.lanes` is read)
 * @returns {Set<string>}
 */
export function deriveValidRestingStates(workflow) {
  const validSet = new Set();
  const lanes = Object.keys(workflow?.lanes || {});

  for (const lane of lanes) {
    for (const status of ALWAYS_VALID_STATUSES) {
      validSet.add(`${lane}:${status}`);
    }

    const onSuccess = workflow.lanes[lane]?.on_success;
    if (!onSuccess) {
      // No on_success defined (e.g. 'done' — the merge action, not a
      // generic transition, decides its own success/waiting outcome).
      // Nothing else could ever have moved this track further, so
      // resting at `success` here is always legitimate.
      validSet.add(`${lane}:success`);
      continue;
    }

    const [targetLane] = onSuccess.split(':');
    if (targetLane === lane) {
      // Self-referencing on_success (this project's own
      // plan.on_success: "plan:success") — a deliberate park, not a
      // stranding. Valid.
      validSet.add(`${lane}:success`);
    }
    // Otherwise on_success moves elsewhere: `${lane}:success` is NOT
    // added, so it is correctly flagged invalid — the track should have
    // transitioned and didn't.
  }

  return validSet;
}

/**
 * Finds tracks resting in a state the workflow cannot produce.
 *
 * @param {Array<{lane: string, status: string, [key: string]: any}>} tracks
 * @param {Set<string>} validSet - from deriveValidRestingStates
 * @param {object} workflow - parsed workflow.json, used to report the
 *   transition that should have applied
 * @returns {Array<object>} each input track, plus `expectedTransition`
 */
export function findInvalidRestingStates(tracks, validSet, workflow) {
  const offenders = [];
  for (const track of tracks) {
    const key = `${track.lane}:${track.status}`;
    if (!validSet.has(key)) {
      offenders.push({ ...track, expectedTransition: workflow?.lanes?.[track.lane]?.on_success ?? null });
    }
  }
  return offenders;
}

/**
 * Classifies a forward-stranded track (Findings 4/6's shape:
 * <lane>:success where the workflow says it should have moved on).
 * Conservative by design — defaults to escalate; reapply requires the
 * caller to have positively confirmed the lane's own completion markers
 * are both present and internally consistent (never inferred here).
 *
 * @param {object} opts
 * @param {boolean} [opts.completionMarkersPresent]
 * @param {boolean} [opts.completionMarkersConsistent]
 * @returns {{action: 'reapply'|'escalate'}}
 */
export function classifyRestingState({ completionMarkersPresent = false, completionMarkersConsistent = false } = {}) {
  if (completionMarkersPresent && completionMarkersConsistent) {
    return { action: 'reapply' };
  }
  return { action: 'escalate' };
}

/**
 * Classifies the INVERSE corruption (REQ-17): a track whose merge commit
 * is already reachable from main, but whose lane marker still reads
 * earlier than 'done'. 10038's exact shape. Spec D9: always escalate,
 * NEVER reapply/auto-forward — re-running a merged track repeats real
 * damage (10038 was re-implemented after it had already shipped), and
 * writing markers forward to 'done' asserts a merge nobody verified.
 *
 * @param {object} opts
 * @param {string} opts.trackNumber
 * @param {boolean} opts.mergeCommitReachable - injected (a real
 *   isReachableFromMain(sha) probe lives in the caller, keeping this pure)
 * @param {string} opts.lane
 * @returns {{invalid: boolean, action: 'escalate'|null, reason: string|null}}
 */
export function classifyMergedButNotDone({ trackNumber, mergeCommitReachable, lane }) {
  if (!mergeCommitReachable) return { invalid: false, action: null, reason: null };

  const rank = LANE_ORDER.indexOf(lane);
  const doneRank = LANE_ORDER.indexOf('done');
  if (rank === -1 || rank >= doneRank) return { invalid: false, action: null, reason: null };

  return {
    invalid: true,
    action: 'escalate',
    reason: `track ${trackNumber}'s merge commit is reachable from main but its lane ('${lane}') ranks earlier than 'done'`,
  };
}
