// conductor/services/capacity-probe-throttle.mjs
// Pure decision logic for whether checkClaudeCapacity() (laneconductor.sync.mjs)
// should skip spawning a real `claude -p test` CLI process — a real API call —
// and instead reuse a recent result.
//
// Confirmed live 2026-09-01: checkClaudeCapacity() had zero throttling and is
// called from inside the 5s auto-launch tick whenever a worker is idle with
// capacity to claim more work. That meant one full Claude API probe every 5
// seconds per idle worker, indefinitely — real CPU/wall-clock and real usage
// burned for no reason while nothing had changed. Pure module, no I/O —
// mirrors this codebase's other extraction style (workspace-mode.mjs,
// lane-regression-guard.mjs) so the decision is testable without spawning a
// real CLI process.
export const DEFAULT_CAPACITY_CHECK_TTL_MS = 60000;

/**
 * @param {object} opts
 * @param {{status: string, reset_at: string|null, lastCapacityCheckAt: number}|null|undefined} opts.cached
 * @param {number} opts.nowMs
 * @param {number} [opts.ttlMs]
 * @returns {{skip: boolean, available: boolean}} `skip: false` means the
 *   caller must do a real probe (`available` is meaningless in that case).
 *   `skip: true` means reuse `available` — no process should be spawned.
 */
export function decideCapacityProbe({ cached, nowMs, ttlMs = DEFAULT_CAPACITY_CHECK_TTL_MS }) {
  if (!cached || typeof cached.lastCapacityCheckAt !== 'number') {
    return { skip: false, available: false };
  }
  if (nowMs - cached.lastCapacityCheckAt >= ttlMs) {
    return { skip: false, available: false };
  }
  if (cached.status !== 'exhausted') {
    return { skip: true, available: true };
  }
  if (!cached.reset_at) {
    return { skip: true, available: false };
  }
  return { skip: true, available: new Date(cached.reset_at).getTime() < nowMs };
}
