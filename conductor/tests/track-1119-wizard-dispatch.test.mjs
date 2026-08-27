#!/usr/bin/env node
// conductor/tests/track-1119-wizard-dispatch.test.mjs
// Track AM-1119 Phase 2 (Task 3, TC-4/AC-2): the App Creator wizard's
// Deployment step choice (`wizard.deployment` on the create-project
// dispatch payload) must produce real conductor/deploy.json +
// deployment-stack.md + .env.example artifacts in the scaffolded project,
// matching the shape ui/server/index.mjs's deploy-config routes read/write
// (so DeployPanel works unchanged — REQ-2).
//
// Reuses the same manager-worker + mock-collector + mock-cli harness as
// track-1091-create-project-worker.test.mjs.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1119-wizard-dispatch');
const MANAGER_DIR = join(TMP, 'manager');
const TARGET_DIR_FIREBASE = join(TMP, 'digger-game');
const TARGET_DIR_SKIP = join(TMP, 'skip-deploy-project');

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

describe('Track AM-1119 Phase 2: wizard.deployment → deploy artifacts on create-project', () => {
  let collectorProc, collectorPort, managerWorker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    rmSync(TMP, { recursive: true, force: true });
    setupProject(MANAGER_DIR, collectorPort);
    mkdirSync(TARGET_DIR_FIREBASE, { recursive: true });
    mkdirSync(TARGET_DIR_SKIP, { recursive: true });

    managerWorker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only', '--manager'], {
      cwd: MANAGER_DIR,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '150', LC_SKIP_GIT_LOCK: '1', LC_SKIP_WORKER_LOCK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    managerWorker.stdout.on('data', d => process.stdout.write(`[manager] ${d}`));
    managerWorker.stderr.on('data', d => process.stderr.write(`[manager] ${d}`));

    await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'manager worker registered' });
  });

  after(() => {
    managerWorker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('writes conductor/deploy.json, deployment-stack.md, and .env.example from wizard.deployment (firebase + two envs)', async () => {
    const state = await getState(collectorPort);
    const workerId = state.workers[0].id;

    await enqueueDispatch(collectorPort, {
      worker_id: workerId,
      action: 'create-project',
      payload: {
        repo_source: { type: 'path', value: TARGET_DIR_FIREBASE },
        scaffold_context: { project: { name: 'Digger Game' } },
        wizard: {
          deployment: { provider: 'firebase', environments: ['prod', 'staging'] },
        },
      },
    });

    await poll(async () => existsSync(join(TARGET_DIR_FIREBASE, 'conductor', 'deploy.json')) || null,
      { label: 'deploy.json written' });

    const deployJson = JSON.parse(readFileSync(join(TARGET_DIR_FIREBASE, 'conductor', 'deploy.json'), 'utf8'));
    assert.equal(deployJson.provider, 'firebase');
    assert.equal(deployJson.defaultEnvironment, 'prod');
    assert.ok(deployJson.environments.prod, 'prod environment present');
    assert.ok(deployJson.environments.staging, 'staging environment present');
    assert.match(deployJson.environments.prod.command, /firebase deploy/);
    // Same shape ui/server/index.mjs's GET /api/projects/:id/deploy-config
    // and GET /api/projects/:id/deploy-environments read: environments is a
    // plain object keyed by env name, each with a string `command`.
    assert.equal(typeof deployJson.environments.prod.command, 'string');

    const deploymentStackMd = readFileSync(join(TARGET_DIR_FIREBASE, 'conductor', 'deployment-stack.md'), 'utf8');
    assert.match(deploymentStackMd, /Firebase Hosting/);
    assert.match(deploymentStackMd, /prod/);
    assert.match(deploymentStackMd, /staging/);

    const envExample = readFileSync(join(TARGET_DIR_FIREBASE, '.env.example'), 'utf8');
    assert.match(envExample, /FIREBASE_TOKEN/);

    // Regression guard: writing .env.example must not make the git-init
    // step (which runs after this) treat it as unexpected pre-existing
    // content and abort the whole create-project dispatch — found live
    // the first time this test ran (dispatch reported "failed" even
    // though deploy.json itself had already been written correctly).
    const dispatchDone = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'create-project' && e.payload?.repo_source?.value === TARGET_DIR_FIREBASE);
      return d?.status === 'done' || d?.status === 'failed' ? d : null;
    }, { label: 'create-project dispatch resolves' });
    assert.equal(dispatchDone.status, 'done', `create-project dispatch should succeed, got: ${dispatchDone.result}`);
    assert.ok(existsSync(join(TARGET_DIR_FIREBASE, '.git')), 'project should still be git-initialized');
  });

  it('writes no deploy.json when wizard.deployment.provider is "skip"', async () => {
    const state = await getState(collectorPort);
    const workerId = state.workers[0].id;

    await enqueueDispatch(collectorPort, {
      worker_id: workerId,
      action: 'create-project',
      payload: {
        repo_source: { type: 'path', value: TARGET_DIR_SKIP },
        scaffold_context: { project: { name: 'Skip Deploy Project' } },
        wizard: {
          deployment: { provider: 'skip', environments: [] },
        },
      },
    });

    await poll(async () => existsSync(join(TARGET_DIR_SKIP, '.laneconductor.json')) || null,
      { label: 'project scaffolded (skip case)' });
    // Give the (already-completed) create-project handler's synchronous
    // deploy-artifact step a moment it doesn't actually need, so a bug that
    // writes it late wouldn't produce a flaky false negative here.
    await sleep(300);
    assert.ok(!existsSync(join(TARGET_DIR_SKIP, 'conductor', 'deploy.json')), 'deploy.json should not be written for provider: skip');
  });
});
