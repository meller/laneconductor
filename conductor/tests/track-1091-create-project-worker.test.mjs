#!/usr/bin/env node
// conductor/tests/track-1091-create-project-worker.test.mjs
// Track 1091 Phase 3: create-project dispatch execution, verified against
// a real spawned manager worker process (not a mock of the handler).
//
// Uses repo_source.type: 'path' (an existing local tmp directory) rather
// than 'git', to avoid a real network clone in this test — Task 2's git
// path is exercised by resolveRepoTarget's own unit tests (Phase 3's pure
// module), not re-verified here against a real remote.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1091-create-project');
const MANAGER_DIR = join(TMP, 'manager');
const TARGET_DIR = join(TMP, 'new-project');

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

function setupProject(dir, collectorPort, extra = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: dir, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
    ...extra,
  }, null, 2));
  mkdirSync(join(dir, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(dir, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 }, defaults: { parallel_limit: 3, max_retries: 1 },
  }, null, 2));
}

describe('Track 1091 Phase 3: create-project dispatch handler', () => {
  let collectorProc, collectorPort, managerWorker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    rmSync(TMP, { recursive: true, force: true });
    setupProject(MANAGER_DIR, collectorPort);
    mkdirSync(TARGET_DIR, { recursive: true }); // repo_source.type: 'path' requires this to already exist

    managerWorker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only', '--manager'], {
      cwd: MANAGER_DIR,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '150', LC_SKIP_GIT_LOCK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    managerWorker.stdout.on('data', d => process.stdout.write(`[manager] ${d}`));
    managerWorker.stderr.on('data', d => process.stderr.write(`[manager] ${d}`));
  });

  after(() => {
    managerWorker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('scaffolds the target directory: writes scaffold context and .laneconductor.json, spawns a worker there', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'manager worker registered' });
    assert.equal(state0.workers[0].type, 'manager');
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, {
      worker_id: workerId,
      action: 'create-project',
      payload: {
        repo_source: { type: 'path', value: TARGET_DIR },
        scaffold_context: { project: { name: 'New Test Project' } },
      },
    });

    // The scaffold context file is written before the (mocked) claude spawn —
    // check it lands regardless of how long the mock takes to exit.
    await poll(async () => existsSync(join(TARGET_DIR, 'conductor', '.setup-scaffold-context.json')) || null,
      { label: 'scaffold context written' });
    const scaffoldContext = JSON.parse(readFileSync(join(TARGET_DIR, 'conductor', '.setup-scaffold-context.json'), 'utf8'));
    assert.equal(scaffoldContext.project.name, 'New Test Project');

    // .laneconductor.json + a spawned worker only appear after the mocked
    // "setup scaffold generate" exits 0.
    await poll(async () => existsSync(join(TARGET_DIR, '.laneconductor.json')) || null,
      { label: '.laneconductor.json written for the new project' });
    const newConfig = JSON.parse(readFileSync(join(TARGET_DIR, '.laneconductor.json'), 'utf8'));
    assert.equal(newConfig.mode, 'local-api');
    assert.equal(newConfig.project.name, 'New Test Project');
    assert.equal(newConfig.project.repo_path, TARGET_DIR);
    assert.equal(newConfig.collectors[0].url, `http://127.0.0.1:${collectorPort}`);

    await poll(async () => existsSync(join(TARGET_DIR, 'conductor', '.sync.pid')) || null,
      { label: 'lc worker start spawned a worker for the new project' });
    const newPid = parseInt(readFileSync(join(TARGET_DIR, 'conductor', '.sync.pid'), 'utf8').trim(), 10);
    let alive = false;
    try { process.kill(newPid, 0); alive = true; } catch { }
    assert.ok(alive, `spawned worker (PID ${newPid}) for the new project should be running`);

    // The scaffolded config's collectors must NOT be *written* with the
    // manager's own machine_token baked in (runCreateProject strips it —
    // see the comment at its write site). We can't assert this from the
    // final file content: the new worker legitimately re-registers itself
    // moments after spawn via its own normal upsertWorker() call, and that
    // (correctly) writes ITS OWN resolved token back into its own config —
    // same behavior every worker has, including the manager itself. Since
    // the mock collector returns the same literal token string for every
    // caller, "has a token" can't distinguish inherited-from-manager vs.
    // freshly-registered by value. What it CAN prove: a *second*, distinct
    // /worker/register call actually happened for the new project (not
    // just the manager's own one at startup) — that's the real guarantee
    // "registers fresh and gets its own" is making.
    const state = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length >= 2 ? s : null;
    }, { label: 'new project worker registered separately from the manager' });
    assert.equal(state.workers.length, 2);
    assert.equal(state.workers[0].type, 'manager');
    assert.notEqual(state.workers[1].type, 'manager');

    process.kill(newPid); // cleanup — this test's own spawned process tree

    const dispatchState = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'create-project');
      return d?.status === 'done' ? s : null;
    }, { label: 'create-project dispatch reports done' });
    const dispatchEntry = dispatchState.dispatch.find(e => e.action === 'create-project');
    assert.match(dispatchEntry.result, /Created at/);
  });
});
