#!/usr/bin/env node
// conductor/tests/track-10035-removed-dispatch-actions.test.mjs
// Track 10035 Phase 5 (TC-5.1): merge-worktree/create-pr/merge-pr/
// ai-resolve-conflict were deleted along with the UI buttons that
// dispatched them — merging is the done lane's own standard lane action
// now. A stray dispatch of one of these (e.g. a cached UI tab that hasn't
// reloaded since this track shipped) must fail cleanly with an
// unknown-action result, not silently fall through to the generic
// "Lane action dispatch" fallback and try to spawn a CLI against a
// nonsense command.
//
// Run: node --test conductor/tests/track-10035-removed-dispatch-actions.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10035-removed-dispatch');

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
  }, null, 2));
}

describe('Track 10035 Phase 5 (TC-5.1): removed dispatch actions fail cleanly', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    setupProject(collectorPort);

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, LC_SKIP_GIT_LOCK: '1', LC_DISPATCH_POLL_MS: '500' },
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

  for (const action of ['merge-worktree', 'create-pr', 'merge-pr', 'ai-resolve-conflict']) {
    it(`dispatching '${action}' resolves failed with an unknown-action result, not a spawned CLI run`, async () => {
      const state0 = await poll(async () => {
        const s = await getState(collectorPort);
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registered' });
      const workerId = state0.workers[0].id;

      await enqueueDispatch(collectorPort, {
        worker_id: workerId,
        action,
        track_number: '9999',
        payload: { track_number: '9999' },
      });

      const finalState = await poll(async () => {
        const s = await getState(collectorPort);
        const d = s.dispatch.find(e => e.action === action);
        return d && d.status !== 'pending' && d.status !== 'claimed' ? s : null;
      }, { timeout: 10000, label: `${action} dispatch resolves` });

      const entry = finalState.dispatch.find(e => e.action === action);
      assert.equal(entry.status, 'failed');
      assert.match(entry.result, /removed/i);
    });
  }
});

// TC-5.2: every surviving handler posts its result to conversation.md
// through the shared postDispatchResultComment() helper (REQ-13) —
// checked here for remove-worktree specifically, since before this track
// it posted NO comment at all (a real failure was as invisible as the
// merge-pr gap track 1119 found live). discard-track already posted one
// before this track; the refactor to the shared helper is covered
// implicitly by remove-worktree passing, since both go through the same
// function now.
describe('Track 10035 Phase 5 (TC-5.2): remove-worktree posts its result to conversation.md', () => {
  let collectorProc, collectorPort, worker;
  const TRACK_NUM = '9998';
  const TRACK_DIR = `${TRACK_NUM}-remove-worktree-comment`;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    setupProject(collectorPort);

    // A real track folder + a real linked git worktree on branch
    // track-9998, so auditWorktrees() has something live to find and
    // remove — remove-worktree resolves the track number from the
    // matched row, not from the dispatch payload directly.
    const trackDir = join(TMP, 'conductor/tracks', TRACK_DIR);
    mkdirSync(trackDir, { recursive: true });
    writeFileSync(join(trackDir, 'index.md'), [
      `# Track ${TRACK_NUM}: Remove Worktree Comment`, '',
      '**Lane**: implement', '**Lane Status**: queue', '**Progress**: 10%', '',
    ].join('\n'));
    writeFileSync(join(trackDir, 'conversation.md'), '');
    execSync('git add -A', { cwd: TMP });
    execSync('git -c user.email=t@t -c user.name=t commit -q -m "seed track"', { cwd: TMP });
    execSync(`git worktree add -q -B track-${TRACK_NUM} .worktrees/${TRACK_NUM} HEAD`, { cwd: TMP });
    // auditWorktrees() omits any branch that's a plain ancestor of main
    // (nothing to report — see its own isAncestor early-continue), so the
    // branch needs at least one commit of its own to actually surface as a
    // live row for remove-worktree to find.
    const worktreePath = join(TMP, '.worktrees', TRACK_NUM);
    writeFileSync(join(worktreePath, 'scratch.txt'), 'wip\n');
    execSync('git add -A', { cwd: worktreePath });
    execSync('git -c user.email=t@t -c user.name=t commit -q -m "wip on track-9998"', { cwd: worktreePath });

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, LC_SKIP_GIT_LOCK: '1', LC_DISPATCH_POLL_MS: '500' },
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

  it('posts a system comment to the matched track\'s conversation.md', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, {
      worker_id: workerId,
      action: 'remove-worktree',
      track_number: null,
      payload: { branch: `track-${TRACK_NUM}` },
    });

    const finalState = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'remove-worktree');
      return d && d.status !== 'pending' && d.status !== 'claimed' ? s : null;
    }, { timeout: 10000, label: 'remove-worktree dispatch resolves' });

    const entry = finalState.dispatch.find(e => e.action === 'remove-worktree');
    assert.equal(entry.status, 'done');

    const conversationPath = join(TMP, 'conductor/tracks', TRACK_DIR, 'conversation.md');
    const conversation = await poll(() => {
      if (!existsSync(conversationPath)) return null;
      const c = readFileSync(conversationPath, 'utf8');
      return c.includes('> **system**:') ? c : null;
    }, { timeout: 5000, label: 'result comment appended to conversation.md' });
    assert.match(conversation, /Removed worktree/);
  });
});
