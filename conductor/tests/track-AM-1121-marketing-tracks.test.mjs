#!/usr/bin/env node
// conductor/tests/track-AM-1121-marketing-tracks.test.mjs
// Track AM-1121: scaffold_context.project.kind: 'marketing' routes track
// generation through runMarketingTrackBrainstorm (a real spawned `claude`
// process prompted to consult marketing-ideas/content-strategy/
// analytics-tracking/launch-strategy/social-content) instead of
// deriveTrackPlan's hardcoded app-shaped templates ("App Skeleton",
// "Deploy to <provider>"). Verified against a real spawned manager worker
// process (not a mock of the handler), same harness as
// track-1091-create-project-worker.test.mjs.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-am1121-marketing');
const MANAGER_DIR = join(TMP, 'manager');

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

describe('Track AM-1121: marketing-kind create-project routes tracks through the marketing skills', () => {
  let collectorProc, collectorPort, managerWorker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    rmSync(TMP, { recursive: true, force: true });
    setupProject(MANAGER_DIR, collectorPort);

    managerWorker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only', '--manager'], {
      cwd: MANAGER_DIR,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '150', LC_SKIP_GIT_LOCK: '1', LC_SKIP_WORKER_LOCK: '1' },
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

  it('kind: marketing writes the LLM-sourced tracks, not App Skeleton/Deploy templates, and skips deploy.json', async () => {
    const targetDir = join(TMP, 'book-marketing');
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'manager worker registered' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, {
      worker_id: workerId,
      action: 'create-project',
      payload: {
        repo_source: { type: 'path', value: targetDir },
        scaffold_context: {
          project: { name: 'Book Marketing', has_existing_code: false, kind: 'marketing' },
          brainstorm_summary: 'Project purpose: sell more copies of a yoga book',
        },
        wizard: { product: { target_users: 'yoga practitioners' }, design: null, deployment: { provider: 'skip', environments: [] } },
      },
    });

    const plan = await poll(async () => existsSync(join(targetDir, 'conductor', '.wizard-track-plan.json')) || null,
      { label: 'mock-cli wrote the marketing track plan' });

    const dispatchState = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'create-project');
      return d?.status === 'done' ? s : null;
    }, { timeout: 20000, label: 'create-project dispatch reports done' });
    const dispatchEntry = dispatchState.dispatch.find(e => e.action === 'create-project');
    assert.match(dispatchEntry.result, /Created at/);

    const tracksDir = join(targetDir, 'conductor', 'tracks');
    const trackFolders = readdirSync(tracksDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    assert.equal(trackFolders.length, 3, `expected 3 generated tracks, got: ${trackFolders.join(', ')}`);

    const titles = trackFolders.map(f => readFileSync(join(tracksDir, f, 'index.md'), 'utf8').match(/^# Track [^:]+: (.+)$/m)[1]);
    assert.deepEqual(titles.sort(), ['Content Plan', 'KPI Tracking', 'Promotion Channels'].sort());
    assert.ok(!titles.some(t => /App Skeleton|Deploy to/i.test(t)), 'marketing kind must not produce app-shaped templated tracks');

    // Every generated track still carries Auto Run: yes — same contract as
    // deriveTrackPlan's output, so a sync+poll worker claims these too.
    for (const f of trackFolders) {
      const content = readFileSync(join(tracksDir, f, 'index.md'), 'utf8');
      assert.match(content, /\*\*Auto Run\*\*:\s*yes/);
    }

    assert.ok(!existsSync(join(targetDir, 'conductor', 'deploy.json')), 'marketing kind has no deployment step — deploy.json should not be written');

    const newPidPath = join(targetDir, 'conductor', '.sync.pid');
    await poll(async () => existsSync(newPidPath) || null, { label: 'worker spawned for the new project' });
    try { process.kill(parseInt(readFileSync(newPidPath, 'utf8').trim(), 10)); } catch { }
  });

  // Companion to the 'marketing' test above: proves the branch in
  // runCreateProject actually branches — kind: 'app' (and, separately,
  // omitting kind entirely — covered by track-1119-phase3-track-generation's
  // existing scaffold_context.project with no kind field at all) must keep
  // going through deriveTrackPlan/writeGeneratedTracks exactly as before
  // this track, and must never invoke runMarketingTrackBrainstorm at all —
  // not just "produces similar-looking tracks", but "never spawned the
  // second claude process or touched .wizard-track-plan.json in the first
  // place".
  it('kind: app (explicit) still goes through deriveTrackPlan and never spawns the marketing brainstorm', async () => {
    const targetDir = join(TMP, 'digger-game-explicit-app-kind');
    const state = await getState(collectorPort);
    const workerId = state.workers[0].id;

    await enqueueDispatch(collectorPort, {
      worker_id: workerId,
      action: 'create-project',
      payload: {
        repo_source: { type: 'path', value: targetDir },
        scaffold_context: {
          project: { name: 'Digger Game', has_existing_code: false, kind: 'app' },
          brainstorm_summary: [
            'Project purpose: Dig for ore, avoid hazards',
            'Success metrics / KPIs: 500 plays in week 1',
          ].join('\n'),
        },
        wizard: { product: {}, design: null, deployment: { provider: 'skip', environments: [] } },
      },
    });

    const dispatchState = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'create-project'
        && e.payload?.scaffold_context?.project?.name === 'Digger Game');
      return d?.status === 'done' ? s : null;
    }, { timeout: 20000, label: 'explicit app-kind create-project dispatch reports done' });
    const dispatchEntry = dispatchState.dispatch.find(e => e.action === 'create-project'
      && e.payload?.scaffold_context?.project?.name === 'Digger Game');
    assert.match(dispatchEntry.result, /Created at/);

    const tracksDir = join(targetDir, 'conductor', 'tracks');
    const trackFolders = readdirSync(tracksDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    const titles = trackFolders.map(f => readFileSync(join(tracksDir, f, 'index.md'), 'utf8').match(/^# Track [^:]+: (.+)$/m)[1]);

    // deriveTrackPlan's exact, deterministic shape for this input: App
    // Skeleton (always first), a Core Feature track (purpose was given), a
    // Success Metrics track (KPIs were given), no deploy track (provider:
    // skip) — see wizard-track-plan.test.mjs for deriveTrackPlan's own
    // direct unit tests of this contract.
    assert.ok(titles.some(t => t === 'App Skeleton'), `expected an "App Skeleton" track, got: ${titles.join(', ')}`);
    assert.ok(titles.some(t => t.startsWith('Core Feature:')), `expected a "Core Feature:" track, got: ${titles.join(', ')}`);
    assert.ok(titles.some(t => t.startsWith('Success Metrics:')), `expected a "Success Metrics:" track, got: ${titles.join(', ')}`);
    assert.ok(!titles.some(t => /Promotion Channels|Content Plan|KPI Tracking/.test(t)), 'app kind must not produce marketing-brainstorm track titles');

    // The real proof this took the deterministic branch, not just a plan
    // that happens to look app-shaped: runMarketingTrackBrainstorm's own
    // JSON handoff file must never have been written for this project.
    assert.ok(!existsSync(join(targetDir, 'conductor', '.wizard-track-plan.json')),
      'kind: app must never invoke runMarketingTrackBrainstorm (no .wizard-track-plan.json should exist)');

    const newPidPath = join(targetDir, 'conductor', '.sync.pid');
    await poll(async () => existsSync(newPidPath) || null, { label: 'worker spawned for the new project' });
    try { process.kill(parseInt(readFileSync(newPidPath, 'utf8').trim(), 10)); } catch { }
  });
});

describe('Track AM-1121: marketing brainstorm failure is reported clearly, not silently swallowed', () => {
  const TMP2 = join(ROOT, '.test-tmp-track-am1121-marketing-failure');
  const MANAGER_DIR2 = join(TMP2, 'manager');
  let collectorProc, collectorPort, managerWorker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    rmSync(TMP2, { recursive: true, force: true });
    setupProject(MANAGER_DIR2, collectorPort);

    // MOCK_CLI_SKIP_MARKETING_TRACK_PLAN: this scenario needs a mock-cli that
    // exits 0 (scaffold generate succeeds) but never writes
    // .wizard-track-plan.json — the "brainstorm ran but produced nothing"
    // case. Env is fixed for the worker's whole process lifetime, so this
    // gets its own manager worker rather than sharing the happy-path one above.
    managerWorker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only', '--manager'], {
      cwd: MANAGER_DIR2,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '150', MOCK_CLI_SKIP_MARKETING_TRACK_PLAN: '1', LC_SKIP_GIT_LOCK: '1', LC_SKIP_WORKER_LOCK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    managerWorker.stdout.on('data', d => process.stdout.write(`[manager2] ${d}`));
    managerWorker.stderr.on('data', d => process.stderr.write(`[manager2] ${d}`));
  });

  after(() => {
    managerWorker?.kill();
    collectorProc?.kill();
    rmSync(TMP2, { recursive: true, force: true });
  });

  it('fails the dispatch with an error naming the marketing brainstorm, instead of reporting done with zero tracks', async () => {
    const targetDir = join(TMP2, 'book-marketing-failure');
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'manager worker registered' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, {
      worker_id: workerId,
      action: 'create-project',
      payload: {
        repo_source: { type: 'path', value: targetDir },
        scaffold_context: { project: { name: 'Book Marketing Failure', has_existing_code: false, kind: 'marketing' } },
        wizard: { product: {}, design: null, deployment: { provider: 'skip', environments: [] } },
      },
    });

    const dispatchState = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'create-project');
      return d?.status === 'failed' ? s : null;
    }, { timeout: 20000, label: 'create-project dispatch reports failed' });
    const dispatchEntry = dispatchState.dispatch.find(e => e.action === 'create-project');
    assert.match(dispatchEntry.result, /marketing track generation failed/);
    assert.match(dispatchEntry.result, /did not write/);

    // Scaffolding itself (conductor/ files) still ran before the failure —
    // this is specifically a track-generation failure, not a total loss.
    assert.ok(existsSync(join(targetDir, 'conductor', '.setup-scaffold-context.json')), 'scaffold context should still be written even though track generation failed');
  });
});
