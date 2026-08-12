#!/usr/bin/env node
// conductor/tests/track-1110-lc-start-lock.test.mjs
// Track 1110 Phase 2, Task 8: end-to-end — `lc worker start` itself,
// not just worker-lock.mjs in isolation, refuses to spawn a live
// duplicate for the same identity, including when a pidfile-based race
// alone wouldn't have caught it (two near-simultaneous invocations,
// neither of which sees the other's pidfile yet).
//
// Run: node --test conductor/tests/track-1110-lc-start-lock.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const LC = join(ROOT, 'bin/lc.mjs');
const TMP = join(ROOT, '.test-tmp-lc-start-lock');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function setupProject() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'lc-start-lock-test', id: 1, repo_path: TMP, primary: { cli: 'mock' } },
  }, null, 2));
}

function runLcStart(env = {}) {
  return new Promise(resolvePromise => {
    let stdout = '';
    const proc = spawn('node', [LC, 'start'], {
      cwd: TMP,
      env: { ...process.env, ...env },
    });
    proc.stdout.on('data', d => { stdout += d; });
    proc.on('close', code => resolvePromise({ code, stdout }));
  });
}

function runLcStop() {
  return new Promise(resolvePromise => {
    const proc = spawn('node', [LC, 'stop'], { cwd: TMP });
    proc.on('close', code => resolvePromise(code));
  });
}

describe('Track 1110 Phase 2 Task 8: lc worker start end-to-end lock behavior', () => {
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('two near-simultaneous `lc start` invocations for the same identity produce exactly one live process', async () => {
    setupProject();

    // Launched together (Promise.all), not sequentially — the point is
    // that neither invocation's own pidfile pre-check (which only looks
    // at whatever pidfile already exists on disk) can see the other yet,
    // so this specifically exercises the lock, not the earlier pidfile
    // fast-path that already existed before this track.
    const [resultA, resultB] = await Promise.all([runLcStart(), runLcStart()]);

    const successes = [resultA, resultB].filter(r => r.code === 0);
    const failures = [resultA, resultB].filter(r => r.code !== 0);
    assert.equal(successes.length, 1, `expected exactly one success, got ${successes.length} (A: code=${resultA.code} "${resultA.stdout.trim()}", B: code=${resultB.code} "${resultB.stdout.trim()}")`);
    assert.equal(failures.length, 1);

    const pidFile = join(TMP, 'conductor/.sync.pid');
    assert.ok(existsSync(pidFile), 'the successful invocation should have written a pidfile');
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    assert.ok(isAlive(pid), 'the pidfile\'s pid should be a real live process');

    await runLcStop();
    await sleep(300);
  });

  it('after SIGKILLing the holder, a start attempt still fails until the lock\'s stale window passes, then succeeds', async () => {
    setupProject();
    const STALE_MS = 1000;

    const first = await runLcStart({ LC_WORKER_LOCK_STALE_MS: String(STALE_MS) });
    assert.equal(first.code, 0, `first start should succeed: ${first.stdout}`);
    const pidFile = join(TMP, 'conductor/.sync.pid');
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    assert.ok(isAlive(pid));

    process.kill(pid, 'SIGKILL');
    await sleep(300); // give the OS a moment to reap; well under the 1000ms stale window

    // Honest consequence of choosing proper-lockfile over true kernel
    // flock (see worker-lock.mjs's own comment): a SIGKILL'd holder's
    // lock is not released instantly — it only becomes stealable once
    // the stale window elapses. Immediately after the kill, a new start
    // is expected to still be refused.
    rmSync(pidFile, { force: true }); // simulate the pidfile having gone stale/lost, forcing reliance on the lock
    const tooSoon = await runLcStart({ LC_WORKER_LOCK_STALE_MS: String(STALE_MS) });
    assert.notEqual(tooSoon.code, 0, `expected start to still fail immediately after SIGKILL (lock not yet stale): ${tooSoon.stdout}`);

    await sleep(STALE_MS + 500); // past the stale window
    const afterStale = await runLcStart({ LC_WORKER_LOCK_STALE_MS: String(STALE_MS) });
    assert.equal(afterStale.code, 0, `expected start to succeed once the stale window passed: ${afterStale.stdout}`);

    await runLcStop();
    await sleep(300);
  });
});
