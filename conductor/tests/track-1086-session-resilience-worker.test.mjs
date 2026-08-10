#!/usr/bin/env node
// conductor/tests/track-1086-session-resilience-worker.test.mjs
// Track 1086 Phase 4 Task 1: --resume failure detection + fallback,
// verified end-to-end against a real worker process.
//
// Scenario: a track already has a (broken — pruned/corrupted) session on
// record. The worker's first dispatched call tries to --resume it, the
// CLI reports "session not found", and the worker must invalidate the
// stale session rather than just marking the dispatch failed. A second
// dispatch afterward must mint a genuinely NEW session and succeed.
//
// Run: node --test conductor/tests/track-1086-session-resilience-worker.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1086-resilience');
const SENTINEL = join(TMP, '.resume-failure-sentinel');

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

async function seedSession(port, trackNumber, claudeSessionId) {
  await fetch(`http://127.0.0.1:${port}/track/${trackNumber}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claude_session_id: claudeSessionId }),
  });
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

describe('Track 1086 Phase 4 Task 1: resume-failure fallback', () => {
  let collectorProc, collectorPort, worker, log = '';

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;

    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

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
    // max_retries: 0 so the first (resume-failure) attempt resolves to an
    // unambiguous **Lane Status**: failure, not queue — with retries
    // allowed, resolveTransition requeues instead (status stays 'queue',
    // which reconcileActiveDispatch correctly reports as 'done', not
    // 'failed' — see track 1085's plan.md for why that ambiguity is
    // inherent to index.md alone and not something dispatch tracking
    // resolves). Not relevant to what THIS test verifies.
    writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
      global: { total_parallel_limit: 3 },
      defaults: { parallel_limit: 3, max_retries: 0, primary_model: 'mock' },
      lanes: { implement: { parallel_limit: 3, max_retries: 0 } },
    }, null, 2));
    writeTrack('4001', 'implement', 'idle');

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        MOCK_CLI_DELAY_MS: '150',
        MOCK_CLI_RESUME_FAILURE_SENTINEL: SENTINEL,
        LC_SKIP_GIT_LOCK: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => { log += d.toString(); process.stdout.write(`[resilience-worker] ${d}`); });
    worker.stderr.on('data', d => { log += d.toString(); process.stderr.write(`[resilience-worker] ${d}`); });
  });

  after(() => {
    worker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('invalidates a broken session on resume-failure, then mints a fresh one on the next attempt', async () => {
    const state = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state.workers[0].id;

    // Seed a pre-existing (broken) session, matching a real pruned/corrupted
    // one — resolveTrackSession will find this and try --resume with it.
    const brokenSessionId = '11111111-1111-1111-1111-111111111111';
    await seedSession(collectorPort, '4001', brokenSessionId);
    writeFileSync(SENTINEL, 'fail this attempt');

    await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '4001', action: 'implement' });

    // The attempt fails (mock-cli exits 1 simulating the resume error) —
    // the dispatch entry should be reported failed...
    const afterFirst = await poll(async () => {
      const s = await getState(collectorPort);
      const entry = s.dispatch.find(d => d.track_number === '4001');
      return (entry && entry.status !== 'pending' && entry.status !== 'claimed') ? s : null;
    }, { label: 'first (resume-failure) dispatch settles', timeout: 20000 });
    const firstEntry = afterFirst.dispatch.find(d => d.track_number === '4001');
    assert.equal(firstEntry.status, 'failed', 'a resume-failure should still surface as a failed dispatch, not silently succeed');

    // ...but the stale session should have been invalidated, not left in
    // place to break every future attempt the same way.
    await poll(async () => {
      const s = await getState(collectorPort);
      return s.sessions['4001'] === undefined ? s : null;
    }, { label: 'stale session invalidated' });

    // Now let a real attempt succeed: clear the sentinel, dispatch again.
    rmSync(SENTINEL, { force: true });
    await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '4001', action: 'implement' });

    await poll(async () => (laneStatusOf('4001') === 'success') || null, { label: 'second dispatch (cold-start) succeeds' });

    const finalState = await poll(async () => {
      const s = await getState(collectorPort);
      return s.sessions['4001'] ? s : null;
    }, { label: 'fresh session persisted' });
    assert.notEqual(finalState.sessions['4001'], brokenSessionId, 'the retry must mint a genuinely new session, not reuse the broken one');
    assert.match(finalState.sessions['4001'], /^[0-9a-f-]{36}$/);
  });
});
