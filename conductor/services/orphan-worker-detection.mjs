// conductor/services/orphan-worker-detection.mjs
// Track 1091 Phase 7: find laneconductor.sync.mjs OS processes on this host
// that are NOT any currently-registered worker.
//
// Distinct from Phase 6 (manager respawns a worker whose heartbeat went
// stale): Phase 6 only sees processes that registered with the real
// collector and then stopped heartbeating. Confirmed live this session:
// 18 laneconductor.sync.mjs processes were running on this host, none
// registered in the real DB at all (GET /api/workers showed exactly the
// 2 legitimate ones) — leftover test-harness workers, each spawned by a
// track-1119 test against its own throwaway mock collector, whose
// working directory was deleted out from under them without the process
// ever being killed. 3 of them had been spinning at ~80% CPU for 13+
// hours against a dead cwd, ~2.2GB combined RSS across all 18. A
// heartbeat-staleness check structurally cannot see these — they never
// heartbeat the real collector in the first place.
//
// Pure module, no I/O — mirrors workspace-mode.mjs's extraction style.

/**
 * Parses `ps -eo pid,etimes,args --no-headers` output into structured rows,
 * filtered to laneconductor.sync.mjs processes only.
 *
 * @param {string} psOutput
 * @returns {Array<{pid: number, ageMs: number, cmd: string}>}
 */
export function parsePsWorkerRows(psOutput) {
  if (!psOutput) return [];
  return psOutput
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) return null;
      const [, pid, etimesSec, cmd] = match;
      return { pid: Number(pid), ageMs: Number(etimesSec) * 1000, cmd };
    })
    .filter(row => row && row.cmd.includes('laneconductor.sync.mjs'));
}

/**
 * Filters a list of laneconductor.sync.mjs process rows down to the ones
 * eligible for reaping. The original rule (unregistered + older than
 * grace) is unchanged. Track 10040 Phase 6 (REQ-6) widens "orphan" beyond
 * "unregistered": a REGISTERED worker is also reaped if its cwd has been
 * deleted out from under it, or its heartbeat has gone stale — the real
 * zombie this widening was written for (PID 1736711, ~17% CPU for 2 days
 * against a deleted cwd) was invisible to the original rule precisely
 * because it had registered.
 *
 * Backward compatible: passing the legacy `registeredPids: Set<pid>` shape
 * with no `cwdExists`/`staleHeartbeatMs` reproduces the exact original
 * behavior (registered pids are never touched, regardless of age).
 *
 * @param {Array<{pid: number, ageMs: number, cmd: string}>} rows
 * @param {object} opts
 * @param {Set<number>} [opts.registeredPids] - legacy shape: pids of workers currently
 *   registered for this host, from GET /api/workers
 * @param {Array<{pid: number, last_heartbeat?: string}>} [opts.registeredWorkers] - new shape,
 *   carrying enough per-worker info to evaluate the widened conditions
 * @param {number} opts.selfPid - this manager's own pid, never reaped
 * @param {number} opts.graceMs - minimum process age before eligible, applies to every branch
 * @param {number} [opts.staleHeartbeatMs] - a registered worker whose last_heartbeat is older
 *   than this is reaped too; omit to disable this widening
 * @param {(pid: number) => boolean} [opts.cwdExists] - injected probe (e.g. reads
 *   /proc/<pid>/cwd on Linux); a registered worker for which this returns false is reaped;
 *   omit to disable this widening
 * @param {number} [opts.now] - injected clock (ms), defaults to Date.now()
 * @returns {Array<{pid: number, ageMs: number, cmd: string}>}
 */
export function findOrphanedWorkerProcesses(rows, {
  registeredPids,
  registeredWorkers,
  selfPid,
  graceMs,
  staleHeartbeatMs,
  cwdExists,
  now = Date.now(),
}) {
  const registeredByPid = new Map();
  if (registeredWorkers) {
    for (const w of registeredWorkers) registeredByPid.set(w.pid, w);
  } else if (registeredPids) {
    for (const pid of registeredPids) registeredByPid.set(pid, null);
  }

  return rows.filter(row => {
    if (row.pid === selfPid) return false;
    if (row.ageMs < graceMs) return false;

    if (!registeredByPid.has(row.pid)) {
      // Unregistered — the original rule, unchanged.
      return true;
    }

    // Registered: only reap via an explicitly-enabled widening condition.
    const worker = registeredByPid.get(row.pid);
    if (cwdExists && !cwdExists(row.pid)) return true;
    if (staleHeartbeatMs && worker?.last_heartbeat) {
      const heartbeatAgeMs = now - new Date(worker.last_heartbeat).getTime();
      if (heartbeatAgeMs >= staleHeartbeatMs) return true;
    }
    return false;
  });
}

// Track AM-10093 (REQ-9): distinguishes a real `--worker-number` identity
// (its own OS process, its own poll loop) from a claim-scoped row spawnCli
// mints for a concurrently-live lane action
// (`workerNumber * CLAIM_WORKER_NUMBER_BASE_MULTIPLIER + slot`, laneconductor.
// sync.mjs). Confirmed via `git log -S CLAIM_WORKER_NUMBER_BASE_MULTIPLIER`
// during this track's own implementation: the constant was introduced once,
// at 100000, and has never changed — so a claim-scoped row's worker_number
// is always >= 100001, and a value below the multiplier can only be a real
// base identity. This is a THRESHOLD, not a guess: it holds for every
// worker_number this codebase has ever produced.
export const CLAIM_WORKER_NUMBER_BASE_MULTIPLIER = 100000;

export function classifyWorkerIdentity(workerNumber) {
  const n = Number(workerNumber);
  if (!Number.isFinite(n) || n < 0) return 'base'; // fail toward counting it, not silently dropping it
  return n >= CLAIM_WORKER_NUMBER_BASE_MULTIPLIER ? 'claim-scoped' : 'base';
}

/**
 * Counts live BASE worker identities for one (project_id, hostname) pair,
 * excluding claim-scoped rows, manager rows, and this process's own
 * about-to-register identity.
 *
 * @param {Array<{worker_number: number|string, project_id: number|null, hostname: string, type?: string}>} workers
 *   - rows from GET /api/workers (already heartbeat-freshness-filtered server-side)
 * @param {object} opts
 * @param {number} opts.projectId
 * @param {string} opts.hostname
 * @returns {Array<object>} the live base-identity rows matching this project+host (never includes 'manager' type rows)
 */
export function findLiveBaseIdentities(workers, { projectId, hostname }) {
  if (!Array.isArray(workers)) return [];
  return workers.filter(w =>
    w.type !== 'manager' &&
    w.project_id === projectId &&
    w.hostname === hostname &&
    classifyWorkerIdentity(w.worker_number) === 'base'
  );
}

/**
 * Decides whether a NEW base-identity worker may start, given how many
 * other live base identities already exist for this (project, host).
 *
 * @param {object} opts
 * @param {number} opts.liveCount - result of findLiveBaseIdentities(...).length
 * @param {number} opts.maxBaseWorkersPerProject - LC_MAX_BASE_WORKERS_PER_PROJECT (default 1); `0` disables the check entirely
 * @param {boolean} [opts.allowDuplicate] - LC_ALLOW_DUPLICATE_WORKER escape hatch
 * @returns {{allow: boolean, warn: boolean}} `warn` is true whenever another
 *   live identity exists, even when `allow` is true (REQ-8: "warn always")
 */
export function decideWorkerIdentityCap({ liveCount, maxBaseWorkersPerProject, allowDuplicate = false }) {
  if (maxBaseWorkersPerProject === 0) return { allow: true, warn: liveCount > 0 };
  const overCap = liveCount >= maxBaseWorkersPerProject;
  if (!overCap) return { allow: true, warn: false };
  return { allow: !!allowDuplicate, warn: true };
}
