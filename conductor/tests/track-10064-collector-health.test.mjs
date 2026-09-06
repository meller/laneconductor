// conductor/tests/track-10064-collector-health.test.mjs
// Track 10064 Phase 3 (REQ-7/REQ-8/REQ-9): pure unit tests for the
// escalation/throttle/health-tracking logic — no process spawn needed.
//
// This is the direct regression test for the incident's actual symptom:
// 560 consecutive identical `[collector-1] write failed: 401` lines with no
// counter, no escalation, and nothing reaching the heartbeat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollectorHealthTracker } from '../services/collector-health.mjs';

function fakeLogger() {
  const calls = { log: [], warn: [], error: [] };
  return {
    calls,
    log: (...a) => calls.log.push(a),
    warn: (...a) => calls.warn.push(a),
    error: (...a) => calls.error.push(a),
  };
}

test('TC-13: a single failure logs at warn, not error, and sets consecutive_failures to 1', () => {
  const logger = fakeLogger();
  const tracker = createCollectorHealthTracker({ threshold: 5, logIntervalMs: 60000, logger });
  const outcome = tracker.recordFailure('https://c1', new Error('401 unauthorized'));
  assert.equal(outcome, 'warned');
  assert.equal(logger.calls.warn.length, 1);
  assert.equal(logger.calls.error.length, 0);
  assert.equal(tracker.getEntry('https://c1').consecutive_failures, 1);
});

test('TC-14: exactly one escalated `error` line at the threshold, not before', () => {
  const logger = fakeLogger();
  const tracker = createCollectorHealthTracker({ threshold: 5, logIntervalMs: 60000, logger });
  const outcomes = [];
  for (let i = 0; i < 5; i++) outcomes.push(tracker.recordFailure('https://c1', new Error('401')));
  assert.deepEqual(outcomes, ['warned', 'warned', 'warned', 'warned', 'escalated']);
  assert.equal(logger.calls.warn.length, 4);
  assert.equal(logger.calls.error.length, 1);
});

test('TC-15: this is the direct regression test for the 560-line flood — 100 consecutive failures past threshold produce exactly ONE escalated line, not 96', () => {
  const logger = fakeLogger();
  let clock = 0;
  const tracker = createCollectorHealthTracker({ threshold: 5, logIntervalMs: 60000, now: () => clock, logger });
  const outcomes = [];
  for (let i = 0; i < 100; i++) outcomes.push(tracker.recordFailure('https://c1', new Error('401 unauthorized: missing token')));
  assert.equal(outcomes.filter(o => o === 'escalated').length, 1, 'exactly one escalation for 100 failures within the throttle window — this is what "560 identical lines" must never happen again means');
  assert.equal(outcomes.filter(o => o === 'throttled').length, 100 - 4 - 1);
  assert.equal(logger.calls.error.length, 1);
  assert.equal(tracker.getEntry('https://c1').consecutive_failures, 100);
});

test('a second escalation fires once the throttle interval elapses', () => {
  const logger = fakeLogger();
  let clock = 0;
  const tracker = createCollectorHealthTracker({ threshold: 5, logIntervalMs: 60000, now: () => clock, logger });
  for (let i = 0; i < 5; i++) tracker.recordFailure('https://c1', new Error('401'));
  assert.equal(logger.calls.error.length, 1);
  clock += 60001;
  const outcome = tracker.recordFailure('https://c1', new Error('401'));
  assert.equal(outcome, 'escalated');
  assert.equal(logger.calls.error.length, 2);
});

test('TC-16: a success after failures logs one recovery line and resets consecutive_failures and last_success_at', () => {
  const logger = fakeLogger();
  const tracker = createCollectorHealthTracker({ threshold: 5, logIntervalMs: 60000, logger });
  for (let i = 0; i < 6; i++) tracker.recordFailure('https://c1', new Error('401'));
  tracker.recordSuccess('https://c1');
  const entry = tracker.getEntry('https://c1');
  assert.equal(entry.consecutive_failures, 0);
  assert.equal(entry.last_error, null);
  assert.equal(entry.last_error_status, null);
  assert.ok(entry.last_success_at);
  assert.equal(logger.calls.log.length, 1);
});

test('a success with no prior failures logs nothing (not every heartbeat should print a line)', () => {
  const logger = fakeLogger();
  const tracker = createCollectorHealthTracker({ threshold: 5, logIntervalMs: 60000, logger });
  tracker.recordSuccess('https://c1');
  assert.equal(logger.calls.log.length, 0);
});

test('TC-17: collector 0 (the primary, awaited collector) is tracked identically to collectors 1..n', () => {
  const tracker = createCollectorHealthTracker({ threshold: 5, logIntervalMs: 60000, logger: fakeLogger() });
  tracker.recordFailure('https://primary', new Error('500 internal error'));
  const entry = tracker.getEntry('https://primary');
  assert.equal(entry.attempts, 1);
  assert.equal(entry.consecutive_failures, 1);
});

test('recordFailure captures a structured HTTP status when the error carries one', () => {
  const tracker = createCollectorHealthTracker({ threshold: 5, logIntervalMs: 60000, logger: fakeLogger() });
  const err = new Error('401 {"error":"unauthorized: missing token"}');
  err.status = 401;
  tracker.recordFailure('https://c1', err);
  assert.equal(tracker.getEntry('https://c1').last_error_status, 401);
});

test('serialize() returns undefined when nothing has been tracked yet (REQ-9: omitted, not an empty object)', () => {
  const tracker = createCollectorHealthTracker({ logger: fakeLogger() });
  assert.equal(tracker.serialize(), undefined);
});

test('TC-18/TC-19 shape: serialize() returns a plain object keyed by collector URL, suitable for JSON in a register/heartbeat payload', () => {
  const tracker = createCollectorHealthTracker({ threshold: 5, logIntervalMs: 60000, logger: fakeLogger() });
  tracker.recordTokenSource('https://c0', 'machine_token (own)');
  tracker.recordSuccess('https://c0');
  tracker.recordTokenSource('https://c1', 'env COLLECTOR_1_TOKEN');
  const err = new Error('401 unauthorized: missing token');
  err.status = 401;
  tracker.recordFailure('https://c1', err);

  const snapshot = tracker.serialize();
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot, 'must be JSON-safe (no Map, no functions)');
  assert.equal(snapshot['https://c0'].token_source, 'machine_token (own)');
  assert.equal(snapshot['https://c1'].token_source, 'env COLLECTOR_1_TOKEN');
  assert.equal(snapshot['https://c1'].consecutive_failures, 1);
  assert.equal(snapshot['https://c1'].last_error_status, 401);
});
