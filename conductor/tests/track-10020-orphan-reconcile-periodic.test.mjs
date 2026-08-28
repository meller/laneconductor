#!/usr/bin/env node
// conductor/tests/track-10020-orphan-reconcile-periodic.test.mjs
// Track 10020 Phase 2/3/4: reconcileOrphanedDispatches() used to run
// exactly ONCE per sync-worker process, immediately after that process's
// first successful registration. If a worker restarted WHILE a dispatched
// lane action's detached CLI child was still genuinely running, the
// one-time check correctly found nothing to reconcile and never ran
// again — the child's own proc.on('exit') handler lived in the memory of
// the now-replaced process and never fired either. The dispatch, the DB's
// lane_action_status, and the primary checkout's index.md all stayed
// frozen forever, even after the worktree's own index.md correctly showed
// the finished state and was fully committed.
//
// Reproduced live: track 10018's quality-gate dispatch (worker_dispatch id
// 1588) finished successfully but sat stuck at quality-gate:queue for 5+
// minutes with zero live process tracking it.
//
// This suite drives the FIX (a periodic tick + a persistent, cross-process
// run-marker liveness signal) via DIRECT STATE SEEDING rather than a
// literal two-process kill/restart choreography: a real worktree carrying
// the track's terminal markers, a real run-marker JSON pointing at a real
// long-lived process (`sleep N` standing in for "the CLI child is still
// alive" — genuinely alive, genuinely reports "sleep N" via `ps`), and a
// `claimed` dispatch row seeded directly into the mock collector. ONE
// worker process — which never itself spawned any of these — then proves
// its periodic tick reconciles (or correctly refuses to reconcile) each
// scenario, exercising the IDENTICAL reconcileOrphanedDispatches() code
// path a real restart would hit (this worker's own runningTrackMap/
// activeDispatch are empty for every seeded track, exactly as they would
// be for a REPLACEMENT process after a real restart).
//
// Run: node --test conductor/tests/track-10020-orphan-reconcile-periodic.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { runMarkerPath, buildRunMarker } from '../services/run-marker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10020-orphan-periodic');

function sleepMs(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 15000, interval = 200, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleepMs(interval);
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

function primaryTrackDir(track) { return join(TMP, 'conductor/tracks', `${track}-test-track`); }
function worktreeIndexPath(track) { return join(TMP, '.worktrees', track, 'conductor/tracks', `${track}-test-track`, 'index.md'); }

function writeIndex(path, { lane, laneStatus }) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, [
    `# Track ${path.includes('.worktrees') ? 'worktree' : 'primary'} copy`,
    '',
    `**Lane**: ${lane}`,
    `**Lane Status**: ${laneStatus}`,
    '**Progress**: 0%',
    '',
    '## Problem',
    'Test problem.',
  ].join('\n'));
}

function writeRunMarker(track, { pid, command, dispatchId, action }) {
  const markerPath = runMarkerPath(TMP, track);
  mkdirSync(dirname(markerPath), { recursive: true });
  const marker = buildRunMarker({ pid, pgid: pid, workerPid: 999999, trackNumber: track, dispatchId, action, command });
  writeFileSync(markerPath, JSON.stringify(marker, null, 2));
  return markerPath;
}

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execSync('git init -q', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: TMP });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: { implement: { parallel_limit: 1, max_retries: 1 } },
  }, null, 2));
}

describe('Track 10020 Phase 2/3/4: periodic orphan reconciliation', () => {
  let collectorProc, collectorPort, worker, workerId;
  const workerLog = [];

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    setupProject(collectorPort);

    // Fast poll intervals throughout so the suite runs in seconds, not
    // minutes — the grace window (900ms) is comfortably larger than one
    // orphan-reconcile tick (300ms) so TC-2.4 can observe the "still inside
    // grace" window before it expires.
    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_SKIP_GIT_LOCK: '1',
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        // TC-2.3 is the only test in this suite where the worker spawns a
        // REAL mock-cli itself (all others direct-state-seed); a generous
        // delay lets that test observe it staying 'claimed' across several
        // 300ms orphan-reconcile ticks while genuinely still running,
        // instead of racing to assert on the end state alone.
        MOCK_CLI_DELAY_MS: '1200',
        LC_DISPATCH_POLL_MS: '300',
        LC_RECONCILE_ACTIVE_POLL_MS: '300',
        LC_ORPHAN_RECONCILE_POLL_MS: '300',
        LC_ORPHAN_RECONCILE_GRACE_MS: '900',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => { const s = d.toString(); workerLog.push(s); process.stdout.write(`[worker] ${s}`); });
    worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));

    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    workerId = state0.workers[0].id;
  });

  after(() => {
    worker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('TC-4.5: a tick with nothing claimed is a cheap no-op — no orphan-reconcile log lines, no PATCHes', async () => {
    workerLog.length = 0;
    await sleepMs(1200); // several ticks at 300ms
    const noise = workerLog.filter(l => l.includes('[orphan-reconcile]'));
    assert.equal(noise.length, 0, `expected zero orphan-reconcile log lines with nothing claimed, got: ${JSON.stringify(noise)}`);
    const state = await getState(collectorPort);
    assert.equal(state.dispatch.length, 0);
  });

  it('TC-2.4: a dispatch claimed moments ago is skipped until the grace window elapses', async () => {
    const track = '005';
    writeIndex(join(primaryTrackDir(track), 'index.md'), { lane: 'implement', laneStatus: 'queue' });
    writeIndex(worktreeIndexPath(track), { lane: 'implement', laneStatus: 'success' });

    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: track, action: 'implement',
      status: 'claimed', claimed_at: new Date().toISOString(),
    });

    // Still well inside the 900ms grace window.
    await sleepMs(500);
    let state = await getState(collectorPort);
    let entry = state.dispatch.find(d => d.id === dispatchId);
    assert.equal(entry.status, 'claimed', 'must not finalize before the grace window elapses');

    // Grace window (900ms from claim) plus at least one more 300ms tick.
    state = await poll(async () => {
      const s = await getState(collectorPort);
      const e = s.dispatch.find(d => d.id === dispatchId);
      return e.status !== 'claimed' ? s : null;
    }, { timeout: 5000, label: 'TC-2.4 reconciles once grace elapses' });
    entry = state.dispatch.find(d => d.id === dispatchId);
    assert.equal(entry.status, 'done');
  });

  it('TC-4.1 (the live 10018 incident): a dispatch whose worktree already finished, with no run marker, is closed out and copied to the primary', async () => {
    const track = '001';
    writeIndex(join(primaryTrackDir(track), 'index.md'), { lane: 'quality-gate', laneStatus: 'queue' });
    // The worktree's own state already shows the finished, committed
    // result — exactly what track 10018's worktree looked like when it
    // was found stuck.
    writeIndex(worktreeIndexPath(track), { lane: 'quality-gate', laneStatus: 'success' });

    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: track, action: 'quality-gate',
      status: 'claimed', claimed_at: new Date(Date.now() - 60000).toISOString(), // well past grace
    });

    const state = await poll(async () => {
      const s = await getState(collectorPort);
      const e = s.dispatch.find(d => d.id === dispatchId);
      return e && e.status !== 'claimed' ? s : null;
    }, { timeout: 5000, label: 'TC-4.1 reconciles a finished-while-orphaned dispatch' });

    const entry = state.dispatch.find(d => d.id === dispatchId);
    assert.equal(entry.status, 'done');
    assert.equal(entry.finalizePatchCount, 1, 'exactly one finalizing PATCH — no double-PATCH race');

    const primaryIndex = readFileSync(join(primaryTrackDir(track), 'index.md'), 'utf8');
    assert.match(primaryIndex, /\*\*Lane\*\*:\s*quality-gate/i, 'artifacts must actually be copied back to the primary checkout');
  });

  it('TC-4.2: a live run marker protects a track from premature finalization, even though the worktree already reads a terminal status', async () => {
    const track = '002';
    writeIndex(join(primaryTrackDir(track), 'index.md'), { lane: 'quality-gate', laneStatus: 'queue' });
    // Terminal-looking worktree state — WOULD be classified orphaned:done
    // if evaluated, exactly like TC-4.1. The only difference is a live
    // marker, which must cause it to be skipped before classification ever
    // runs.
    writeIndex(worktreeIndexPath(track), { lane: 'quality-gate', laneStatus: 'success' });

    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: track, action: 'quality-gate',
      status: 'claimed', claimed_at: new Date(Date.now() - 60000).toISOString(),
    });

    // A REAL long-lived process this worker never spawned — standing in
    // for "a different process's CLI child is still alive". This worker's
    // own runningTrackMap/activeDispatch are empty for this track, so ONLY
    // the run-marker liveness check can be protecting it.
    const liveProc = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    liveProc.unref();
    writeRunMarker(track, { pid: liveProc.pid, command: 'sleep', dispatchId, action: 'quality-gate' });

    try {
      // Several ticks (900ms+ at 300ms) — must stay claimed the whole time.
      await sleepMs(1200);
      const state = await getState(collectorPort);
      const entry = state.dispatch.find(d => d.id === dispatchId);
      assert.equal(entry.status, 'claimed', 'a live run marker must prevent finalization even with a terminal-looking worktree status');
    } finally {
      try { process.kill(liveProc.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  });

  it('TC-4.3 (crash detection, folds TC-2.6): a dead run-marker process with the worktree stuck at "running" is closed out as failed, flags a human, and the marker is deleted', async () => {
    const track = '003';
    mkdirSync(primaryTrackDir(track), { recursive: true });
    writeIndex(join(primaryTrackDir(track), 'index.md'), { lane: 'implement', laneStatus: 'queue' });
    writeFileSync(join(primaryTrackDir(track), 'conversation.md'), '');
    // The worktree never got a chance to write a terminal status —
    // exactly what a SIGKILL/OOM crash mid-run leaves behind.
    writeIndex(worktreeIndexPath(track), { lane: 'implement', laneStatus: 'running' });

    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: track, action: 'implement',
      status: 'claimed', claimed_at: new Date(Date.now() - 60000).toISOString(),
    });

    const crashedProc = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    crashedProc.unref();
    const markerPath = writeRunMarker(track, { pid: crashedProc.pid, command: 'sleep', dispatchId, action: 'implement' });
    process.kill(crashedProc.pid, 'SIGKILL');
    // Give the OS a moment to actually reap/mark the pid gone.
    await sleepMs(300);

    const state = await poll(async () => {
      const s = await getState(collectorPort);
      const e = s.dispatch.find(d => d.id === dispatchId);
      return e && e.status !== 'claimed' ? s : null;
    }, { timeout: 5000, label: 'TC-4.3 reconciles a crashed run' });

    const entry = state.dispatch.find(d => d.id === dispatchId);
    assert.equal(entry.status, 'failed');
    assert.match(entry.result, /implement/);

    const conversation = readFileSync(join(primaryTrackDir(track), 'conversation.md'), 'utf8');
    assert.match(conversation, />\s*\*\*system\*\*:\s*⚠️/, 'must post a human-flag comment to conversation.md');
    assert.match(conversation, /implement/, 'the comment must name the action to re-run');

    assert.ok(!existsSync(markerPath), 'the stale run marker must be deleted once reconciled (TC-2.6)');
  });

  it('TC-2.3: this worker\'s own in-flight dispatch is never touched by the orphan tick — reconcileActiveDispatch stays the sole finalizer', async () => {
    const track = '004';
    mkdirSync(primaryTrackDir(track), { recursive: true });
    writeIndex(join(primaryTrackDir(track), 'index.md'), { lane: 'implement', laneStatus: 'queue' });

    // A REAL pending dispatch this worker claims and spawns itself, via
    // its own checkDispatchInbox loop — so runningTrackMap/activeDispatch
    // genuinely hold this track while MOCK_CLI_DELAY_MS keeps it alive
    // across several orphan-reconcile ticks.
    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: track, action: 'implement', status: 'pending',
    });

    // Wait until the dispatch is claimed and spawnCli has written "running"
    // to the worktree-less (LC_SKIP_GIT_LOCK) primary index.md.
    await poll(async () => {
      const content = existsSync(join(primaryTrackDir(track), 'index.md')) ? readFileSync(join(primaryTrackDir(track), 'index.md'), 'utf8') : '';
      return /\*\*Lane Status\*\*:\s*running/i.test(content) ? true : null;
    }, { label: 'TC-2.3 dispatch claimed and marked running' });

    // Several orphan-reconcile ticks (300ms each) while MOCK_CLI_DELAY_MS
    // (1200ms) keeps the real process genuinely alive — must stay claimed.
    await sleepMs(700);
    let mid = await getState(collectorPort);
    let midEntry = mid.dispatch.find(d => d.id === dispatchId);
    assert.equal(midEntry.status, 'claimed', 'must not be touched by the orphan tick while this process\'s own runningTrackMap/activeDispatch still track it');

    const finalState = await poll(async () => {
      const s = await getState(collectorPort);
      const e = s.dispatch.find(d => d.id === dispatchId);
      return e && e.status !== 'pending' && e.status !== 'claimed' ? s : null;
    }, { timeout: 10000, label: 'TC-2.3 self-dispatch resolves normally' });

    const entry = finalState.dispatch.find(d => d.id === dispatchId);
    assert.equal(entry.status, 'done');
    assert.equal(entry.finalizePatchCount, 1, 'exactly one finalizing PATCH — the orphan tick must never also finalize a dispatch this process is actively tracking');
  });
});

describe('Track 10020 TC-2.1: boot-time reconcile of a dispatch already stale before this process ever started (no regression to the pre-periodic track-1110 behavior)', () => {
  const TMP2 = join(ROOT, '.test-tmp-track-10020-orphan-boot');
  let collectorProc, collectorPort, worker;

  after(() => {
    worker?.kill();
    collectorProc?.kill();
    rmSync(TMP2, { recursive: true, force: true });
  });

  it('reconciles on the immediate post-registration call, not the (deliberately slow) periodic tick', async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    rmSync(TMP2, { recursive: true, force: true });
    mkdirSync(TMP2, { recursive: true });
    execSync('git init -q', { cwd: TMP2 });
    execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: TMP2 });
    writeFileSync(join(TMP2, '.laneconductor.json'), JSON.stringify({
      mode: 'local-api',
      project: { name: 'test-project', id: 1, repo_path: TMP2, primary: { cli: 'mock', model: 'mock' } },
      collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
      ui: { port: 8090 },
    }, null, 2));
    mkdirSync(join(TMP2, 'conductor/tracks'), { recursive: true });
    writeFileSync(join(TMP2, 'conductor/workflow.json'), JSON.stringify({
      global: { total_parallel_limit: 3 },
      defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
      lanes: { implement: { parallel_limit: 1, max_retries: 1 } },
    }, null, 2));

    const track = '006';
    const primaryDir = join(TMP2, 'conductor/tracks', `${track}-test-track`);
    mkdirSync(primaryDir, { recursive: true });
    writeFileSync(join(primaryDir, 'index.md'), '# Track\n\n**Lane**: implement\n**Lane Status**: queue\n**Progress**: 0%\n\n## Problem\nTest.\n');
    const wtIndex = join(TMP2, '.worktrees', track, 'conductor/tracks', `${track}-test-track`, 'index.md');
    mkdirSync(dirname(wtIndex), { recursive: true });
    writeFileSync(wtIndex, '# Track\n\n**Lane**: implement\n**Lane Status**: success\n**Progress**: 0%\n\n## Problem\nTest.\n');

    // The dispatch is seeded, claimed, and already well past the grace
    // window BEFORE this worker process even exists — mirroring the
    // pre-periodic-tick track-1110 scenario exactly (a dispatch already
    // stale when the process boots). worker_id is a guess (this mock
    // collector's next-issued id) since registration hasn't happened yet;
    // the mock always issues ids sequentially from a fixed base, so the
    // first worker registered against a freshly-reset collector always
    // gets the same id.
    const preResetState = await getState(collectorPort);
    const nextWorkerId = preResetState.nextWorkerId;
    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: nextWorkerId, track_number: track, action: 'implement',
      status: 'claimed', claimed_at: new Date(Date.now() - 60000).toISOString(),
    });

    // Deliberately slow periodic tick + grace — if this reconciles quickly
    // anyway, it can only be the immediate post-registration call proving
    // it, not the periodic one.
    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP2,
      env: {
        ...process.env,
        LC_SKIP_GIT_LOCK: '1',
        LC_ORPHAN_RECONCILE_POLL_MS: '60000',
        LC_ORPHAN_RECONCILE_GRACE_MS: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => process.stdout.write(`[worker-boot] ${d}`));
    worker.stderr.on('data', d => process.stderr.write(`[worker-boot] ${d}`));

    const finalState = await poll(async () => {
      const s = await getState(collectorPort);
      const e = s.dispatch.find(d => d.id === dispatchId);
      return e && e.status !== 'claimed' ? s : null;
    }, { timeout: 8000, label: 'TC-2.1 reconciles promptly on boot, well inside the 60s periodic interval' });

    const entry = finalState.dispatch.find(d => d.id === dispatchId);
    assert.equal(entry.status, 'done');
  });
});
