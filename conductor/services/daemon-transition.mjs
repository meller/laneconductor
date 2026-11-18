// The sync daemon's transition helpers (track AM-10131, ONE LOGIC, TWO CALLERS). The daemon used to parse `on_success` / `on_failure`
// itself, in several places. The target computation now lives in ONE file, conductor/services/workflow-transitions.mjs, which the
// connector calls too; this file only adapts it to what the daemon's call sites pass in and expect back. It is pure (no I/O, no worker),
// so the parity test can run it without starting anything.
//
// COMPATIBILITY SHIMS (named, each keeps one thing the old daemon did that track 1020's grammar does not say; the owner decides whether
// to keep it, see the track's report):
//   - NO_TARGET_STAYS: no target (null, 'stay', 'stop') keeps the track in its lane with status success / failure / queue.
//   - RETRY_REQUEUE: a BARE target naming the SAME lane re-queues (status `queue`) on a failure that has not used up max_retries; the
//     grammar's `failure` applies only at max_retries (explicit `lane:failure` always stays as written).
import { Lanes } from '../constants.mjs';
import { resolveTarget } from './workflow-transitions.mjs';

const EXPLICIT_STATUS = /:\s*\S/;

/**
 * Where a finished lane action puts the track: a transition string (e.g. "implement:queue" or "plan") to `{ lane, status }`.
 * Replaces resolveTransition() of laneconductor.sync.mjs; same arguments and result.
 */
export function resolveTransition(configValue, currentLane, isSuccess, isMaxRetries) {
  const stay = () => ({ lane: currentLane || Lanes.PLAN, status: isSuccess ? 'success' : (isMaxRetries ? 'failure' : 'queue') }); // NO_TARGET_STAYS
  if (!configValue || configValue === 'stay' || configValue === 'stop') return stay();
  const t = resolveTarget(configValue, currentLane, isSuccess ? 'success' : 'failure');
  if (!t) return stay();
  let { status } = t;
  if (!isSuccess && !isMaxRetries && status === 'failure' && !EXPLICIT_STATUS.test(configValue)) status = 'queue'; // RETRY_REQUEUE
  return { lane: t.lane || currentLane || Lanes.PLAN, status };
}

/**
 * The lane agent-runtime.mjs writes into `**Lane**` after a run: the lane part of the lane's `on_success` / `on_failure`, or the lane it
 * ran in when there is no target (or `stay`). The status the runtime writes is its own (success / failure) and is not touched here.
 */
export function runtimeTargetLane(laneConfig, isSuccess, laneStatus) {
  const value = isSuccess ? laneConfig?.on_success : laneConfig?.on_failure;
  if (value && value !== 'stay') {
    const t = resolveTarget(value, laneStatus, isSuccess ? 'success' : 'failure');
    if (t?.lane) return t.lane;
  }
  return laneStatus;
}
