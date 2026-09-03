#!/usr/bin/env node
// conductor/tests/track-1102-f8-dispatch-failure-reporting.test.mjs
// Track 1102 F8: a failed lane-action dispatch must report failure like
// every other dispatch handler (chat, deploy, create-project,
// provision-worker) does — not silently stay 'claimed' forever.
//
// Reproduces a real spawnCli-throws trigger: checkAndClaimGitLock() throws
// when the track is already locked by someone else (contention with
// another worker/user). (A git-repo-with-no-commits trigger, F7's
// original failure mode, turns out to now self-heal: checkAndClaimGitLock
// itself commits the track's files before createWorktree runs, giving a
// fresh repo its first commit — so lock contention is the reliable way
// to exercise this path today.) Before this fix, checkDispatchInbox()'s
// lane-action branch called spawnCli() with no try/catch: the dispatch
// stayed 'claimed', the track's own **Lane Status** marker (already
// flipped to 'running' right before the call) never got reverted, and
// the uncaught throw aborted the rest of that poll tick's dispatches too.
//
// Run: node --test conductor/tests/track-1102-f8-dispatch-failure-reporting.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1102-f8');

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
    lanes: { plan: { parallel_limit: 1, max_retries: 1 } },
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

  // Force checkAndClaimGitLock() to throw deterministically: a fresh
  // (non-stale) lock already held by a different machine/pid. This is a
  // real trigger (lock contention with another worker/user) and, unlike
  // the git-repo-with-no-commits case, isn't self-healed by anything else
  // in the lock-claim path.
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

describe('Track 1102 F8: lane-action dispatch reports failure instead of hanging forever', () => {
  let collectorProc, collectorPort, worker, trackDir;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    trackDir = setupProject(collectorPort);

    // Deliberately NOT setting LC_SKIP_GIT_LOCK — this test needs the
    // real git-lock/worktree path to run and fail.
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

  it('reports the dispatch as failed (with the real error) instead of leaving it claimed forever', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, {
      worker_id: workerId,
      action: 'plan',
      track_number: '001',
    });

    const finalState = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'plan');
      return d && d.status !== 'pending' && d.status !== 'claimed' ? s : null;
    }, { timeout: 20000, label: 'plan dispatch resolves out of claimed/pending' });

    const entry = finalState.dispatch.find(e => e.action === 'plan');
    assert.equal(entry.status, 'failed');
    assert.match(entry.result, /locked by/i);
  });

  it('does not leave the track\'s Lane Status marker stuck on "running"', async () => {
    // The failure above already happened in the previous test; give the
    // worker's revert-write a moment in case of any residual async lag.
    await sleep(500);
    const content = readFileSync(join(trackDir, 'index.md'), 'utf8');
    assert.doesNotMatch(content, /\*\*Lane Status\*\*:\s*running/i);
  });

  it('posts the failure to conversation.md — visible in the Inbox, not just the dispatch table', async () => {
    // Track 10024/10012 dogfooding session: a lock-contention rejection was
    // only ever visible by digging through worker_dispatch rows and lock
    // files by hand — conversation.md (what the Inbox/Conversation tab
    // actually reads) had no trace of it, so an entirely ordinary "another
    // run was already in progress" bounce looked like an unexplained stall.
    const convPath = join(trackDir, 'conversation.md');
    const content = existsSync(convPath) ? readFileSync(convPath, 'utf8') : '';
    assert.match(content, /\*\*system\*\*:.*plan could not start:.*locked by/i);
  });
});

// Track 10050 (2026-09-03): found live — an implement dispatch blocked by
// lock contention reverted "Lane Status" to 'success', because that was
// the prior lane's (plan's) leftover completed-status string still
// sitting in the file when the implement dispatch began. The track then
// read as a bogus completed implement at 0% progress instead of a
// retriable failure. Same trigger as the suite above (pre-existing lock
// contention), but the fixture starts at 'success' — the exact stale
// value a just-finished prior lane leaves behind — to prove the revert
// path no longer preserves it verbatim.
describe('Track 10050: spawn-failure revert must not preserve a stale outcome status from a prior lane', () => {
  let collectorProc, collectorPort, worker, trackDir;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    trackDir = setupProject(collectorPort);
    // Overwrite the fixture: simulate a track whose PLAN lane just
    // finished successfully, now sitting in the implement lane's queue —
    // exactly the shape that produced the live bug.
    writeFileSync(join(trackDir, 'index.md'), [
      '# Track 001: Test Track',
      '',
      '**Lane**: implement',
      '**Lane Status**: success',
      '**Progress**: 0%',
      '',
      '## Problem',
      'Test problem.',
    ].join('\n'));

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

  it('reverts a blocked implement dispatch to "queue", not the stale "success" left by the previous lane', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, {
      worker_id: workerId,
      action: 'implement',
      track_number: '001',
    });

    await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'implement');
      return d && d.status !== 'pending' && d.status !== 'claimed' ? s : null;
    }, { timeout: 20000, label: 'implement dispatch resolves out of claimed/pending' });

    await sleep(500);
    const content = readFileSync(join(trackDir, 'index.md'), 'utf8');
    assert.match(content, /\*\*Lane Status\*\*:\s*queue/i,
      'a failed spawn must leave Lane Status as queue (retriable), never a stale outcome status borrowed from the lane this dispatch superseded');
    assert.doesNotMatch(content, /\*\*Lane Status\*\*:\s*success/i);
  });
});
