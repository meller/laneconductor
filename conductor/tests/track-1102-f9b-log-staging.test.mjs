#!/usr/bin/env node
// conductor/tests/track-1102-f9b-log-staging.test.mjs
// Track 1102 F9b: spawnCli's exit handler ("Phase 4: Write last run log to
// the track folder", conductor/laneconductor.sync.mjs) writes last_run.log
// to disk, then tries to `git add` it via
//   execSync(`git add "${relLogPath}"`, { cwd: workDir, stdio: 'pipe' })
// — but `workDir` at that point is declared later, inside a SIBLING
// `if (updated) { const workDir = ... }` block, so it is out of scope
// where it's used. That throws ReferenceError: workDir is not defined,
// swallowed by this call's own empty `catch (e) {}`, so last_run.log is
// written but never staged.
//
// Reproduction: real spawned worker, real git worktree, a mock CLI that
// prints output (mock-cli.mjs always logs at least one startup line).
// After the run completes, last_run.log must exist on disk (unaffected —
// writeFileSync happens before the broken git add) AND be staged in git
// (`git status --porcelain` shows it as a staged addition, not untracked).
//
// Run: node --test conductor/tests/track-1102-f9b-log-staging.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1102-f9b');

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

async function enqueueDispatch(port, entry) {
  const r = await fetch(`http://127.0.0.1:${port}/_enqueue-dispatch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
  });
  return (await r.json()).id;
}

const PRIMARY_INDEX = [
  '# Track 001: A Track With Log Output',
  '',
  '**Lane**: plan',
  '**Lane Status**: queue',
  '**Progress**: 0%',
].join('\n');

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execSync('git init -q', { cwd: TMP });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' }, worktree_lifecycle: 'per-cycle' },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: { plan: { parallel_limit: 1, max_retries: 1 } },
  }, null, 2));

  const trackDir = join(TMP, 'conductor/tracks/001-a-track-with-log-output');
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), PRIMARY_INDEX);
  writeFileSync(join(trackDir, 'plan.md'), '# Plan\n\n## Phase 1\n\n**Problem**: unrelated.\n');

  execSync('git add -A', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: TMP });

  return trackDir;
}

describe('Track 1102 F9b: last_run.log gets staged after a run with log output', () => {
  let collectorProc, collectorPort, worker, trackDir;
  const workerLogs = [];

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    trackDir = setupProject(collectorPort);

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '300', LC_DISPATCH_POLL_MS: '500' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => { workerLogs.push(d.toString()); process.stdout.write(`[worker] ${d}`); });
    worker.stderr.on('data', d => { workerLogs.push(d.toString()); process.stderr.write(`[worker] ${d}`); });
  });

  after(() => {
    worker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('writes last_run.log to disk and stages it in git after the run', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state0.workers[0].id;

    const dispatchId = await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'plan', track_number: '001' });

    // Wait for the dispatch itself to leave 'claimed' — this is the exit
    // handler's own completion signal, unlike polling index.md's Lane
    // Status (which can read 'queue' before the run ever starts, making
    // "not running" a false positive for "already finished").
    await poll(async () => {
      const s = await getState(collectorPort);
      const entry = s.dispatch.find(d => d.id === dispatchId);
      return entry && entry.status !== 'claimed' && entry.status !== 'pending' ? entry : null;
    }, { timeout: 15000, interval: 300, label: 'dispatch leaves claimed/pending' });

    await sleep(500); // let any trailing writes/commits settle

    // last_run.log is written into the WORKTREE's own tracks dir (spawnCli's
    // exit handler uses `tracksDir = join(worktreePath || process.cwd(), ...)`
    // for it) — it is not one of the artifacts copyWorktreeArtifactsToPrimary()
    // copies back to primary, so it only ever exists in the worktree.
    const worktreeDir = join(TMP, '.worktrees', '001');
    assert.ok(existsSync(worktreeDir), 'worktree must still exist after a plain plan run (per-cycle lifecycle)');
    const lastRunLogPath = join(worktreeDir, 'conductor/tracks/001-a-track-with-log-output', 'last_run.log');
    assert.ok(existsSync(lastRunLogPath), 'last_run.log must exist on disk (in the worktree) after a run with output');

    // The exit handler's own git commit runs right after staging
    // last_run.log, so a successful `git add` normally ends up fully
    // committed (not merely staged) by the time we check — `git status`
    // would then show nothing for it at all (clean tree), which is NOT
    // the same as "still untracked". Check `git ls-files` instead: it
    // answers "is this file tracked by git", true whether it's committed
    // or only staged, false if the `git add` never ran (the bug).
    const relLogPath = 'conductor/tracks/001-a-track-with-log-output/last_run.log';
    const tracked = execSync(`git ls-files -- "${relLogPath}"`, { cwd: worktreeDir, encoding: 'utf8' }).trim();
    assert.ok(
      tracked === relLogPath,
      `last_run.log must be tracked by git (the workDir git-add must have succeeded) after the run.\n` +
      `git ls-files output: "${tracked}"`
    );

    const fullLog = workerLogs.join('');
    assert.ok(
      !fullLog.includes('workDir is not defined') && !fullLog.includes('ReferenceError'),
      `Worker output must not show the workDir ReferenceError.\nWorker output:\n${fullLog}`
    );
  });
});
