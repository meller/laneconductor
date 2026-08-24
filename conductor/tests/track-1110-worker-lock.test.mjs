#!/usr/bin/env node
// conductor/tests/track-1110-worker-lock.test.mjs
// Track 1110 Phase 2, Task 5: worker-lock.mjs's core exclusivity
// guarantee — at most one holder at a time, and a released/expired lock
// becomes acquirable again.
//
// Run: node --test conductor/tests/track-1110-worker-lock.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { acquireWorkerLock } from '../services/worker-lock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, '.test-tmp-worker-lock');
const FAKE_HOLDER = join(__dirname, 'fake-lock-holder.mjs');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForStdout(proc, marker, timeoutMs = 5000) {
  return new Promise((resolvePromise, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${marker}"`)), timeoutMs);
    proc.stdout.on('data', d => {
      buf += d;
      if (buf.includes(marker)) { clearTimeout(timer); resolvePromise(buf); }
    });
  });
}

describe('worker-lock.mjs', () => {
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('a second acquire fails while the first holder still has it', async () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    const lockPath = join(TMP, 'worker-1.lock-target');

    const release1 = await acquireWorkerLock(lockPath);
    assert.ok(release1, 'first acquire should succeed');

    const release2 = await acquireWorkerLock(lockPath);
    assert.equal(release2, null, 'second acquire should fail while the first is held');

    await release1();
  });

  it('releasing frees the lock for the next acquirer', async () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    const lockPath = join(TMP, 'worker-1.lock-target');

    const release1 = await acquireWorkerLock(lockPath);
    assert.ok(release1);
    await release1();

    const release2 = await acquireWorkerLock(lockPath);
    assert.ok(release2, 'lock should be acquirable again after release');
    await release2();
  });

  it('a lock whose holder PROCESS DIES becomes stealable once the stale window passes', async () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    const lockPath = join(TMP, 'worker-1.lock-target');
    const staleMs = 300;

    // Real death, not just "never call release()" — proper-lockfile
    // auto-refreshes the lock on a timer for as long as the CALLING
    // PROCESS is alive (this is what makes a live worker's lock never go
    // stale on its own). Within one process, an unreleased lock keeps
    // getting refreshed by that same timer, so it never actually goes
    // stale — only a real killed process stops the refresh. This test
    // exists because an earlier version tried "just don't call release()
    // in this test process" and incorrectly failed for exactly that
    // reason: it was still being refreshed the whole time.
    const holder = spawn('node', [FAKE_HOLDER, lockPath, String(staleMs)]);
    try {
      await waitForStdout(holder, 'LOCK_HELD');

      const tooSoon = await acquireWorkerLock(lockPath, { staleMs });
      assert.equal(tooSoon, null, 'should still be held while the holder process is alive');

      holder.kill('SIGKILL');
      await sleep(staleMs + 3000); // past the stale window, with generous margin

      const afterStale = await acquireWorkerLock(lockPath, { staleMs });
      assert.ok(afterStale, 'should be stealable once the stale window passes after the holder actually died');
      await afterStale();
    } finally {
      try { holder.kill('SIGKILL'); } catch { /* already gone */ }
    }
  });

  it('distinct lock paths do not interfere with each other', async () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    const lockA = join(TMP, 'worker-1.lock-target');
    const lockB = join(TMP, 'worker-2.lock-target');

    const releaseA = await acquireWorkerLock(lockA);
    const releaseB = await acquireWorkerLock(lockB);
    assert.ok(releaseA);
    assert.ok(releaseB, 'a different identity\'s lock must be independently acquirable');

    await releaseA();
    await releaseB();
  });

  describe('onCompromised handling (Track 1117 Bug 4)', () => {
    it('TC-11: a custom onCompromised fires with the underlying error, and no uncaughtException propagates, when the lock is compromised externally', async () => {
      rmSync(TMP, { recursive: true, force: true });
      mkdirSync(TMP, { recursive: true });
      const lockPath = join(TMP, 'worker-1.lock-target');
      const staleMs = 2000; // proper-lockfile's own minimum; update interval = staleMs/2 = 1000ms

      let compromisedErr = null;
      let uncaughtFired = false;
      const onUncaught = (err) => { uncaughtFired = true; };
      process.once('uncaughtException', onUncaught);

      const release = await acquireWorkerLock(lockPath, {
        staleMs,
        onCompromised: (err) => { compromisedErr = err; },
      });
      assert.ok(release, 'initial acquire should succeed');

      // Compromise it externally: proper-lockfile's lock marker is a
      // directory at `${lockPath}.lock` (confirmed in lockfile.js) — delete
      // it out from under the active hold so the next mtime-refresh tick
      // finds it gone (ENOENT) rather than touching lockPath itself.
      rmSync(`${lockPath}.lock`, { recursive: true, force: true });

      // Wait past one refresh interval (1000ms) with margin.
      await sleep(2000);

      process.removeListener('uncaughtException', onUncaught);

      assert.ok(compromisedErr, 'the injected onCompromised handler must have fired');
      assert.match(compromisedErr.message, /stale threshold|ENOENT|no such file/i);
      assert.equal(uncaughtFired, false, 'a handled compromise must not also propagate as an uncaughtException');
    });

    it('TC-12: normal acquisition/release is unaffected when onCompromised is supplied but never triggered', async () => {
      rmSync(TMP, { recursive: true, force: true });
      mkdirSync(TMP, { recursive: true });
      const lockPath = join(TMP, 'worker-1.lock-target');

      let compromisedFired = false;
      const release = await acquireWorkerLock(lockPath, {
        onCompromised: () => { compromisedFired = true; },
      });
      assert.ok(release, 'acquire should succeed exactly as without onCompromised');
      await sleep(200);
      await release();

      assert.equal(compromisedFired, false, 'the happy path must never invoke onCompromised');

      // And the lock must be normally re-acquirable afterward, same as the
      // no-onCompromised-supplied tests above.
      const release2 = await acquireWorkerLock(lockPath);
      assert.ok(release2);
      await release2();
    });

    it('TC-11 (regression, real process): the DEFAULT onCompromised handler exits cleanly with a dedicated log line, not an Uncaught Exception trace', async () => {
      rmSync(TMP, { recursive: true, force: true });
      mkdirSync(TMP, { recursive: true });
      const lockPath = join(TMP, 'worker-1.lock-target');
      const staleMs = 2000;

      const holder = spawn('node', [FAKE_HOLDER, lockPath, String(staleMs)]);
      let stdout = '';
      let stderr = '';
      holder.stdout.on('data', d => { stdout += d; });
      holder.stderr.on('data', d => { stderr += d; });

      try {
        await waitForStdout(holder, 'LOCK_HELD');
        rmSync(`${lockPath}.lock`, { recursive: true, force: true });

        const exitCode = await new Promise((resolvePromise) => {
          holder.on('exit', (code) => resolvePromise(code));
        });

        assert.equal(exitCode, 1, 'the default onCompromised handler exits with code 1');
        assert.match(stderr, /\[worker-lock\] Lock compromised/, 'must log the dedicated worker-lock line');
        assert.doesNotMatch(stderr, /Uncaught Exception/, 'must NOT fall through to a generic uncaught-exception crash trace');
      } finally {
        try { holder.kill('SIGKILL'); } catch { /* already gone */ }
      }
    });
  });
});
