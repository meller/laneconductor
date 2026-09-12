// Track AM-10093 Phase 1/4: pins the exit handler's producedByThisRun
// anchor to the run marker's dispatch_lane (REQ-4), and reproduces the
// scenario it closes (R3 in spec.md) via applyGuardedLaneWrite directly —
// the same pure guard the exit handler calls, driven with the exact
// inputs the anchor produces in each case.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyGuardedLaneWrite } from '../services/lane-regression-guard.mjs';
import { resolveDispatchLaneAnchor, buildRunMarker } from '../services/run-marker.mjs';

const SYNC_SRC = readFileSync(new URL('../laneconductor.sync.mjs', import.meta.url), 'utf8');

// ── resolveDispatchLaneAnchor's own contract ───────────────────────────────
test('resolveDispatchLaneAnchor prefers the marker\'s dispatch_lane when present', () => {
  const marker = { dispatch_lane: 'plan' };
  assert.equal(resolveDispatchLaneAnchor(marker, 'done'), 'plan');
});

test('TC-4.3: resolveDispatchLaneAnchor falls back to laneStatus when the marker is missing (older code, no marker)', () => {
  assert.equal(resolveDispatchLaneAnchor(null, 'done'), 'done');
});

test('TC-4.3: resolveDispatchLaneAnchor falls back when the marker exists but has no dispatch_lane (marker written by pre-AM-10093 code)', () => {
  const legacyMarker = { pid: 123, track_number: '10093', command: 'claude' };
  assert.equal(resolveDispatchLaneAnchor(legacyMarker, 'done'), 'done');
});

test('buildRunMarker records dispatch_lane and defaults to null when not passed (old call sites)', () => {
  const withLane = buildRunMarker({ pid: 1, pgid: 1, workerPid: 2, trackNumber: '10093', command: 'claude', dispatchLane: 'implement' });
  assert.equal(withLane.dispatch_lane, 'implement');
  const without = buildRunMarker({ pid: 1, pgid: 1, workerPid: 2, trackNumber: '10093', command: 'claude' });
  assert.equal(without.dispatch_lane, null);
});

// ── TC-1.5 / TC-4.1: the actual incident — anchor correctly blocks a run
// whose OWN pre-spawn write is what put the matching value on disk ────────
test('TC-1.5/TC-4.1: run dispatched for done, on-disk is done ONLY because this run\'s own pre-spawn write put it there, but the anchor says this run was dispatched for done and disk still reads plan (human wrote plan) — blocked', () => {
  // Simulates the anchored comparison directly: the run's dispatch_lane is
  // 'done' (this run WAS legitimately dispatched for the done lane), but a
  // human's index.md write landed 'plan' on disk before the exit handler's
  // read. producedByThisRun must be false: 'plan' (on disk) !== 'done'
  // (anchor) — the write is correctly refused regardless of what any
  // stale in-memory `laneStatus` variable might separately claim.
  const marker = { dispatch_lane: 'done' };
  const anchor = resolveDispatchLaneAnchor(marker, 'done');
  const r = applyGuardedLaneWrite('**Lane**: plan\n**Lane Status**: running\n', {
    intendedLane: 'done',
    intendedStatus: 'success',
    producedByThisRun: 'plan' === anchor, // preWriteOnDiskLane === dispatchLaneAnchor
    requireProducedForAnyChange: true,
  });
  assert.equal(r.blocked, true, 'a done-write must be blocked when the fresh on-disk lane does not match this run\'s own recorded dispatch lane');
});

// ── TC-4.2: normal, legitimate completion still transitions ───────────────
test('TC-4.2: run dispatched for plan, disk still reads plan, run succeeded — normal transition allowed', () => {
  const marker = { dispatch_lane: 'plan' };
  const anchor = resolveDispatchLaneAnchor(marker, 'plan');
  const r = applyGuardedLaneWrite('**Lane**: plan\n**Lane Status**: running\n', {
    intendedLane: 'plan', // same-lane status churn (queue->success) is not a regression
    intendedStatus: 'success',
    producedByThisRun: 'plan' === anchor,
    requireProducedForAnyChange: true,
  });
  assert.equal(r.blocked, false);
});

// ── TC-4.4: a legitimate backwards transition this run genuinely produced
// (review's on_failure -> implement:queue) must still be allowed ──────────
test('TC-4.4: review on_failure sending a track backward from review to implement is still allowed when the anchor matches', () => {
  const marker = { dispatch_lane: 'review' };
  const anchor = resolveDispatchLaneAnchor(marker, 'review');
  const r = applyGuardedLaneWrite('**Lane**: review\n**Lane Status**: running\n', {
    intendedLane: 'implement',
    intendedStatus: 'queue',
    producedByThisRun: 'review' === anchor,
    requireProducedForAnyChange: true,
  });
  assert.equal(r.blocked, false, 'review legitimately failing itself back to implement must not be blocked by the anchor change');
});

// ── Wiring pins ─────────────────────────────────────────────────────────
test('the exit handler anchors producedByThisRun to resolveDispatchLaneAnchor, not directly to laneStatus', () => {
  assert.ok(SYNC_SRC.includes('resolveDispatchLaneAnchor('), 'the exit handler must call resolveDispatchLaneAnchor');
  assert.ok(SYNC_SRC.includes('producedByThisRun: preWriteOnDiskLane === dispatchLaneAnchor'), 'the guard call must compare against the anchor, not the raw laneStatus variable');
});

test('spawnCli threads dispatchLane into buildRunMarker so the anchor has something to read', () => {
  assert.ok(SYNC_SRC.includes('dispatchLane: laneStatus'), 'the run marker must record this run\'s own dispatch-time lane');
});
