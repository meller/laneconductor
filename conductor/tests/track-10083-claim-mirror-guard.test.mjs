#!/usr/bin/env node
// conductor/tests/track-10083-claim-mirror-guard.test.mjs
// Track AM-10083 Phase 5 (RC-3/REQ-6): Phases 2-4 make a status transition
// reach every collector within roughly one HTTP round trip of the local
// write, but /tracks/claim-queue is still only ever called against the
// primary — the same track stays claimable on every other collector for
// that whole window. This is the residual defense-in-depth layer: mirror a
// won claim outward, and refuse to spawn if a non-primary collector reports
// the track already running under a genuinely different claimant.
//
// Four scenarios, one worker process per `it()` (auto-launch, not
// --sync-only, so the real claim-queue + pre-spawn-guard code path runs):
//   1. A normal claim (no pre-existing conflict) mirrors 'running' to the
//      non-primary collector.
//   2. A non-primary collector already showing the track running under a
//      DIFFERENT claimant blocks the spawn and posts a conversation.md
//      comment naming the collector.
//   3. A non-primary collector showing the track running under THIS
//      worker's OWN identity does not block — self is not a conflict.
//   4. A non-primary collector that's unreachable never blocks — the spawn
//      proceeds normally.
//
// Run: node --test conductor/tests/track-10083-claim-mirror-guard.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');

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

async function setTrack(port, fields) {
  await fetch(`http://127.0.0.1:${port}/_set-track`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
  });
}

function stopWorker(worker) {
  return new Promise(resolve => {
    if (!worker || worker.exitCode !== null || worker.signalCode !== null) return resolve();
    worker.once('exit', () => resolve());
    worker.kill('SIGTERM');
    setTimeout(() => { try { worker.kill('SIGKILL'); } catch { /* already dead */ } resolve(); }, 3000);
  });
}

function setupProject(tmp, primaryPort, secondaryPort) {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  execSync('git init -q', { cwd: tmp });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: tmp });

  writeFileSync(join(tmp, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-10083-claim-guard', id: 1, repo_path: tmp, primary: { cli: 'mock', model: 'mock' } },
    collectors: [
      { url: `http://127.0.0.1:${primaryPort}`, token: null },
      { url: `http://127.0.0.1:${secondaryPort}`, token: null, enabled: true, type: 'remote' },
    ],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(tmp, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(tmp, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: null, on_failure: null },
    lanes: { implement: { parallel_limit: 1, max_retries: 1 } },
  }, null, 2));
}

function createTrack(tmp, num) {
  const dir = join(tmp, 'conductor/tracks', `${num}-claim-guard-test`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track ${num}: Claim Guard Test`, '',
    '**Lane**: implement', '**Lane Status**: queue', '**Progress**: 0%', '',
    '## Problem', 'Test.', '', '## Solution', 'Test.', '**Auto Run**: yes',
  ].join('\n'));
  return dir;
}

function startWorker(tmp, extraEnv = {}) {
  const proc = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: tmp,
    env: {
      ...process.env,
      LC_MOCK_CLI: `node ${MOCK_CLI}`,
      MOCK_CLI_DELAY_MS: '2000',
      LC_SKIP_GIT_LOCK: '1',
      LC_SKIP_WORKER_LOCK: '1',
      LC_AUTO_LAUNCH_INTERVAL_MS: '500',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  proc.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return proc;
}

describe('Track AM-10083 Phase 5: claim mirror + pre-spawn cross-collector guard', () => {
  it('TC-5.1: a normal claim mirrors running to the non-primary collector', async () => {
    const tmp = join(ROOT, `.test-tmp-track-10083-guard-5.1-${process.pid}`);
    const { proc: mockA, port: mockAPort } = await startMock();
    const { proc: mockB, port: mockBPort } = await startMock();
    setupProject(tmp, mockAPort, mockBPort);
    createTrack(tmp, '9990');
    const worker = startWorker(tmp);
    try {
      await poll(async () => {
        const s = await getState(mockBPort);
        return s.tracks['9990']?.lane_action_status === 'running' ? s : null;
      }, { label: 'secondary sees the mirrored running claim' });

      const secondary = await getState(mockBPort);
      assert.equal(secondary.tracks['9990'].lane_action_status, 'running');
    } finally {
      await stopWorker(worker);
      mockA.kill('SIGTERM'); mockB.kill('SIGTERM');
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('TC-5.2: a confirmed conflict on the non-primary collector blocks the spawn and posts a comment', async () => {
    const tmp = join(ROOT, `.test-tmp-track-10083-guard-5.2-${process.pid}`);
    const { proc: mockA, port: mockAPort } = await startMock();
    const { proc: mockB, port: mockBPort } = await startMock();
    setupProject(tmp, mockAPort, mockBPort);
    const trackDir = createTrack(tmp, '9991');
    // A generous auto-launch interval — the worker's OWN initial full-file
    // sync (on startup, ignoreInitial:false) would otherwise race the seed
    // below and overwrite it with the file's genuine 'queue' state before
    // the first claim attempt ever reads it.
    const worker = startWorker(tmp, { LC_AUTO_LAUNCH_INTERVAL_MS: '3000' });
    try {
      await poll(async () => {
        const s = await getState(mockBPort);
        return s.tracks['9991'] ? s : null;
      }, { label: 'secondary received the initial file sync for 9991' });

      // NOW seed the conflict — running under SOME OTHER claimant, a real
      // remote token this worker could never have.
      await setTrack(mockBPort, { track_number: '9991', lane_action_status: 'running', claimed_by: 'a-different-workers-token' });

      await poll(async () => {
        const convPath = join(trackDir, 'conversation.md');
        const content = existsSync(convPath) ? readFileSync(convPath, 'utf8') : '';
        return /Spawn refused/i.test(content) ? content : null;
      }, { timeout: 10000, label: 'conflict comment posted to conversation.md' });

      const convContent = readFileSync(join(trackDir, 'conversation.md'), 'utf8');
      assert.match(convContent, /\*\*system\*\*:.*Spawn refused.*already running under a different worker/i);

      // The mock CLI must never have actually been invoked for this track.
      await sleep(1000);
      const primary = await getState(mockAPort);
      assert.notEqual(primary.tracks['9991']?.lane_action_status, 'success',
        'the spawn must have been refused — the mock CLI should never have run to completion');
      // The primary's own claim must have been reverted to queue, not left
      // stuck 'running' forever with no local file ever written to match.
      assert.equal(primary.tracks['9991']?.lane_action_status, 'queue',
        'the claim this cycle won on primary must be reverted after a confirmed conflict, so the track can be retried');
    } finally {
      await stopWorker(worker);
      mockA.kill('SIGTERM'); mockB.kill('SIGTERM');
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('TC-5.3: a non-primary collector reporting THIS worker as the claimant does not block', async () => {
    const tmp = join(ROOT, `.test-tmp-track-10083-guard-5.3-${process.pid}`);
    const { proc: mockA, port: mockAPort } = await startMock();
    const { proc: mockB, port: mockBPort } = await startMock();
    setupProject(tmp, mockAPort, mockBPort);
    createTrack(tmp, '9992');
    const worker = startWorker(tmp, { LC_AUTO_LAUNCH_INTERVAL_MS: '3000' });
    try {
      // Wait for both: registration (to learn this worker's own token on
      // the secondary) AND the initial file sync (so seeding below isn't
      // clobbered by it) before seeding.
      const secondaryState = await poll(async () => {
        const s = await getState(mockBPort);
        return (s.workers.length > 0 && s.tracks['9992']) ? s : null;
      }, { label: 'worker registered with secondary and initial sync landed' });
      const ownToken = secondaryState.workers[0].machine_token;

      await setTrack(mockBPort, { track_number: '9992', lane_action_status: 'running', claimed_by: ownToken });

      // Proceeds all the way to a successful run — self-claim must not block.
      await poll(async () => {
        const s = await getState(mockAPort);
        return s.tracks['9992']?.lane_action_status === 'success' ? s : null;
      }, { timeout: 15000, label: 'track 9992 completes despite secondary showing this worker as claimant' });
    } finally {
      await stopWorker(worker);
      mockA.kill('SIGTERM'); mockB.kill('SIGTERM');
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('TC-5.4: an unreachable non-primary collector never blocks the spawn', async () => {
    const tmp = join(ROOT, `.test-tmp-track-10083-guard-5.4-${process.pid}`);
    const { proc: mockA, port: mockAPort } = await startMock();
    // A port nothing listens on — every request to it fails immediately.
    const deadPort = 1;
    setupProject(tmp, mockAPort, deadPort);
    createTrack(tmp, '9993');
    const worker = startWorker(tmp);
    try {
      await poll(async () => {
        const s = await getState(mockAPort);
        return s.tracks['9993']?.lane_action_status === 'success' ? s : null;
      }, { timeout: 15000, label: 'track 9993 completes despite an unreachable secondary collector' });
    } finally {
      await stopWorker(worker);
      mockA.kill('SIGTERM');
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
