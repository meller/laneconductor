#!/usr/bin/env node
// conductor/tests/local-fs-e2e.test.mjs
// End-to-end test for the LaneConductor worker in local-fs mode.
//
// Tests:
//   1. Parallelism: max 1 per lane (parallel_limit: 1)
//   2. on_success: in-progress → review (Lane Status resets to queue in new lane)
//   3. on_failure: quality-gate → planning (after max retries)
//   4. Full pipeline: in-progress → review → quality-gate → done
//
// Track 10045 Phase 5: migrated to the shared isolated-worker helper
// (conductor/tests/helpers/isolated-worker.mjs). Previously this suite
// spawned the worker with a sandbox at `join(ROOT, '.test-tmp-local-fs')`
// — inside the repo — which is the exact mechanism that let a worktree-
// launched run of this suite escape into the real primary checkout (see
// conductor/tracks/AM-10045-e2e-tests-leak-real-worker-from-worktree/spec.md).
// Each test now gets its own throwaway sandbox outside the repo entirely.
//
// Run: node --test conductor/tests/local-fs-e2e.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox, cleanupSandbox, startIsolatedWorker, stopWorker } from './helpers/isolated-worker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readIndex(tracksDir, trackNum) {
  const dirs = readdirSync(tracksDir).filter(d => d.startsWith(`${trackNum}-`));
  if (!dirs.length) return null;
  const p = join(tracksDir, dirs[0], 'index.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function getLane(content) {
  return content?.match(/\*\*Lane\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
}

function getLaneStatus(content) {
  return content?.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
}

async function poll(fn, { timeout = 15000, interval = 300, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

// ── Project setup ─────────────────────────────────────────────────────────────

// Returns a fresh, isolated sandbox (own git repo, outside this repo
// entirely — makeSandbox()) pre-seeded with this suite's own
// .laneconductor.json / workflow.json. startIsolatedWorker() respects an
// existing config rather than overwriting it, so this is what actually
// selects local-fs mode for these tests.
function setupProject() {
  const sandbox = makeSandbox('local-fs');

  writeFileSync(join(sandbox, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'test-project', id: 1, repo_path: sandbox, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(sandbox, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(sandbox, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: null, on_failure: null },
    lanes: {
      planning:       { parallel_limit: 1, max_retries: 1, auto_action: 'plan',        on_success: 'planning',     on_failure: 'backlog' },
      'in-progress':  { parallel_limit: 1, max_retries: 1, auto_action: 'implement',   on_success: 'review',       on_failure: 'in-progress' },
      review:         { parallel_limit: 1, max_retries: 1, auto_action: 'review',      on_success: 'quality-gate', on_failure: 'in-progress' },
      'quality-gate': { parallel_limit: 1, max_retries: 1, auto_action: 'qualityGate', on_success: 'done',         on_failure: 'planning' },
    },
  }, null, 2));

  return sandbox;
}

// Track 10017: auto_run defaults to true here so the suites above (testing
// parallelism/transitions/pipeline behavior, not the auto-run gate itself)
// don't need to know the gate exists. The gate's own tests below pass
// autoRun explicitly.
function createTrack(tracksDir, num, lane, laneStatus = 'queue', { autoRun = true } = {}) {
  const dir = join(tracksDir, `${num}-test-track-${num}`);
  mkdirSync(dir, { recursive: true });
  const lines = [
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
  ];
  if (autoRun) lines.push('**Auto Run**: yes');
  writeFileSync(join(dir, 'index.md'), lines.join('\n'));
}

function startWorker(sandbox, env = {}) {
  return startIsolatedWorker({
    sandbox,
    env: {
      LC_MOCK_CLI: `node ${MOCK_CLI}`,
      MOCK_CLI_DELAY_MS: '200',
      ...env,
    },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LaneConductor local-fs E2E', () => {

  it('parallelism: only 1 track runs per lane at a time', async () => {
    const TMP = setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '101', 'in-progress', 'queue');
    createTrack(tracksDir, '102', 'in-progress', 'queue');
    createTrack(tracksDir, '103', 'in-progress', 'queue');

    const worker = await startWorker(TMP, { MOCK_CLI_DELAY_MS: '1500' });
    try {
      await poll(() => {
        const c = readIndex(tracksDir, '101') ?? readIndex(tracksDir, '102') ?? readIndex(tracksDir, '103');
        return getLaneStatus(c) === 'running' ? true : null;
      }, { label: 'any track running', timeout: 10000 });

      await sleep(500);
      const statuses = ['101', '102', '103'].map(n => getLaneStatus(readIndex(tracksDir, n)));
      const running = statuses.filter(s => s === 'running').length;
      assert.equal(running, 1, `expected 1 running, got ${running} (statuses: ${statuses})`);
    } finally {
      await stopWorker(worker);
      cleanupSandbox(TMP);
    }
  });

  it('on_success: in-progress → review with Lane Status reset to queue', async () => {
    const TMP = setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '201', 'in-progress', 'queue');

    const worker = await startWorker(TMP, { MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_DELAY_MS: '200' });
    try {
      const final = await poll(() => {
        const c = readIndex(tracksDir, '201');
        return getLane(c) === 'review' ? c : null;
      }, { label: 'lane → review', timeout: 15000 });

      assert.equal(getLane(final), 'review');
      assert.equal(getLaneStatus(final), 'queue', 'new lane status must be queue so auto-action triggers');
    } finally {
      await stopWorker(worker);
      cleanupSandbox(TMP);
    }
  });

  it('on_failure: quality-gate exhausts retries → transitions to planning', async () => {
    const TMP = setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '301', 'quality-gate', 'queue');

    const worker = await startWorker(TMP, { MOCK_CLI_EXIT_CODE: '1', MOCK_CLI_DELAY_MS: '200' });
    try {
      const final = await poll(() => {
        const c = readIndex(tracksDir, '301');
        return getLane(c) === 'planning' ? c : null;
      }, { label: 'lane → planning (on_failure)', timeout: 15000 });

      assert.equal(getLane(final), 'planning');
      assert.equal(getLaneStatus(final), 'failure');
    } finally {
      await stopWorker(worker);
      cleanupSandbox(TMP);
    }
  });

  it('full pipeline: in-progress → review → quality-gate → done', async () => {
    const TMP = setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '401', 'in-progress', 'queue');

    const worker = await startWorker(TMP, { MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_DELAY_MS: '100' });
    try {
      const final = await poll(() => {
        const c = readIndex(tracksDir, '401');
        return getLane(c) === 'done' ? c : null;
      }, { label: 'lane → done', timeout: 30000 });

      assert.equal(getLane(final), 'done');
    } finally {
      await stopWorker(worker);
      cleanupSandbox(TMP);
    }
  });

  it('queue-based track creation: creates a structured test.md file', async () => {
    const TMP = setupProject();
    const queuePath = join(TMP, 'conductor/tracks/file_sync_queue.md');

    // Write queue file
    writeFileSync(queuePath, [
      '# File Sync Queue',
      '',
      '## Track Creation Requests',
      '',
      '### Track 501: Queue Track 501',
      '**Status**: pending',
      '**Type**: track-create',
      '**Created**: ' + new Date().toISOString(),
      '**Title**: Queue Track 501',
      '**Description**: This is a test track for queue creation.',
      '**Metadata**: { "priority": "medium", "assignee": null }',
    ].join('\n'));

    const worker = await startWorker(TMP, { MOCK_CLI_DELAY_MS: '100' });
    try {
      // Wait until the folder is created and queue entry is processed
      const trackDirName = await poll(() => {
        const dirs = readdirSync(join(TMP, 'conductor/tracks')).filter(d => d.startsWith('501-'));
        return dirs.length ? dirs[0] : null;
      }, { label: 'track 501 folder created', timeout: 15000 });

      const testPath = join(TMP, 'conductor/tracks', trackDirName, 'test.md');
      assert.ok(existsSync(testPath), 'test.md must exist in the created track folder');

      const testContent = readFileSync(testPath, 'utf8');
      assert.ok(testContent.includes('# Tests: Track 501 — Queue Track 501'), 'test.md should contain proper title');
      assert.ok(testContent.includes('## Test Commands'), 'test.md should contain Test Commands section');
      assert.ok(testContent.includes('## Test Cases'), 'test.md should contain Test Cases section');
      assert.ok(testContent.includes('## Acceptance Criteria'), 'test.md should contain Acceptance Criteria section');

      // Verify the queue file is updated
      const queueContent = readFileSync(queuePath, 'utf8');
      assert.ok(queueContent.includes('**Status**: processed') || queueContent.includes('**Status**: completed'), 'Queue entry status should be updated');
    } finally {
      await stopWorker(worker);
      cleanupSandbox(TMP);
    }
  });

  // Track 10017: end-to-end auto-run gating (TC-9, TC-10). These are the
  // only two tests in this file that intentionally omit or toggle
  // **Auto Run** — every other test above opts in via createTrack's default.
  it('TC-9: a queued track with no **Auto Run** marker is left untouched by the auto-launch loop', async () => {
    const TMP = setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '601', 'in-progress', 'queue', { autoRun: false });

    const worker = await startWorker(TMP, { MOCK_CLI_DELAY_MS: '200' });
    try {
      // No positive event to poll for (that's the point) — wait out a full
      // poll cycle plus margin, then assert nothing happened.
      await sleep(6000);
      const content = readIndex(tracksDir, '601');
      assert.equal(getLaneStatus(content), 'queue', 'lane_action_status must stay queue — no CLI process should have spawned');
      assert.equal(getLane(content), 'in-progress', 'lane must not have moved either');
    } finally {
      await stopWorker(worker);
      cleanupSandbox(TMP);
    }
  });

  it('TC-10: the same track WITH **Auto Run**: yes is picked up and run', async () => {
    const TMP = setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '602', 'in-progress', 'queue', { autoRun: true });

    const worker = await startWorker(TMP, { MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_DELAY_MS: '1500' });
    try {
      await poll(() => {
        const c = readIndex(tracksDir, '602');
        return getLaneStatus(c) === 'running' ? true : null;
      }, { label: 'track 602 picked up and running', timeout: 10000 });
    } finally {
      await stopWorker(worker);
      cleanupSandbox(TMP);
    }
  });

});
