#!/usr/bin/env node
// conductor/tests/track-10080-file-manifest.test.mjs
// Track 10080 Phase 4 (TC-53..TC-58, TC-63): the worker's file-manifest
// push — computed on a slow tick, hashed, and pushed only on change to a
// dedicated collector endpoint. Real worker process (via
// conductor/tests/helpers/isolated-worker.mjs), real mock collector
// (conductor/tests/mock-collector.mjs).
//
// LC_FILE_MANIFEST_INTERVAL_MS and LC_FILE_MANIFEST_CAP are test-only
// overrides (see laneconductor.sync.mjs) — without them this suite would
// need to wait out a real 60s tick per assertion, or create 20,000 real
// files to exercise the truncation cap.
//
// Run: node --test conductor/tests/track-10080-file-manifest.test.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox, cleanupSandbox, startIsolatedWorker, stopWorker } from './helpers/isolated-worker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
process.env.LC_TEST_REPO_ROOT = repoRoot; // see track-10061-handshake-e2e.test.mjs's identical note

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 8000, interval = 150, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(interval);
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

function addTrackedFile(sandbox, relPath, content = 'x') {
  const fullPath = join(sandbox, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
  execFileSync('git', ['add', relPath], { cwd: sandbox });
}

// A real subprocess test would otherwise need to wait out the 60s production
// default per tick — same reasoning as LC_HEARTBEAT_INTERVAL_MS elsewhere.
const FAST_MANIFEST_ENV = { LC_FILE_MANIFEST_INTERVAL_MS: '400' };

describe('Track 10080 Phase 4: worker file-manifest sync', () => {
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
    sandbox = makeSandbox('filemanifest');
    await post(mock.port, '/_reset');
  });

  async function teardownWorker() {
    if (worker) await stopWorker(worker);
    worker = null;
    cleanupSandbox(sandbox);
  }

  it('TC-53: a local-fs worker computes and pushes no manifest', async () => {
    // Pre-write local-fs config so startIsolatedWorker's own default
    // (local-api) config never gets a chance to apply — it only writes one
    // if none already exists.
    writeFileSync(join(sandbox, '.laneconductor.json'), JSON.stringify({
      mode: 'local-fs',
      project: { name: 'lf-test', repo_path: sandbox, primary: { cli: 'mock', model: 'mock' } },
    }, null, 2));
    addTrackedFile(sandbox, 'Makefile');

    try {
      worker = await startIsolatedWorker({ sandbox, args: ['--sync-only'], env: FAST_MANIFEST_ENV });
      await worker.waitForServingRoot();
      await sleep(1200); // several manifest ticks' worth of real time
      const state = await getState(mock.port);
      assert.equal(state.fileManifests.length, 0, 'local-fs mode must never push a file manifest');
    } finally {
      await teardownWorker();
    }
  });

  it('TC-54: the first tick in a collector mode pushes exactly one manifest', async () => {
    addTrackedFile(sandbox, 'Makefile');
    addTrackedFile(sandbox, 'bin/lc.mjs');
    try {
      worker = await startIsolatedWorker({ sandbox, collectorPort: mock.port, args: ['--sync-only'], env: FAST_MANIFEST_ENV });
      await poll(async () => (await getState(mock.port)).fileManifests.length > 0, { label: 'first manifest push' });

      const state = await getState(mock.port);
      const manifest = state.fileManifests[0];
      assert.equal(manifest.project_id, 1);
      assert.ok(manifest.hostname, 'expected a hostname on the pushed manifest');
      assert.match(manifest.digest, /^sha256:/);
      assert.deepEqual([...manifest.files].sort(), ['Makefile', 'bin/lc.mjs']);
      assert.equal(manifest.truncated, false);
    } finally {
      await teardownWorker();
    }
  });

  it('TC-55: a second tick with an unchanged file list pushes nothing further', async () => {
    addTrackedFile(sandbox, 'Makefile');
    try {
      worker = await startIsolatedWorker({ sandbox, collectorPort: mock.port, args: ['--sync-only'], env: FAST_MANIFEST_ENV });
      await poll(async () => (await getState(mock.port)).fileManifests.length > 0);
      await sleep(1200); // several more ticks with nothing changed
      const state = await getState(mock.port);
      assert.equal(state.fileManifests.length, 1, 'an unchanged digest must not push again');
    } finally {
      await teardownWorker();
    }
  });

  it('TC-56: a file added between ticks triggers exactly one further push', async () => {
    addTrackedFile(sandbox, 'Makefile');
    try {
      worker = await startIsolatedWorker({ sandbox, collectorPort: mock.port, args: ['--sync-only'], env: FAST_MANIFEST_ENV });
      await poll(async () => (await getState(mock.port)).fileManifests.length > 0);
      const firstDigest = (await getState(mock.port)).fileManifests[0].digest;

      addTrackedFile(sandbox, 'bin/lc.mjs');
      await poll(async () => (await getState(mock.port)).fileManifests.length > 1, { label: 'second manifest push' });

      const state = await getState(mock.port);
      assert.equal(state.fileManifests.length, 2);
      assert.notEqual(state.fileManifests[1].digest, firstDigest);
      assert.deepEqual([...state.fileManifests[1].files].sort(), ['Makefile', 'bin/lc.mjs']);

      await sleep(1200); // no further changes -> no further pushes
      assert.equal((await getState(mock.port)).fileManifests.length, 2);
    } finally {
      await teardownWorker();
    }
  });

  it('TC-57: a repository over the cap is truncated and flagged', async () => {
    addTrackedFile(sandbox, 'a.txt');
    addTrackedFile(sandbox, 'b.txt');
    addTrackedFile(sandbox, 'c.txt');
    addTrackedFile(sandbox, 'd.txt');
    addTrackedFile(sandbox, 'e.txt');
    try {
      worker = await startIsolatedWorker({
        sandbox, collectorPort: mock.port, args: ['--sync-only'],
        env: { ...FAST_MANIFEST_ENV, LC_FILE_MANIFEST_CAP: '3' },
      });
      await poll(async () => (await getState(mock.port)).fileManifests.length > 0);
      const manifest = (await getState(mock.port)).fileManifests[0];
      assert.equal(manifest.files.length, 3);
      assert.equal(manifest.truncated, true);
    } finally {
      await teardownWorker();
    }
  });

  it('TC-58/TC-63: a failed push does not advance the digest — the next tick retries the same content', async () => {
    addTrackedFile(sandbox, 'Makefile');
    await post(mock.port, '/_set-fail-file-manifest', { count: 1 });
    try {
      worker = await startIsolatedWorker({ sandbox, collectorPort: mock.port, args: ['--sync-only'], env: FAST_MANIFEST_ENV });
      // The first attempt 500s (consumed by /_set-fail-file-manifest) and
      // must not be recorded; the worker's own cycle must not crash from
      // it either (still reaches a normal successful push on retry).
      await poll(async () => (await getState(mock.port)).fileManifests.length > 0, { label: 'retried manifest push' });

      const state = await getState(mock.port);
      assert.equal(state.fileManifests.length, 1, 'the failed attempt must not itself be recorded as a push');
      assert.deepEqual(state.fileManifests[0].files, ['Makefile']);
      assert.ok(
        worker.getOutput().includes('file-manifest error'),
        'expected the failed push to be logged, not silently swallowed',
      );
    } finally {
      await teardownWorker();
    }
  });
});
