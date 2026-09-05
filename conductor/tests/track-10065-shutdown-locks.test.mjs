#!/usr/bin/env node
// conductor/tests/track-10065-shutdown-locks.test.mjs
// Track 10065 Phase 4 (REQ-8, REQ-9, F4): shutdown() used to de-register the
// worker and exit without ever touching the per-track git locks THIS
// process itself holds. A worker stopped (deliberately, or via systemd
// restart) after its spawned CLI child had already exited left
// `.conductor/locks/<track>.lock` stamped with a PID about to be dead too,
// undispatchable until some later claim attempt happened to rediscover and
// clear it. releaseOwnLocksOnShutdown() (called from shutdown(), before
// removeWorker()) closes this: for each track this process's own
// runningTrackMap still tracks, a DEAD child's lock is released; a LIVE
// child's lock is deliberately left alone (the run genuinely isn't over —
// releasing it would let another worker claim a track still being worked
// on) and its run marker is stamped with worker_shutdown_at instead.
//
// This suite covers the cleanly-testable, non-racy, high-value case: a
// worker SIGTERMed while its spawned child is still genuinely alive (the
// exact track 10063 shape) must leave the lock in place and stamp the
// marker, and must still exit within its bounded shutdown deadline despite
// the extra sweep. The "tracked child already dead" release branch shares
// the identical own-pid/own-host dead-check pattern already exercised
// elsewhere in this codebase (track-10020-orphan-reconcile-periodic.test.mjs's
// TC-3.1/TC-3.4, and the orphan-reconcile lock-release block itself) — the
// exit handler deletes a pid from runningTrackMap synchronously at the very
// top of its own body, before yielding control back to the event loop, so
// the window where a dead child's pid is STILL present in runningTrackMap
// when a SIGTERM lands is a same-tick race, not a reliably reproducible
// integration scenario.
//
// Run: node --test conductor/tests/track-10065-shutdown-locks.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import os from 'node:os';
import { runMarkerPath, parseRunMarker } from '../services/run-marker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10065-shutdown-locks');

function sleepMs(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 15000, interval = 150, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleepMs(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

function startMockCollector() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(__dirname, 'mock-collector.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', d => {
      out += d.toString();
      const m = out.match(/MOCK_COLLECTOR_PORT=(\d+)/);
      if (m) resolve({ proc, port: parseInt(m[1]) });
    });
    proc.stderr.on('data', d => process.stderr.write(`[mock-collector] ${d}`));
    proc.on('error', reject);
    setTimeout(() => reject(new Error('mock-collector startup timeout')), 5000);
  });
}

async function enqueueDispatch(port, entry) {
  const r = await fetch(`http://127.0.0.1:${port}/_enqueue-dispatch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
  });
  return (await r.json()).id;
}

function primaryTrackDir(track) { return join(TMP, 'conductor/tracks', `${track}-test-track`); }

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execSync('git init -q', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: TMP });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: { implement: { parallel_limit: 1, max_retries: 1 } },
  }, null, 2));
}

describe('Track 10065 Phase 4: releaseOwnLocksOnShutdown', () => {
  it('TC-4.2: SIGTERM while the spawned child is still genuinely alive leaves the lock in place and stamps the run marker', async () => {
    const { proc: collectorProc, port: collectorPort } = await startMockCollector();
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);
    const track = '001';
    mkdirSync(primaryTrackDir(track), { recursive: true });
    writeFileSync(join(primaryTrackDir(track), 'index.md'), [
      '# Track primary copy', '', '**Lane**: implement', '**Lane Status**: queue', '**Progress**: 0%', '',
      '## Problem', 'Test problem.',
    ].join('\n'));

    const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_SKIP_GIT_LOCK: '1', // simplifies scaffolding — the lock file below is seeded by hand instead
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        MOCK_CLI_DELAY_MS: '8000', // must still be alive when we SIGTERM
        LC_DISPATCH_POLL_MS: '300',
        LC_SHUTDOWN_DEADLINE_MS: '2000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));

    let mockChildPid = null;
    try {
      const state0 = await poll(async () => {
        const s = await fetch(`http://127.0.0.1:${collectorPort}/_state`).then(r => r.json());
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registered' });
      const workerId = state0.workers[0].id;

      await enqueueDispatch(collectorPort, {
        worker_id: workerId, track_number: track, action: 'implement', status: 'pending',
      });

      await poll(async () => {
        const content = existsSync(join(primaryTrackDir(track), 'index.md')) ? readFileSync(join(primaryTrackDir(track), 'index.md'), 'utf8') : '';
        return /\*\*Lane Status\*\*:\s*running/i.test(content) ? true : null;
      }, { label: 'dispatch claimed and marked running' });

      const marker = parseRunMarker(readFileSync(runMarkerPath(TMP, track), 'utf8'));
      assert.ok(marker, 'sanity: a run marker must exist for the genuinely-running child');
      mockChildPid = marker.pid;

      // Seed the per-track lock as if checkAndClaimGitLock had claimed it —
      // stamped with the WORKER's own pid (never the child's), same shape
      // checkAndClaimGitLock itself writes.
      const lockPath = join(TMP, '.conductor', 'locks', `${track}.lock`);
      mkdirSync(dirname(lockPath), { recursive: true });
      writeFileSync(lockPath, JSON.stringify({
        user: 'test', machine: os.hostname(), pid: worker.pid,
        started_at: new Date().toISOString(), track_number: track,
      }));

      const sigtermSentAt = Date.now();
      const exited = new Promise(resolve => worker.on('exit', (code, signal) => resolve({ code, signal, at: Date.now() })));
      worker.kill('SIGTERM');
      const { at: exitedAt } = await exited;

      assert.ok(exitedAt - sigtermSentAt < 4000,
        `shutdown must stay bounded despite the lock sweep — took ${exitedAt - sigtermSentAt}ms`);

      assert.ok(existsSync(lockPath), 'the lock must NOT be released — the child was still genuinely alive at shutdown');
      const lockAfter = JSON.parse(readFileSync(lockPath, 'utf8'));
      assert.equal(lockAfter.pid, worker.pid, 'the lock itself must be untouched');

      const markerAfter = JSON.parse(readFileSync(runMarkerPath(TMP, track), 'utf8'));
      assert.ok(markerAfter.worker_shutdown_at, 'the run marker must be stamped so a replacement process can tell this was a deliberate shutdown mid-run');
    } finally {
      if (mockChildPid) { try { process.kill(mockChildPid, 'SIGKILL'); } catch { /* already gone */ } }
      try { worker.kill('SIGKILL'); } catch { /* already exited */ }
      collectorProc.kill();
      rmSync(TMP, { recursive: true, force: true });
    }
  });
});
