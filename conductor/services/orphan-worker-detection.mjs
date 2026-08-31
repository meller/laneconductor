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
