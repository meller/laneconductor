#!/usr/bin/env node
// conductor/tests/track-10064-env-reload.test.mjs
//
// Track 10064 Phases 1-2. Two defects, driven through a real worker
// process against two real mock collectors (mock-target.mjs):
//
// 1. `.env` (and conductor/defaults.json, .laneconductor.json) were read
//    via a bare relative path — correct only because track 10019's
//    chdir-to-primary happens to run first. A worker started with
//    LC_SKIP_CWD_NORMALIZATION=1 from inside a linked worktree, where
//    `.env` doesn't exist, silently sent no Authorization header to the
//    remote collector. TC-3 pins this.
//
// 2. `.laneconductor.json` is hot-reloaded, but `.env` was read exactly
//    once at module load — a collector added while the worker is running
//    goes live before its token does. TC-7 pins this: it is the actual
//    root cause of this track's reported incident (560 consecutive 401s
//    from a worker in the PRIMARY checkout, not a worktree).
//
// Run: node --test conductor/tests/track-10064-env-reload.test.mjs

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TMP = join(ROOT, `.test-tmp-track-10064-env-reload-${process.pid}`);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 20000, interval = 250, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

function startMock() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(__dirname, 'mock-target.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', d => {
      out += d.toString();
      const m = out.match(/MOCK_COLLECTOR_PORT=(\d+)/);
      if (m) resolve({ proc, port: parseInt(m[1]) });
    });
    proc.stderr.on('data', d => process.stderr.write(`[mock] ${d}`));
    proc.on('error', reject);
    setTimeout(() => reject(new Error('mock collector startup timeout')), 5000);
  });
}

async function getState(port) {
  const r = await fetch(`http://127.0.0.1:${port}/_state`);
  return r.json();
}

function stopWorker(worker) {
  return new Promise(resolve => {
    if (!worker || worker.exitCode !== null || worker.signalCode !== null) return resolve();
    worker.once('exit', () => resolve());
    try { process.kill(-worker.pid, 'SIGTERM'); }
    catch { try { worker.kill('SIGTERM'); } catch { /* already dead */ } }
    setTimeout(() => {
      try { process.kill(-worker.pid, 'SIGKILL'); } catch { /* already dead */ }
      resolve();
    }, 3000);
  });
}

function scaffoldProject(root, { collectorAUrl, collectorBUrl, extraEnvLines = [] } = {}) {
  mkdirSync(root, { recursive: true });
  // CRITICAL: this whole suite runs from inside a real git worktree
  // (.worktrees/10064). resolvePrimaryRepoRoot() walks UP via `git
  // rev-parse` regardless of LC_SKIP_CWD_NORMALIZATION (that env var only
  // gates the startup chdir, never the resolver itself) — a `root` that is
  // not its OWN git repo resolves to the ENCLOSING worktree's primary
  // checkout instead of `root`. Confirmed live while writing this suite:
  // omitting this `git init` sent real /worker/register, /conductor-files,
  // /provider-status, /tracks/reset-stuck-actions requests to this
  // machine's REAL local collector on :8091 using the REAL
  // .laneconductor.json's machine_token, and the real /conductor-files
  // UPDATE overwrote the actual project's cached docs with nulls (repaired
  // by hand afterwards — see conversation.md). Every scaffolded root MUST
  // be its own git repo so git-dir === git-common-dir and
  // resolvePrimaryRepoRoot(root) returns `root` unchanged. See also
  // track-10062-auth-required.test.mjs's setupProject, which does the same
  // for the same reason.
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(root, 'conductor/tracks/file_sync_queue.md'), '# File Sync Queue\n');
  writeFileSync(join(root, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-10064', id: 1, repo_path: root, primary: { cli: 'mock', model: 'mock' } },
    collectors: [
      { url: collectorAUrl, token: null },
      ...(collectorBUrl ? [{ url: collectorBUrl, token: null, enabled: true, type: 'remote' }] : []),
    ],
    ui: { port: 8090 },
  }, null, 2));
  if (extraEnvLines.length) writeFileSync(join(root, '.env'), extraEnvLines.join('\n') + '\n');
}

// This test process's OWN environment is a real developer/CI machine's —
// confirmed live while writing this suite: the ambient shell already has
// this project's real COLLECTOR_0_TOKEN/COLLECTOR_1_TOKEN exported (however
// that got there — a login shell profile, a prior `source .env`, whatever).
// `...process.env` below would otherwise hand the spawned worker that REAL
// credential, which always wins over anything this suite writes to a test
// `.env` (correctly — a real ambient env var must never lose to a file) and
// silently made every token-value assertion here compare against
// production data instead of the fixture. Stripped unconditionally; a test
// that wants to exercise "a real ambient env var wins" (TC-8) re-adds its
// OWN fixture value via `extraEnv`, applied after this strip.
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^COLLECTOR_\d+_TOKEN$/.test(key)) delete env[key];
  }
  return env;
}

function startWorker(cwd, extraEnv = {}) {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd,
    detached: true,
    env: {
      ...cleanEnv(),
      LC_SKIP_GIT_LOCK: '1',
      LC_SKIP_WORKER_LOCK: '1',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

describe('Track 10064: .env resolution and reload', () => {
  let mockA, mockAPort, mockB, mockBPort, worker;

  beforeEach(async () => {
    ({ proc: mockA, port: mockAPort } = await startMock());
    ({ proc: mockB, port: mockBPort } = await startMock());
  });

  afterEach(async () => {
    await stopWorker(worker);
    worker = null;
    mockA?.kill('SIGTERM');
    mockB?.kill('SIGTERM');
    rmSync(TMP, { recursive: true, force: true });
  });

  it('TC-3: a worker spawned with cwd inside a linked worktree still sends Authorization to the remote collector (LC_SKIP_CWD_NORMALIZATION=1 so track 10019\'s chdir cannot mask the defect)', async () => {
    const primary = join(TMP, 'primary');
    const worktree = join(TMP, 'worktree-track');
    mkdirSync(primary, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: primary });
    execFileSync('git', ['config', 'user.email', 'a@b.c'], { cwd: primary });
    execFileSync('git', ['config', 'user.name', 'a'], { cwd: primary });
    execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: primary });

    const collectorA = `http://127.0.0.1:${mockAPort}`;
    const collectorB = `http://127.0.0.1:${mockBPort}`;
    scaffoldProject(primary, {
      collectorAUrl: collectorA,
      collectorBUrl: collectorB,
      extraEnvLines: ['COLLECTOR_1_TOKEN=lc_live_test_token_for_tc3'],
    });

    // The worktree is a REAL linked git worktree of `primary` (git-dir !=
    // git-common-dir), so resolvePrimaryRepoRoot(worktree) === primary —
    // but the worktree directory itself has no .env, mirroring every real
    // `.worktrees/<track>` checkout in this repo.
    execFileSync('git', ['worktree', 'add', '-q', worktree, '-b', 'track-test'], { cwd: primary });
    mkdirSync(join(worktree, 'conductor/tracks'), { recursive: true });
    writeFileSync(join(worktree, 'conductor/tracks/file_sync_queue.md'), '# File Sync Queue\n');

    worker = startWorker(worktree, {
      // The defect this pins is masked by track 10019's own chdir whenever
      // it's allowed to run — LC_SKIP_CWD_NORMALIZATION=1 disables it, the
      // same escape hatch a real deployment could (mis)use.
      LC_SKIP_CWD_NORMALIZATION: '1',
    });

    await poll(async () => {
      const state = await getState(mockBPort);
      return state.workers.length > 0 ? state : null;
    }, { label: 'remote collector worker registration' });

    const stateB = await getState(mockBPort);
    const registerCall = stateB.requestAuthLog.find(r => r.path === '/worker/register');
    assert.ok(registerCall, 'remote collector never received /worker/register at all');
    assert.equal(registerCall.hasAuth, true, 'remote collector saw no Authorization header — this is the defect: .env was read relative to the worktree cwd, not the primary root');
    assert.equal(registerCall.authHeader, 'Bearer lc_live_test_token_for_tc3');
  });

  it('TC-4: a --manager worker resolves .env from its own cwd (never redirected)', async () => {
    const managerRoot = join(TMP, 'manager-root');
    const collectorA = `http://127.0.0.1:${mockAPort}`;
    const collectorB = `http://127.0.0.1:${mockBPort}`;
    scaffoldProject(managerRoot, {
      collectorAUrl: collectorA,
      collectorBUrl: collectorB,
      extraEnvLines: ['COLLECTOR_1_TOKEN=lc_live_manager_token'],
    });

    worker = startWorker(managerRoot, { LC_SKIP_CWD_NORMALIZATION: '1' });
    // --manager changes a lot of unrelated startup behavior (no project
    // scoping); easiest reliable signal here is the same
    // /worker/register call other tests use, with --manager appended.
    worker.kill('SIGKILL');
    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--manager'], {
      cwd: managerRoot,
      detached: true,
      env: { ...cleanEnv(), LC_SKIP_GIT_LOCK: '1', LC_SKIP_WORKER_LOCK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => process.stdout.write(`[manager] ${d}`));
    worker.stderr.on('data', d => process.stderr.write(`[manager] ${d}`));

    await poll(async () => {
      const state = await getState(mockBPort);
      return state.requestAuthLog.length > 0 ? state : null;
    }, { label: 'manager worker made some request to the remote collector' });

    const stateB = await getState(mockBPort);
    const anyAuthed = stateB.requestAuthLog.some(r => r.hasAuth);
    assert.ok(anyAuthed, 'manager worker never sent Authorization to the remote collector from its own cwd');
  });

  it('TC-7: adding a collector + its token to .env while the worker is already running takes effect without a restart', async () => {
    const root = join(TMP, 'reload-root');
    const collectorA = `http://127.0.0.1:${mockAPort}`;
    // Start with ONE collector and no remote token at all — the exact
    // pre-incident shape.
    scaffoldProject(root, { collectorAUrl: collectorA });

    worker = startWorker(root, { LC_SKIP_CWD_NORMALIZATION: '1' });

    await poll(async () => {
      const state = await getState(mockAPort);
      return state.workers.length > 0 ? state : null;
    }, { label: 'initial registration to collector A only' });

    // Remote collector must have received NOTHING yet.
    const beforeStateB = await getState(mockBPort);
    assert.equal(beforeStateB.requestAuthLog.length, 0, 'remote collector should not have been contacted before it was configured');

    // Now, while the worker is still running, add the token to .env FIRST
    // (mirrors the real incident's timeline — .env touched, then
    // .laneconductor.json), then append the second collector.
    appendFileSync(join(root, '.env'), 'COLLECTOR_1_TOKEN=lc_live_added_after_start\n');
    const collectorB = `http://127.0.0.1:${mockBPort}`;
    writeFileSync(join(root, '.laneconductor.json'), JSON.stringify({
      mode: 'local-api',
      project: { name: 'test-10064', id: 1, repo_path: root, primary: { cli: 'mock', model: 'mock' } },
      collectors: [
        { url: collectorA, token: null },
        { url: collectorB, token: null, enabled: true, type: 'remote' },
      ],
      ui: { port: 8090 },
    }, null, 2));

    await poll(async () => {
      const state = await getState(mockBPort);
      return state.requestAuthLog.length > 0 ? state : null;
    }, { timeout: 15000, label: 'remote collector receiving requests after reload' });

    const afterStateB = await getState(mockBPort);
    const authed = afterStateB.requestAuthLog.filter(r => r.hasAuth);
    assert.ok(authed.length > 0, 'no request to the newly-added remote collector carried Authorization — this is the actual incident: token added to .env after startup was never re-read on config reload');
    assert.equal(authed[0].authHeader, 'Bearer lc_live_added_after_start');
  });

  it('TC-8: a real ambient environment variable is never overwritten by a differing .env value on reload', async () => {
    const root = join(TMP, 'precedence-root');
    const collectorA = `http://127.0.0.1:${mockAPort}`;
    const collectorB = `http://127.0.0.1:${mockBPort}`;
    scaffoldProject(root, {
      collectorAUrl: collectorA,
      collectorBUrl: collectorB,
      extraEnvLines: ['COLLECTOR_1_TOKEN=lc_live_from_dotenv'],
    });

    worker = startWorker(root, {
      LC_SKIP_CWD_NORMALIZATION: '1',
      // A real, ambient env var — must always win over .env's value.
      COLLECTOR_1_TOKEN: 'lc_live_from_real_env',
    });

    await poll(async () => {
      const state = await getState(mockBPort);
      return state.requestAuthLog.some(r => r.hasAuth) ? state : null;
    }, { label: 'remote collector authenticated request' });

    const stateB = await getState(mockBPort);
    const authed = stateB.requestAuthLog.find(r => r.hasAuth);
    assert.equal(authed.authHeader, 'Bearer lc_live_from_real_env', 'a real ambient COLLECTOR_1_TOKEN must never be overridden by .env');

    // Trigger a reload with a still-different .env value — must still lose.
    writeFileSync(join(root, '.env'), 'COLLECTOR_1_TOKEN=lc_live_from_dotenv_v2\n');
    appendFileSync(join(root, '.laneconductor.json'), ' '); // touch to trigger chokidar's watch
    await sleep(1500);

    const stateB2 = await getState(mockBPort);
    const stillWins = stateB2.requestAuthLog.every(r => !r.hasAuth || r.authHeader === 'Bearer lc_live_from_real_env');
    assert.ok(stillWins, 'a .env change after reload must not override a real ambient environment variable');
  });

  it('TC-9: changing an existing COLLECTOR_1_TOKEN value in .env and reloading sends the NEW value (tokenCache invalidated)', async () => {
    const root = join(TMP, 'change-root');
    const collectorA = `http://127.0.0.1:${mockAPort}`;
    const collectorB = `http://127.0.0.1:${mockBPort}`;
    scaffoldProject(root, {
      collectorAUrl: collectorA,
      collectorBUrl: collectorB,
      extraEnvLines: ['COLLECTOR_1_TOKEN=lc_live_original'],
    });

    worker = startWorker(root, { LC_SKIP_CWD_NORMALIZATION: '1' });

    await poll(async () => {
      const state = await getState(mockBPort);
      return state.requestAuthLog.some(r => r.authHeader === 'Bearer lc_live_original') ? state : null;
    }, { label: 'initial token seen by remote collector' });

    writeFileSync(join(root, '.env'), 'COLLECTOR_1_TOKEN=lc_live_rotated\n');
    appendFileSync(join(root, '.laneconductor.json'), ' ');

    await poll(async () => {
      const state = await getState(mockBPort);
      return state.requestAuthLog.some(r => r.authHeader === 'Bearer lc_live_rotated') ? state : null;
    }, { timeout: 15000, label: 'rotated token seen by remote collector' });
  });
});
