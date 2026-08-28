#!/usr/bin/env node
// conductor/tests/track-10020-dispatch-running-patch.test.mjs
// Track 10020 Bug 2 / REQ-7: checkDispatchInbox()'s lane-action dispatch
// branch used to write **Lane Status**: running to the track's local
// index.md when spawning a dispatched CLI, but never PATCHed the DB's
// lane_action_status to match (only the failure path patched the DB,
// reverting it) — so the UI showed a dispatched track as queued for its
// entire run. Fixed on main in commit 0abfcf8
// (laneconductor.sync.mjs:7188), mirroring the failure branch and
// claimQueuedTracks()'s own equivalent write for the other auto-launch
// path. Already fixed before this track's own implementation work started
// — this test only pins it so it can't silently regress.
//
// Run: node --test conductor/tests/track-10020-dispatch-running-patch.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10020-dispatch-running-patch');

function sleepMs(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 15000, interval = 150, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleepMs(interval);
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
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: { implement: { parallel_limit: 1, max_retries: 1 } },
  }, null, 2));

  mkdirSync(trackDir, { recursive: true });
  writeFileSync(indexPath, [
    '# Track 001: Test Track',
    '',
    '**Lane**: implement',
    '**Lane Status**: queue',
    '**Progress**: 0%',
    '',
    '## Problem',
    'Test problem.',
  ].join('\n'));
}

describe('Track 10020 REQ-7 (Bug 2 regression, commit 0abfcf8): dispatching a lane action reports "running" to the collector at spawn time', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    setupProject(collectorPort);

    // A generous delay so this test can observe the "running" PATCH land
    // WHILE the CLI is still genuinely mid-run, not just infer it from the
    // final state after everything already finished.
    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_SKIP_GIT_LOCK: '1',
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        MOCK_CLI_DELAY_MS: '2000',
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

  it('TC-4.4: PATCH /track/:num/action carries lane_action_status: "running" at dispatch spawn time, before the CLI exits', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'implement', track_number: '001' });

    // Confirm the file side shows "running" AND the collector's own
    // tracked lane_action_status agrees, while mock-cli's 2s delay
    // guarantees the process is still genuinely running when we check.
    await poll(async () => {
      const content = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
      return /\*\*Lane Status\*\*:\s*running/i.test(content) ? true : null;
    }, { label: 'file marked running' });

    const midState = await getState(collectorPort);
    assert.equal(midState.tracks['001']?.lane_action_status, 'running',
      'the DB-facing collector must already show "running" — this is the bug: only the file used to be updated, leaving the UI stuck on "queued" for the whole run');

    // The CLI must still genuinely be alive at this assertion point (2s
    // delay, well after the poll above resolves quickly).
    const finalState = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'implement');
      return d && d.status !== 'claimed' ? s : null;
    }, { timeout: 10000, label: 'dispatch resolves once the CLI exits' });
    const finalEntry = finalState.dispatch.find(e => e.action === 'implement');
    assert.equal(finalEntry.status, 'done');
  });
});
