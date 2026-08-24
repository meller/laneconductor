#!/usr/bin/env node
// conductor/tests/track-1102-f11-progress-keepalive.test.mjs
// Track 1102 F11: spawnCli's kill-timer must not kill a run that is
// still genuinely producing output — only one that's gone silent for
// the full timeout window.
//
// Before this fix, the timer was a single `setTimeout(..., timeoutMs)`
// fired unconditionally after timeoutMs regardless of whether the run
// was actively working. Live incident (track 1104, 2026-08-13): a
// dogfooded walkthrough was SIGTERM'd 15 minutes in, after 90 productive
// turns — the log was growing the entire time, so it wasn't the hang a
// timeout exists to catch. The only prior fix was operational (manually
// doubling the project's configured timeout), not structural.
//
// This test proves both directions with a real spawned worker: a run
// that keeps producing output past the original deadline must survive
// and finish successfully; a run that goes genuinely silent for the
// full deadline must still be killed (the actual hang case this
// mechanism exists to catch).
//
// Run: node --test conductor/tests/track-1102-f11-progress-keepalive.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');

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

function killAndWait(proc) {
  return new Promise(resolve => {
    if (!proc || proc.exitCode !== null || proc.killed && proc.exitCode !== null) return resolve();
    proc.once('exit', resolve);
    proc.kill();
    setTimeout(resolve, 3000); // don't hang the suite if it somehow doesn't exit
  });
}

async function enqueueDispatch(port, entry) {
  const r = await fetch(`http://127.0.0.1:${port}/_enqueue-dispatch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
  });
  return (await r.json()).id;
}

function setupProject(tmpDir, collectorPort) {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  execSync('git init -q', { cwd: tmpDir });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: tmpDir });

  writeFileSync(join(tmpDir, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: tmpDir, primary: { cli: 'mock', model: 'mock' }, worktree_lifecycle: 'per-cycle' },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(tmpDir, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(tmpDir, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: { plan: { parallel_limit: 1, max_retries: 1 } },
  }, null, 2));

  const trackDir = join(tmpDir, 'conductor/tracks/001-test-track');
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    '# Track 001: Test Track', '', '**Lane**: plan', '**Lane Status**: queue', '**Progress**: 0%',
  ].join('\n'));

  execSync('git add -A', { cwd: tmpDir });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m init2', { cwd: tmpDir });
}

describe('Track 1102 F11: timeout only kills a genuinely stalled run, not one still producing output', () => {
  let collectorProc, collectorPort;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
  });

  after(() => {
    collectorProc?.kill();
  });

  it('a run still producing output past the original deadline survives and completes', async () => {
    const TMP = join(ROOT, '.test-tmp-track-1102-f11-progress');
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(TMP, collectorPort);

    const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        LC_SPAWN_TIMEOUT_MS: '2500',
        MOCK_CLI_DELAY_MS: '7000',
        MOCK_CLI_PROGRESS_INTERVAL_MS: '500',
        LC_DISPATCH_POLL_MS: '500',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let workerOutput = '';
    worker.stdout.on('data', d => { workerOutput += d.toString(); process.stdout.write(`[worker] ${d}`); });
    worker.stderr.on('data', d => { workerOutput += d.toString(); process.stderr.write(`[worker] ${d}`); });

    try {
      const state0 = await poll(async () => {
        const s = await getState(collectorPort);
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registered' });
      const workerId = state0.workers[0].id;

      await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'plan', track_number: '001' });

      // Original deadline (2500ms) passes here — a run that's still
      // producing output must NOT have been killed at this point.
      await sleep(4000);
      assert.doesNotMatch(
        workerOutput, /\[timeout\] killing PID/,
        'Run was killed even though it was still producing output past the original deadline — the keepalive fix is not working.'
      );

      // Wait for a genuinely terminal status (success/failure), not just
      // "not running" — that's trivially true of the initial 'queue'
      // state too, before the dispatch is even claimed.
      const finalState = await poll(async () => {
        const s = await getState(collectorPort);
        const status = s.tracks['001']?.lane_action_status;
        return status === 'success' || status === 'failure' ? s : null;
      }, { timeout: 10000, label: 'run finishes' });

      assert.equal(finalState.tracks['001'].lane_action_status, 'success');
      assert.doesNotMatch(workerOutput, /\[timeout\] killing PID/);
    } finally {
      await killAndWait(worker);
      rmSync(TMP, { recursive: true, force: true });
    }
  });

  it('a genuinely silent run is still killed after the full deadline (the real hang case)', async () => {
    const TMP = join(ROOT, '.test-tmp-track-1102-f11-silent');
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(TMP, collectorPort);

    const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        LC_SPAWN_TIMEOUT_MS: '2500',
        MOCK_CLI_DELAY_MS: '30000', // never produces further output, no progress interval
        LC_DISPATCH_POLL_MS: '500',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let workerOutput = '';
    worker.stdout.on('data', d => { workerOutput += d.toString(); process.stdout.write(`[worker] ${d}`); });
    worker.stderr.on('data', d => { workerOutput += d.toString(); process.stderr.write(`[worker] ${d}`); });

    try {
      const state0 = await poll(async () => {
        const s = await getState(collectorPort);
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registered' });
      const workerId = state0.workers[0].id;

      await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'plan', track_number: '001' });

      // The killer's own 'timeout' tag on lane_action_result is
      // immediately overwritten by the exit handler's own generic
      // `error (code ${code})` PATCH that runs right after (pre-existing
      // behavior, unrelated to this fix) — so the DB fields alone can't
      // distinguish a genuine timeout-kill from any other failure. The
      // direct, unambiguous signal is the worker's own kill-log line.
      await poll(async () => workerOutput.includes('[timeout] killing PID') || null,
        { timeout: 10000, label: 'worker logs a genuine timeout kill' });

      assert.match(workerOutput, /\[timeout\] killing PID \d+ — no log growth for \d+ms \(genuinely stalled\)/);
    } finally {
      await killAndWait(worker);
      rmSync(TMP, { recursive: true, force: true });
    }
  });
});
