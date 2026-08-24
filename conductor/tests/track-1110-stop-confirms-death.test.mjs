#!/usr/bin/env node
// conductor/tests/track-1110-stop-confirms-death.test.mjs
// Track 1110 Phase 2, Task 1: reproduction proving `lc stop` reports
// success and deletes the pidfile BEFORE the worker process has actually
// exited — the precise mechanism behind the live duplicate-worker
// incident (see conductor/tracks/1110-*/plan.md's Phase 2 for the full
// trace: bin/lc.mjs's stop handler does `process.kill(pid)` — which only
// delivers SIGTERM, it does not wait — then immediately unlinks the
// pidfile and prints success, while laneconductor.sync.mjs's own SIGTERM
// handler can legitimately take up to ~10s (removeWorker()'s network
// call timeout) to actually call process.exit()).
//
// Run: node --test conductor/tests/track-1110-stop-confirms-death.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const FAKE_WORKER = join(__dirname, 'fake-slow-worker.mjs');
const LC = join(ROOT, 'bin/lc.mjs');
const TMP = join(ROOT, '.test-tmp-stop-confirms-death');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitForFile(path, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await sleep(50);
  }
  return false;
}

describe('Track 1110 Phase 2: lc stop must confirm death before reporting success', () => {
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('does not report success (or delete the pidfile) while the worker is still shutting down', async () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, 'conductor'), { recursive: true });
    writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
      mode: 'local-fs',
      project: { name: 'stop-test', id: 1, repo_path: TMP, primary: { cli: 'mock' } },
    }, null, 2));

    const pidFile = join(TMP, 'conductor', '.sync.pid');
    const SLOW_SHUTDOWN_MS = 2000;

    const fakeWorker = spawn('node', [FAKE_WORKER, pidFile, String(SLOW_SHUTDOWN_MS)], { stdio: 'ignore' });
    try {
      await waitForFile(pidFile);
      const fakePid = fakeWorker.pid;
      assert.ok(isAlive(fakePid), 'fake worker should be alive right after starting');

      // Async spawn, not spawnSync: a blocking spawnSync call here would
      // stall THIS process's event loop, which would prevent it from
      // reaping the fake worker (spawned async, above) the instant it
      // exits — leaving a zombie that kill(pid,0) reports as "alive" to
      // any process, including lc.mjs's own subprocess, regardless of
      // the real bug this test targets. Confirmed by hand: spawnSync here
      // produced a false "still alive" even against a fixed lc stop.
      const stopStart = Date.now();
      let stdout = '';
      const stopProc = spawn('node', [LC, 'stop'], { cwd: TMP });
      stopProc.stdout.on('data', d => { stdout += d; });
      await new Promise(resolvePromise => stopProc.on('close', resolvePromise));
      const stopElapsedMs = Date.now() - stopStart;

      // The bug: `lc stop` returns almost immediately (well under the
      // fake worker's 2s shutdown delay) because it never waits for the
      // signal to actually take effect.
      console.log(`[track-1110] lc stop returned after ${stopElapsedMs}ms (fake worker's shutdown takes ${SLOW_SHUTDOWN_MS}ms), stdout: ${stdout.trim()}`);

      // Desired behavior (post-fix): `lc stop` must not return claiming
      // success until the process is actually confirmed dead. Asserting
      // the CORRECT behavior here — expected to FAIL against today's
      // code (proving the bug) and PASS once Phase 2 Task 2 lands.
      assert.ok(
        stopElapsedMs >= SLOW_SHUTDOWN_MS,
        `lc stop returned in ${stopElapsedMs}ms, before the worker's ${SLOW_SHUTDOWN_MS}ms shutdown could complete — ` +
        `it reported success without confirming the process actually died`
      );
      assert.ok(
        !isAlive(fakePid),
        `lc stop reported success but the worker (pid ${fakePid}) is still alive`
      );
      assert.equal(
        existsSync(pidFile), false,
        'pidfile should only be removed once death is confirmed'
      );
    } finally {
      try { process.kill(fakeWorker.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  });
});
