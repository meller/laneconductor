#!/usr/bin/env node
// conductor/tests/track-1102-f9b-log-staging.test.mjs
// Track 1102 F9b originally found spawnCli's exit handler referencing
// `workDir` (for a `git add` of last_run.log) before it was declared —
// a ReferenceError swallowed by an empty catch. F9b hoisted the
// declaration and turned the catch into a console.warn, and this test
// was written to assert the `git add` then succeeded.
//
// It did, in THIS test's fixture — but only because the fixture never
// wrote a `.gitignore`. Track 10016 found that the real repository's
// `.gitignore` has `*.log` (matching last_run.log), and git refuses to
// stage an explicitly-named ignored path without `-f`. Adding a
// `*.log` `.gitignore` to this fixture (to match production) reproduces
// that live: the `git add` fails and F9b's console.warn fires on every
// run with log output — see track 10016's spec.md Finding B.
//
// Track 10016 removed the `git add` call entirely rather than working
// around the ignore rule (`git add -f` / a `!last_run.log` negation was
// considered and rejected — see spec.md's Rejected Alternative):
// last_run.log is a per-run runtime artifact, same category as
// conductor/.runs/<track>.json, which product.md already documents as
// not committed. This test now asserts that corrected behavior: the
// file is written to disk, is NOT staged/tracked, and produces no
// warning.
//
// Reproduction: real spawned worker, real git worktree (with a
// production-matching `.gitignore`), a mock CLI that prints output
// (mock-cli.mjs always logs at least one startup line).
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

// Track 1115 (merged into this branch 2026-08 via main): the 'plan' lane
// is now ALWAYS main-direct (resolveWorkspaceMode() row 1, unconditional,
// no worktree) — this test originally dispatched 'plan' specifically to
// get a worktree. Switched to 'implement', which still defaults to
// 'branch' (today's worktree-per-track behavior) for a manually-dispatched,
// non-bug track with no explicit **Workspace** marker or project default.
const PRIMARY_INDEX = [
  '# Track 001: A Track With Log Output',
  '',
  '**Lane**: implement',
  '**Lane Status**: queue',
  '**Progress**: 0%',
].join('\n');

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execSync('git init -q', { cwd: TMP });
  writeFileSync(join(TMP, '.gitignore'), '*.log\n'); // matches production .gitignore:17

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
    lanes: { implement: { parallel_limit: 1, max_retries: 1 } },
  }, null, 2));

  const trackDir = join(TMP, 'conductor/tracks/001-a-track-with-log-output');
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), PRIMARY_INDEX);
  writeFileSync(join(trackDir, 'plan.md'), '# Plan\n\n## Phase 1\n\n**Problem**: unrelated.\n');

  execSync('git add -A', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: TMP });

  return trackDir;
}

describe('Track 10016: last_run.log is written but never staged (matches .gitignore)', () => {
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

  it('writes last_run.log to disk but never stages or warns about it', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state0.workers[0].id;

    const dispatchId = await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'implement', track_number: '001' });

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

    // last_run.log matches the fixture's `.gitignore` (`*.log`, mirroring
    // production) — it must never be tracked. `git ls-files` answers "is
    // this file tracked by git" whether committed or merely staged.
    const relLogPath = 'conductor/tracks/001-a-track-with-log-output/last_run.log';
    const tracked = execSync(`git ls-files -- "${relLogPath}"`, { cwd: worktreeDir, encoding: 'utf8' }).trim();
    assert.strictEqual(
      tracked, '',
      `last_run.log must NOT be tracked by git — it matches .gitignore's *.log and staging it was removed.\n` +
      `git ls-files output: "${tracked}"`
    );

    // git check-ignore -v confirms it's the *.log rule doing the ignoring,
    // not some other mechanism (e.g. the file simply never being added).
    const ignoreCheck = execSync(`git check-ignore -v -- "${relLogPath}"`, { cwd: worktreeDir, encoding: 'utf8' }).trim();
    assert.match(ignoreCheck, /\*\.log/, `expected .gitignore's *.log rule to match, got: "${ignoreCheck}"`);

    const fullLog = workerLogs.join('');
    assert.ok(
      !fullLog.includes('workDir is not defined') && !fullLog.includes('ReferenceError'),
      `Worker output must not show the workDir ReferenceError.\nWorker output:\n${fullLog}`
    );
    assert.ok(
      !fullLog.includes('Failed to stage last_run.log'),
      `Worker output must not show the (now-removed) staging warning.\nWorker output:\n${fullLog}`
    );
  });
});
