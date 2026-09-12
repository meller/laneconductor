// conductor/services/suppression-log-throttle.mjs
// Track AM-10093 Phase 6 (REQ-7, Task 6.2): a persistently-contended track
// re-evaluates every ~5s cycle, so an unthrottled warn for each abandoned
// dispatch or skipped DB pull would flood the log exactly the way 560
// consecutive identical 401s did before track 10064's collector-health
// throttle (collector-health.mjs) — same shape of problem, same fix
// pattern: one line per key per interval, not one per tick.
//
// Pure factory, no I/O — mirrors collector-health.mjs's
// createCollectorHealthTracker style (injectable clock + logger, for
// tests), scoped down to just the throttle decision since this doesn't
// need health accumulation, only rate-limiting.

/**
 * @param {object} opts
 * @param {number} [opts.intervalMs] - minimum ms between logged lines for
 *   the same key. Reads LC_SUPPRESSION_LOG_INTERVAL_MS at call time if not
 *   given.
 * @param {() => number} [opts.now] - injectable clock, for tests.
 */
export function createSuppressionLogThrottle({
  intervalMs = Number(process.env.LC_SUPPRESSION_LOG_INTERVAL_MS) || 60000,
  now = Date.now,
} = {}) {
  const lastLoggedAt = new Map(); // key -> ms

  /**
   * @param {string} key - e.g. `${trackNumber}:${reason}` — distinct
   *   reasons for the same track are tracked independently, so a track
   *   that's simultaneously hitting two different suppression paths still
   *   gets a line for each kind, just not per tick.
   * @returns {boolean} true the first time a key is seen, and again after
   *   `intervalMs` has elapsed since the last true — false otherwise.
   */
  function shouldLog(key) {
    const last = lastLoggedAt.get(key);
    const t = now();
    if (last != null && (t - last) < intervalMs) return false;
    lastLoggedAt.set(key, t);
    return true;
  }

  return { shouldLog };
}
