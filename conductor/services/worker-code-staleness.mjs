// conductor/services/worker-code-staleness.mjs
// Track 10040 Phase 2 (REQ-11, Finding 4): detects a worker process running
// code older than what's actually on disk. Node loads modules into memory
// at boot; editing the file on disk changes nothing for an already-running
// process. Confirmed live 2026-08-30: a worker started at 10:01 kept
// running for 7 hours after a fix landed at 17:02, using the stale code to
// manufacture duplicate track folders and (with REQ-12 not yet in place)
// drag a shipped track backwards.
//
// This is the ALARM, not the seatbelt — REQ-12's lane-regression-guard
// contains the damage even when this detector never fires or a human
// hasn't acted on its report yet. See spec D6 for why containment ships
// first.
//
// Spec D5 (corrected from the original REQ-11 wording, which said "the
// repo's current HEAD for its project" — wrong for the common case): a
// worker's CODE lives at the LaneConductor install path
// (~/.laneconductorrc), not in any project repo it manages. The manager
// worker in particular registers with project_id: null and has no project
// repo at all. Staleness is always measured against the INSTALL DIR's
// HEAD — never a managed project's repo.
//
// Pure module, no I/O — git facts are injected, same style as
// orphan-worker-detection.mjs, so this unit-tests without a repo.

// Files this worker process actually loads at boot. A commit since
// `workerSha` that touches any of these is 'critical' — the running
// process's behavior has diverged from what's on disk in a way that
// matters, not just "some time has passed".
export const WORKER_LOADED_FILE_PATTERNS = [
  /^conductor\/laneconductor\.sync\.mjs$/,
  /^conductor\/services\//,
  /^conductor\/constants\.mjs$/,
];

function touchesLoadedFile(touchedFiles) {
  return touchedFiles.some(f => WORKER_LOADED_FILE_PATTERNS.some(re => re.test(f)));
}

/**
 * Classifies how stale a worker's loaded code is relative to the install
 * dir's current HEAD.
 *
 * @param {object} opts
 * @param {string} opts.workerSha - the commit sha this worker registered with (captured once at boot)
 * @param {string} opts.headSha - the install dir's current HEAD sha
 * @param {number} [opts.commitsBehind] - number of commits between workerSha and headSha
 * @param {string[]} [opts.touchedFiles] - union of file paths touched by every commit since workerSha
 * @param {number} [opts.maxCommitsBehind] - threshold for 'stale' when no loaded file was touched
 * @returns {{stale: boolean, severity: 'current'|'stale'|'critical', reason: string}}
 */
export function classifyWorkerStaleness({
  workerSha,
  headSha,
  commitsBehind = 0,
  touchedFiles = [],
  maxCommitsBehind = 20,
}) {
  if (!workerSha || workerSha === headSha) {
    return { stale: false, severity: 'current', reason: 'worker code sha matches install dir HEAD' };
  }

  if (touchesLoadedFile(touchedFiles)) {
    return {
      stale: true,
      severity: 'critical',
      reason: `${commitsBehind} commit(s) behind HEAD, and at least one touched a file this worker loads (${touchedFiles.filter(f => WORKER_LOADED_FILE_PATTERNS.some(re => re.test(f))).join(', ')})`,
    };
  }

  if (commitsBehind > maxCommitsBehind) {
    return {
      stale: true,
      severity: 'stale',
      reason: `${commitsBehind} commit(s) behind HEAD (threshold ${maxCommitsBehind}), none touched a loaded file`,
    };
  }

  return { stale: false, severity: 'current', reason: `${commitsBehind} commit(s) behind HEAD, within threshold, no loaded file touched` };
}
