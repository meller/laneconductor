#!/usr/bin/env node
// conductor/tests/track-10064-collector-retry-e2e.test.mjs
//
// Track 10064 Phase 5 (REQ-11), wiring-level: proves a write that failed
// while a remote collector was unreachable is actually replayed by the
// real worker process once the collector recovers — not just that the
// pure retry-buffer module works in isolation
// (track-10064-collector-retry.test.mjs).
//
// Run: node --test conductor/tests/track-10064-collector-retry-e2e.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, `.test-tmp-track-10064-collector-retry-${process.pid}`);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 30000, interval = 300, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

function startMock() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(__dirname, 'mock-target.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', d => {
      out += d.toString();
      const m = out.match(/MOCK_COLLECTOR_PORT=(\d+)/);
      if (m) resolve({ proc, port: parseInt(m[1]) });
    });
    proc.stderr.on('data', d => process.stderr.write(`[mock] ${d}`));
    proc.on('error', reject);
    setTimeout(() => reject(new Error('mock collector startup timeout')), 5000);
  });
}

async function getState(port) {
  const r = await fetch(`http://127.0.0.1:${port}/_state`);
  return r.json();
}

async function setRequireAuth(port, require) {
  await fetch(`http://127.0.0.1:${port}/_set-require-auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ require }),
  });
}

function stopWorker(worker) {
  return new Promise(resolve => {
    if (!worker || worker.exitCode !== null || worker.signalCode !== null) return resolve();
    worker.once('exit', () => resolve());
    try { process.kill(-worker.pid, 'SIGTERM'); }
    catch { try { worker.kill('SIGTERM'); } catch { /* already dead */ } }
    setTimeout(() => {
      try { process.kill(-worker.pid, 'SIGKILL'); } catch { /* already dead */ }
      resolve();
    }, 3000);
  });
}

function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^COLLECTOR_\d+_TOKEN$/.test(key)) delete env[key];
  }
  return env;
}

describe('Track 10064: collector retry buffer replays after recovery', () => {
  let mockA, mockAPort, mockB, mockBPort, worker;

  before(async () => {
    ({ proc: mockA, port: mockAPort } = await startMock());
    ({ proc: mockB, port: mockBPort } = await startMock());
    // mockB starts DOWN (from the worker's perspective — 401 on every
    // write, the incident's own failure shape) until the test flips it.
    await setRequireAuth(mockBPort, true);

    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: TMP });
    mkdirSync(join(TMP, 'conductor/tracks/9999-retry-test'), { recursive: true });
    writeFileSync(join(TMP, 'conductor/tracks/file_sync_queue.md'), '# File Sync Queue\n');
    writeFileSync(join(TMP, 'conductor/tracks/9999-retry-test/index.md'), [
      '# Track 9999: Retry Test',
      '',
      '**Lane**: backlog',
      '**Lane Status**: queue',
      '**Progress**: 0%',
    ].join('\n'));
    writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
      mode: 'local-api',
      project: { name: 'test-10064-retry', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
      collectors: [
        { url: `http://127.0.0.1:${mockAPort}`, token: null },
        { url: `http://127.0.0.1:${mockBPort}`, token: null, enabled: true, type: 'remote' },
      ],
      ui: { port: 8090 },
    }, null, 2));

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
      cwd: TMP,
      detached: true,
      env: {
        ...cleanEnv(),
        LC_SKIP_GIT_LOCK: '1',
        LC_SKIP_WORKER_LOCK: '1',
        LC_SKIP_CWD_NORMALIZATION: '1',
        // Fast retry tick so this test doesn't need the 15s production default.
        LC_COLLECTOR_RETRY_INTERVAL_MS: '1500',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
    worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  });

  after(async () => {
    await stopWorker(worker);
    mockA?.kill('SIGTERM');
    mockB?.kill('SIGTERM');
    rmSync(TMP, { recursive: true, force: true });
  });

  it('a track write that failed against the down collector is replayed once it recovers', async () => {
    // Wait for the track to have synced successfully to the WORKING
    // collector at least once — proves the worker is up and syncing.
    await poll(async () => {
      const state = await getState(mockAPort);
      return state.tracks['9999'] ? state : null;
    }, { label: 'track synced to collector A' });

    // The same write must have been attempted against collector B and
    // failed (401, no token) — mockB never applies it while requireAuth is
    // on, so its track state stays absent.
    await poll(async () => {
      const state = await getState(mockBPort);
      return state.requestAuthLog.some(r => r.path === '/track') ? true : null;
    }, { label: 'collector B saw a failed /track attempt' });
    const beforeRecovery = await getState(mockBPort);
    assert.equal(beforeRecovery.tracks['9999'], undefined, 'collector B must not have the track yet — it only ever rejected the write');

    // Recovery: the collector starts accepting writes again (stands in for
    // "the real token finally showed up" — see track-10064-env-reload for
    // the actual token-reload path; this test is about the retry buffer,
    // not token resolution).
    await setRequireAuth(mockBPort, false);

    // The buffered write must be replayed by the next retry tick, without
    // any NEW change to the track file.
    await poll(async () => {
      const state = await getState(mockBPort);
      return state.tracks['9999'] ? state : null;
    }, { timeout: 15000, label: 'buffered write replayed to collector B after recovery' });

    const afterRecovery = await getState(mockBPort);
    assert.ok(afterRecovery.tracks['9999'], 'collector B must now have the track — the buffered write was replayed');
  });
});
