#!/usr/bin/env node
// conductor/tests/track-1102-f9-index-producer.test.mjs
// Track 1102 F9 investigation: find the actual producer of the gutted
// index.md stub (a guard already exists to reject it — this test is
// about finding and fixing the root cause the guard was papering over).
//
// Reproduction: a track with substantial pre-run content in the PRIMARY
// checkout's index.md. Dispatch a lane action for it — a real worktree
// gets created. While the (mocked) CLI is "running" inside that worktree,
// this test writes DIFFERENT, ALSO-substantial "the agent finished its
// real work" content directly into the WORKTREE's copy of index.md
// (Lane Status: success, a unique marker string). Then the mock CLI
// exits and spawnCli's exit handler (the "Phase 5" file update + the
// worktree->primary copy-back) runs for real.
//
// Hypothesis: spawnCli's "Phase 5" block (conductor/laneconductor.sync.mjs,
// ~line 3907) READS the primary checkout's index.md
// (`join(process.cwd(), 'conductor', 'tracks', ...)`) but WRITES the
// regex-patched result to the WORKTREE's index.md
// (`join(worktreePath || process.cwd(), ...)`) — an asymmetric read/write
// location. If true, Phase 5 clobbers the agent's own finished work in
// the worktree with the STALE primary content (just a few markers
// patched), and that clobbered version is what copy-back then pushes
// into the primary — losing the agent's real work even though it never
// touched the primary directly.
//
// Run: node --test conductor/tests/track-1102-f9-index-producer.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1102-f9');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 15000, interval = 200, label = '' } = {}) {
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

const PRIMARY_INDEX = [
  '# Track 001: Real Track With A Full Body',
  '',
  '**Lane**: plan',
  '**Lane Status**: queue',
  '**Progress**: 0%',
  '**Summary**: original pre-run summary, should not leak into the post-run version',
  '',
  '## Problem',
  'This paragraph must NOT end up as the post-run Summary — if it does,',
  'that proves the stale-primary-content theory.',
  '',
  '## Solution',
  'Some real solution text that must survive the run.',
  '',
  '## Meta',
  'Some meta section that must survive the run.',
].join('\n');

const WORKTREE_MARKER = 'UNIQUE_AGENT_FINISHED_WORK_MARKER_98765';
const AGENT_INDEX = [
  '# Track 001: Real Track With A Full Body',
  '',
  '**Lane**: plan',
  '**Lane Status**: success',
  '**Progress**: 100%',
  `**Summary**: ${WORKTREE_MARKER}`,
  '',
  '## Problem',
  'This paragraph must NOT end up as the post-run Summary — if it does,',
  'that proves the stale-primary-content theory.',
  '',
  '## Solution',
  `The agent actually did real work here: ${WORKTREE_MARKER}.`,
  '',
  '## Meta',
  'Some meta section that must survive the run.',
].join('\n');

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execSync('git init -q', { cwd: TMP });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' }, worktree_lifecycle: 'per-cycle' },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: { plan: { parallel_limit: 1, max_retries: 1 } },
  }, null, 2));

  const trackDir = join(TMP, 'conductor/tracks/001-real-track-with-a-full-body');
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), PRIMARY_INDEX);
  writeFileSync(join(trackDir, 'plan.md'), '# Plan\n\n## Phase 1\n\n**Problem**: unrelated plan.md problem text.\n');

  execSync('git add -A', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: TMP });

  return trackDir;
}

describe('Track 1102 F9: does the exit handler clobber the worktree\'s own finished work?', () => {
  let collectorProc, collectorPort, worker, trackDir;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    trackDir = setupProject(collectorPort);

    // Real git lock/worktree path — deliberately NOT setting LC_SKIP_GIT_LOCK.
    // MOCK_CLI_DELAY_MS gives this test a window to write into the worktree
    // while the "agent" is still "running".
    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '2500', LC_DISPATCH_POLL_MS: '500' },
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

  it('preserves the worktree\'s own finished index.md content in the primary checkout after the run', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'plan', track_number: '001' });

    // Wait for the real worktree to appear, then simulate "the agent
    // finished its real work" by writing AGENT_INDEX into it — before the
    // mock CLI's 2.5s delay elapses and the exit handler runs.
    const worktreeIndexPath = join(TMP, '.worktrees', '001', 'conductor/tracks/001-real-track-with-a-full-body', 'index.md');
    await poll(async () => existsSync(worktreeIndexPath) || null, { label: 'worktree index.md exists' });
    writeFileSync(worktreeIndexPath, AGENT_INDEX, 'utf8');

    // Wait for the dispatch/lane-action run to actually finish (mock CLI
    // exits after MOCK_CLI_DELAY_MS, then the exit handler runs) — must
    // wait for the RUN to leave 'running', not just leave 'queue' (which
    // happens immediately on claim, long before the exit handler).
    await poll(async () => {
      const content = readFileSync(join(trackDir, 'index.md'), 'utf8');
      return /\*\*Lane Status\*\*:\s*running/i.test(content) ? null : content;
    }, { timeout: 15000, interval: 300, label: 'primary index.md leaves Lane Status: running' });

    await sleep(500); // let any trailing writes/commits settle

    const primaryContent = readFileSync(trackDir + '/index.md', 'utf8');
    console.log('--- PRIMARY index.md after run ---\n' + primaryContent + '\n--- end ---');

    assert.ok(
      primaryContent.includes(WORKTREE_MARKER),
      `Primary checkout's index.md must contain the worktree's own finished-work marker after the run — it doesn't, meaning the exit handler clobbered the agent's real work.\n\nActual content:\n${primaryContent}`
    );
  });
});
