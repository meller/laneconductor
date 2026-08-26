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
 * eligible for reaping: not this manager's own pid, not in the
 * currently-registered set, and older than the grace period (so a worker
 * that just spawned and hasn't sent its first heartbeat yet — the same
 * race Phase 6 Task 4 guards against — is never touched).
 *
 * @param {Array<{pid: number, ageMs: number, cmd: string}>} rows
 * @param {object} opts
 * @param {Set<number>} opts.registeredPids - pids of workers currently
 *   registered (fresh heartbeat) for this host, from GET /api/workers
 * @param {number} opts.selfPid - this manager's own pid, never reaped
 * @param {number} opts.graceMs - minimum process age before eligible
 * @returns {Array<{pid: number, ageMs: number, cmd: string}>}
 */
export function findOrphanedWorkerProcesses(rows, { registeredPids, selfPid, graceMs }) {
  return rows.filter(row =>
    row.pid !== selfPid
    && !registeredPids.has(row.pid)
    && row.ageMs >= graceMs
  );
}
