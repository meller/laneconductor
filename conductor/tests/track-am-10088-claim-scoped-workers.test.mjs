#!/usr/bin/env node
// conductor/tests/track-am-10088-claim-scoped-workers.test.mjs
// Track AM-10088: worker:pid:track must be strictly 1:1:1 — a single
// registered worker process running TWO tracks' lane actions concurrently
// (parallel_limit > 1) must show TWO distinct rows in the workers table,
// each with its own pid/status/current_task, not one row whose current_task
// gets clobbered by whichever claim heartbeats last (the live AM-1018/
// AM-1019 incident spec.md documents).
//
// Uses the same isolated-sandbox + mock-collector pattern as
// local-api-e2e.test.mjs (track 10045) — NOT the older in-repo TMP pattern
// some pre-10045 test files still use, which redirects into the real
// primary checkout when run from inside a worktree (see this project's own
// memory notes on that hazard).
//
// Run: node --test conductor/tests/track-am-10088-claim-scoped-workers.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { makeSandbox, cleanupSandbox, startIsolatedWorker, stopWorker } from './helpers/isolated-worker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');

// isolated-worker.mjs's default script resolution deliberately normalizes
// through resolvePrimaryRepoRoot() — i.e. it spawns the PRIMARY checkout's
// copy of conductor/laneconductor.sync.mjs, not necessarily this file's own
// worktree's copy. That's the right default for most suites, but this one
// exists specifically to exercise the claim-scoped worker identity code as
// edited in THIS worktree — LC_TEST_REPO_ROOT is isolated-worker.mjs's
// documented override for exactly this case (see
// track-10061-handshake-e2e.test.mjs's identical note).
process.env.LC_TEST_REPO_ROOT = join(__dirname, '..', '..');
const CLAIM_WORKER_NUMBER_THRESHOLD = 100000; // mirrors CLAIM_WORKER_NUMBER_BASE_MULTIPLIER in laneconductor.sync.mjs

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

async function setupProject(sandbox, collectorPort) {
  await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' }).catch(() => {});
  const collectorUrl = `http://127.0.0.1:${collectorPort}`;

  writeFileSync(join(sandbox, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: sandbox, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: collectorUrl, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(sandbox, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(sandbox, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: null, on_failure: null },
    lanes: {
      implement: { parallel_limit: 2, max_retries: 1, on_success: 'review', on_failure: 'implement' },
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
    '**Auto Run**: yes',
    '',
    '## Problem',
    'Test problem.',
    '',
    '## Solution',
    'Test solution.',
  ].join('\n'));
}

function startWorker(sandbox, collectorPort, env = {}) {
  return startIsolatedWorker({
    sandbox,
    collectorPort,
    env: {
      LC_MOCK_CLI: `node ${MOCK_CLI}`,
      MOCK_CLI_DELAY_MS: '200',
      LC_SKIP_GIT_LOCK: '1',
      ...env,
    },
  });
}

describe('Track AM-10088: claim-scoped worker identities', () => {
  let collectorProc, collectorPort, TMP;

  before(async () => {
    ({ proc: collectorProc, port: collectorPort } = await startMockCollector());
    TMP = makeSandbox('am-10088');
  });

  after(() => {
    collectorProc?.kill('SIGTERM');
    cleanupSandbox(TMP);
  });

  it('TC-3: a single claim keeps reporting under the base worker_number — no behavior change', async () => {
    await setupProject(TMP, collectorPort);
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '1101', 'implement', 'queue');

    const worker = await startWorker(TMP, collectorPort, { MOCK_CLI_DELAY_MS: '1500' });
    try {
      const state = await poll(async () => {
        const s = await getState(collectorPort);
        const busy = s.workers.filter(w => w.status === 'busy');
        return busy.length >= 1 ? s : null;
      }, { label: 'solo claim registered as busy' });

      const busy = state.workers.filter(w => w.status === 'busy');
      assert.equal(busy.length, 1, `expected exactly 1 busy worker row, got ${busy.length}`);
      assert.equal(busy[0].worker_number, 1, 'a solo claim must use the base worker_number (1), unchanged');
      assert.match(busy[0].current_task, /track 1101/);
    } finally {
      await stopWorker(worker);
    }
  });

  it('TC-2/TC-4: two concurrent claims each get their own row; one finishing does not touch the other', async () => {
    await setupProject(TMP, collectorPort);
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '1018', 'implement', 'queue');
    createTrack(tracksDir, '1019', 'implement', 'queue');

    // 1018 finishes quickly; 1019 stays alive long enough to observe it
    // surviving 1018's retirement untouched. mock-cli.mjs reads
    // MOCK_CLI_DELAY_MS once per invocation from the environment, which is
    // fixed for the whole worker process — so both tracks would normally
    // get the SAME delay. Instead, drive them with a long shared delay and
    // kill 1018's own child early (see TC-5 below reusing the same
    // mechanism) OR just give both a long-ish shared delay and assert the
    // concurrent-visibility invariant while both are alive; the
    // finish-independently assertion is covered by TC-5 (kill one, observe
    // the other untouched), which exercises the same retirement code path
    // as a natural exit.
    const worker = await startWorker(TMP, collectorPort, { MOCK_CLI_DELAY_MS: '3000' });
    try {
      const state = await poll(async () => {
        const s = await getState(collectorPort);
        const busy = s.workers.filter(w => w.status === 'busy');
        return busy.length >= 2 ? s : null;
      }, { label: 'both claims registered as busy', timeout: 20000 });

      const busy = state.workers.filter(w => w.status === 'busy');
      assert.equal(busy.length, 2, `expected exactly 2 busy worker rows, got ${busy.length}`);

      const byTrack = {};
      for (const w of busy) {
        const m = w.current_task.match(/track (\d+)/);
        byTrack[m[1]] = w;
      }
      assert.ok(byTrack['1018'], 'expected a row naming track 1018');
      assert.ok(byTrack['1019'], 'expected a row naming track 1019');
      assert.notEqual(byTrack['1018'].pid, byTrack['1019'].pid, 'each claim must report its own distinct pid');
      assert.notEqual(byTrack['1018'].worker_number, byTrack['1019'].worker_number, 'each claim must have a distinct worker_number');

      // Exactly one of the two owns the base identity (worker_number 1);
      // the other must be claim-scoped (derived, far outside real
      // manually-assigned worker numbers).
      const workerNumbers = [byTrack['1018'].worker_number, byTrack['1019'].worker_number].sort((a, b) => a - b);
      assert.equal(workerNumbers[0], 1, 'one of the two concurrent claims must own the base worker_number');
      assert.ok(workerNumbers[1] >= CLAIM_WORKER_NUMBER_THRESHOLD, 'the additional claim must use a derived, claim-scoped worker_number');

      // ── TC-5 (kill -9 the derived claim's own child pid) ──────────────
      // Node's `exit` event fires on a direct child's termination
      // regardless of signal — SIGKILL does not bypass this worker's own
      // retirement logic (only a *graceful in-child* shutdown would be
      // bypassed, and this claim never gets the chance to run one).
      const derivedRow = byTrack['1018'].worker_number >= CLAIM_WORKER_NUMBER_THRESHOLD ? byTrack['1018'] : byTrack['1019'];
      const survivorTrack = derivedRow === byTrack['1018'] ? '1019' : '1018';
      const survivorPidBefore = byTrack[survivorTrack].pid;

      process.kill(derivedRow.pid, 'SIGKILL');

      await poll(async () => {
        const s = await getState(collectorPort);
        const row = s.workers.find(w => w.worker_number === derivedRow.worker_number);
        return row && row.status === 'offline' ? s : null;
      }, { label: 'killed claim retired to offline', timeout: 10000 });

      // The sibling claim's own row must be completely untouched — same
      // pid, still busy, still naming its own track (REQ-5).
      const afterKill = await getState(collectorPort);
      const survivorRow = afterKill.workers.find(w => w.worker_number === byTrack[survivorTrack].worker_number);
      assert.ok(survivorRow, 'sibling claim row must still exist');
      assert.equal(survivorRow.status, 'busy', 'sibling claim must remain busy after the OTHER claim was killed');
      assert.equal(survivorRow.pid, survivorPidBefore, 'sibling claim pid must be unchanged');
      assert.match(survivorRow.current_task, new RegExp(`track ${survivorTrack}`));
    } finally {
      await stopWorker(worker);
    }
  });
});
