// conductor/services/collector-retry-buffer.mjs
// Track 10064 (REQ-11): bounded, in-memory retry buffer for non-primary
// ("fire-and-forget") collector writes. Before this, a write that failed
// while a remote collector was down was simply gone — collector[0]'s
// awaited result was still returned to the caller, so nothing about the
// failure ever surfaced beyond a log line, and there was no way for the
// data to reach the collector once it recovered.
//
// Deliberately NOT persisted to disk across restarts — track state
// re-syncs from the filesystem on the worker's next heartbeat/full-sync
// cycle anyway, so a durable write-ahead log wouldn't add much value here
// (see spec.md's Non-Goals). This buffer only smooths over an outage that
// happens while the worker process is already running.

/**
 * @param {object} [opts]
 * @param {number} [opts.max] - max distinct (collector, method, path) entries
 *   before the oldest is evicted. Reads LC_COLLECTOR_RETRY_MAX if not given.
 * @param {number} [opts.baseDelayMs] - initial backoff delay.
 * @param {number} [opts.maxDelayMs] - backoff ceiling.
 * @param {() => number} [opts.now] - injectable clock, for tests.
 * @param {{ warn: Function }} [opts.logger] - injectable logger, for tests.
 */
export function createCollectorRetryBuffer({
  max = Number(process.env.LC_COLLECTOR_RETRY_MAX) || 100,
  baseDelayMs = 1000,
  maxDelayMs = 5 * 60 * 1000,
  now = Date.now,
  logger = console,
} = {}) {
  // Map preserves insertion order — the FIRST key is always the oldest,
  // which is exactly what "evict the oldest entry when full" needs. Update
  // (not delete-then-set) on coalescing, so a repeatedly-failing write's
  // position stays where it was first enqueued rather than hopping to the
  // back — the oldest genuinely stale write is what should be evicted,
  // not whichever one happened to fail most recently.
  const entries = new Map();

  function keyOf(collector, method, path) {
    return `${collector}|${method}|${path}`;
  }

  // Coalesces by (collector, method, path): a track patched five times
  // while the remote is down replays once, with the newest body. `attempts`
  // (and therefore backoff) is preserved across coalescing — the
  // underlying collector is still down, so a fresh write to the same
  // endpoint shouldn't reset how long we've been waiting.
  function enqueue({ collector, method, path, body }) {
    const key = keyOf(collector, method, path);
    const existing = entries.get(key);
    if (existing) {
      existing.body = body;
      existing.enqueuedAt = now();
      return { evicted: null };
    }

    let evicted = null;
    if (entries.size >= max) {
      const oldestKey = entries.keys().next().value;
      evicted = entries.get(oldestKey);
      entries.delete(oldestKey);
      logger.warn(`[collector-retry] buffer full (${max}) — evicted oldest entry for ${evicted.collector} ${evicted.method} ${evicted.path}`);
    }

    entries.set(key, { collector, method, path, body, attempts: 0, nextAttemptAt: now(), enqueuedAt: now() });
    return { evicted };
  }

  // Entries for `collector` (or all, if omitted) whose backoff window has
  // elapsed — what a retry tick should actually attempt right now.
  function dueEntries(collector) {
    const nowMs = now();
    return [...entries.values()].filter(
      e => (collector === undefined || e.collector === collector) && e.nextAttemptAt <= nowMs
    );
  }

  function recordAttemptResult(collector, method, path, success) {
    const key = keyOf(collector, method, path);
    const entry = entries.get(key);
    if (!entry) return;
    if (success) {
      entries.delete(key);
      return;
    }
    entry.attempts += 1;
    entry.nextAttemptAt = now() + Math.min(maxDelayMs, baseDelayMs * 2 ** entry.attempts);
  }

  // Track 10064 (REQ-11 Task 5): a token-source change means anything
  // queued was built against a stale (or absent) credential — replaying it
  // as-is would either fail again for the same reason or, worse, succeed
  // with a credential that's no longer this worker's own. Drop rather than
  // reattempt; the next real write will requeue with the current token.
  function clearForCollector(collector) {
    for (const [key, entry] of entries) {
      if (entry.collector === collector) entries.delete(key);
    }
  }

  function size() {
    return entries.size;
  }

  return { enqueue, dueEntries, recordAttemptResult, clearForCollector, size };
}
