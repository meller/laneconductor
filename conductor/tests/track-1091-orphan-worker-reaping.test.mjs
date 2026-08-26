#!/usr/bin/env node
// conductor/tests/track-1091-orphan-worker-reaping.test.mjs
// Track 1091 Phase 7: detect and reap laneconductor.sync.mjs processes on
// this host that aren't any currently-registered worker. Distinct from
// Phase 6 (respawns a worker whose heartbeat went stale) — these never
// registered with the real collector at all, so a staleness check can't
// see them. See orphan-worker-detection.mjs's doc comment for the live
// incident (18 unregistered processes, 3 spinning at ~80% CPU for 13+
// hours against a deleted cwd) that motivated this phase.
//
// Run: node --test conductor/tests/track-1091-orphan-worker-reaping.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePsWorkerRows, findOrphanedWorkerProcesses } from '../services/orphan-worker-detection.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('parsePsWorkerRows', () => {
  it('parses pid/etimes/args lines and filters to laneconductor.sync.mjs only', () => {
    const psOutput = [
      '2592047   65126 node /home/meller/Code/laneconductor/conductor/laneconductor.sync.mjs --sync-only --worker-number 20002',
      '  12345      42 node /some/other/script.mjs',
      '2607345   64639 node /home/meller/Code/laneconductor/conductor/laneconductor.sync.mjs --sync-only',
    ].join('\n');
    const rows = parsePsWorkerRows(psOutput);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { pid: 2592047, ageMs: 65126000, cmd: 'node /home/meller/Code/laneconductor/conductor/laneconductor.sync.mjs --sync-only --worker-number 20002' });
    assert.equal(rows[1].pid, 2607345);
  });

  it('returns empty array for null/empty input', () => {
    assert.deepEqual(parsePsWorkerRows(''), []);
    assert.deepEqual(parsePsWorkerRows(null), []);
  });

  it('ignores malformed lines rather than throwing', () => {
    const rows = parsePsWorkerRows('not a valid ps line\n123 456 node laneconductor.sync.mjs ok');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].pid, 123);
  });
});

describe('findOrphanedWorkerProcesses', () => {
  const graceMs = 30 * 60 * 1000;
  const oldEnough = graceMs + 60000;

  it('reaps an old, unregistered process', () => {
    const rows = [{ pid: 111, ageMs: oldEnough, cmd: 'node laneconductor.sync.mjs --sync-only' }];
    const result = findOrphanedWorkerProcesses(rows, { registeredPids: new Set(), selfPid: 999, graceMs });
    assert.equal(result.length, 1);
    assert.equal(result[0].pid, 111);
  });

  it('does NOT reap a registered process even if old', () => {
    const rows = [{ pid: 111, ageMs: oldEnough, cmd: 'node laneconductor.sync.mjs --sync-only' }];
    const result = findOrphanedWorkerProcesses(rows, { registeredPids: new Set([111]), selfPid: 999, graceMs });
    assert.deepEqual(result, []);
  });

  it('does NOT reap an unregistered process younger than the grace period', () => {
    const rows = [{ pid: 111, ageMs: 5000, cmd: 'node laneconductor.sync.mjs --sync-only' }];
    const result = findOrphanedWorkerProcesses(rows, { registeredPids: new Set(), selfPid: 999, graceMs });
    assert.deepEqual(result, []);
  });

  it('never reaps its own pid, even if old and unregistered', () => {
    const rows = [{ pid: 999, ageMs: oldEnough, cmd: 'node laneconductor.sync.mjs --manager' }];
    const result = findOrphanedWorkerProcesses(rows, { registeredPids: new Set(), selfPid: 999, graceMs });
    assert.deepEqual(result, []);
  });

  it('handles a mixed fleet correctly in one pass', () => {
    const rows = [
      { pid: 1, ageMs: oldEnough, cmd: 'orphan, old' },       // reap
      { pid: 2, ageMs: 1000, cmd: 'orphan, young' },          // grace period
      { pid: 3, ageMs: oldEnough, cmd: 'registered, old' },   // registered
      { pid: 4, ageMs: oldEnough, cmd: 'self' },               // self
    ];
    const result = findOrphanedWorkerProcesses(rows, { registeredPids: new Set([3]), selfPid: 4, graceMs });
    assert.deepEqual(result.map(r => r.pid), [1]);
  });
});

describe('Track 1091 Phase 7: real orphaned process gets killed', () => {
  it('a real, unregistered, aged-past-grace laneconductor.sync.mjs process is identified and can be terminated', async () => {
    // Spawn a real worker process pointed at a project dir with no
    // .laneconductor.json / no collector reachable — it never registers,
    // exactly mirroring an orphaned test-harness process that outlived
    // its own mock collector.
    const TMP = join(ROOT, '.test-tmp-track-1091-orphan-reap');
    execSync(`rm -rf "${TMP}" && mkdir -p "${TMP}/conductor/tracks"`);

    const child = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: { ...process.env, LC_SKIP_GIT_LOCK: '1' },
      stdio: 'ignore',
    });
    const pid = child.pid;

    try {
      // Give it a moment to actually start running (not just fork).
      await sleep(500);
      assert.doesNotThrow(() => process.kill(pid, 0), 'spawned process should be alive before the reap check');

      // Real ps output, but with this test's own pid's age overridden —
      // we can't wait out a real 30-minute grace period, so exercise the
      // real ps-based lookup for correctness and inject an aged row for
      // the actual reap decision, same as the pure unit tests above but
      // against a real, live pid.
      const psOutput = execSync('ps -eo pid,etimes,args --no-headers', { encoding: 'utf8' });
      const rows = parsePsWorkerRows(psOutput);
      const realRow = rows.find(r => r.pid === pid);
      assert.ok(realRow, 'ps must actually see the spawned child as a laneconductor.sync.mjs process');

      const agedRow = { ...realRow, ageMs: 31 * 60 * 1000 };
      const orphans = findOrphanedWorkerProcesses([agedRow], {
        registeredPids: new Set(), // never registered — no real collector reachable
        selfPid: process.pid,
        graceMs: 30 * 60 * 1000,
      });
      assert.equal(orphans.length, 1);
      assert.equal(orphans[0].pid, pid);

      process.kill(pid, 'SIGTERM');
      await sleep(500);
      assert.throws(() => process.kill(pid, 0), 'process must actually be dead after reaping');
    } finally {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
      execSync(`rm -rf "${TMP}"`);
    }
  });

  it('a process still within its grace period is never flagged, even with zero registered workers', async () => {
    const TMP = join(ROOT, '.test-tmp-track-1091-orphan-reap-2');
    execSync(`rm -rf "${TMP}" && mkdir -p "${TMP}/conductor/tracks"`);

    const child = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: { ...process.env, LC_SKIP_GIT_LOCK: '1' },
      stdio: 'ignore',
    });
    const pid = child.pid;

    try {
      await sleep(500);
      const psOutput = execSync('ps -eo pid,etimes,args --no-headers', { encoding: 'utf8' });
      const rows = parsePsWorkerRows(psOutput);
      const realRow = rows.find(r => r.pid === pid);
      assert.ok(realRow, 'ps must see the freshly-spawned child');

      const orphans = findOrphanedWorkerProcesses([realRow], {
        registeredPids: new Set(),
        selfPid: process.pid,
        graceMs: 30 * 60 * 1000,
      });
      assert.deepEqual(orphans, [], 'a process seconds old must never be reaped regardless of registration state');
    } finally {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
      execSync(`rm -rf "${TMP}"`);
    }
  });
});
