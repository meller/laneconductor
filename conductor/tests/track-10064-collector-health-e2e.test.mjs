#!/usr/bin/env node
// conductor/tests/track-10064-collector-health-e2e.test.mjs
//
// Track 10064 Phases 3-4, wiring-level: proves the real worker process
// actually calls into services/collector-health.mjs (unit-tested in
// track-10064-collector-health.test.mjs) from its real register/heartbeat
// paths, and ships the result in the payload — not just that the pure
// module works in isolation.
//
// Run: node --test conductor/tests/track-10064-collector-health-e2e.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, `.test-tmp-track-10064-collector-health-${process.pid}`);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 25000, interval = 300, label = '' } = {}) {
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

// See track-10064-env-reload.test.mjs's identical helper for why: this
// test process's own ambient shell may already have this project's real
// COLLECTOR_*_TOKEN exported, which would otherwise silently override the
// fixture and defeat the "no resolvable token" scenario this test relies on.
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^COLLECTOR_\d+_TOKEN$/.test(key)) delete env[key];
  }
  return env;
}

describe('Track 10064: collector_health wiring (register/heartbeat)', () => {
  let mockA, mockAPort, mockB, mockBPort, worker;

  before(async () => {
    ({ proc: mockA, port: mockAPort } = await startMock());
    ({ proc: mockB, port: mockBPort } = await startMock());
    // mockB requires a bearer token, like the real Cloud Function does
    // (cloud/functions/index.js's `auth` middleware) — and nothing in this
    // test ever configures one, so every request to it fails with exactly
    // the incident's own "unauthorized: missing token" shape.
    await setRequireAuth(mockBPort, true);

    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: TMP }); // see track-10062/10064-env-reload for why this is load-bearing
    mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
    writeFileSync(join(TMP, 'conductor/tracks/file_sync_queue.md'), '# File Sync Queue\n');
    writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
      mode: 'local-api',
      project: { name: 'test-10064-health', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
      collectors: [
        { url: `http://127.0.0.1:${mockAPort}`, token: null },
        { url: `http://127.0.0.1:${mockBPort}`, token: null, enabled: true, type: 'remote' },
      ],
      ui: { port: 8090 },
    }, null, 2));

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
      cwd: TMP,
      detached: true,
      env: { ...cleanEnv(), LC_SKIP_GIT_LOCK: '1', LC_SKIP_WORKER_LOCK: '1', LC_SKIP_CWD_NORMALIZATION: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
    // console.error (used by logCollectorTokenSources for a missing token —
    // this is the log TC-12 checks) writes to stderr, not stdout.
    worker.stderr.on('data', d => { global.__tc10064Stderr = (global.__tc10064Stderr || '') + d; process.stderr.write(`[worker] ${d}`); });
  });

  after(async () => {
    await stopWorker(worker);
    mockA?.kill('SIGTERM');
    mockB?.kill('SIGTERM');
    rmSync(TMP, { recursive: true, force: true });
  });

  it('TC-12: startup logs an error naming the exact expected env key for a collector with no resolvable token', async () => {
    await poll(async () => (global.__tc10064Stderr || '').includes('no resolvable token') ? true : null,
      { label: 'startup token-source error log' });
    assert.match(global.__tc10064Stderr, /http:\/\/127\.0\.0\.1:\d+ has no resolvable token — expected COLLECTOR_1_TOKEN/);
  });

  it('TC-18: the /worker/register payload sent to the WORKING collector includes collector_health for the FAILING one', async () => {
    await poll(async () => {
      const state = await getState(mockAPort);
      const reg = state.workers.at(-1);
      return reg?.collector_health ? reg : null;
    }, { label: 'registration payload carrying collector_health' });

    const state = await getState(mockAPort);
    const reg = state.workers.at(-1);
    const bKey = `http://127.0.0.1:${mockBPort}`;
    assert.ok(reg.collector_health[bKey], 'collector_health must have an entry for the failing remote collector');
    assert.equal(reg.collector_health[bKey].token_source, 'none');
  });

  it('TC-19/TC-9(REQ-7): consecutive_failures accumulates across heartbeats and is visible in the heartbeat payload', async () => {
    const bKey = `http://127.0.0.1:${mockBPort}`;
    const first = await poll(async () => {
      const state = await getState(mockAPort);
      const w = state.workers.at(-1);
      return w?.collector_health?.[bKey]?.consecutive_failures > 0 ? w.collector_health[bKey].consecutive_failures : null;
    }, { label: 'first observed failure count' });

    const grew = await poll(async () => {
      const state = await getState(mockAPort);
      const w = state.workers.at(-1);
      const n = w?.collector_health?.[bKey]?.consecutive_failures ?? 0;
      return n > first ? n : null;
    }, { timeout: 20000, label: 'failure count growing across subsequent heartbeats' });

    assert.ok(grew > first, `expected consecutive_failures to grow past ${first}, saw ${grew}`);
    // The healthy collector's own entry must show zero failures — this
    // isn't a global flag, it's genuinely per-collector.
    const state = await getState(mockAPort);
    const aKey = `http://127.0.0.1:${mockAPort}`;
    assert.equal(state.workers.at(-1).collector_health[aKey].consecutive_failures, 0);
  });
});
