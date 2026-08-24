#!/usr/bin/env node
// conductor/tests/track-1110-claim-race-api-mode.test.mjs
// Track 1110 Phase 3: proves the API-mode claim fix — autoLaunchLocalFs's
// API-mode branch now calls POST /tracks/claim-queue (FOR UPDATE SKIP
// LOCKED on the real server; single-threaded-equivalent on the mock)
// before spawning, instead of deciding purely from a local file read.
//
// Two things to prove:
//   1. Single-worker case is unaffected (REQ-5) — a lone worker still
//      claims and runs a queued track exactly as before this track.
//   2. Two DISTINCT, legitimately-running workers (worker_number 1 and 2
//      — both allowed to coexist per track 1084 Phase 0) racing on one
//      queued track: exactly one of them runs it. This is the actual
//      fix Phase 3 exists for — Phase 1's claim-race reproduction used
//      local-fs mode (no DB); this is the API-mode equivalent, using the
//      mechanism this track actually shipped rather than local-fs mode's
//      still-unbuilt Phase 4 primitive.
//
// Run: node --test conductor/tests/track-1110-claim-race-api-mode.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-claim-race-api');

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

async function setupProject(collectorPort) {
  await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' }).catch(() => {});
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'claim-race-api-test', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: null, on_failure: null },
    lanes: {
      'in-progress': { parallel_limit: 1, max_retries: 1, on_success: 'review', on_failure: 'in-progress' },
    },
  }, null, 2));
}

// Track 10017: this suite tests claim atomicity, not the auto-run gate —
// opt in so it's unaffected.
function createTrack(num) {
  const dir = join(TMP, 'conductor/tracks', `${num}-race-track`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track ${num}: Race Track`, '',
    '**Lane**: in-progress', '**Lane Status**: queue', '**Progress**: 0%', '',
    '## Problem', 'Test.', '', '## Solution', 'Test.', '**Auto Run**: yes',
  ].join('\n'));
}

function startWorker(workerNumber, claimMarkerPath, env = {}) {
  const args = [join(ROOT, 'conductor/laneconductor.sync.mjs')];
  if (workerNumber !== 1) args.push('--worker-number', String(workerNumber));
  const proc = spawn('node', args, {
    cwd: TMP,
    env: {
      ...process.env,
      LC_MOCK_CLI: `node ${MOCK_CLI}`,
      MOCK_CLI_DELAY_MS: '400',
      LC_SKIP_GIT_LOCK: '1',
      // Distinct identity per worker_number already prevents Phase 2's
      // lock from interfering here (each gets its own lock file), but
      // skip it anyway to keep this test focused purely on the claim
      // mechanism, not process-separation (that's Phase 2's own suite).
      LC_SKIP_WORKER_LOCK: '1',
      ...(claimMarkerPath ? { MOCK_CLI_CLAIM_MARKER: claimMarkerPath } : {}),
      ...env,
    },
    stdio: 'ignore',
  });
  return proc;
}

describe('Track 1110 Phase 3: API-mode claim atomicity', () => {
  let collectorProc, collectorPort;

  before(async () => {
    ({ proc: collectorProc, port: collectorPort } = await startMockCollector());
  });

  after(() => {
    collectorProc?.kill('SIGTERM');
    rmSync(TMP, { recursive: true, force: true });
  });

  it('REQ-5: a single worker still claims and runs a queued track normally', async () => {
    await setupProject(collectorPort);
    createTrack('601');

    const worker = startWorker(1);
    try {
      const final = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks['601'];
        return t?.lane_status === 'review' ? t : null;
      }, { label: 'track 601 reaches review', timeout: 15000 });

      assert.equal(final.lane_status, 'review');
    } finally {
      worker.kill('SIGTERM');
      await sleep(300);
    }
  });

  it('two distinct legitimate workers racing on one queued track: exactly one runs it', async () => {
    // The mock's claim-queue mutation is synchronous JS with no `await`
    // between reading and mutating state, so Node's single-threaded event
    // loop already makes a genuine double-RETURN from the mock itself
    // impossible — that's not what's actually at risk here. What Phase 3
    // could still get wrong is the WORKER's own wiring: spawning anyway
    // despite an empty/losing claim response, or never calling claim-queue
    // at all for one of the two workers. The claim marker (same mechanism
    // as Phase 1's local-fs repro) directly counts how many times the
    // mock CLI was actually INVOKED — the thing that would show two
    // spawns if the wiring, not just the mock, were broken.
    const RUNS = 5;
    let doubleSpawnCount = 0;
    const perRunPids = [];

    for (let run = 0; run < RUNS; run++) {
      await setupProject(collectorPort);
      createTrack('602');
      const markerPath = join(TMP, 'claims.log');
      rmSync(markerPath, { force: true });

      const workerA = startWorker(1, markerPath);
      const workerB = startWorker(2, markerPath);
      try {
        await sleep(6000); // one auto-launch tick (5s) plus margin
        const pids = existsSync(markerPath)
          ? [...new Set(readFileSync(markerPath, 'utf8').trim().split('\n').filter(Boolean))]
          : [];
        perRunPids.push(pids);
        if (pids.length > 1) doubleSpawnCount++;
      } finally {
        workerA.kill('SIGKILL');
        workerB.kill('SIGKILL');
        await sleep(200);
      }
    }

    console.log('[track-1110] per-run distinct spawning pids for track 602:', perRunPids);
    assert.equal(
      doubleSpawnCount, 0,
      `expected exactly one worker to ever spawn the CLI for track 602 in each run, but ${doubleSpawnCount}/${RUNS} runs showed both workers spawning it (pids per run: ${JSON.stringify(perRunPids)})`
    );
    // Also confirm the track wasn't simply never claimed by anyone (a
    // different failure mode than double-claiming — both workers
    // wrongly skipping it).
    const neverClaimed = perRunPids.filter(pids => pids.length === 0).length;
    assert.equal(neverClaimed, 0, `expected the track to be claimed by someone in every run, but ${neverClaimed}/${RUNS} runs had no claimant at all`);
  });
});
