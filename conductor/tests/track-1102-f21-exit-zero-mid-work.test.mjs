#!/usr/bin/env node
// conductor/tests/track-1102-f21-exit-zero-mid-work.test.mjs
// Track 1102 F21 (original, non-escalated variant): reproduces "an agent
// backgrounds a long command at turn end and its CLI process exits 0
// mid-work" by using mock-cli.mjs, which — like a real agent that never
// gets to write its own final **Lane Status** marker — exits 0 without
// ever touching index.md. Empirical, not assumed: earlier reading of
// spawnCli's exit handler's Phase 5 block suggested it unconditionally
// overwrites Lane Status away from 'running' on exit 0, which would seem
// to contradict the original finding's claim that the file was left
// showing 'running' — reproducing for real settles which is true before
// writing any fix.
//
// Run: node --test conductor/tests/track-1102-f21-exit-zero-mid-work.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1102-f21-original');

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
  '# Track 001: Mid Work Exit',
  '',
  '**Lane**: implement',
  '**Lane Status**: queue',
  '**Progress**: 40%',
  '',
  '## Problem',
  'Real work in progress.',
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
    lanes: { implement: { parallel_limit: 1, max_retries: 1, on_success: 'review:queue', on_failure: 'implement:failure' } },
  }, null, 2));

  const trackDir = join(TMP, 'conductor/tracks/001-mid-work-exit');
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), PRIMARY_INDEX);
  writeFileSync(join(trackDir, 'plan.md'), '# Plan\n\n## Phase 1\n\n**Problem**: unrelated.\n');

  execSync('git add -A', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: TMP });

  return trackDir;
}

describe('Track 1102 F21 (original variant): mock CLI exits 0 without ever touching index.md', () => {
  let collectorProc, collectorPort, worker, trackDir;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    trackDir = setupProject(collectorPort);

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '300', LC_DISPATCH_POLL_MS: '500',
        // The ended-mid-work check is gated on cli !== 'mock' (see the
        // production comment at its declaration) — LC_MOCK_CLI alone
        // always reports 'mock', so this test needs the override to
        // exercise the check while still running the mock binary.
        LC_MOCK_CLI_REPORTED_CLI: 'claude',
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

  it('does NOT advance the lane or report success — reports a distinguishable ended-mid-work outcome instead', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state0.workers[0].id;

    const dispatchId = await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'implement', track_number: '001' });

    await poll(async () => {
      const s = await getState(collectorPort);
      const entry = s.dispatch.find(d => d.id === dispatchId);
      return entry && entry.status !== 'claimed' && entry.status !== 'pending' ? entry : null;
    }, { timeout: 15000, interval: 300, label: 'dispatch leaves claimed/pending' });

    await sleep(500);

    const primaryContent = readFileSync(join(trackDir, 'index.md'), 'utf8');
    console.log('--- PRIMARY index.md after mock CLI exit 0 ---\n' + primaryContent + '\n--- end ---');

    // Must NOT have advanced to the review lane (the normal on_success
    // transition) — this run never actually finished.
    assert.match(primaryContent, /\*\*Lane\*\*:\s*implement/i,
      `Lane must stay 'implement', not advance — got:\n${primaryContent}`);
    // Must NOT report 100% progress — nothing was verified complete.
    assert.doesNotMatch(primaryContent, /\*\*Progress\*\*:\s*100%/,
      `Progress must not be forced to 100% on an ended-mid-work exit — got:\n${primaryContent}`);

    const finalState = await getState(collectorPort);
    const finalDispatch = finalState.dispatch.find(d => d.id === dispatchId);
    console.log('--- final dispatch entry ---\n' + JSON.stringify(finalDispatch, null, 2) + '\n--- end ---');

    const convPath = join(trackDir, 'conversation.md');
    const convContent = existsSync(convPath) ? readFileSync(convPath, 'utf8') : '';
    assert.match(convContent, /⚠️ Run ended mid-work/,
      `conversation.md must carry a distinguishable ⚠️ ended-mid-work comment — got:\n${convContent}`);
  });
});
