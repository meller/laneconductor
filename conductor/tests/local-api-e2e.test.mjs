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
// Run: node --test conductor/tests/local-api-e2e.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-local-api');

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

async function setupProject(collectorPort, mode = 'local-api') {
  // Reset mock collector state so previous test tracks don't interfere
  await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' }).catch(() => {});

  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  const collectorUrl = `http://127.0.0.1:${collectorPort}`;

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode,
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: collectorUrl, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
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
      LC_SKIP_GIT_LOCK: '1',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

// ── Tests — local-api mode ────────────────────────────────────────────────────

describe('LaneConductor local-api E2E', () => {
  let collectorProc, collectorPort;

  // One mock collector shared across all tests in this suite
  before(async () => {
    ({ proc: collectorProc, port: collectorPort } = await startMockCollector());
  });

  after(() => {
    collectorProc?.kill('SIGTERM');
    rmSync(TMP, { recursive: true, force: true });
  });

  it('parallelism: only 1 track per lane at a time', async () => {
    await setupProject(collectorPort);
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '101', 'implement', 'queue');
    createTrack(tracksDir, '102', 'implement', 'queue');
    createTrack(tracksDir, '103', 'implement', 'queue');

    const worker = startWorker({ MOCK_CLI_DELAY_MS: '1500' });
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
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('on_success: implement → review', async () => {
    await setupProject(collectorPort);
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '201', 'implement', 'queue');

    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_DELAY_MS: '200' });
    try {
      const final = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks['201'];
        return t?.lane_status === 'review' && t?.lane_action_status === 'queue' ? t : null;
      }, { label: 'lane → review (queue)', timeout: 20000 });

      assert.equal(final.lane_status, 'review');
      assert.equal(final.lane_action_status, 'queue');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('on_failure: quality-gate exhausts retries → failure status', async () => {
    await setupProject(collectorPort);
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '301', 'quality-gate', 'queue');

    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '1', MOCK_CLI_DELAY_MS: '200' });
    try {
      const final = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks['301'];
        return t?.lane_action_status === 'failure' ? t : null;
      }, { label: 'lane_action_status → failure', timeout: 20000 });

      assert.equal(final.lane_action_status, 'failure');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('full pipeline: implement → review → quality-gate → done', async () => {
    await setupProject(collectorPort);
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '401', 'implement', 'queue');

    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_DELAY_MS: '100' });
    try {
      const final = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks['401'];
        return t?.lane_status === 'done' ? t : null;
      }, { label: 'lane → done', timeout: 45000 });

      assert.equal(final.lane_status, 'done');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('custom transition: review → implement:queue on failure', async () => {
    await setupProject(collectorPort);
    const tracksDir = join(TMP, 'conductor/tracks');
    // Override workflow specifically for this test
    const wf = JSON.parse(readFileSync(join(TMP, 'conductor/workflow.json'), 'utf8'));
    wf.lanes.review.on_failure = 'implement:queue';
    wf.lanes.review.max_retries = 1;
    writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify(wf));
    await sleep(500); // Give worker time to reload config

    createTrack(tracksDir, '601', 'review', 'queue');

    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '1', MOCK_CLI_DELAY_MS: '200' });
    try {
      const final = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks['601'];
        return t?.lane_status === 'implement' && t?.lane_action_status === 'queue' ? t : null;
      }, { label: 'review failure → implement:queue', timeout: 20000 });

      assert.equal(final.lane_status, 'implement');
      assert.equal(final.lane_action_status, 'queue');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });
});

// ── Tests — remote-api mode (mode detection) ──────────────────────────────────

describe('LaneConductor remote-api mode (explicit config)', () => {
  let collectorProc, collectorPort;

  before(async () => {
    ({ proc: collectorProc, port: collectorPort } = await startMockCollector());
  });

  after(() => {
    collectorProc?.kill('SIGTERM');
  });

  it('explicit config.mode remote-api: worker processes tracks correctly', async () => {
    await setupProject(collectorPort, 'remote-api');
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '501', 'implement', 'queue');

    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_DELAY_MS: '200' });
    try {
      const final = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks['501'];
        return t?.lane_status === 'review' && t?.lane_action_status === 'queue' ? t : null;
      }, { label: 'remote-api: lane → review (queue)', timeout: 20000 });

      assert.equal(final.lane_status, 'review');
      assert.equal(final.lane_action_status, 'queue');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });
});
