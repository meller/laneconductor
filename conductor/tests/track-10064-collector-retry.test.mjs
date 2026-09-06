// conductor/tests/track-10064-collector-retry.test.mjs
// Track 10064 Phase 5 (REQ-11): pure unit tests for the bounded, coalescing
// retry buffer — no process spawn needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollectorRetryBuffer } from '../services/collector-retry-buffer.mjs';

function fakeLogger() {
  const calls = { warn: [] };
  return { calls, warn: (...a) => calls.warn.push(a) };
}

test('TC-27: a failed write becomes due immediately and clears on a successful retry', () => {
  let clock = 0;
  const buf = createCollectorRetryBuffer({ now: () => clock, logger: fakeLogger() });
  buf.enqueue({ collector: 'https://c1', method: 'PATCH', path: '/track/10064/action', body: { progress: 10 } });
  assert.equal(buf.size(), 1);
  assert.equal(buf.dueEntries('https://c1').length, 1);

  buf.recordAttemptResult('https://c1', 'PATCH', '/track/10064/action', true);
  assert.equal(buf.size(), 0);
  assert.equal(buf.dueEntries('https://c1').length, 0);
});

test('TC-28: five patches to the same (collector, method, path) while down coalesce into one entry carrying the newest body', () => {
  const buf = createCollectorRetryBuffer({ logger: fakeLogger() });
  for (let i = 1; i <= 5; i++) {
    buf.enqueue({ collector: 'https://c1', method: 'PATCH', path: '/track/10064/action', body: { progress: i * 10 } });
  }
  assert.equal(buf.size(), 1);
  const [entry] = buf.dueEntries('https://c1');
  assert.deepEqual(entry.body, { progress: 50 });
});

test('TC-29: the buffer stops at LC_COLLECTOR_RETRY_MAX and logs the eviction of the oldest entry', () => {
  const logger = fakeLogger();
  const buf = createCollectorRetryBuffer({ max: 3, logger });
  const r1 = buf.enqueue({ collector: 'https://c1', method: 'PATCH', path: '/track/1/action', body: {} });
  const r2 = buf.enqueue({ collector: 'https://c1', method: 'PATCH', path: '/track/2/action', body: {} });
  const r3 = buf.enqueue({ collector: 'https://c1', method: 'PATCH', path: '/track/3/action', body: {} });
  assert.equal(r1.evicted, null);
  assert.equal(r2.evicted, null);
  assert.equal(r3.evicted, null);
  assert.equal(buf.size(), 3);

  const r4 = buf.enqueue({ collector: 'https://c1', method: 'PATCH', path: '/track/4/action', body: {} });
  assert.equal(buf.size(), 3, 'bounded — must not grow past max');
  assert.ok(r4.evicted, 'the 4th distinct entry must evict the oldest');
  assert.equal(r4.evicted.path, '/track/1/action', 'oldest (first-enqueued) entry is evicted');
  assert.equal(logger.calls.warn.length, 1);

  // The oldest survivor is now /track/2 — never re-appears after a second eviction.
  buf.enqueue({ collector: 'https://c1', method: 'PATCH', path: '/track/5/action', body: {} });
  const paths = buf.dueEntries('https://c1').map(e => e.path).sort();
  assert.deepEqual(paths, ['/track/3/action', '/track/4/action', '/track/5/action']);
});

test('TC-30: a token-source change (clearForCollector) drops queued entries for that collector without replaying them', () => {
  const buf = createCollectorRetryBuffer({ logger: fakeLogger() });
  buf.enqueue({ collector: 'https://c1', method: 'PATCH', path: '/track/1/action', body: {} });
  buf.enqueue({ collector: 'https://c2', method: 'PATCH', path: '/track/2/action', body: {} });
  buf.clearForCollector('https://c1');
  assert.equal(buf.size(), 1);
  assert.equal(buf.dueEntries('https://c1').length, 0);
  assert.equal(buf.dueEntries('https://c2').length, 1, 'a different collector must be unaffected');
});

test('exponential backoff: a repeatedly-failing entry is not due again until its window elapses, and the window grows', () => {
  let clock = 0;
  const buf = createCollectorRetryBuffer({ now: () => clock, baseDelayMs: 1000, maxDelayMs: 60000, logger: fakeLogger() });
  buf.enqueue({ collector: 'https://c1', method: 'PATCH', path: '/track/1/action', body: {} });

  buf.recordAttemptResult('https://c1', 'PATCH', '/track/1/action', false); // attempt 1 -> next in 2000ms
  assert.equal(buf.dueEntries('https://c1').length, 0);
  clock += 1999;
  assert.equal(buf.dueEntries('https://c1').length, 0);
  clock += 2;
  assert.equal(buf.dueEntries('https://c1').length, 1);

  buf.recordAttemptResult('https://c1', 'PATCH', '/track/1/action', false); // attempt 2 -> next in 4000ms
  clock += 3999;
  assert.equal(buf.dueEntries('https://c1').length, 0);
  clock += 2;
  assert.equal(buf.dueEntries('https://c1').length, 1);
});

test('backoff is capped at maxDelayMs', () => {
  let clock = 0;
  const buf = createCollectorRetryBuffer({ now: () => clock, baseDelayMs: 1000, maxDelayMs: 5000, logger: fakeLogger() });
  buf.enqueue({ collector: 'https://c1', method: 'PATCH', path: '/track/1/action', body: {} });
  for (let i = 0; i < 10; i++) buf.recordAttemptResult('https://c1', 'PATCH', '/track/1/action', false);
  clock += 4999;
  assert.equal(buf.dueEntries('https://c1').length, 0);
  clock += 2;
  assert.equal(buf.dueEntries('https://c1').length, 1);
});

test('coalescing preserves attempts/backoff state — a fresh write to a still-down collector does not reset the wait', () => {
  let clock = 0;
  const buf = createCollectorRetryBuffer({ now: () => clock, baseDelayMs: 1000, maxDelayMs: 60000, logger: fakeLogger() });
  buf.enqueue({ collector: 'https://c1', method: 'PATCH', path: '/track/1/action', body: { v: 1 } });
  buf.recordAttemptResult('https://c1', 'PATCH', '/track/1/action', false); // next due at clock+2000
  clock += 500;
  buf.enqueue({ collector: 'https://c1', method: 'PATCH', path: '/track/1/action', body: { v: 2 } }); // coalesce
  clock += 1000; // total elapsed 1500ms since first failure — still short of the 2000ms window
  assert.equal(buf.dueEntries('https://c1').length, 0);
  clock += 501; // now past the 2000ms window
  assert.equal(buf.dueEntries('https://c1')[0].body.v, 2, 'coalesced body must be the newest one');
});
