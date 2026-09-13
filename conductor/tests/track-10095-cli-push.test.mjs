#!/usr/bin/env node
// conductor/tests/track-10095-cli-push.test.mjs
// Track AM-10095 Phase 2 (REQ-3/4/5): bin/lc.mjs's move-family handler
// (plan/implement/review/quality-gate/backlog/done/pulse/rerun/move) used to
// write a lane transition to the track's index.md with a plain
// writeFileSync and push it nowhere — the DB (and therefore the browser
// board) only learned about it once a SEPARATE, already-running sync
// worker noticed the file change via chokidar, debounced, and pushed it.
// With no worker running at all, the DB never learned. This asserts the
// CLI now pushes the same fields it just wrote to PATCH /track/:num/action,
// best-effort, immediately.
//
// Same fixture and mock-collector-subprocess pattern as
// track-10092-move-family-cli.test.mjs (bin/lc.mjs's own regression suite
// for this exact command branch) — every `lc` invocation here is a short
// synchronous script, so execFileSync is used directly rather than
// spawn+Promise. Fixture lives under os.tmpdir() (makeSandbox — never
// inside the repo or a worktree, per the track-10082 hazard), spawns no
// worker process, needs no database.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox, cleanupSandbox } from './helpers/isolated-worker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const LC = join(ROOT, 'bin/lc.mjs');

// ── Mock collector lifecycle (same pattern every other suite in this repo uses) ──

function startMockCollector() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(__dirname, 'mock-collector.mjs')], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

async function resetCollector(port) {
  await fetch(`http://127.0.0.1:${port}/_reset`, { method: 'POST' }).catch(() => {});
}

// ── Sandbox project setup ────────────────────────────────────────────────────

function laneOf(sandbox, folder) {
  const content = readFileSync(join(sandbox, 'conductor/tracks', folder, 'index.md'), 'utf8');
  return {
    lane: content.match(/\*\*Lane\*\*:\s*([^\n]+)/i)?.[1]?.trim(),
    status: content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim(),
    progress: content.match(/\*\*Progress\*\*:\s*(\d+)%/i)?.[1],
  };
}

function writeTrack(sandbox, folder, { lane = 'done', status = 'success', progress = 100 } = {}) {
  const dir = join(sandbox, 'conductor/tracks', folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track ${folder}`,
    '',
    `**Lane**: ${lane}`,
    `**Lane Status**: ${status}`,
    `**Progress**: ${progress}%`,
  ].join('\n'));
}

function writeConfig(sandbox, { mode = 'local-api', collectors = [], projectId = null } = {}) {
  writeFileSync(join(sandbox, '.laneconductor.json'), JSON.stringify({
    mode,
    project: { name: 'test-10095', id: projectId, repo_path: sandbox, primary: { cli: 'mock', model: 'mock' } },
    collectors,
    ui: { port: 8090 },
  }, null, 2));
}

function writeWorkflow(sandbox) {
  mkdirSync(join(sandbox, 'conductor'), { recursive: true });
  writeFileSync(join(sandbox, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: {
      plan: { parallel_limit: 1, max_retries: 1, on_success: 'plan:success', on_failure: 'backlog' },
      implement: { parallel_limit: 1, max_retries: 1, on_success: 'review:queue', on_failure: 'implement:failure' },
      done: { parallel_limit: 1, max_retries: 1 },
    },
  }, null, 2));
}

function runLc(sandbox, args) {
  try {
    const out = execFileSync('node', [LC, ...args], { cwd: sandbox, encoding: 'utf8', timeout: 10000 });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

// ── Single mock collector shared across the main suite ──────────────────────

describe('Track AM-10095: lc move-family pushes its own lane transition to the collector', () => {
  let collectorProc, collectorPort, TMP;

  before(async () => {
    ({ proc: collectorProc, port: collectorPort } = await startMockCollector());
    TMP = makeSandbox('10095-cli-push');
    writeConfig(TMP, { collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }] });
    writeWorkflow(TMP);
  });

  after(() => {
    collectorProc?.kill('SIGTERM');
    cleanupSandbox(TMP);
  });

  beforeEach(async () => {
    await resetCollector(collectorPort);
  });

  it('TC-2.1: "lc implement <n>" sends lane_status and lane_action_status, no progress_percent', async () => {
    writeTrack(TMP, 'AM-10095-sample', { lane: 'done' });
    const { code } = runLc(TMP, ['implement', '10095']);
    assert.equal(code, 0);

    const state = await getState(collectorPort);
    assert.equal(state.actionCalls.length, 1);
    const call = state.actionCalls[0];
    assert.equal(call.track_number, '10095');
    assert.equal(call.body.lane_status, 'implement');
    assert.equal(call.body.lane_action_status, 'queue');
    assert.equal(call.body.progress_percent, undefined);
  });

  it('TC-2.2: "lc pulse <n> <status> <pct>" sends progress_percent and lane_action_status, never lane_status', async () => {
    writeTrack(TMP, 'AM-10095-sample', { lane: 'implement', status: 'running', progress: 0 });
    const { code } = runLc(TMP, ['pulse', '10095', 'running', '50']);
    assert.equal(code, 0);

    const state = await getState(collectorPort);
    assert.equal(state.actionCalls.length, 1);
    const call = state.actionCalls[0];
    assert.equal(call.body.lane_action_status, 'running');
    assert.equal(call.body.progress_percent, 50);
    assert.equal(call.body.lane_status, undefined, 'pulse must never rewrite Lane — the push must mirror that');
  });

  it('TC-2.4: an unreachable collector never blocks the move', () => {
    const unreachable = makeSandbox('10095-unreachable');
    try {
      // Port 1 is privileged and essentially always closed — connection
      // refused immediately, no listener to accidentally bind in a test run.
      writeConfig(unreachable, { collectors: [{ url: 'http://127.0.0.1:1', token: null }] });
      writeWorkflow(unreachable);
      writeTrack(unreachable, 'AM-10095-sample', { lane: 'done' });
      const start = Date.now();
      const { code } = runLc(unreachable, ['plan', '10095']);
      const elapsedMs = Date.now() - start;
      assert.equal(code, 0);
      assert.equal(laneOf(unreachable, 'AM-10095-sample').lane, 'plan');
      assert.ok(elapsedMs < 10000, `expected best-effort push to not block the move (took ${elapsedMs}ms)`);
    } finally {
      cleanupSandbox(unreachable);
    }
  });
});

// ── Degraded/multi-collector paths — each needs its own config, separate describe ──

describe('Track AM-10095: lc move-family push — degraded/multi-collector paths', () => {
  it('TC-2.3: local-fs mode issues no action push at all', async () => {
    const { proc, port } = await startMockCollector();
    const TMP = makeSandbox('10095-local-fs');
    try {
      writeConfig(TMP, { mode: 'local-fs', collectors: [{ url: `http://127.0.0.1:${port}`, token: null }] });
      writeWorkflow(TMP);
      writeTrack(TMP, 'AM-10095-sample', { lane: 'done' });
      const { code } = runLc(TMP, ['plan', '10095']);
      assert.equal(code, 0);
      assert.equal(laneOf(TMP, 'AM-10095-sample').lane, 'plan');
      const state = await getState(port);
      assert.equal(state.actionCalls.length, 0);
    } finally {
      proc.kill('SIGTERM');
      cleanupSandbox(TMP);
    }
  });

  it('TC-2.5: a disabled sibling collector receives no push; the enabled one does', async () => {
    const a = await startMockCollector();
    const b = await startMockCollector();
    const TMP = makeSandbox('10095-disabled-collector');
    try {
      writeConfig(TMP, {
        collectors: [
          { url: `http://127.0.0.1:${a.port}`, token: null, enabled: false },
          { url: `http://127.0.0.1:${b.port}`, token: null },
        ],
      });
      writeWorkflow(TMP);
      writeTrack(TMP, 'AM-10095-sample', { lane: 'done' });
      const { code } = runLc(TMP, ['plan', '10095']);
      assert.equal(code, 0);
      const [stateA, stateB] = await Promise.all([getState(a.port), getState(b.port)]);
      assert.equal(stateA.actionCalls.length, 0);
      assert.equal(stateB.actionCalls.length, 1);
      assert.equal(stateB.actionCalls[0].body.lane_status, 'plan');
    } finally {
      a.proc.kill('SIGTERM');
      b.proc.kill('SIGTERM');
      cleanupSandbox(TMP);
    }
  });

  it('TC-2.6: each collector receives the Authorization token getCollectorToken resolves for its own index', async () => {
    const a = await startMockCollector();
    const b = await startMockCollector();
    const TMP = makeSandbox('10095-per-collector-token');
    try {
      writeConfig(TMP, {
        collectors: [
          { url: `http://127.0.0.1:${a.port}`, token: null },
          { url: `http://127.0.0.1:${b.port}`, token: null },
        ],
      });
      writeWorkflow(TMP);
      writeFileSync(join(TMP, '.env'), [
        'COLLECTOR_0_TOKEN=lc_test_token_collector_zero',
        'COLLECTOR_1_TOKEN=lc_test_token_collector_one',
      ].join('\n') + '\n');
      writeTrack(TMP, 'AM-10095-sample', { lane: 'done' });
      const { code } = runLc(TMP, ['plan', '10095']);
      assert.equal(code, 0);
      const [stateA, stateB] = await Promise.all([getState(a.port), getState(b.port)]);
      assert.equal(stateA.actionCalls.length, 1);
      assert.equal(stateB.actionCalls.length, 1);
      assert.equal(stateA.actionCalls[0].bearerToken, 'lc_test_token_collector_zero');
      assert.equal(stateB.actionCalls[0].bearerToken, 'lc_test_token_collector_one');
    } finally {
      a.proc.kill('SIGTERM');
      b.proc.kill('SIGTERM');
      cleanupSandbox(TMP);
    }
  });
});
