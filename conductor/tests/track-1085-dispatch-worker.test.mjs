#!/usr/bin/env node
// conductor/tests/track-1085-dispatch.test.mjs
// Track 1085 Phase 2: worker-side dispatch inbox loop in
// conductor/laneconductor.sync.mjs — checkDispatchInbox/reconcileActiveDispatch.
//
// Tests:
//   1. A --sync-only worker picks up and runs a dispatched lane action,
//      without touching an unrelated queued track (the general queue).
//   2. A sync+poll worker also honors dispatch entries.
//   3. A dispatched deploy action runs via the shared deploy-runner and logs.
//
// Run: node --test conductor/tests/track-1085-dispatch.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1085-dispatch');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 12000, interval = 250, label = '' } = {}) {
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
    global: { total_parallel_limit: 3 },
    // No on_success/on_failure configured — resolveTransition's "stay" branch
    // applies, giving clean success/failure literals in **Lane Status**.
    defaults: { parallel_limit: 3, max_retries: 1, primary_model: 'mock' },
    lanes: { implement: { parallel_limit: 3, max_retries: 1 } },
  }, null, 2));
}

function writeTrack(num, lane, laneStatus) {
  const dir = join(TMP, 'conductor/tracks', `${num}-test-track`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track ${num}: Test Track`,
    '',
    `**Lane**: ${lane}`,
    `**Lane Status**: ${laneStatus}`,
    '**Progress**: 0%',
  ].join('\n'));
}

function laneStatusOf(num) {
  const path = join(TMP, 'conductor/tracks', `${num}-test-track`, 'index.md');
  const content = readFileSync(path, 'utf8');
  return content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim();
}

function startWorker(extraArgs = []) {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), ...extraArgs], {
    cwd: TMP,
    env: {
      ...process.env,
      LC_MOCK_CLI: `node ${MOCK_CLI}`,
      MOCK_CLI_DELAY_MS: '150',
      LC_SKIP_GIT_LOCK: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[dispatch-worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[dispatch-worker] ${d}`));
  return worker;
}

describe('Track 1085 Phase 2: worker dispatch inbox', () => {
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

  it('a --sync-only worker runs a dispatched lane action, leaving an unrelated queued track untouched', async () => {
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);
    writeTrack('2001', 'implement', 'idle');   // targeted by dispatch
    writeTrack('2002', 'implement', 'queue');  // NOT dispatched — sync-only must leave it alone

    // Register a worker first so we have a real worker_id for the dispatch entry.
    const worker = startWorker(['--sync-only']);
    try {
      const state = await poll(async () => {
        const s = await getState(collectorPort);
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registered' });
      const workerId = state.workers[0].id;

      await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '2001', action: 'implement' });

      await poll(async () => (laneStatusOf('2001') === 'success') || null, { label: 'track 2001 dispatched run completes' });
      assert.equal(laneStatusOf('2001'), 'success', 'dispatched track should have run to completion');
      assert.equal(laneStatusOf('2002'), 'queue', 'sync-only worker must not touch the general queue');

      const finalState = await poll(async () => {
        const s = await getState(collectorPort);
        const entry = s.dispatch.find(d => d.track_number === '2001');
        return (entry && entry.status !== 'pending' && entry.status !== 'claimed') ? s : null;
      }, { label: 'dispatch entry reported done' });
      const entry = finalState.dispatch.find(d => d.track_number === '2001');
      assert.equal(entry.status, 'done', 'dispatch entry should be reported done');
    } finally {
      worker.kill();
    }
  });

  it('a sync+poll worker also honors dispatch entries', async () => {
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);
    writeTrack('2003', 'implement', 'idle');

    const worker = startWorker(); // no --sync-only
    try {
      const state = await poll(async () => {
        const s = await getState(collectorPort);
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registered' });
      const workerId = state.workers[0].id;

      await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '2003', action: 'implement' });

      await poll(async () => (laneStatusOf('2003') === 'success') || null, { label: 'track 2003 dispatched run completes' });
      assert.equal(laneStatusOf('2003'), 'success');
    } finally {
      worker.kill();
    }
  });

  it('a dispatched deploy action runs via the shared deploy-runner and writes a log', async () => {
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);
    writeFileSync(join(TMP, 'conductor/deploy.json'), JSON.stringify({
      environments: { prod: { command: 'echo dispatch-deploy-marker' } },
    }));

    const worker = startWorker(['--sync-only']);
    try {
      const state = await poll(async () => {
        const s = await getState(collectorPort);
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registered' });
      const workerId = state.workers[0].id;

      await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: null, action: 'deploy', payload: { environment: 'prod' } });

      const finalState = await poll(async () => {
        const s = await getState(collectorPort);
        const entry = s.dispatch.find(d => d.action === 'deploy');
        return (entry && entry.status !== 'pending' && entry.status !== 'claimed') ? s : null;
      }, { label: 'deploy dispatch reported done' });
      const entry = finalState.dispatch.find(d => d.action === 'deploy');
      assert.equal(entry.status, 'done');

      const logsDir = join(TMP, 'conductor/logs');
      assert.ok(existsSync(logsDir), 'logs dir should exist');
      const logFiles = readdirSync(logsDir).filter(f => f.startsWith('deploy-prod-'));
      assert.ok(logFiles.length > 0, 'a deploy log file should have been written');
      const logContent = readFileSync(join(logsDir, logFiles[0]), 'utf8');
      assert.match(logContent, /dispatch-deploy-marker/);
    } finally {
      worker.kill();
    }
  });
});
