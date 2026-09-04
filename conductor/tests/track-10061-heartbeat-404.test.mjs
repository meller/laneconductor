#!/usr/bin/env node
// conductor/tests/track-10061-heartbeat-404.test.mjs
// Track 10061 Phase 3: the heartbeat error path no longer conflates a 404
// (this collector doesn't implement this route) with a 401 (this worker's
// token/record is gone). Real worker process (via
// conductor/tests/helpers/isolated-worker.mjs), real mock collector
// (conductor/tests/mock-target.mjs).
//
// TC-20 (get/post/patch/del attach err.status/err.body) is exercised
// indirectly by every test below — the heartbeat path only branches
// correctly at all if that structural status is actually present. A direct
// unit test would need to import laneconductor.sync.mjs's get/post/patch/del,
// none of which are exported (it's a script, not a library) — see this
// file's Phase 2 sibling for the same reasoning about getOwnCollectorCalls.
//
// Run: node --test conductor/tests/track-10061-heartbeat-404.test.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox, cleanupSandbox, startIsolatedWorker, stopWorker } from './helpers/isolated-worker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
process.env.LC_TEST_REPO_ROOT = repoRoot; // see track-10061-handshake-e2e.test.mjs's identical note

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function poll(fn, { timeout = 10000, interval = 200 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)`);
}

function startMockCollector() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(__dirname, 'mock-target.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d.toString();
      const m = out.match(/MOCK_COLLECTOR_PORT=(\d+)/);
      if (m) resolve({ proc, port: parseInt(m[1]) });
    });
    proc.stderr.on('data', (d) => process.stderr.write(`[mock-target] ${d}`));
    proc.on('error', reject);
    setTimeout(() => reject(new Error('mock-target startup timeout')), 5000);
  });
}

async function getState(port) {
  const r = await fetch(`http://127.0.0.1:${port}/_state`);
  return r.json();
}

async function post(port, path, body = {}) {
  await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Track 10061 Phase 3: heartbeat 404 disambiguation', () => {
  let mock;
  let sandbox;
  let worker;

  before(async () => {
    mock = await startMockCollector();
  });

  after(async () => {
    if (mock) mock.proc.kill();
  });

  beforeEach(async () => {
    sandbox = makeSandbox('heartbeat404');
    await post(mock.port, '/_reset');
  });

  async function teardownWorker() {
    if (worker) await stopWorker(worker);
    worker = null;
    cleanupSandbox(sandbox);
  }

  // A short heartbeat interval is what makes these tests fast without
  // waiting out the 10s production default.
  const FAST_HEARTBEAT_ENV = { LC_HEARTBEAT_INTERVAL_MS: '1000' };

  it('TC-21: a 404 whose manifest OMITS the heartbeat route warns and does not re-register', async () => {
    await post(mock.port, '/_set-health', { omit: ['PATCH /worker/heartbeat'] });
    try {
      worker = await startIsolatedWorker({ sandbox, collectorPort: mock.port, args: ['--sync-only'], env: FAST_HEARTBEAT_ENV });
      await poll(async () => (await getState(mock.port)).workers.length > 0);
      const registerCountAfterStartup = (await getState(mock.port)).workers.length;

      await post(mock.port, '/_set-heartbeat-404', { fail: true });
      // Let a few heartbeat cycles pass — the bug this track fixes is an
      // infinite re-register loop, so several cycles is the meaningful
      // window, not just one.
      await sleep(3500);

      const state = await getState(mock.port);
      assert.equal(state.workers.length, registerCountAfterStartup, 'a missing-route 404 must NOT trigger re-registration');
      assert.ok(
        worker.getOutput().includes('route not implemented by this collector'),
        'expected a missing-route warning naming the heartbeat route',
      );
    } finally {
      await teardownWorker();
    }
  });

  it('TC-22: a 404 whose manifest INCLUDES the heartbeat route (genuinely deleted worker) still re-registers', async () => {
    // Default health manifest (no omit) reports every route the worker
    // calls, including PATCH /worker/heartbeat — the "route exists, this
    // really is a deleted worker record" case.
    try {
      worker = await startIsolatedWorker({ sandbox, collectorPort: mock.port, args: ['--sync-only'], env: FAST_HEARTBEAT_ENV });
      await poll(async () => (await getState(mock.port)).workers.length > 0);
      const registerCountAfterStartup = (await getState(mock.port)).workers.length;

      await post(mock.port, '/_set-heartbeat-404', { fail: true });
      await poll(async () => (await getState(mock.port)).workers.length > registerCountAfterStartup, { timeout: 8000 });

      const state = await getState(mock.port);
      assert.ok(state.workers.length > registerCountAfterStartup, 'expected re-registration when the manifest confirms the route IS served');
    } finally {
      await teardownWorker();
    }
  });

  it('TC-23: a 401 always re-registers, unchanged from before this track', async () => {
    try {
      worker = await startIsolatedWorker({ sandbox, collectorPort: mock.port, args: ['--sync-only'], env: FAST_HEARTBEAT_ENV });
      await poll(async () => (await getState(mock.port)).workers.length > 0);
      const registerCountAfterStartup = (await getState(mock.port)).workers.length;

      await post(mock.port, '/_set-heartbeat-401', { fail: true });
      await poll(async () => (await getState(mock.port)).workers.length > registerCountAfterStartup, { timeout: 8000 });

      const state = await getState(mock.port);
      assert.ok(state.workers.length > registerCountAfterStartup);
    } finally {
      await teardownWorker();
    }
  });

  it('TC-24: a 200 response whose body merely contains "404" never triggers re-registration', async () => {
    await post(mock.port, '/_set-heartbeat-200-with-404-text', { enable: true });
    try {
      worker = await startIsolatedWorker({ sandbox, collectorPort: mock.port, args: ['--sync-only'], env: FAST_HEARTBEAT_ENV });
      await poll(async () => (await getState(mock.port)).workers.length > 0);
      const registerCountAfterStartup = (await getState(mock.port)).workers.length;

      await sleep(3000); // several real 200-with-"404"-in-body heartbeats

      const state = await getState(mock.port);
      assert.equal(
        state.workers.length, registerCountAfterStartup,
        'a 200 response must never trigger re-registration just because its body text contains "404"',
      );
      assert.ok(state.heartbeatCount >= 2, 'expected multiple real heartbeats to have gone through during the wait');
    } finally {
      await teardownWorker();
    }
  });

  it('TC-25: repeated 404s with NO usable manifest are bounded, not infinite', async () => {
    // A collector whose own /health is unreachable (404) has no manifest to
    // consult at all — the D6.3 cap is what has to bound this, not the
    // missing-route check (there's no manifest to say the route is missing).
    await post(mock.port, '/_set-health', { mode: '404' });
    try {
      worker = await startIsolatedWorker({
        sandbox, collectorPort: mock.port, args: ['--sync-only'],
        env: { LC_HEARTBEAT_INTERVAL_MS: '400', LC_MAX_REREGISTER_ATTEMPTS: '3' },
      });
      await poll(async () => (await getState(mock.port)).workers.length > 0);

      await post(mock.port, '/_set-heartbeat-404', { fail: true });
      // Enough cycles that an unbounded loop would have registered many,
      // many more times than the cap allows.
      await sleep(4000);

      const state = await getState(mock.port);
      // 1 (startup) + at most 3 (the cap) = at most 4 total.
      assert.ok(state.workers.length <= 4, `expected re-registration to be bounded (<=4), got ${state.workers.length}`);
      assert.ok(
        worker.getOutput().includes('re-register cap'),
        'expected a single cap-reached warning once the bound was hit',
      );
    } finally {
      await teardownWorker();
    }
  });

  it('TC-26: a successful handshake after the cap resets the counter', async () => {
    await post(mock.port, '/_set-health', { mode: '404' });
    try {
      worker = await startIsolatedWorker({
        sandbox, collectorPort: mock.port, args: ['--sync-only'],
        env: { LC_HEARTBEAT_INTERVAL_MS: '400', LC_MAX_REREGISTER_ATTEMPTS: '2', LC_HANDSHAKE_INTERVAL_MS: '1500' },
      });
      await poll(async () => (await getState(mock.port)).workers.length > 0);

      await post(mock.port, '/_set-heartbeat-404', { fail: true });
      await sleep(2500); // exhaust the cap
      const cappedCount = (await getState(mock.port)).workers.length;
      assert.ok(worker.getOutput().includes('re-register cap'));

      // A real manifest becomes available — the periodic re-handshake
      // (Phase 5) picks it up and resets the cap.
      await post(mock.port, '/_set-health', {}); // back to the default complete manifest
      await sleep(2000);

      // The heartbeat 404 is still forced, so re-registration must resume
      // past what the cap previously allowed.
      await poll(async () => (await getState(mock.port)).workers.length > cappedCount, { timeout: 8000 });
    } finally {
      await teardownWorker();
    }
  });
});
