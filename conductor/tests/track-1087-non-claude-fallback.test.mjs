#!/usr/bin/env node
// conductor/tests/track-1087-non-claude-fallback.test.mjs
// Track 1087 Phase 7 Task 4: confirms non-Claude CLIs keep populating
// last_log_tail/active_cli exactly as before Phase 2's change — every
// existing worker-process test already exercises this path implicitly
// (LC_MOCK_CLI resolves cli: 'mock', not 'claude'), but none asserted on
// last_log_tail directly. This closes that gap with a direct assertion.
//
// Run: node --test conductor/tests/track-1087-non-claude-fallback.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1087-fallback');

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
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));
  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 3, max_retries: 1, primary_model: 'mock' },
    lanes: { implement: { parallel_limit: 3, max_retries: 1 } },
  }, null, 2));
}

function writeTrack(num, lane, laneStatus) {
  const dir = join(TMP, 'conductor/tracks', `${num}-fallback-test`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track ${num}: Fallback Test`, '', `**Lane**: ${lane}`, `**Lane Status**: ${laneStatus}`, '**Progress**: 0%',
  ].join('\n'));
}

describe('Track 1087 Phase 7 Task 4: non-Claude CLI fallback has no regression', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);
    writeTrack('4001', 'implement', 'idle');

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '150', LC_SKIP_GIT_LOCK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => process.stdout.write(`[fallback-test] ${d}`));
    worker.stderr.on('data', d => process.stderr.write(`[fallback-test] ${d}`));
  });

  after(() => {
    worker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('a mock (non-claude) CLI run still PATCHes last_log_tail and active_cli exactly as before Phase 2', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '4001', action: 'implement' });

    const state = await poll(async () => {
      const s = await getState(collectorPort);
      const t = s.tracks['4001'];
      return t?.active_cli ? s : null;
    }, { label: 'last_log_tail/active_cli populated for non-claude run' });

    const t = state.tracks['4001'];
    assert.equal(t.active_cli, 'mock', 'non-claude CLIs must still report active_cli — Phase 2 only special-cased cli === "claude"');
    assert.ok(t.last_log_tail, 'non-claude CLIs must still get a last_log_tail snapshot — the fallback Logs tab depends on this');
  });
});
