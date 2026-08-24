#!/usr/bin/env node
// conductor/tests/track-10024-auto-complete-spawn-failure.test.mjs
//
// Dogfooding session on 2026-08-24 (tracks 10024/10012): startNextAutoCompleteStage
// called spawnCli() with no try/catch at all — unlike checkDispatchInbox's
// identical call (Track 1102 F8), which already had one. A lock-contention
// rejection there (e.g. a re-triggered auto-complete-track dispatch racing
// an already-running stage for the same track — observed live) threw
// straight out of the async function: the track's own **Lane Status**
// marker (already flipped to 'running' right before the call) never got
// reverted, the dispatch row stayed 'claimed' forever, and conversation.md
// (what the Inbox actually reads) had no trace of what happened — an
// entirely ordinary "another run was already in progress" bounce looked
// like an unexplained stall.
//
// Run: node --test conductor/tests/track-10024-auto-complete-spawn-failure.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10024-auto-complete-spawn-failure');

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
    lanes: { plan: { parallel_limit: 1, max_retries: 1, on_success: 'plan:success' } },
  }, null, 2));

  const trackDir = join(TMP, 'conductor/tracks/001-test-track');
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    '# Track 001: Test Track',
    '',
    '**Lane**: plan',
    '**Lane Status**: queue',
    '**Progress**: 0%',
    '',
    '## Problem',
    'Test problem.',
  ].join('\n'));

  // Same deterministic spawnCli-throws trigger as Track 1102 F8: a fresh,
  // real lock already held by a different machine/pid.
  mkdirSync(join(TMP, '.conductor/locks'), { recursive: true });
  writeFileSync(join(TMP, '.conductor/locks/001.lock'), JSON.stringify({
    user: 'someone-else',
    machine: 'some-other-machine',
    pid: 999999999,
    started_at: new Date().toISOString(),
    cli: 'claude',
    track_number: '001',
  }, null, 2));

  return trackDir;
}

describe('Track 10024: auto-complete-track reports a spawn failure instead of throwing uncaught', () => {
  let collectorProc, collectorPort, worker, trackDir;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    trackDir = setupProject(collectorPort);

    // Deliberately NOT setting LC_SKIP_GIT_LOCK — this test needs the real
    // git-lock/worktree path to run and fail.
    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '150', LC_DISPATCH_POLL_MS: '500' },
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

  it('reports the auto-complete-track dispatch as failed instead of leaving it claimed forever', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, {
      worker_id: workerId,
      action: 'auto-complete-track',
      track_number: '001',
      payload: { track_number: '001' },
    });

    const finalState = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'auto-complete-track');
      return d && d.status !== 'pending' && d.status !== 'claimed' ? s : null;
    }, { timeout: 20000, label: 'auto-complete-track dispatch resolves out of claimed/pending' });

    const entry = finalState.dispatch.find(e => e.action === 'auto-complete-track');
    assert.equal(entry.status, 'failed');
    assert.match(entry.result, /could not start plan.*locked by/i);
  });

  it('does not leave the track\'s Lane Status marker stuck on "running"', async () => {
    await sleep(500);
    const content = readFileSync(join(trackDir, 'index.md'), 'utf8');
    assert.doesNotMatch(content, /\*\*Lane Status\*\*:\s*running/i);
  });

  it('posts the failure to conversation.md — visible in the Inbox, not just the dispatch table', async () => {
    const convPath = join(trackDir, 'conversation.md');
    const content = existsSync(convPath) ? readFileSync(convPath, 'utf8') : '';
    assert.match(content, /\*\*system\*\*:.*could not start plan.*locked by/i);
  });
});
