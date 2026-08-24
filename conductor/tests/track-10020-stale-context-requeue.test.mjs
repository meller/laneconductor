#!/usr/bin/env node
// conductor/tests/track-10020-stale-context-requeue.test.mjs
// Track 10020: a human can post a conversation.md message any time after a
// dispatched run's context was already frozen — not a millisecond race, a
// deterministic architectural gap: nothing re-reads conversation.md for the
// rest of a run, however long it takes. Caught live on track 1102: a human
// wrote "f10c go, f15 can you verify with playwright" into conversation.md
// 59 SECONDS after the current implement dispatch had already started —
// the run's own closing text said "Nothing new has arrived from you yet",
// which was true from its own frozen view and still wrong by completion.
//
// Fix: spawnCli captures contextFrozenAt right when conversation.md is read
// into the prompt. Its exit handler compares that against conversation.md's
// own mtime — if the file changed after the freeze, this run's outcome is
// stale and must not be allowed to stand: no lane transition, no 100%
// progress, and lane_action_status forced to 'queue' so the very next
// dispatch starts with fresh context that DOES include the message —
// instead of the message silently waiting a full extra cycle (or being
// misread as "nothing new" forever, if the run happened to reach a
// terminal lane).
//
// Run: node --test conductor/tests/track-10020-stale-context-requeue.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10020-stale-context');

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
const convPath = join(trackDir, 'conversation.md');

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
  // on_success configured so a genuinely-fresh success WOULD advance lanes —
  // proving the stale case suppresses that, not just coincidentally landing
  // on 'queue' because nothing was configured to move it anyway.
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: { plan: { parallel_limit: 1, max_retries: 1, on_success: 'review:queue' } },
  }, null, 2));

  mkdirSync(trackDir, { recursive: true });
  writeFileSync(indexPath, [
    '# Track 001: Test Track',
    '',
    '**Lane**: plan',
    '**Lane Status**: queue',
    '**Progress**: 0%',
    '',
    '## Problem',
    'Test problem.',
  ].join('\n'));
  writeFileSync(convPath, '');
}

describe('Track 10020: a mid-run conversation.md message must not be silently missed', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    setupProject(collectorPort);

    // Generous delay so there's a real window to append a human message
    // mid-run, well after spawnCli's own context-gathering has already run.
    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_SKIP_GIT_LOCK: '1',
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        MOCK_CLI_DELAY_MS: '2500',
        MOCK_CLI_PROGRESS_INTERVAL_MS: '300',
        LC_DISPATCH_POLL_MS: '300',
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

  it('forces the track back to queue at the same lane instead of finalizing on stale context', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'plan', track_number: '001' });

    // Wait until the dispatch has been claimed and spawnCli has started
    // (marked "running") — its context is now frozen.
    await poll(async () => {
      const content = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
      return /\*\*Lane Status\*\*:\s*running/i.test(content) ? true : null;
    }, { label: 'dispatch claimed and marked running' });

    // Simulate a human posting a message mid-run — well after context froze,
    // well before the mock CLI's 2.5s delay elapses.
    await sleep(500);
    appendFileSync(convPath, '\n> **human**: go ahead and also verify with playwright\n');

    // Let the run finish naturally (isSuccess === true — a normal, clean
    // exit; nothing about the run itself failed).
    const finalState = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'plan');
      return d && d.status === 'done' ? s : null;
    }, { timeout: 15000, label: 'dispatch resolves' });

    const finalEntry = finalState.dispatch.find(e => e.action === 'plan');
    assert.equal(finalEntry.status, 'done', 'the dispatch itself still completes normally');

    // The critical assertions: despite a clean exit and an on_success
    // transition configured for 'plan', the track must NOT have advanced to
    // 'review' or been left at a terminal 'success' — it must be back at
    // 'queue', same lane, ready for an immediate fresh re-run.
    const content = readFileSync(indexPath, 'utf8');
    assert.match(content, /\*\*Lane\*\*:\s*plan/i, 'must NOT have advanced to review — this run\'s success is stale, not trustworthy');
    assert.match(content, /\*\*Lane Status\*\*:\s*queue/i, 'must be back at queue, not left at success, so the next dispatch picks up the fresh message');
    assert.doesNotMatch(content, /\*\*Progress\*\*:\s*100%/, 'must not have been marked 100% complete off a stale run');
  });
});
