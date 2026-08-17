#!/usr/bin/env node
// conductor/tests/worker-id-watchdog.test.mjs
//
// Live incident (2026-08-17, laneconductor project itself): a worker
// process whose /worker/register call never resolved (myWorkerId stayed
// null forever) looked completely healthy — updateWorkerHeartbeat() upserts
// by (hostname, project_id, worker_number) and never reads myWorkerId, so
// heartbeats kept succeeding on schedule, idle status, visible in the UI —
// while checkDispatchInbox()'s `if (... || !myWorkerId) return;` silently
// no-op'd on every single 10s cycle, forever. No log line, no error.
// Discovered only because a track visibly got stuck `pending` with no
// explanation anywhere.
//
// Fix: a watchdog that specifically checks "has myWorkerId resolved within
// a grace period of startup" — the one condition heartbeat can never
// reveal — logs loudly the first time it fires, and keeps retrying
// registration until it succeeds.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, '.test-tmp-worker-id-watchdog');

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

async function setFailRegister(port, fail) {
  await fetch(`http://127.0.0.1:${port}/_set-fail-register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fail }),
  });
}

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'watchdog-test', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 }, defaults: { parallel_limit: 3, max_retries: 1 },
  }, null, 2));
}

describe('worker id watchdog: a stuck myWorkerId is logged loudly and self-heals', () => {
  let collectorProc, collectorPort, worker;
  let workerLog = '';

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    await setFailRegister(collectorPort, true);
    setupProject(collectorPort);

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_SKIP_GIT_LOCK: '1',
        // Real defaults (90s grace + 60s retry) would make this test take
        // minutes; shortened here the same way LC_DISPATCH_POLL_MS already
        // lets track-1113's test avoid a real 10s wait.
        LC_WORKER_ID_STALE_GRACE_MS: '500',
        LC_WORKER_ID_WATCHDOG_MS: '500',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => { workerLog += d.toString(); });
    worker.stderr.on('data', d => { workerLog += d.toString(); });
  });

  after(() => {
    worker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('logs the loud [health] warning once registration has been failing past the grace period', async () => {
    await poll(async () => /\[health\] No worker id resolved/.test(workerLog) ? true : null,
      { timeout: 8000, label: 'watchdog fires' });

    assert.match(workerLog, /dispatch-polling has been silently no-oping/i,
      'the warning must name the actual failure mode, not just "something is wrong"');

    // The whole point: it must actually retry, not just complain once and
    // give up. Confirm at least one retry attempt reached the collector
    // (still failing, since failRegister is still true here).
    const before = (await getState(collectorPort)).workers.length;
    assert.equal(before, 0, 'registration must still be failing at this point (workers array stays empty)');
  });

  it('self-heals once registration starts succeeding — no restart required', async () => {
    await setFailRegister(collectorPort, false);

    await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { timeout: 8000, label: 'a retried registration finally succeeds' });

    const s = await getState(collectorPort);
    assert.equal(s.workers.length, 1, 'exactly one worker row should exist once registration succeeds');
    assert.equal(s.workers[0].worker_number, 1);
  });
});
