#!/usr/bin/env node
// conductor/tests/track-10061-handshake-e2e.test.mjs
// Track 10061 Phase 2: the worker performs the collector handshake at
// registration — real worker process (via the sanctioned
// conductor/tests/helpers/isolated-worker.mjs, track 10045), real mock
// collector (conductor/tests/mock-target.mjs) with its GET /health handshake
// support.
//
// TC-18 (getOwnCollectorCalls returns >=25 entries including
// POST /conductor-files) is NOT duplicated here: getOwnCollectorCalls() is a
// thin wrapper — extractWorkerCalls() applied to the worker's own source —
// and conductor/tests/cloud-route-parity.test.mjs's TC-1 already asserts
// exactly that against the identical (extractor, source file) pair.
// laneconductor.sync.mjs is a script, not a library (it exports almost
// nothing), so importing it directly to unit-test the wrapper would run its
// top-level side effects (starting a worker) — not worth it for a function
// with no logic of its own.
//
// Run: node --test conductor/tests/track-10061-handshake-e2e.test.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox, cleanupSandbox, startIsolatedWorker, stopWorker } from './helpers/isolated-worker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

// isolated-worker.mjs's default script resolution deliberately normalizes
// through resolvePrimaryRepoRoot() — i.e. it spawns the PRIMARY checkout's
// copy of conductor/laneconductor.sync.mjs, not necessarily this file's own
// worktree's copy. That's the right default for most suites, but this one
// exists specifically to exercise Phase 2's handshake code as edited in
// THIS worktree — LC_TEST_REPO_ROOT is isolated-worker.mjs's documented
// override for exactly this case.
process.env.LC_TEST_REPO_ROOT = repoRoot;

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

async function setHealth(port, cfg) {
  await fetch(`http://127.0.0.1:${port}/_set-health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
}

// ── Shared fixture: one mock collector, one sandbox+worker per test ────────────

describe('Track 10061 Phase 2: worker handshake at registration', () => {
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
    sandbox = makeSandbox('handshake');
    await fetch(`http://127.0.0.1:${mock.port}/_reset`, { method: 'POST' });
  });

  async function teardownWorker() {
    if (worker) await stopWorker(worker);
    worker = null;
    cleanupSandbox(sandbox);
  }

  it('TC-12: a complete manifest registers successfully with severity ok', async () => {
    try {
      worker = await startIsolatedWorker({ sandbox, collectorPort: mock.port, args: ['--sync-only'] });
      await poll(async () => (await getState(mock.port)).workers.length > 0);
      const state = await getState(mock.port);
      const w = state.workers.at(-1);
      assert.equal(w.collector_compat.severity, 'ok');
      assert.equal(w.collector_compat.missingRoutes.length, 0);
      await poll(() => worker.getOutput().includes('collector matches'));
    } finally {
      await teardownWorker();
    }
  });

  it('TC-13: a collector missing a route the worker calls still registers and runs', async () => {
    await setHealth(mock.port, { omit: ['POST /tracks/claim-queue'] });
    try {
      worker = await startIsolatedWorker({ sandbox, collectorPort: mock.port, args: ['--sync-only'] });
      await poll(async () => (await getState(mock.port)).workers.length > 0);
      const state = await getState(mock.port);
      const w = state.workers.at(-1);
      assert.equal(w.collector_compat.severity, 'missing-routes');
      assert.deepEqual(w.collector_compat.missingRoutes, ['POST /tracks/claim-queue']);
      await poll(() => worker.getOutput().includes('POST /tracks/claim-queue'));
      // Degraded, not stranded — the worker is still a registered, live worker.
      assert.equal(w.hostname, state.workers.at(-1).hostname);
    } finally {
      await teardownWorker();
    }
  });

  it('TC-14: a lower collector api_version reports version-drift', async () => {
    await setHealth(mock.port, { api_version: 0 });
    try {
      worker = await startIsolatedWorker({ sandbox, collectorPort: mock.port, args: ['--sync-only'] });
      await poll(async () => (await getState(mock.port)).workers.length > 0);
      const state = await getState(mock.port);
      const w = state.workers.at(-1);
      assert.equal(w.collector_compat.severity, 'version-drift');
      assert.equal(w.collector_compat.apiVersionDelta, -1);
      assert.equal(w.collector_api_version, 0);
    } finally {
      await teardownWorker();
    }
  });

  it('TC-15: a 404 from /health (a server predating this track) registers as unknown, no crash', async () => {
    await setHealth(mock.port, { mode: '404' });
    try {
      worker = await startIsolatedWorker({ sandbox, collectorPort: mock.port, args: ['--sync-only'] });
      await poll(async () => (await getState(mock.port)).workers.length > 0);
      const state = await getState(mock.port);
      const w = state.workers.at(-1);
      assert.equal(w.collector_compat.severity, 'unknown');
      assert.ok(!worker.getOutput().includes('Uncaught'));
    } finally {
      await teardownWorker();
    }
  });

  it('TC-16: an HTML 200 (Hosting SPA fallback) is treated as unknown, never a raw SyntaxError', async () => {
    await setHealth(mock.port, { mode: 'html200' });
    try {
      worker = await startIsolatedWorker({ sandbox, collectorPort: mock.port, args: ['--sync-only'] });
      await poll(async () => (await getState(mock.port)).workers.length > 0);
      const state = await getState(mock.port);
      const w = state.workers.at(-1);
      assert.equal(w.collector_compat.severity, 'unknown');
      assert.ok(!worker.getOutput().includes('SyntaxError'), 'a misrouted HTML response must never surface as a raw JSON parse error');
    } finally {
      await teardownWorker();
    }
  });

  it('TC-17: a hanging /health never delays registration beyond the handshake timeout', async () => {
    await setHealth(mock.port, { mode: 'hang' });
    try {
      worker = await startIsolatedWorker({ sandbox, collectorPort: mock.port, args: ['--sync-only'] });
      // fetchCollectorManifest's own timeout is 5s; registration must still
      // complete well inside this suite's poll window.
      await poll(async () => (await getState(mock.port)).workers.length > 0, { timeout: 12000 });
      const state = await getState(mock.port);
      assert.equal(state.workers.at(-1).collector_compat.severity, 'unknown');
    } finally {
      await teardownWorker();
    }
  });

  it('TC-19: an unchanged verdict across repeated registrations logs the match only once', async () => {
    try {
      worker = await startIsolatedWorker({
        sandbox, collectorPort: mock.port, args: ['--sync-only'],
        env: { LC_HEARTBEAT_INTERVAL_MS: '1500' },
      });
      await poll(async () => (await getState(mock.port)).workers.length > 0);
      await poll(() => worker.getOutput().includes('collector matches'));

      // Force a second registration (401 -> re-register, unchanged from
      // before this track) without changing the collector's manifest at all.
      await fetch(`http://127.0.0.1:${mock.port}/_set-heartbeat-401`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fail: true }) });
      await poll(async () => (await getState(mock.port)).workers.length >= 2, { timeout: 15000 });
      // Give the log a moment to reflect the second registration's handshake.
      await sleep(500);

      const matches = worker.getOutput().split('collector matches').length - 1;
      assert.equal(matches, 1, `expected exactly one "collector matches" log line, got ${matches}`);
    } finally {
      await teardownWorker();
    }
  });
});

// ── Phase 5: periodic re-check ──────────────────────────────────────────────────

describe('Track 10061 Phase 5: periodic collector handshake re-check', () => {
  let mock;
  let sandbox;
  let worker;

  before(async () => { mock = await startMockCollector(); });
  after(async () => { if (mock) mock.proc.kill(); });
  beforeEach(async () => {
    sandbox = makeSandbox('handshake-periodic');
    await fetch(`http://127.0.0.1:${mock.port}/_reset`, { method: 'POST' });
  });

  it('TC-34: a manifest that changes mid-run updates the worker\'s badge-feeding verdict without a restart', async () => {
    try {
      worker = await startIsolatedWorker({
        sandbox, collectorPort: mock.port, args: ['--sync-only'],
        env: { LC_HANDSHAKE_INTERVAL_MS: '1200' },
      });
      await poll(async () => (await getState(mock.port)).workers.length > 0);
      const firstCompat = (await getState(mock.port)).workers.at(-1).collector_compat;
      assert.equal(firstCompat.severity, 'ok');

      // The collector is "redeployed" mid-run with a route now missing —
      // no worker restart happens here.
      await setHealth(mock.port, { omit: ['POST /tracks/claim-queue'] });

      await poll(async () => {
        const workers = (await getState(mock.port)).workers;
        return workers.at(-1).collector_compat.severity === 'missing-routes';
      }, { timeout: 10000 });

      assert.ok(worker.getOutput().includes('POST /tracks/claim-queue'));
    } finally {
      if (worker) await stopWorker(worker);
      worker = null;
      cleanupSandbox(sandbox);
    }
  });

  it('TC-35: the default re-check interval is 15 minutes, not the 10s heartbeat cadence', () => {
    const source = readFileSync(join(repoRoot, 'conductor/laneconductor.sync.mjs'), 'utf8');
    assert.match(
      source,
      /recheckCollectorHandshakes[\s\S]{0,40}Number\(process\.env\.LC_HANDSHAKE_INTERVAL_MS\)\s*\|\|\s*15\s*\*\s*60\s*\*\s*1000/,
      'expected the periodic handshake re-check to default to 15 minutes via LC_HANDSHAKE_INTERVAL_MS',
    );
    // Distinguish it from the unrelated 10s heartbeat interval constant —
    // this asserts they are two DIFFERENT setInterval calls, not the same one.
    assert.doesNotMatch(
      source,
      /setInterval\(\(\) => \{ recheckCollectorHandshakes\(\); \}, Number\(process\.env\.LC_HEARTBEAT_INTERVAL_MS\)/,
      'the handshake re-check must not be driven off the heartbeat interval env var',
    );
  });
});
