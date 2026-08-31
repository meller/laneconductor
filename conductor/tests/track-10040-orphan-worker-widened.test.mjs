// Track 10040 Phase 6 (REQ-6, Finding 3): widen orphan-worker detection
// beyond "unregistered" — a registered worker with a deleted cwd or a
// stale heartbeat is also reaped. The real zombie (PID 1736711, ~17% CPU
// for 2 days against a deleted cwd) was invisible to the original rule
// because it HAD registered.

import { test } from 'node:test';
import assert from 'node:assert';
import { findOrphanedWorkerProcesses } from '../services/orphan-worker-detection.mjs';

const GRACE = 30 * 60 * 1000;
const STALE_HEARTBEAT = 5 * 60 * 1000;
const row = (pid, ageMs = GRACE + 1000) => [{ pid, ageMs, cmd: 'node laneconductor.sync.mjs' }];

test('TC-35 (AC-4): registered worker, fresh heartbeat, deleted cwd -> reaped', () => {
  const r = findOrphanedWorkerProcesses(row(1736711), {
    registeredWorkers: [{ pid: 1736711, last_heartbeat: new Date().toISOString() }],
    selfPid: 999,
    graceMs: GRACE,
    cwdExists: pid => pid !== 1736711, // this pid's cwd was deleted
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].pid, 1736711);
});

test('TC-36: registered worker, cwd exists, stale heartbeat -> reaped', () => {
  const staleHeartbeat = new Date(Date.now() - STALE_HEARTBEAT - 1000).toISOString();
  const r = findOrphanedWorkerProcesses(row(42), {
    registeredWorkers: [{ pid: 42, last_heartbeat: staleHeartbeat }],
    selfPid: 999,
    graceMs: GRACE,
    staleHeartbeatMs: STALE_HEARTBEAT,
    cwdExists: () => true,
  });
  assert.equal(r.length, 1);
});

test('TC-37: registered worker, cwd exists, fresh heartbeat -> NOT reaped', () => {
  const r = findOrphanedWorkerProcesses(row(42), {
    registeredWorkers: [{ pid: 42, last_heartbeat: new Date().toISOString() }],
    selfPid: 999,
    graceMs: GRACE,
    staleHeartbeatMs: STALE_HEARTBEAT,
    cwdExists: () => true,
  });
  assert.equal(r.length, 0);
});

test('TC-38: unregistered process older than grace -> still reaped (unchanged original rule)', () => {
  const r = findOrphanedWorkerProcesses(row(77), {
    registeredWorkers: [],
    selfPid: 999,
    graceMs: GRACE,
    cwdExists: () => true,
  });
  assert.equal(r.length, 1);
});

test('TC-39: the manager\'s own pid is never reaped, even matching every reap condition', () => {
  const r = findOrphanedWorkerProcesses(row(999), {
    registeredWorkers: [],
    selfPid: 999,
    graceMs: GRACE,
    cwdExists: () => false,
  });
  assert.equal(r.length, 0);
});

test('TC-40: any process younger than graceMs is never reaped, on every branch', () => {
  const young = [{ pid: 1, ageMs: 100, cmd: 'node laneconductor.sync.mjs' }];
  assert.equal(findOrphanedWorkerProcesses(young, { registeredWorkers: [], selfPid: 999, graceMs: GRACE }).length, 0);
  assert.equal(findOrphanedWorkerProcesses(young, { registeredWorkers: [{ pid: 1, last_heartbeat: '1970-01-01' }], selfPid: 999, graceMs: GRACE, staleHeartbeatMs: STALE_HEARTBEAT }).length, 0);
  assert.equal(findOrphanedWorkerProcesses(young, { registeredWorkers: [{ pid: 1 }], selfPid: 999, graceMs: GRACE, cwdExists: () => false }).length, 0);
});

test('backward compatible: legacy registeredPids Set shape reproduces the original behavior exactly', () => {
  const r1 = findOrphanedWorkerProcesses(row(1), { registeredPids: new Set(), selfPid: 999, graceMs: GRACE });
  assert.equal(r1.length, 1); // unregistered, old rule
  const r2 = findOrphanedWorkerProcesses(row(1), { registeredPids: new Set([1]), selfPid: 999, graceMs: GRACE });
  assert.equal(r2.length, 0); // registered, no widening probes given -> never touched, same as before this track
});
