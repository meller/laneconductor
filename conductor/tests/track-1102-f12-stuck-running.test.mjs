#!/usr/bin/env node
// conductor/tests/track-1102-f12-stuck-running.test.mjs
// Track 1102 F12: a successful worktree run must not leave the track's
// lane_action_status frozen at 'running' forever when the exit
// handler's completion PATCH (and copy-back's own DB sync right after
// it) both fail to a transient outage. Before the fix, nothing ever
// retried pushing the track's now-terminal file state to the DB, and
// the code's own comment at the completion-PATCH call site admitted it
// ("this one specifically has no other path to recovery").
//
// This is NOT the worker-restart-orphans-a-dispatch scenario (that's
// already covered live by Track 1110 Phase 6's startup reconciler,
// conductor/services/orphaned-dispatch.mjs). This is the SAME process,
// still alive, whose completion report simply failed to land.
//
// Reproduction: a real spawned worker, a real git worktree, a mock CLI
// that succeeds — but every write the collector receives fails for a
// window covering the whole exit handler (mock-collector.mjs's
// /_set-fail-all-writes test helper), simulating a real full outage at
// the exact moment the run finished. A narrower version of this test
// (failing only the direct completion PATCH) never reproduced a stuck
// track in the first place — copy-back's own independent syncTrack()
// call already self-healed that case; only a full outage covering both
// left it genuinely stuck, which is what this test targets. The fix:
// reconcileActiveDispatch() (already polling every 5s for exactly this
// class of thing) now also re-pushes the track's file state to the DB,
// retrying on each tick until it actually lands instead of giving up
// after one failed attempt.
//
// Run: node --test conductor/tests/track-1102-f12-stuck-running.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1102-f12');

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

async function setFailAllWrites(port, durationMs) {
  await fetch(`http://127.0.0.1:${port}/_set-fail-all-writes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ durationMs }),
  });
}

async function enqueueDispatch(port, entry) {
  const r = await fetch(`http://127.0.0.1:${port}/_enqueue-dispatch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
  });
  return (await r.json()).id;
}

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execSync('git init -q', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: TMP });

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

  const trackDir = join(TMP, 'conductor/tracks/001-test-track');
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    '# Track 001: Test Track',
    '',
    '**Lane**: implement',
    '**Lane Status**: queue',
    '**Progress**: 0%',
  ].join('\n'));

  execSync('git add -A', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m init2', { cwd: TMP });

  return trackDir;
}

describe('Track 1102 F12: a failed completion PATCH permanently freezes the track at running', () => {
  let collectorProc, collectorPort, worker, trackDir;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    trackDir = setupProject(collectorPort);

    // Real git lock/worktree path — needed for copy-back to have
    // something real to copy. MOCK_CLI_DELAY_MS keeps the run fast.
    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '3000', LC_DISPATCH_POLL_MS: '500' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
    worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  });

  after(() => {
    worker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('self-heals to a terminal status once the outage clears, instead of staying stuck at running forever', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'implement', track_number: '001' });

    // Let claim + git-lock + worktree setup succeed for real first (the
    // outage must only cover the EXIT HANDLER's writes, not the ones
    // needed to even start the run — otherwise the run never starts at
    // all, which isn't this scenario). The worktree appearing on disk
    // proves that part completed.
    const worktreeIndexPath = join(TMP, '.worktrees', '001', 'conductor/tracks/001-test-track', 'index.md');
    await poll(async () => existsSync(worktreeIndexPath) || null, { label: 'worktree created' });

    // NOW fail every write for a window comfortably covering the mock
    // CLI's remaining delay (3000ms) plus exit-handler processing —
    // simulates a real full outage covering the whole exit handler
    // (completion PATCH, conversation.md comment sync, copy-back's own
    // DB sync), not just one specific endpoint.
    await setFailAllWrites(collectorPort, 5000);

    // First, confirm it's genuinely stuck WHILE the outage is active —
    // same evidence the pre-fix version of this test used to prove the
    // bug. This isn't the interesting assertion (of course it's stuck
    // mid-outage); it's a sanity check that the repro still triggers.
    await sleep(4000);
    const midOutage = await getState(collectorPort);
    assert.equal(midOutage.tracks['001']?.lane_action_status, 'running',
      'Sanity check failed: track should still be running mid-outage — the reproduction itself may be broken.');

    // The real assertion: once the outage clears, reconcileActiveDispatch()
    // (polling every 5s) must eventually notice the worktree/primary file's
    // terminal Lane Status and successfully re-push it to the DB — not stay
    // stuck forever the way it did before this fix.
    const healed = await poll(async () => {
      const s = await getState(collectorPort);
      const status = s.tracks['001']?.lane_action_status;
      return status && status !== 'running' ? s : null;
    }, { timeout: 15000, interval: 500, label: 'track self-heals out of running after the outage clears' });

    assert.equal(healed.tracks['001'].lane_action_status, 'success');
    assert.equal(healed.tracks['001'].progress_percent, 100);
  });
});
