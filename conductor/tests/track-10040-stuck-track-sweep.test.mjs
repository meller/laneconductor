// Track 10040 Phase 6 (REQ-5, Finding 2/3): phantom-running detection.

import { test } from 'node:test';
import assert from 'node:assert';
import { findPhantomRunningTracks, classifyPhantom } from '../services/stuck-track-sweep.mjs';

const GRACE = 5 * 60 * 1000;

test('TC-28 (AC-3): running, no live pid, no run marker, no DB claim, older than grace -> phantom', () => {
  const r = findPhantomRunningTracks({
    fsRunning: [{ trackNumber: '1', lane: 'implement', ageMs: GRACE + 1000, pid: 999 }],
    livePids: new Set(),
    runMarkerLive: {},
    dbClaims: new Set(),
    graceMs: GRACE,
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].trackNumber, '1');
});

test('TC-29: running with a LIVE pid -> not a phantom', () => {
  const r = findPhantomRunningTracks({
    fsRunning: [{ trackNumber: '1', lane: 'implement', ageMs: GRACE + 1000, pid: 999 }],
    livePids: new Set([999]),
    graceMs: GRACE,
  });
  assert.equal(r.length, 0);
});

test('TC-30: running with a live run marker (different process spawned it) -> not a phantom', () => {
  const r = findPhantomRunningTracks({
    fsRunning: [{ trackNumber: '1', lane: 'implement', ageMs: GRACE + 1000, pid: 999 }],
    livePids: new Set(),
    runMarkerLive: { '1': true },
    graceMs: GRACE,
  });
  assert.equal(r.length, 0);
});

test('TC-31: running with a live DB claim -> not a phantom', () => {
  const r = findPhantomRunningTracks({
    fsRunning: [{ trackNumber: '1', lane: 'implement', ageMs: GRACE + 1000, pid: 999 }],
    livePids: new Set(),
    dbClaims: new Set(['1']),
    graceMs: GRACE,
  });
  assert.equal(r.length, 0);
});

test('TC-32: running for less than the grace window -> not a phantom (claim->lock->worktree->spawn takes seconds)', () => {
  const r = findPhantomRunningTracks({
    fsRunning: [{ trackNumber: '1', lane: 'implement', ageMs: 1000, pid: 999 }],
    graceMs: GRACE,
  });
  assert.equal(r.length, 0);
});

test('TC-33: repeat phantom -> classifyPhantom returns escalate', () => {
  assert.equal(classifyPhantom({ seenBefore: true }).action, 'escalate');
});

test('first sighting -> classifyPhantom returns reconcile', () => {
  assert.equal(classifyPhantom({ seenBefore: false }).action, 'reconcile');
  assert.equal(classifyPhantom().action, 'reconcile');
});

test('multiple fsRunning entries — only the genuinely phantom one is returned', () => {
  const r = findPhantomRunningTracks({
    fsRunning: [
      { trackNumber: '1', lane: 'implement', ageMs: GRACE + 1, pid: 111 }, // live pid
      { trackNumber: '2', lane: 'review', ageMs: GRACE + 1, pid: 222 }, // phantom
      { trackNumber: '3', lane: 'plan', ageMs: 100, pid: 333 }, // too young
    ],
    livePids: new Set([111]),
    graceMs: GRACE,
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].trackNumber, '2');
});
