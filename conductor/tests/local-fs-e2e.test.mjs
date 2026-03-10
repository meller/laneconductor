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
// Run: node --test conductor/tests/local-fs-e2e.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-local-fs');

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

function setupProject() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: null, on_failure: null },
    lanes: {
      planning:       { parallel_limit: 1, max_retries: 1, auto_action: 'plan',        on_success: 'planning',     on_failure: 'backlog' },
      'in-progress':  { parallel_limit: 1, max_retries: 1, auto_action: 'implement',   on_success: 'review',       on_failure: 'in-progress' },
      review:         { parallel_limit: 1, max_retries: 1, auto_action: 'review',      on_success: 'quality-gate', on_failure: 'in-progress' },
      'quality-gate': { parallel_limit: 1, max_retries: 1, auto_action: 'qualityGate', on_success: 'done',         on_failure: 'planning' },
    },
  }, null, 2));
}

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
  ].join('\n'));
}

function startWorker(env = {}) {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: TMP,
    env: {
      ...process.env,
      LC_MOCK_CLI: `node ${MOCK_CLI}`,
      MOCK_CLI_DELAY_MS: '200',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LaneConductor local-fs E2E', () => {

  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('parallelism: only 1 track runs per lane at a time', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '101', 'in-progress', 'queue');
    createTrack(tracksDir, '102', 'in-progress', 'queue');
    createTrack(tracksDir, '103', 'in-progress', 'queue');

    const worker = startWorker({ MOCK_CLI_DELAY_MS: '1500' });
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
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('on_success: in-progress → review with Lane Status reset to queue', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '201', 'in-progress', 'queue');

    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_DELAY_MS: '200' });
    try {
      const final = await poll(() => {
        const c = readIndex(tracksDir, '201');
        return getLane(c) === 'review' ? c : null;
      }, { label: 'lane → review', timeout: 15000 });

      assert.equal(getLane(final), 'review');
      assert.equal(getLaneStatus(final), 'queue', 'new lane status must be queue so auto-action triggers');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('on_failure: quality-gate exhausts retries → transitions to planning', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '301', 'quality-gate', 'queue');

    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '1', MOCK_CLI_DELAY_MS: '200' });
    try {
      const final = await poll(() => {
        const c = readIndex(tracksDir, '301');
        return getLane(c) === 'planning' ? c : null;
      }, { label: 'lane → planning (on_failure)', timeout: 15000 });

      assert.equal(getLane(final), 'planning');
      assert.equal(getLaneStatus(final), 'failure');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('full pipeline: in-progress → review → quality-gate → done', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '401', 'in-progress', 'queue');

    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_DELAY_MS: '100' });
    try {
      const final = await poll(() => {
        const c = readIndex(tracksDir, '401');
        return getLane(c) === 'done' ? c : null;
      }, { label: 'lane → done', timeout: 30000 });

      assert.equal(getLane(final), 'done');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

});
