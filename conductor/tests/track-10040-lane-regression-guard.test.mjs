// Track 10040 Phase 2 (REQ-12, Finding 4): a worker must never write a
// track's Lane/Lane Status backwards past a terminal state it did not
// itself produce. Confirmed live: a stale-code worker overwrote track
// 10036's own done:queue back to implement:success.

import { test } from 'node:test';
import assert from 'node:assert';
import { shouldBlockLaneWrite, LANE_ORDER } from '../services/lane-regression-guard.mjs';

test('TC-65 (AC-11 core): done -> implement, not produced by this run, is blocked', () => {
  const r = shouldBlockLaneWrite({
    onDiskLane: 'done', intendedLane: 'implement', producedByThisRun: false,
  });
  assert.equal(r.blocked, true);
});

test('TC-66: done -> implement, even IF producedByThisRun, is still blocked (done is terminal)', () => {
  const r = shouldBlockLaneWrite({
    onDiskLane: 'done', intendedLane: 'implement', producedByThisRun: true,
  });
  assert.equal(r.blocked, true);
});

test('TC-67: review -> implement:queue with producedByThisRun is a legitimate on_failure, not blocked', () => {
  const r = shouldBlockLaneWrite({
    onDiskLane: 'review', intendedLane: 'implement', producedByThisRun: true,
  });
  assert.equal(r.blocked, false);
});

test('TC-68: quality-gate -> plan:queue with producedByThisRun is a legitimate on_failure, not blocked', () => {
  const r = shouldBlockLaneWrite({
    onDiskLane: 'quality-gate', intendedLane: 'plan', producedByThisRun: true,
  });
  assert.equal(r.blocked, false);
});

test('TC-69: review -> implement:queue WITHOUT producedByThisRun is blocked (same transition, different author)', () => {
  const r = shouldBlockLaneWrite({
    onDiskLane: 'review', intendedLane: 'implement', producedByThisRun: false,
  });
  assert.equal(r.blocked, true);
});

test('TC-70: same-lane status churn is never blocked', () => {
  for (const [onDiskLane, intendedLane] of [['implement', 'implement'], ['implement', 'implement'], ['implement', 'implement']]) {
    const r = shouldBlockLaneWrite({ onDiskLane, intendedLane, producedByThisRun: false });
    assert.equal(r.blocked, false);
  }
});

test('TC-71: forward moves are never blocked', () => {
  assert.equal(shouldBlockLaneWrite({ onDiskLane: 'plan', intendedLane: 'implement', producedByThisRun: false }).blocked, false);
  assert.equal(shouldBlockLaneWrite({ onDiskLane: 'quality-gate', intendedLane: 'done', producedByThisRun: false }).blocked, false);
});

test('TC-72: unknown lane name on either side fails closed (blocked), never rank 0', () => {
  assert.equal(shouldBlockLaneWrite({ onDiskLane: 'bogus-lane', intendedLane: 'implement', producedByThisRun: false }).blocked, true);
  assert.equal(shouldBlockLaneWrite({ onDiskLane: 'implement', intendedLane: 'bogus-lane', producedByThisRun: false }).blocked, true);
  const r = shouldBlockLaneWrite({ onDiskLane: 'bogus-lane', intendedLane: 'implement', producedByThisRun: false });
  assert.ok(r.reason, 'must carry a reason');
});

test('LANE_ORDER is the documented rank order', () => {
  assert.deepEqual(LANE_ORDER, ['backlog', 'plan', 'implement', 'review', 'quality-gate', 'done']);
});
