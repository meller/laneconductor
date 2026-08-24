#!/usr/bin/env node
// conductor/tests/per-worker-machine-token.test.mjs
//
// Real incident (track 182, aitutor, 2026-08-14): a project with three
// manual workers sharing one .laneconductor.json/one project directory.
// Registration wrote each worker's freshly-issued machine_token into the
// SHARED .laneconductor.json and saved it; every running worker's config
// file-watcher then reloaded whichever token was written last and used it as
// its OWN identity. All workers converged on one identity server-side, so
// GET /track/:num/session — scoped by (track_number, req.worker_id) — could
// return a DIFFERENT worker's session. Concretely: worker #2 resumed worker
// #3's already-finished planning session (`--resume` onto session
// c02a4bb7-...), which just re-emitted the same finished plan and silently
// dropped a human comment sent to worker #2's own run — looked exactly like
// "the agent ignored me", not an auth bug.
//
// Fix: each worker persists its OWN machine_token to a per-worker file
// (conductor/.worker.tokens.json / .worker-N.tokens.json) that no other
// worker process writes, and that token always outranks whatever the shared
// config currently holds.
//
// This test runs TWO real worker processes against ONE shared project
// directory/config (the exact real-world shape) and proves:
//   1. Each worker registers with, and persists, its OWN distinct token —
//      never the other's.
//   2. The shared .laneconductor.json is never mutated with either token.
//   3. A track_chat session minted by worker #1 is invisible to worker #2's
//      session lookup for the same track — no cross-worker resume.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, '.test-tmp-per-worker-token');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 15000, interval = 250, label = '' } = {}) {
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

function findDispatch(state, id) {
  return state.dispatch.find(e => String(e.id) === String(id));
}

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, 'conductor/tracks/050-shared-track'), { recursive: true });
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'multi-worker-test', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 }, defaults: { parallel_limit: 3, max_retries: 1 },
  }, null, 2));
  writeFileSync(join(TMP, 'conductor/tracks/050-shared-track/index.md'),
    '# Track 050: Shared Track\n\n**Lane**: implement\n**Lane Status**: queue\n**Progress**: 0%\n');
}

function startWorker(workerNumber) {
  const args = [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'];
  if (workerNumber !== 1) args.push('--worker-number', String(workerNumber));
  const proc = spawn('node', args, {
    cwd: TMP,
    env: { ...process.env, LC_MOCK_CLI: 'node ' + join(__dirname, 'mock-cli.mjs'), LC_SKIP_GIT_LOCK: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', d => { log += d.toString(); });
  proc.stderr.on('data', d => { log += d.toString(); });
  return { proc, getLog: () => log };
}

describe('Per-worker machine tokens: two workers sharing one project directory never impersonate each other', () => {
  let collectorProc, collectorPort;
  let w1, w2;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);

    w1 = startWorker(1);
    w2 = startWorker(2);

    await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length >= 2 ? s : null;
    }, { label: 'both workers registered' });
  });

  after(() => {
    w1?.proc.kill();
    w2?.proc.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('each worker registers with, and is issued, a distinct machine_token', async () => {
    const s = await getState(collectorPort);
    assert.equal(s.workers.length, 2);
    const [tokA, tokB] = s.workers.map(w => w.machine_token);
    assert.ok(tokA, 'worker 1 must have a token');
    assert.ok(tokB, 'worker 2 must have a token');
    assert.notEqual(tokA, tokB, 'two distinct workers must never share one machine_token');
  });

  it('neither worker writes its token into the shared .laneconductor.json', async () => {
    // Give both workers' registration + any config-reload cycle time to settle.
    await sleep(1500);
    const sharedConfig = JSON.parse(readFileSync(join(TMP, '.laneconductor.json'), 'utf8'));
    assert.equal(sharedConfig.collectors[0].machine_token, undefined,
      'a machine_token must never be persisted to the file every worker of this project shares — that is the exact mechanism that caused one worker to authenticate as another');
  });

  it('each worker persists its OWN token to its OWN file, not the other worker\'s', async () => {
    const p1 = join(TMP, 'conductor/.worker.tokens.json');
    const p2 = join(TMP, 'conductor/.worker-2.tokens.json');
    await poll(() => (existsSync(p1) && existsSync(p2)) || null, { label: 'both per-worker token files written' });

    const store1 = JSON.parse(readFileSync(p1, 'utf8'));
    const store2 = JSON.parse(readFileSync(p2, 'utf8'));
    const tok1 = Object.values(store1)[0];
    const tok2 = Object.values(store2)[0];

    const s = await getState(collectorPort);
    const dbTok1 = s.workers.find(w => w.worker_number === 1)?.machine_token;
    const dbTok2 = s.workers.find(w => w.worker_number === 2)?.machine_token;

    assert.equal(tok1, dbTok1, "worker 1's stored token must match what the server issued IT");
    assert.equal(tok2, dbTok2, "worker 2's stored token must match what the server issued IT");
    assert.notEqual(tok1, tok2, 'the two per-worker stores must never converge on one token');
  });

  it('a session minted by worker 1 is invisible to worker 2 for the same track — no cross-worker resume', async () => {
    // Uses lane-action dispatch ('implement'), not track_chat: session
    // resolve/persist (resolveTrackSession/persistTrackSession, via
    // buildCliArgs -> spawnCli) is wired into the lane-action path on
    // `main` already (track 1086) — the chat path only gained the same
    // wiring on a separate, unmerged branch. The identity bug being tested
    // here lives in resolveToken/resolveCollectorToken, one layer below
    // either call site, so either exercises it equally.
    const s = await getState(collectorPort);
    const worker1Row = s.workers.find(w => w.worker_number === 1);
    const worker2Row = s.workers.find(w => w.worker_number === 2);

    const run1 = await enqueueDispatch(collectorPort, {
      worker_id: worker1Row.id, action: 'implement', track_number: '050', payload: {},
    });
    await poll(async () => {
      const d = findDispatch(await getState(collectorPort), run1);
      return d && (d.status === 'done' || d.status === 'failed') ? d : null;
    }, { label: 'worker 1 implement run completes' });

    const afterW1 = await getState(collectorPort);
    const w1Token = worker1Row.machine_token;
    const w2Token = worker2Row.machine_token;
    const sessionFromW1 = afterW1.sessionsByToken[w1Token]?.['050'];
    assert.ok(sessionFromW1, 'worker 1 must have minted a session for track 050 under ITS OWN token');

    // The pre-fix bug: worker 2, sharing the same directory, ends up reading
    // worker 1's token out of the shared config and calling GET
    // /track/050/session AS worker 1 — which would return sessionFromW1 here.
    // With the fix, worker 2's own registered identity has no session for
    // this track yet, so its own lookup must come back empty.
    assert.equal(afterW1.sessionsByToken[w2Token]?.['050'], undefined,
      "worker 2 must not see worker 1's session for the same track — a defined value here means worker 2 read/used worker 1's token");

    // Dispatch-inbox lane actions (unlike the queue-claim auto-launch path)
    // don't gate on the track's own lane_action_status, so worker 2 can run
    // the same track immediately without any reset step.
    const run2 = await enqueueDispatch(collectorPort, {
      worker_id: worker2Row.id, action: 'implement', track_number: '050', payload: {},
    });
    await poll(async () => {
      const d = findDispatch(await getState(collectorPort), run2);
      return d && (d.status === 'done' || d.status === 'failed') ? d : null;
    }, { label: 'worker 2 implement run completes' });

    const afterW2 = await getState(collectorPort);
    const sessionFromW2 = afterW2.sessionsByToken[w2Token]?.['050'];
    assert.ok(sessionFromW2, 'worker 2 must mint its OWN session for track 050');
    assert.notEqual(sessionFromW2, sessionFromW1,
      'worker 2 must mint a session distinct from worker 1\'s — resuming the same id would mean it authenticated as worker 1');
  });
});
