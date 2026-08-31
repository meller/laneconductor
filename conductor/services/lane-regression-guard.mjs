// conductor/services/lane-regression-guard.mjs
// Track 10040 Phase 2 (REQ-12, Finding 4): a worker must never write a
// track's **Lane**/**Lane Status** backwards past a terminal state it did
// not itself produce. Confirmed live 2026-08-30: a worker process running
// 7-hour-stale in-memory code (the tracksMetadata bug track 10036 fixed)
// overwrote track 10036's own canonical index.md from `done:queue` back to
// `implement:success`, dragging a shipped track backwards and triggering a
// redundant implement run.
//
// This is a pure containment primitive — it holds against stale code,
// third-party processes, and races alike, without needing to first detect
// any of them (that's REQ-11 / worker-code-staleness.mjs, a separate,
// weaker alarm). Every marker-write site in the worker must route its
// intended write through shouldBlockLaneWrite() and no-op when blocked,
// rather than writing unconditionally.
//
// Pure module, no I/O — mirrors workspace-mode.mjs's extraction style.

export const LANE_ORDER = ['backlog', 'plan', 'implement', 'review', 'quality-gate', 'done'];

function rank(lane) {
  const i = LANE_ORDER.indexOf(lane);
  return i === -1 ? null : i;
}

/**
 * Decides whether an intended lane/status write should be blocked because
 * it would regress a track past a state this run did not itself produce.
 *
 * @param {object} opts
 * @param {string} opts.onDiskLane - the lane currently on disk (freshly read, not cached)
 * @param {string} [opts.onDiskStatus] - the status currently on disk (unused in the rank
 *   decision itself, kept for logging/symmetry with the write site's own state)
 * @param {string} opts.intendedLane - the lane this write wants to set
 * @param {string} [opts.intendedStatus] - the status this write wants to set
 * @param {boolean} opts.producedByThisRun - true when THIS run is the one whose failure/
 *   completion legitimately causes a backwards transition (e.g. review's on_failure sending
 *   a track back to implement:queue). An unrelated process acting on a stale view is never
 *   the producer of a regression it didn't cause.
 * @returns {{blocked: boolean, reason: string|null}}
 */
export function shouldBlockLaneWrite({
  onDiskLane,
  onDiskStatus = null,
  intendedLane,
  intendedStatus = null,
  producedByThisRun = false,
}) {
  const onDiskRank = rank(onDiskLane);
  const intendedRank = rank(intendedLane);

  // Unknown lane names fail closed — never treated as rank 0, which would
  // let a garbled lane name masquerade as "backlog" and pass every check.
  if (onDiskRank === null || intendedRank === null) {
    return { blocked: true, reason: `unknown lane name (onDisk=${onDiskLane}, intended=${intendedLane})` };
  }

  // Same-lane status churn (running -> success, queue -> running,
  // running -> failure) is not a lane regression — this guard only cares
  // about the LANE moving backwards, not status transitions within it.
  if (onDiskLane === intendedLane) {
    return { blocked: false, reason: null };
  }

  // `done` is terminal, unconditionally — moving OUT of done is always
  // blocked, even when producedByThisRun is true. Unlike review/quality-gate's
  // legitimate on_failure regressions, nothing in workflow.json ever sends
  // `done` anywhere else, so there is no such thing as a run that
  // legitimately "produces" a move out of done. This is the exact shape of
  // the live incident and the strictest rule in this module.
  if (onDiskLane === 'done') {
    return { blocked: true, reason: `refused to move track out of terminal lane 'done' (intended: ${intendedLane})` };
  }

  if (intendedRank < onDiskRank) {
    if (producedByThisRun) {
      // A legitimate on_failure transition (review -> implement:queue,
      // quality-gate -> plan:queue) — the run that just failed IS the
      // author of this regression, which is precisely what the flag
      // encodes.
      return { blocked: false, reason: null };
    }
    return {
      blocked: true,
      reason: `refused to write '${intendedLane}' over on-disk '${onDiskLane}' (rank ${intendedRank} < ${onDiskRank}, not produced by this run)`,
    };
  }

  return { blocked: false, reason: null };
}

/**
 * Applies a guarded Lane/Lane Status write to an index.md's raw content
 * string. Reads the on-disk lane FRESH from `content` itself (never from a
 * caller-cached variable) and no-ops both markers when the guard blocks —
 * the single seam both the worker's exit-handler write and its DB->disk
 * pull site route their marker writes through, so there is exactly one
 * place this invariant can be gotten wrong instead of two.
 *
 * @param {string} content - raw index.md content, read fresh by the caller
 * @param {object} opts
 * @param {string} opts.intendedLane
 * @param {string} [opts.intendedStatus] - omit to only write Lane, not Lane Status
 * @param {boolean} [opts.producedByThisRun]
 * @returns {{content: string, blocked: boolean, reason: string|null, onDiskLane: string|null, onDiskStatus: string|null}}
 */
export function applyGuardedLaneWrite(content, { intendedLane, intendedStatus, producedByThisRun = false }) {
  const onDiskLaneMatch = content.match(/\*\*Lane\*\*:\s*([^\n]+)/i);
  const onDiskStatusMatch = content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i);
  const onDiskLane = onDiskLaneMatch ? onDiskLaneMatch[1].trim() : intendedLane;
  const onDiskStatus = onDiskStatusMatch ? onDiskStatusMatch[1].trim() : null;

  const guard = shouldBlockLaneWrite({ onDiskLane, onDiskStatus, intendedLane, intendedStatus, producedByThisRun });
  if (guard.blocked) {
    return { content, blocked: true, reason: guard.reason, onDiskLane, onDiskStatus };
  }

  let next = content;
  if (next.match(/\*\*Lane\*\*:\s*[^\n]+/i)) {
    next = next.replace(/\*\*Lane\*\*:\s*[^\n]+/i, `**Lane**: ${intendedLane}`);
  } else if (next.match(/(# [^\n]+\n)/i)) {
    next = next.replace(/(# [^\n]+\n)/i, `$1\n**Lane**: ${intendedLane}\n`);
  } else {
    next = `**Lane**: ${intendedLane}\n` + next;
  }

  if (intendedStatus !== undefined) {
    if (next.match(/\*\*Lane Status\*\*:\s*\w+/i)) {
      next = next.replace(/\*\*Lane Status\*\*:\s*\w+/i, `**Lane Status**: ${intendedStatus}`);
    } else if (next.match(/\*\*Lane\*\*:\s*[^\n]+/i)) {
      next = next.replace(/(\*\*Lane\*\*:\s*[^\n]+)/i, `$1\n**Lane Status**: ${intendedStatus}`);
    } else if (next.match(/(# [^\n]+\n)/i)) {
      next = next.replace(/(# [^\n]+\n)/i, `$1\n**Lane Status**: ${intendedStatus}\n`);
    } else {
      next = `**Lane Status**: ${intendedStatus}\n` + next;
    }
  }

  return { content: next, blocked: false, reason: null, onDiskLane, onDiskStatus };
}
