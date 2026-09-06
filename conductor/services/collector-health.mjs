// conductor/services/collector-health.mjs
// Track 10064 (REQ-5..REQ-9): per-collector auth/health tracking, extracted
// as pure/injectable logic so it's testable without spawning a real worker
// process — laneconductor.sync.mjs itself can't be imported directly in a
// test (module-load side effects: setInterval, chokidar), same reasoning as
// conductor/services/primary-cwd.mjs and config-root.mjs.
//
// Before this, a failed remote collector write was a fire-and-forget
// `.catch` that only ever called `console.warn` — confirmed live, 560
// consecutive identical 401s produced 560 identical log lines and nothing
// else: no counter, no escalation, no throttle, nothing reaching the
// heartbeat, the API, or the UI.

/**
 * @param {object} opts
 * @param {number} [opts.threshold] - consecutive failures before escalating
 *   from `warn` to a throttled `error` (REQ-8). Reads
 *   LC_COLLECTOR_FAILURE_THRESHOLD at call time if not given.
 * @param {number} [opts.logIntervalMs] - minimum ms between escalated
 *   `error` lines for the same collector, once past `threshold`. Reads
 *   LC_COLLECTOR_FAILURE_LOG_INTERVAL_MS at call time if not given.
 * @param {() => number} [opts.now] - injectable clock, for tests.
 * @param {{ log: Function, warn: Function, error: Function }} [opts.logger] -
 *   injectable logger, for tests. Defaults to `console`.
 */
export function createCollectorHealthTracker({
  threshold = Number(process.env.LC_COLLECTOR_FAILURE_THRESHOLD) || 5,
  logIntervalMs = Number(process.env.LC_COLLECTOR_FAILURE_LOG_INTERVAL_MS) || 60000,
  now = Date.now,
  logger = console,
} = {}) {
  const health = new Map();
  const failureLogState = new Map(); // url -> { lastLoggedAt }

  function getEntry(url) {
    let entry = health.get(url);
    if (!entry) {
      entry = {
        attempts: 0,
        consecutive_failures: 0,
        last_error_status: null,
        last_error: null,
        last_success_at: null,
        token_source: null,
      };
      health.set(url, entry);
    }
    return entry;
  }

  function recordTokenSource(url, source) {
    getEntry(url).token_source = source;
  }

  function recordSuccess(url) {
    const entry = getEntry(url);
    entry.attempts += 1;
    const wasFailing = entry.consecutive_failures > 0;
    entry.consecutive_failures = 0;
    entry.last_error_status = null;
    entry.last_error = null;
    entry.last_success_at = new Date(now()).toISOString();
    if (wasFailing) {
      logger.log(`[collector] ${url} recovered.`);
      failureLogState.delete(url);
    }
  }

  // Returns 'ok' | 'warned' | 'escalated' | 'throttled' — purely so a test
  // can assert exactly what happened without scraping log text.
  function recordFailure(url, err) {
    const entry = getEntry(url);
    entry.attempts += 1;
    entry.consecutive_failures += 1;
    entry.last_error_status = err?.status ?? null;
    entry.last_error = err?.message ?? String(err);

    if (entry.consecutive_failures < threshold) {
      logger.warn(`[collector] ${url} write failed (${entry.consecutive_failures}/${threshold} before escalation):`, entry.last_error);
      return 'warned';
    }

    const logState = failureLogState.get(url);
    const nowMs = now();
    if (logState && nowMs - logState.lastLoggedAt < logIntervalMs) return 'throttled';
    failureLogState.set(url, { lastLoggedAt: nowMs });
    logger.error(`[collector] ${url} has failed ${entry.consecutive_failures} consecutive writes — last error: ${entry.last_error}`);
    return 'escalated';
  }

  function serialize() {
    if (health.size === 0) return undefined;
    return Object.fromEntries(health);
  }

  return { getEntry, recordTokenSource, recordSuccess, recordFailure, serialize };
}
