#!/usr/bin/env node
// conductor/tests/track-10020-run-marker-lifecycle.test.mjs
// Track 10020 Phase 1: integration tests proving spawnCli actually writes
// and removes conductor/.runs/<track>.json around a real spawned child —
// the disk-mirrored counterpart of runningTrackMap that a REPLACEMENT
// worker process can consult after a restart (see run-marker.mjs's header
// comment, and conductor/tests/track-10020-run-marker.test.mjs for the
// pure-module unit tests this integration layer builds on).
// See test.md TC-1.9..TC-1.12.
//
// Run: node --test conductor/tests/track-10020-run-marker-lifecycle.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync, execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10020-run-marker');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 15000, interval = 250, label = '' } = {}) {
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

async function enqueueDispatch(port, entry) {
  const r = await fetch(`http://127.0.0.1:${port}/_enqueue-dispatch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
  });
  return (await r.json()).id;
}

const trackDir = join(TMP, 'conductor/tracks/001-test-track');
const indexPath = join(trackDir, 'index.md');
const markerPath = join(TMP, 'conductor/.runs/001.json');

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execSync('git init -q', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: TMP });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: { implement: { parallel_limit: 1, max_retries: 1 } },
  }, null, 2));

  mkdirSync(trackDir, { recursive: true });
  writeFileSync(indexPath, [
    '# Track 001: Test Track',
    '',
    '**Lane**: implement',
    '**Lane Status**: queue',
    '**Progress**: 0%',
    '',
    '## Problem',
    'Test problem.',
  ].join('\n'));
}

describe('Track 10020 Phase 1: spawnCli run-marker lifecycle', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    setupProject(collectorPort);

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_SKIP_GIT_LOCK: '1',
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        MOCK_CLI_DELAY_MS: '3000',
        MOCK_CLI_PROGRESS_INTERVAL_MS: '300',
        LC_DISPATCH_POLL_MS: '300',
        LC_RECONCILE_ACTIVE_POLL_MS: '300',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
    worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  });

  after(() => {
    worker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('TC-1.9/1.10: writes a live marker in the primary checkout while running, removes it on clean exit', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'implement', track_number: '001' });

    await poll(async () => {
      const content = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
      return /\*\*Lane Status\*\*:\s*running/i.test(content) ? true : null;
    }, { label: 'dispatch claimed and marked running' });

    // TC-1.9: marker exists in the PRIMARY checkout (TMP itself here, since
    // LC_SKIP_GIT_LOCK skips worktree creation) while the child is alive.
    await poll(() => existsSync(markerPath) || null, { label: 'run marker written' });
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    assert.equal(marker.track_number, '001');
    assert.equal(typeof marker.pid, 'number');
    assert.equal(marker.command, 'node'); // LC_MOCK_CLI="node <mock-cli.mjs>" — argv[0]
    assert.doesNotThrow(() => process.kill(marker.pid, 0), 'marker pid must be a live process while the mock CLI is running');

    // TC-1.10: once the mock CLI exits on its own (3s delay elapses), the
    // exit handler removes the marker — same unconditional best-effort path
    // as releaseTrackClaim.
    await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'implement');
      return d && d.status !== 'claimed' ? true : null;
    }, { timeout: 15000, label: 'dispatch resolves once the mock CLI exits' });
    assert.equal(existsSync(markerPath), false, 'marker must be removed once the CLI has exited cleanly');
  });

  it('TC-1.11: marker is removed even when the spawned child is killed outright', async () => {
    const state0 = await getState(collectorPort);
    const workerId = state0.workers[0].id;

    // Reset the track back to queue so a fresh dispatch can claim it again.
    writeFileSync(indexPath, [
      '# Track 001: Test Track',
      '',
      '**Lane**: implement',
      '**Lane Status**: queue',
      '**Progress**: 0%',
      '',
      '## Problem',
      'Test problem.',
    ].join('\n'));

    await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'implement', track_number: '001' });

    await poll(() => existsSync(markerPath) || null, { label: 'run marker written for second dispatch' });
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));

    process.kill(marker.pid, 'SIGKILL');

    await poll(() => (!existsSync(markerPath)) || null, { label: 'marker removed after SIGKILL' });
    assert.equal(existsSync(markerPath), false);
  });
});

describe('Track 10020 Phase 1: TC-1.12 conductor/.runs/ is gitignored', () => {
  it('git check-ignore reports conductor/.runs/10020.json as ignored', () => {
    const result = execFileSync('git', ['check-ignore', 'conductor/.runs/10020.json'], {
      cwd: ROOT, encoding: 'utf8',
    }).trim();
    assert.equal(result, 'conductor/.runs/10020.json');
  });
});
