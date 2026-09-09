#!/usr/bin/env node
// conductor/tests/track-10083-status-fanout-e2e.test.mjs
// Track AM-10083 Phase 1/3 (RC-1): the dispatch loop's `lane_action_status:
// 'running'` write — the very first thing that happens once a lane action
// actually starts — used to be addressed to primaryCollector() only, so a
// non-primary collector (a real remote collector in production) never
// learned a track had started running except via the much slower,
// file-watch-triggered syncTrack() path (and, before Phase 2's cloud fix,
// not even then — see track-10083-post-track-lane-action-status.test.js).
//
// This proves the fast write itself now reaches every configured collector,
// not just primary — dispatching a real lane action against a real worker
// process and asserting BOTH mock collectors report the track running,
// mirroring the live bug (app.laneconductor.com showing a genuinely-running
// track as still queued) rather than unit-testing patchCollectors() in
// isolation.
//
// Run: node --test conductor/tests/track-10083-status-fanout-e2e.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, `.test-tmp-track-10083-status-fanout-${process.pid}`);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 20000, interval = 250, label = '' } = {}) {
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

async function enqueueDispatch(port, entry) {
  const r = await fetch(`http://127.0.0.1:${port}/_enqueue-dispatch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
  });
  return (await r.json()).id;
}

function setupProject(primaryPort, secondaryPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execSync('git init -q', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: TMP });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-10083-fanout', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [
      { url: `http://127.0.0.1:${primaryPort}`, token: null },
      { url: `http://127.0.0.1:${secondaryPort}`, token: null, enabled: true, type: 'remote' },
    ],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: { implement: { parallel_limit: 1, max_retries: 1 } },
  }, null, 2));

  const trackDir = join(TMP, 'conductor/tracks/9999-fanout-test');
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    '# Track 9999: Fanout Test',
    '',
    '**Lane**: implement',
    '**Lane Status**: success',
    '**Progress**: 0%',
  ].join('\n'));

  return trackDir;
}

function stopWorker(worker) {
  return new Promise(resolve => {
    if (!worker || worker.exitCode !== null || worker.signalCode !== null) return resolve();
    worker.once('exit', () => resolve());
    worker.kill('SIGTERM');
    setTimeout(() => { try { worker.kill('SIGKILL'); } catch { /* already dead */ } resolve(); }, 3000);
  });
}

describe('Track AM-10083: the running-claim status write reaches every collector, not just primary', () => {
  let mockA, mockAPort, mockB, mockBPort, worker;

  before(async () => {
    ({ proc: mockA, port: mockAPort } = await startMock());
    ({ proc: mockB, port: mockBPort } = await startMock());

    setupProject(mockAPort, mockBPort);

    // A slow (but eventually successful) mock CLI run gives the test a
    // window to observe the 'running' write on both collectors before the
    // run completes and the completion write (also fanned out, per Phase 3)
    // would otherwise overwrite it.
    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        MOCK_CLI_DELAY_MS: '4000',
        LC_DISPATCH_POLL_MS: '500',
        LC_SKIP_GIT_LOCK: '1',
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

  it('both collectors report lane_action_status: running for the dispatched track, within one tick', async () => {
    const state0 = await poll(async () => {
      const s = await getState(mockAPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered with primary' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(mockAPort, {
      worker_id: workerId,
      action: 'implement',
      track_number: '9999',
    });

    // The primary must see it (this path already worked before this track).
    await poll(async () => {
      const s = await getState(mockAPort);
      return s.tracks['9999']?.lane_action_status === 'running' ? s : null;
    }, { timeout: 10000, label: 'primary collector sees running' });

    // The non-primary collector must ALSO receive the SAME direct PATCH the
    // dispatch loop sends primary — not merely end up with the right state
    // via some other path. Under light load (no file-watch backlog — see
    // spec.md F-2), the generic chokidar-triggered POST /track sync can
    // race the direct write and land quickly enough to produce the right
    // *state* on its own even without this track's fix, which would make a
    // plain "does the secondary's state say running" assertion pass for the
    // wrong reason. Asserting on the request log instead — a PATCH
    // /track/:num/action actually reaching the secondary — proves the fix
    // under test (the dispatch loop's direct write is no longer
    // primary-only) regardless of how fast the indirect path happens to be
    // in this synthetic single-track run.
    await poll(async () => {
      const s = await getState(mockBPort);
      return s.requestAuthLog.some(r => r.method === 'PATCH' && r.path === '/track/9999/action') ? s : null;
    }, { timeout: 10000, label: 'secondary (non-primary) collector received the direct PATCH /track/9999/action' });

    const secondaryState = await getState(mockBPort);
    assert.equal(secondaryState.tracks['9999']?.lane_action_status, 'running',
      'the non-primary collector must end up with the same running state the primary does');
  });
});
