#!/usr/bin/env node
// conductor/tests/track-1084-worker-identity.test.mjs
// Track 1084 Phase 0: stable worker identity via --worker-number.
//
// Tests:
//   1. Worker registers with worker_number: 1 by default (no flag)
//   2. --worker-number 2 registers with worker_number: 2
//   3. --worker-number is included in heartbeat, not just initial registration
//
// Run: node --test conductor/tests/track-1084-worker-identity.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, '.test-tmp-track-1084');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 8000, interval = 200, label = '' } = {}) {
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
    const proc = spawn('node', [join(__dirname, 'mock-collector.mjs')], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const collectorUrl = `http://127.0.0.1:${collectorPort}`;

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: collectorUrl, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 1 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: { plan: { parallel_limit: 1, max_retries: 1 } },
  }, null, 2));
}

function startWorker(extraArgs = []) {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only', ...extraArgs], {
    cwd: TMP,
    env: { ...process.env, LC_SKIP_GIT_LOCK: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

describe('Track 1084 Phase 0: stable worker identity', () => {
  let collectorProc, collectorPort;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
  });

  after(() => {
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('registers with worker_number: 1 by default when no flag is passed', async () => {
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' }).catch(() => {});
    setupProject(collectorPort);
    const worker = startWorker();
    try {
      const state = await poll(async () => {
        const s = await getState(collectorPort);
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registration' });
      assert.equal(state.workers[0].worker_number, 1, 'should default worker_number to 1');
    } finally {
      worker.kill();
    }
  });

  it('registers with worker_number: 2 when --worker-number 2 is passed', async () => {
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' }).catch(() => {});
    setupProject(collectorPort);
    const worker = startWorker(['--worker-number', '2']);
    try {
      const state = await poll(async () => {
        const s = await getState(collectorPort);
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registration with --worker-number 2' });
      assert.equal(state.workers[0].worker_number, 2, 'should register with worker_number: 2');
    } finally {
      worker.kill();
    }
  });
});

// ── CLI: per-instance pidfile (bin/lc.mjs `worker start --worker-number N`) ──

const LC = join(ROOT, 'bin/lc.mjs');
const TMP_CLI = join(ROOT, '.test-tmp-track-1084-cli');

function sh(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd: TMP_CLI, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { out += d; });
    proc.on('exit', code => resolve({ code, out }));
  });
}

function setupCliProject() {
  rmSync(TMP_CLI, { recursive: true, force: true });
  mkdirSync(join(TMP_CLI, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP_CLI, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'test-cli', repo_path: TMP_CLI, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
    ui: { port: 8090 },
  }, null, 2));
  writeFileSync(join(TMP_CLI, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 1 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: { plan: { parallel_limit: 1, max_retries: 1 } },
  }, null, 2));
}

function killIfRunning(pidFilePath) {
  try {
    const pid = readFileSync(pidFilePath, 'utf8').trim();
    process.kill(pid);
  } catch (e) { /* already dead or file missing */ }
}

describe('Track 1084 Phase 0: CLI --worker-number pidfile', () => {
  after(() => {
    killIfRunning(join(TMP_CLI, 'conductor/.sync.pid'));
    killIfRunning(join(TMP_CLI, 'conductor/.sync-2.pid'));
    rmSync(TMP_CLI, { recursive: true, force: true });
  });

  it('worker start --worker-number 2 writes conductor/.sync-2.pid, not .sync.pid', async () => {
    setupCliProject();
    const { code } = await sh('node', [LC, 'worker', 'start', '--worker-number', '2']);
    assert.equal(code, 0, 'lc worker start should exit 0');

    const pidFile2 = join(TMP_CLI, 'conductor/.sync-2.pid');
    const pidFile1 = join(TMP_CLI, 'conductor/.sync.pid');
    await poll(async () => existsSync(pidFile2) || null, { timeout: 3000, label: '.sync-2.pid created' });

    assert.ok(existsSync(pidFile2), '.sync-2.pid should exist');
    assert.ok(!existsSync(pidFile1), '.sync.pid (worker #1) should NOT exist — only #2 was started');

    killIfRunning(pidFile2);
  });

  it('two workers (default + --worker-number 2) can run concurrently without pidfile collision', async () => {
    setupCliProject();
    const r1 = await sh('node', [LC, 'worker', 'start']);
    assert.equal(r1.code, 0, 'starting worker #1 should succeed');

    const r2 = await sh('node', [LC, 'worker', 'start', '--worker-number', '2']);
    assert.equal(r2.code, 0, 'starting worker #2 should succeed');
    assert.doesNotMatch(r2.out, /already running/i, 'worker #2 should not be blocked by worker #1\'s pidfile');

    const pidFile1 = join(TMP_CLI, 'conductor/.sync.pid');
    const pidFile2 = join(TMP_CLI, 'conductor/.sync-2.pid');
    await poll(async () => (existsSync(pidFile1) && existsSync(pidFile2)) || null, { timeout: 3000, label: 'both pidfiles created' });

    assert.ok(existsSync(pidFile1), 'worker #1 pidfile should exist');
    assert.ok(existsSync(pidFile2), 'worker #2 pidfile should exist');
    assert.notEqual(
      readFileSync(pidFile1, 'utf8').trim(),
      readFileSync(pidFile2, 'utf8').trim(),
      'the two workers should be different processes'
    );

    killIfRunning(pidFile1);
    killIfRunning(pidFile2);
  });
});

// ── Phase 3: assignee/pin gating via claimable-tracks ─────────────────────

const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP_P3 = join(ROOT, '.test-tmp-track-1084-phase3');

function setupPhase3Project(collectorPort) {
  rmSync(TMP_P3, { recursive: true, force: true });
  mkdirSync(TMP_P3, { recursive: true });
  const collectorUrl = `http://127.0.0.1:${collectorPort}`;

  writeFileSync(join(TMP_P3, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP_P3, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: collectorUrl, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP_P3, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP_P3, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 3, max_retries: 1, primary_model: 'mock' },
    lanes: { implement: { parallel_limit: 3, max_retries: 1 } },
  }, null, 2));

  for (const num of ['1001', '1002']) {
    const dir = join(TMP_P3, 'conductor/tracks', `${num}-test-track`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.md'), [
      `# Track ${num}: Test Track`,
      '',
      '**Lane**: implement',
      '**Lane Status**: queue',
      '**Progress**: 0%',
      // Track 10017: this suite tests the assignee/claimable-tracks gate,
      // not the auto-run gate — opt in so it's unaffected.
      '**Auto Run**: yes',
    ].join('\n'));
  }
}

function startPhase3Worker() {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: TMP_P3,
    env: {
      ...process.env,
      LC_MOCK_CLI: `node ${MOCK_CLI}`,
      MOCK_CLI_DELAY_MS: '200',
      LC_SKIP_GIT_LOCK: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[p3-worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[p3-worker] ${d}`));
  return worker;
}

function laneStatusOf(num) {
  const path = join(TMP_P3, 'conductor/tracks', `${num}-test-track`, 'index.md');
  const content = readFileSync(path, 'utf8');
  return content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim();
}

describe('Track 1084 Phase 3: claimable-tracks gating', () => {
  let collectorProc, collectorPort;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
  });

  after(() => {
    collectorProc?.kill();
    rmSync(TMP_P3, { recursive: true, force: true });
  });

  it('only claims tracks present in claimable-tracks, leaves others in queue', async () => {
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' }).catch(() => {});
    // Worker is only allowed to claim 1001, not 1002.
    await fetch(`http://127.0.0.1:${collectorPort}/_set-claimable`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimable: ['1001'] }),
    });
    setupPhase3Project(collectorPort);
    const worker = startPhase3Worker();
    try {
      await poll(async () => (laneStatusOf('1001') !== 'queue') || null, { timeout: 8000, label: 'track 1001 claimed' });
      assert.notEqual(laneStatusOf('1001'), 'queue', 'track 1001 (claimable) should have been claimed');
      assert.equal(laneStatusOf('1002'), 'queue', 'track 1002 (not claimable) should NOT have been claimed');
    } finally {
      worker.kill();
    }
  });
});
