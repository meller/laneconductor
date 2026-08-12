#!/usr/bin/env node
// conductor/tests/track-1089-provision-worker-dispatch.test.mjs
// Track 1089 Phase 6 (redesigned 2026-08-12, no SSH): the manager worker
// starts a worker for an existing project on its OWN machine, resolving
// the project folder from its own --projects-dir. Verified against a real
// spawned manager worker process.
//
// The success path deliberately isn't asserted here: it shells out to the
// real `lc worker start`, which would spawn a real long-lived worker
// process against a real collector. What IS asserted is the resolution
// and failure reporting — the parts this phase actually added, and the
// parts that were silently wrong before (a bare "failed" with no context).
// The full happy path is covered by the live browser verification noted
// in plan.md.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, '.test-tmp-track-1089-provision');
const PROJECTS_DIR = join(TMP, 'projects');
const FAKE_HOME = join(TMP, 'home');

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

function setupManager(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(PROJECTS_DIR, { recursive: true });
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'manager-scratch', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));
  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 }, defaults: { parallel_limit: 3, max_retries: 1 },
  }, null, 2));
  // The manager reads projectsDir from ~/.laneconductor/manager-config.json
  // (the file `lc worker start --manager --projects-dir` writes). Rather
  // than touching the real one — which would clobber a running manager's
  // actual configuration — the spawned worker gets a fake HOME pointing
  // into this test's own temp dir.
  mkdirSync(join(FAKE_HOME, '.laneconductor'), { recursive: true });
  writeFileSync(
    join(FAKE_HOME, '.laneconductor', 'manager-config.json'),
    JSON.stringify({ projectsDir: PROJECTS_DIR }, null, 2)
  );
}

describe('Track 1089 Phase 6: manager provisions a worker locally (no SSH)', () => {
  let collectorProc, collectorPort, manager;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupManager(collectorPort);

    manager = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only', '--manager'], {
      cwd: TMP,
      env: { ...process.env, HOME: FAKE_HOME, LC_SKIP_GIT_LOCK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    manager.stdout.on('data', d => process.stdout.write(`[manager] ${d}`));
    manager.stderr.on('data', d => process.stderr.write(`[manager] ${d}`));
  });

  after(() => {
    manager?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('fails with a clear, actionable message when the project is not on this machine', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'manager worker registered' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, {
      worker_id: workerId,
      action: 'provision-worker',
      payload: { project_name: 'not-on-this-machine', worker_number: 2 },
    });

    const dispatchState = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'provision-worker');
      return d && (d.status === 'done' || d.status === 'failed') ? s : null;
    }, { label: 'provision-worker dispatch completes' });
    const entry = dispatchState.dispatch.find(e => e.action === 'provision-worker');

    assert.equal(entry.status, 'failed');
    // Must name the project, every path actually tried, and the configured
    // projects dir — enough for the user to see *why* without digging
    // through worker logs. This is the specific regression the original
    // stub's bare "not yet implemented" message motivated fixing.
    assert.match(entry.result, /not-on-this-machine/);
    assert.match(entry.result, /not found on/i);
    assert.match(entry.result, /Looked in:/);
    assert.ok(entry.result.includes(PROJECTS_DIR), `expected the configured projects dir in: ${entry.result}`);
  });

  it('rejects a dispatch with no project_name rather than guessing', async () => {
    const state0 = await getState(collectorPort);
    // Track by dispatch id — this suite's earlier test already left one
    // 'provision-worker' entry behind, so find-by-action would match that
    // one instead of this test's.
    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: state0.workers[0].id,
      action: 'provision-worker',
      payload: { worker_number: 1 },
    });

    const entry = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => String(e.id) === String(dispatchId));
      return d && (d.status === 'done' || d.status === 'failed') ? d : null;
    }, { label: 'provision-worker dispatch completes (missing project_name)' });

    assert.equal(entry.status, 'failed');
    assert.match(entry.result, /project_name/);
  });
});
