#!/usr/bin/env node
// conductor/tests/local-api-e2e.test.mjs
// End-to-end tests for the LaneConductor worker in local-api and remote-api modes.
//
// Tests (local-api mode):
//   1. Parallelism: max 1 per lane (parallel_limit: 1)
//   2. on_success: implement → review
//   3. on_failure: quality-gate exhausts retries → failure status
//   4. Full pipeline: implement → review → quality-gate → done
//   5. Custom transition: review → implement:queue on failure
//
// Test (remote-api mode):
//   6. Explicit config.mode: 'remote-api' is respected (same as local-api flow)
//
// Track 10045 Phase 5: migrated to the shared isolated-worker helper
// (conductor/tests/helpers/isolated-worker.mjs). Previously this suite
// spawned the worker with a sandbox at `join(ROOT, '.test-tmp-local-api')`
// — inside the repo — which is the exact mechanism that let a worktree-
// launched run of this suite leak into the real, currently-running
// Collector API instead of the mock one (see
// conductor/tracks/AM-10045-e2e-tests-leak-real-worker-from-worktree/spec.md).
// The sandbox now lives outside the repo entirely, in its own git repo, so
// `resolvePrimaryRepoRoot()` structurally cannot redirect it anywhere.
//
// Run: node --test conductor/tests/local-api-e2e.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { makeSandbox, cleanupSandbox, startIsolatedWorker, stopWorker } from './helpers/isolated-worker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 15000, interval = 300, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

// ── Mock collector lifecycle ───────────────────────────────────────────────────
// Unrelated to the isolation bug — this is the TEST's own stand-in for a
// real Collector API, not a laneconductor.sync.mjs spawn.

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

// ── Project setup ─────────────────────────────────────────────────────────────

// Writes this suite's own config into an already-created sandbox (from
// makeSandbox()) — mode is explicit here rather than relying on the
// helper's own default so the 'remote-api' describe block below can use
// the exact same setup function.
async function setupProject(sandbox, collectorPort, mode = 'local-api') {
  // Reset mock collector state so previous test tracks don't interfere
  await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' }).catch(() => {});

  const collectorUrl = `http://127.0.0.1:${collectorPort}`;

  writeFileSync(join(sandbox, '.laneconductor.json'), JSON.stringify({
    mode,
    project: { name: 'test-project', id: 1, repo_path: sandbox, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: collectorUrl, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(sandbox, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(sandbox, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: null, on_failure: null },
    lanes: {
      plan:           { parallel_limit: 1, max_retries: 1, on_success: 'plan',      on_failure: 'backlog' },
      implement:      { parallel_limit: 1, max_retries: 1, on_success: 'review',    on_failure: 'implement' },
      review:         { parallel_limit: 1, max_retries: 1, on_success: 'quality-gate', on_failure: 'implement' },
      'quality-gate': { parallel_limit: 1, max_retries: 1, on_success: 'done',      on_failure: 'review' },
    },
  }, null, 2));
}

// Track 10017: auto_run defaults to true — this suite tests local/remote-api
// sync behavior, not the auto-run gate itself (which has its own dedicated
// coverage in local-fs-e2e.test.mjs and track-10017-auto-run.test.mjs).
function createTrack(tracksDir, num, lane, laneStatus = 'queue') {
  const dir = join(tracksDir, `${num}-test-track-${num}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track ${num}: Test Track ${num}`,
    '',
    `**Lane**: ${lane}`,
    `**Lane Status**: ${laneStatus}`,
    '**Progress**: 0%',
    '',
    '## Problem',
    'Test problem.',
    '',
    '## Solution',
    'Test solution.',
    '**Auto Run**: yes',
  ].join('\n'));
}

function startWorker(sandbox, collectorPort, env = {}) {
  return startIsolatedWorker({
    sandbox,
    collectorPort,
    env: {
      LC_MOCK_CLI: `node ${MOCK_CLI}`,
      MOCK_CLI_DELAY_MS: '200',
      // Preserved from the pre-migration version of this suite even
      // though the sandbox is now a real git repo of its own (so the
      // ORIGINAL reason this was needed — resolvePrimaryRepoRoot()
      // walking past a non-git TMP into the real checkout and colliding
      // with whatever live worker is running for this project —
      // structurally cannot happen anymore, see Phase 1). Kept
      // unconditionally rather than re-deriving whether it's still
      // needed, to keep this migration a pure spawn-mechanism change and
      // not risk altering this suite's git-lock/worktree behavior or
      // timing as a side effect.
      LC_SKIP_GIT_LOCK: '1',
      ...env,
    },
  });
}

// ── Tests — local-api mode ────────────────────────────────────────────────────

describe('LaneConductor local-api E2E', () => {
  let collectorProc, collectorPort, TMP;

  // One mock collector shared across all tests in this suite
  before(async () => {
    ({ proc: collectorProc, port: collectorPort } = await startMockCollector());
    TMP = makeSandbox('local-api');
  });

  after(() => {
    collectorProc?.kill('SIGTERM');
    cleanupSandbox(TMP);
  });

  it('parallelism: only 1 track per lane at a time', async () => {
    await setupProject(TMP, collectorPort);
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '101', 'implement', 'queue');
    createTrack(tracksDir, '102', 'implement', 'queue');
    createTrack(tracksDir, '103', 'implement', 'queue');

    const worker = await startWorker(TMP, collectorPort, { MOCK_CLI_DELAY_MS: '1500' });
    try {
      // Wait until at least 1 track is running
      await poll(async () => {
        const s = await getState(collectorPort);
        const running = Object.values(s.tracks).filter(t => t.lane_action_status === 'running');
        return running.length >= 1 ? s : null;
      }, { label: 'any track running', timeout: 15000 });

      await sleep(500);
      const s = await getState(collectorPort);
      const running = Object.values(s.tracks).filter(
        t => t.lane_status === 'implement' && t.lane_action_status === 'running'
      );
      assert.equal(running.length, 1, `expected 1 running, got ${running.length}`);
    } finally {
      await stopWorker(worker);
    }
  });

  it('on_success: implement → review', async () => {
    await setupProject(TMP, collectorPort);
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '201', 'implement', 'queue');

    const worker = await startWorker(TMP, collectorPort, { MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_DELAY_MS: '200' });
    try {
      const final = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks['201'];
        return t?.lane_status === 'review' && t?.lane_action_status === 'queue' ? t : null;
      }, { label: 'lane → review (queue)', timeout: 20000 });

      assert.equal(final.lane_status, 'review');
      assert.equal(final.lane_action_status, 'queue');
    } finally {
      await stopWorker(worker);
    }
  });

  it('on_failure: quality-gate exhausts retries → failure status', async () => {
    await setupProject(TMP, collectorPort);
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '301', 'quality-gate', 'queue');

    const worker = await startWorker(TMP, collectorPort, { MOCK_CLI_EXIT_CODE: '1', MOCK_CLI_DELAY_MS: '200' });
    try {
      const final = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks['301'];
        return t?.lane_action_status === 'failure' ? t : null;
      }, { label: 'lane_action_status → failure', timeout: 20000 });

      assert.equal(final.lane_action_status, 'failure');
    } finally {
      await stopWorker(worker);
    }
  });

  it('full pipeline: implement → review → quality-gate → done', async () => {
    await setupProject(TMP, collectorPort);
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '401', 'implement', 'queue');

    const worker = await startWorker(TMP, collectorPort, { MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_DELAY_MS: '100' });
    try {
      const final = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks['401'];
        return t?.lane_status === 'done' ? t : null;
      }, { label: 'lane → done', timeout: 45000 });

      assert.equal(final.lane_status, 'done');
    } finally {
      await stopWorker(worker);
    }
  });

  it('custom transition: review → implement:queue on failure', async () => {
    await setupProject(TMP, collectorPort);
    const tracksDir = join(TMP, 'conductor/tracks');
    // Override workflow specifically for this test
    const wf = JSON.parse(readFileSync(join(TMP, 'conductor/workflow.json'), 'utf8'));
    wf.lanes.review.on_failure = 'implement:queue';
    wf.lanes.review.max_retries = 1;
    writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify(wf));
    await sleep(500); // Give worker time to reload config

    createTrack(tracksDir, '601', 'review', 'queue');

    const worker = await startWorker(TMP, collectorPort, { MOCK_CLI_EXIT_CODE: '1', MOCK_CLI_DELAY_MS: '200' });
    try {
      const final = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks['601'];
        return t?.lane_status === 'implement' && t?.lane_action_status === 'queue' ? t : null;
      }, { label: 'review failure → implement:queue', timeout: 20000 });

      assert.equal(final.lane_status, 'implement');
      assert.equal(final.lane_action_status, 'queue');
    } finally {
      await stopWorker(worker);
    }
  });
});

// ── Tests — remote-api mode (mode detection) ──────────────────────────────────

describe('LaneConductor remote-api mode (explicit config)', () => {
  let collectorProc, collectorPort, TMP;

  before(async () => {
    ({ proc: collectorProc, port: collectorPort } = await startMockCollector());
    TMP = makeSandbox('remote-api');
  });

  after(() => {
    collectorProc?.kill('SIGTERM');
    cleanupSandbox(TMP);
  });

  it('explicit config.mode remote-api: worker processes tracks correctly', async () => {
    await setupProject(TMP, collectorPort, 'remote-api');
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '501', 'implement', 'queue');

    const worker = await startWorker(TMP, collectorPort, { MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_DELAY_MS: '200' });
    try {
      const final = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks['501'];
        return t?.lane_status === 'review' && t?.lane_action_status === 'queue' ? t : null;
      }, { label: 'remote-api: lane → review (queue)', timeout: 20000 });

      assert.equal(final.lane_status, 'review');
      assert.equal(final.lane_action_status, 'queue');
    } finally {
      await stopWorker(worker);
    }
  });
});
