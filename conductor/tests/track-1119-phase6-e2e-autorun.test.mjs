#!/usr/bin/env node
// conductor/tests/track-1119-phase6-e2e-autorun.test.mjs
// Track AM-1119 Phase 6 (Task 2, TC-9's full chain / AC-3): proves the
// whole autonomous chain end to end — create-project generates real track
// folders + queue entries with `**Auto Run**: yes` (Phase 3), and once a
// real sync+poll worker is pointed at the new project, it actually claims
// the first non-dependent one out of `queue`, while the `**Depends On**`
// -gated deploy track (Phase 3's dependency gate) stays queued. Earlier
// tests proved these two halves separately (track-1119-phase3-track-
// generation.test.mjs: generation + DB registration;
// track-1119-phase3-depends-on.test.mjs: the gate itself, on hand-crafted
// fixture tracks) — this is the first test to run them together against
// tracks a real create-project dispatch actually produced.
//
// AC-3 says "a running sync+poll worker" — deliberately not the
// auto-spawned worker runCreateProject itself starts (that one is
// sync-only by design, track 1091's own documented default; see its
// test's comment). This test starts a second one itself, exactly as an
// operator would run `lc worker start --sync-and-work` after Launch.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1119-phase6-autorun');
const MANAGER_DIR = join(TMP, 'manager');
const TARGET_DIR = join(TMP, 'digger-game');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 20000, interval = 300, label = '' } = {}) {
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

function setupProject(dir, collectorPort) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-manager', id: 1, repo_path: dir, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));
  mkdirSync(join(dir, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(dir, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 }, defaults: { parallel_limit: 3, max_retries: 1 },
  }, null, 2));
}

describe('Track AM-1119 Phase 6: full auto-run chain — generated tracks actually claim (or wait) once a sync+poll worker runs', () => {
  let collectorProc, collectorPort, managerWorker, projectWorker, tracksDir;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    rmSync(TMP, { recursive: true, force: true });
    setupProject(MANAGER_DIR, collectorPort);
    mkdirSync(TARGET_DIR, { recursive: true });

    managerWorker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only', '--manager'], {
      cwd: MANAGER_DIR,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '150', LC_SKIP_GIT_LOCK: '1', LC_SKIP_WORKER_LOCK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    managerWorker.stdout.on('data', d => process.stdout.write(`[manager] ${d}`));
    managerWorker.stderr.on('data', d => process.stderr.write(`[manager] ${d}`));

    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'manager worker registered' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, {
      worker_id: workerId,
      action: 'create-project',
      payload: {
        repo_source: { type: 'path', value: TARGET_DIR },
        scaffold_context: {
          project: { name: 'Digger Game' },
          brainstorm_summary: [
            'Project purpose: Dig for ore, avoid hazards',
            'Success metrics / KPIs: 500 plays in week 1',
          ].join('\n'),
        },
        wizard: { deployment: { provider: 'firebase', environments: ['prod'] } },
      },
    });

    const dispatchDone = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'create-project');
      return d?.status === 'done' || d?.status === 'failed' ? d : null;
    }, { label: 'create-project dispatch resolves' });
    assert.equal(dispatchDone.status, 'done', `create-project dispatch should succeed, got: ${dispatchDone.result}`);

    // The mocked `setup scaffold generate` step (mock-cli.mjs) is a no-op —
    // a real one writes conductor/workflow.json as part of scaffolding.
    // Supply the minimal real shape ourselves so the sync+poll worker
    // started below has an actual `plan` lane to auto-launch into.
    tracksDir = join(TARGET_DIR, 'conductor', 'tracks');
    writeFileSync(join(TARGET_DIR, 'conductor', 'workflow.json'), JSON.stringify({
      global: { total_parallel_limit: 3 },
      defaults: { parallel_limit: 3, max_retries: 1 },
      lanes: {
        plan: { parallel_limit: 3, max_retries: 1, auto_action: 'plan', on_success: 'plan:success', on_failure: 'backlog' },
      },
    }, null, 2));
  });

  after(() => {
    managerWorker?.kill();
    projectWorker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('a real sync+poll worker claims the first non-dependent generated track, leaving the Depends-On-gated deploy track queued', async () => {
    const trackDirs = readdirSync(tracksDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^\d|^[A-Z]+-\d/.test(d.name))
      .map(d => d.name)
      .sort();
    assert.ok(trackDirs.length >= 2, `expected at least 2 generated tracks, got ${trackDirs.length}`);
    const firstTrack = trackDirs[0];
    const lastTrack = trackDirs[trackDirs.length - 1];
    assert.match(lastTrack.toLowerCase(), /deploy/, 'sanity: last track should be the deploy track');

    projectWorker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-and-work'], {
      cwd: TARGET_DIR,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '300', LC_SKIP_GIT_LOCK: '1', LC_SKIP_WORKER_LOCK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    projectWorker.stdout.on('data', d => process.stdout.write(`[project-worker] ${d}`));
    projectWorker.stderr.on('data', d => process.stderr.write(`[project-worker] ${d}`));

    await poll(() => {
      const content = readFileSync(join(tracksDir, firstTrack, 'index.md'), 'utf8');
      const laneStatus = content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim();
      return laneStatus && laneStatus !== 'queue' ? laneStatus : null;
    }, { label: `first generated track (${firstTrack}) claimed from queue`, timeout: 15000 });

    // The deploy track's dependency isn't done — even after the first
    // track finished its own lane action, it must never have been claimed.
    const lastContent = readFileSync(join(tracksDir, lastTrack, 'index.md'), 'utf8');
    assert.match(lastContent, /\*\*Lane Status\*\*:\s*queue/i, 'deploy track must still be queued — its dependencies are not done yet');
    assert.match(lastContent, /\*\*Depends On\*\*:/i, 'deploy track must carry a Depends On marker');
  });
});
