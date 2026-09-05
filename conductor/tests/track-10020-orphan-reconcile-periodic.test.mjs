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
import { runMarkerPath, buildRunMarker, markRunFinalizing, parseRunMarker } from '../services/run-marker.mjs';

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

function writeIndex(path, { lane, laneStatus, workspace, trackKind }) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, [
    `# Track ${path.includes('.worktrees') ? 'worktree' : 'primary'} copy`,
    '',
    `**Lane**: ${lane}`,
    `**Lane Status**: ${laneStatus}`,
    '**Progress**: 0%',
    ...(workspace ? [`**Workspace**: ${workspace}`] : []),
    ...(trackKind ? [`**Track Kind**: ${trackKind}`] : []),
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

// Track 10065: a marker whose owning worker is mid-finalization (see
// markRunFinalizing in spawnCli's proc.on('exit')) — `workerPid` stands in
// for the finalizing worker itself, not the (already-exited) CLI child.
function writeFinalizingRunMarker(track, { childPid, workerPid, command, dispatchId, action }) {
  const markerPath = runMarkerPath(TMP, track);
  mkdirSync(dirname(markerPath), { recursive: true });
  const marker = buildRunMarker({ pid: childPid, pgid: childPid, workerPid, trackNumber: track, dispatchId, action, command });
  writeFileSync(markerPath, JSON.stringify(markRunFinalizing(marker, { exitCode: 0 }), null, 2));
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
        // Track 10065: same scale-down as GRACE_MS above, for the same
        // reason — keeps this suite in the seconds range.
        LC_ORPHAN_RECONCILE_NO_MARKER_MS: '900',
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

  it('Found live 2026-09-05 (tracks 10064/10065/10067): a crash-detected orphan must also flip tracks.lane_action_status, not just worker_dispatch.status — the skipArtifactCopy branch never runs syncTrack, so nothing else ever clears "running" off the board', async () => {
    const track = '10064';
    mkdirSync(primaryTrackDir(track), { recursive: true });
    writeIndex(join(primaryTrackDir(track), 'index.md'), { lane: 'implement', laneStatus: 'running' });
    writeFileSync(join(primaryTrackDir(track), 'conversation.md'), '');
    writeIndex(worktreeIndexPath(track), { lane: 'implement', laneStatus: 'running' });

    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: track, action: 'implement',
      status: 'claimed', claimed_at: new Date(Date.now() - 60000).toISOString(),
    });

    const crashedProc = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    crashedProc.unref();
    writeRunMarker(track, { pid: crashedProc.pid, command: 'sleep', dispatchId, action: 'implement' });
    process.kill(crashedProc.pid, 'SIGKILL');
    await sleepMs(300);

    // Poll the actual condition under test (the tracks-row patch), not a
    // proxy signal — the worker_dispatch patch and the tracks-row patch are
    // two separate awaited network calls in sequence, so waiting on the
    // first one alone raced against the second under full-suite load.
    const state = await poll(async () => {
      const s = await getState(collectorPort);
      return s.tracks[track]?.lane_action_status === 'failure' ? s : null;
    }, { timeout: 5000, label: 'track lane_action_status flips to failure' });

    // The primary checkout's own index.md still reads "running" (nothing
    // ever rewrote it — skipArtifactCopy means the worktree's stale/
    // untrustworthy state is deliberately never copied over). Before this
    // fix, tracks.lane_action_status was left however it started, forever,
    // because only worker_dispatch.status got patched.
    assert.equal(state.tracks[track]?.lane_action_status, 'failure',
      'the track itself must be flipped out of "running" once its dispatch is reconciled as failed, using the tracks-table vocabulary (failure), not the dispatch one (failed)');
  });

  it('Track 10065: a run marker that NEVER EXISTED (not proven dead, simply absent) still reconciles once the no-marker window passes, via the claiming git lock\'s dead pid', async () => {
    // The gap TC-4.3 does not cover: that scenario always had a marker (it
    // proves the marker dead). Found live: a worker restart that takes the
    // whole process group with it (e.g. systemd's default cgroup KillMode)
    // can kill the spawned child before it ever gets far enough to write
    // one at all — runnerExited then stays undefined forever, and this
    // dispatch had no path to resolution whatsoever.
    const track = '10065';
    mkdirSync(primaryTrackDir(track), { recursive: true });
    writeIndex(join(primaryTrackDir(track), 'index.md'), { lane: 'implement', laneStatus: 'queue' });
    writeFileSync(join(primaryTrackDir(track), 'conversation.md'), '');
    // No forward transition and no terminal status — the worktree looks
    // identical to a genuinely still-running session. Only the missing
    // marker plus a dead claiming-lock pid can tell them apart.
    writeIndex(worktreeIndexPath(track), { lane: 'implement', laneStatus: 'running' });

    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: track, action: 'implement',
      status: 'claimed', claimed_at: new Date(Date.now() - 60000).toISOString(),
    });

    // The per-track git lock checkAndClaimGitLock() would have written
    // BEFORE spawning — independent evidence from the same claim, not a
    // re-derivation of the run marker. Its pid is real but definitely dead.
    const deadPid = 999999; // astronomically unlikely to collide with a live pid
    const lockPath = join(TMP, '.conductor', 'locks', `${track}.lock`);
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({
      user: 'test', machine: 'test-host', pid: deadPid,
      started_at: new Date(Date.now() - 60000).toISOString(), track_number: track,
    }));
    // No run marker written at all for this track — that omission is the point.
    assert.ok(!existsSync(runMarkerPath(TMP, track)), 'sanity: no marker must exist for this scenario');

    const state = await poll(async () => {
      const s = await getState(collectorPort);
      const e = s.dispatch.find(d => d.id === dispatchId);
      return e && e.status !== 'claimed' ? s : null;
    }, { timeout: 5000, label: 'Track 10065 reconciles a no-marker-ever dispatch' });

    const entry = state.dispatch.find(d => d.id === dispatchId);
    assert.equal(entry.status, 'failed');
    assert.match(entry.result, /implement/);
    assert.ok(!existsSync(lockPath), 'the dead lock must be cleaned up once reconciled, same as checkAndClaimGitLock does on its own next claim');
  });

  it('Track 10065: the no-marker fallback stays conservative — inside its own window, or with a LIVE lock pid, nothing is touched', async () => {
    const trackLive = '10067';
    mkdirSync(primaryTrackDir(trackLive), { recursive: true });
    writeIndex(join(primaryTrackDir(trackLive), 'index.md'), { lane: 'implement', laneStatus: 'queue' });
    writeIndex(worktreeIndexPath(trackLive), { lane: 'implement', laneStatus: 'running' });
    const dispatchLive = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: trackLive, action: 'implement',
      status: 'claimed', claimed_at: new Date(Date.now() - 60000).toISOString(),
    });
    const liveProc = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    liveProc.unref();
    const liveLockPath = join(TMP, '.conductor', 'locks', `${trackLive}.lock`);
    mkdirSync(dirname(liveLockPath), { recursive: true });
    writeFileSync(liveLockPath, JSON.stringify({
      user: 'test', machine: 'test-host', pid: liveProc.pid,
      started_at: new Date(Date.now() - 60000).toISOString(), track_number: trackLive,
    }));

    try {
      await sleepMs(1200); // several ticks
      const state = await getState(collectorPort);
      assert.equal(state.dispatch.find(d => d.id === dispatchLive).status, 'claimed',
        'the claiming lock pid is genuinely alive — a marker not having appeared YET does not mean the claim is dead');
    } finally {
      try { process.kill(liveProc.pid, 'SIGKILL'); } catch { /* already gone */ }
    }

    // Guards against the failure mode this fix could itself introduce: a
    // dispatch that legitimately has not written its marker YET (spawn is
    // slow, or simply hasn't happened this tick) must not be reaped. Seeded
    // and checked on its own short timescale — well under both graceMs and
    // NO_MARKER_FALLBACK_MS (900ms each in this suite) — since the LIVE
    // case above needed a long wait first and this claim must still read as
    // "recent" at the moment it's actually evaluated.
    const trackRecent = '10066';
    mkdirSync(primaryTrackDir(trackRecent), { recursive: true });
    writeIndex(join(primaryTrackDir(trackRecent), 'index.md'), { lane: 'implement', laneStatus: 'queue' });
    writeIndex(worktreeIndexPath(trackRecent), { lane: 'implement', laneStatus: 'running' });
    const dispatchRecent = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: trackRecent, action: 'implement',
      status: 'claimed', claimed_at: new Date().toISOString(),
    });
    // No lock file at all yet either — mid-claim, before checkAndClaimGitLock
    // has even run. Still must not be touched this soon.
    await sleepMs(400); // a tick or two, still comfortably under both thresholds
    const recentState = await getState(collectorPort);
    assert.equal(recentState.dispatch.find(d => d.id === dispatchRecent).status, 'claimed',
      'inside the no-marker window — too soon to conclude anything, must not be reaped');
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

  it('Track 10054: a dispatch claimed by a DIFFERENT, now-offline worker identity is reconciled too, not just this worker\'s own claims', async () => {
    // Simulate a second worker identity (--worker-number, track 1084) that
    // claimed a dispatch and then went offline for good — a real worker
    // restart landing on a fresh identity rather than resuming this one,
    // the exact live shape (tracks 10016/10053, 2026-09-03) that left two
    // dispatches permanently invisible to every reconciler.
    const otherWorkerId = await (async () => {
      const r = await fetch(`http://127.0.0.1:${collectorPort}/worker/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: 1, hostname: 'other-machine', worker_number: 2 }),
      });
      return (await r.json()).id;
    })();

    const track = '006';
    writeIndex(join(primaryTrackDir(track), 'index.md'), { lane: 'implement', laneStatus: 'queue' });
    writeIndex(worktreeIndexPath(track), { lane: 'implement', laneStatus: 'success' });

    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: otherWorkerId, track_number: track, action: 'implement',
      status: 'claimed', claimed_at: new Date(Date.now() - 60000).toISOString(),
    });

    // Not offline yet — this worker's reconciler must not touch a claim
    // belonging to another identity that's still (as far as it can tell)
    // alive and well.
    await sleepMs(700);
    let state = await getState(collectorPort);
    let entry = state.dispatch.find(d => d.id === dispatchId);
    assert.equal(entry.status, 'claimed', 'must not reconcile another worker\'s claim while that worker isn\'t known to be offline');

    // Now it goes offline (mock stand-in for last_heartbeat staleness).
    await fetch(`http://127.0.0.1:${collectorPort}/_set-offline-workers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerIds: [otherWorkerId] }),
    });

    state = await poll(async () => {
      const s = await getState(collectorPort);
      const e = s.dispatch.find(d => d.id === dispatchId);
      return e.status !== 'claimed' ? s : null;
    }, { timeout: 5000, label: 'TC-10054 a DIFFERENT worker reconciles the offline worker\'s orphaned claim' });
    entry = state.dispatch.find(d => d.id === dispatchId);
    assert.equal(entry.status, 'done');
    assert.notEqual(String(entry.worker_id), String(workerId), 'sanity: this dispatch really was claimed by the OTHER identity, not the live worker itself');
  });

  // ── Track 10065 Phase 2: the marker must outlive the exit handler's own finalization ──

  it('TC-2.5: a marker whose owning worker is still finalizing (finalizing-live) protects the dispatch — that worker is still the sole finalizer', async () => {
    const track = '007';
    writeIndex(join(primaryTrackDir(track), 'index.md'), { lane: 'implement', laneStatus: 'queue' });
    writeIndex(worktreeIndexPath(track), { lane: 'implement', laneStatus: 'running' });

    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: track, action: 'implement',
      status: 'claimed', claimed_at: new Date(Date.now() - 60000).toISOString(), // well past every grace window
    });

    // A REAL process standing in for "the OTHER worker that is finalizing
    // this run" — this suite's own worker never spawned it, so only the
    // marker's finalizing-live classification can be protecting this.
    const finalizingWorker = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    finalizingWorker.unref();
    try {
      writeFinalizingRunMarker(track, {
        childPid: 424242, workerPid: finalizingWorker.pid, command: 'claude', dispatchId, action: 'implement',
      });

      await sleepMs(1200); // several orphan-reconcile ticks
      const state = await getState(collectorPort);
      assert.equal(state.dispatch.find(d => d.id === dispatchId).status, 'claimed',
        'a finalizing-live marker must never be reconciled out from under its owning worker');
    } finally {
      try { process.kill(finalizingWorker.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  });

  it('TC-2.6: a marker whose owning worker died mid-finalization (finalizing-dead) reconciles promptly — stronger evidence than an absent marker, no need to wait out the no-marker window', async () => {
    const track = '008';
    mkdirSync(primaryTrackDir(track), { recursive: true });
    writeIndex(join(primaryTrackDir(track), 'index.md'), { lane: 'implement', laneStatus: 'queue' });
    writeFileSync(join(primaryTrackDir(track), 'conversation.md'), '');
    writeIndex(worktreeIndexPath(track), { lane: 'implement', laneStatus: 'running' });

    // Reuse the same dead-pid trick TC-4.3 uses: a real process, killed and
    // reaped, so the pid is genuinely gone rather than merely never-issued.
    const deadWorker = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    deadWorker.unref();
    process.kill(deadWorker.pid, 'SIGKILL');
    await sleepMs(300);

    // Just past the ordinary 900ms grace window, deliberately NOT past
    // grace + the 900ms no-marker window (1800ms total) — proving this
    // path doesn't fall through to (and wait out) the no-marker fallback.
    const claimedAtMs = Date.now() - 950;
    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: track, action: 'implement',
      status: 'claimed', claimed_at: new Date(claimedAtMs).toISOString(),
    });
    writeFinalizingRunMarker(track, {
      childPid: 424243, workerPid: deadWorker.pid, command: 'claude', dispatchId, action: 'implement',
    });

    const state = await poll(async () => {
      const s = await getState(collectorPort);
      const e = s.dispatch.find(d => d.id === dispatchId);
      return e && e.status !== 'claimed' ? s : null;
    }, { timeout: 3000, label: 'TC-2.6 reconciles a finalizing-dead marker' });

    assert.ok(Date.now() - claimedAtMs < 1500,
      'must reconcile well before grace + NO_MARKER_FALLBACK_MS (1800ms) — finalizing-dead is stronger evidence than "no marker at all" and skips that extra wait');

    const entry = state.dispatch.find(d => d.id === dispatchId);
    assert.equal(entry.status, 'failed');
    assert.match(entry.result, /implement/);
    const conversation = readFileSync(join(primaryTrackDir(track), 'conversation.md'), 'utf8');
    assert.match(conversation, />\s*\*\*system\*\*:\s*⚠️/, 'must post a human-flag comment to conversation.md');
    assert.ok(!existsSync(runMarkerPath(TMP, track)), 'the finalizing marker must be deleted once reconciled');
  });

  it('TC-2.7: a real spawned run keeps its marker throughout the exit handler and removes it only once finalization completes', async () => {
    const track = '009';
    mkdirSync(primaryTrackDir(track), { recursive: true });
    writeIndex(join(primaryTrackDir(track), 'index.md'), { lane: 'implement', laneStatus: 'queue' });
    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: track, action: 'implement', status: 'pending',
    });

    // Wait until this worker has claimed + spawned it (own runningTrackMap
    // / activeDispatch protect it from the orphan tick — this test is about
    // the MARKER's lifecycle, not about restart recovery).
    await poll(async () => {
      const content = existsSync(join(primaryTrackDir(track), 'index.md')) ? readFileSync(join(primaryTrackDir(track), 'index.md'), 'utf8') : '';
      return /\*\*Lane Status\*\*:\s*running/i.test(content) ? true : null;
    }, { label: 'TC-2.7 dispatch claimed and marked running' });

    assert.ok(existsSync(runMarkerPath(TMP, track)), 'the run marker must exist while the CLI child is genuinely running');

    const finalState = await poll(async () => {
      const s = await getState(collectorPort);
      const e = s.dispatch.find(d => d.id === dispatchId);
      return e && e.status !== 'pending' && e.status !== 'claimed' ? s : null;
    }, { timeout: 10000, label: 'TC-2.7 self-dispatch resolves normally' });

    const entry = finalState.dispatch.find(d => d.id === dispatchId);
    assert.equal(entry.status, 'done');
    assert.equal(entry.finalizePatchCount, 1, 'exactly one finalizing PATCH');
    assert.ok(!existsSync(runMarkerPath(TMP, track)), 'the marker must be removed once the exit handler\'s own finalization actually completed');
  });

  // ── Track 10065 Phase 3 (F3): main-mode dispatches have no worktree at all ──

  it('TC-3.1: a main-mode dispatch (no worktree, ever) is reconciled from the PRIMARY checkout\'s own index.md, and its stale lock is released', async () => {
    const track = '10068';
    mkdirSync(primaryTrackDir(track), { recursive: true });
    // **Workspace**: main means this track never had a worktree — the bug
    // this phase fixes. The primary index.md itself shows the crash shape
    // (still "running", nobody finished the write).
    writeIndex(join(primaryTrackDir(track), 'index.md'), { lane: 'implement', laneStatus: 'running', workspace: 'main' });
    writeFileSync(join(primaryTrackDir(track), 'conversation.md'), '');
    assert.ok(!existsSync(join(TMP, '.worktrees', track)), 'sanity: no worktree must exist for this scenario');

    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: track, action: 'implement',
      status: 'claimed', claimed_at: new Date(Date.now() - 60000).toISOString(),
    });

    // Independent evidence the dispatch is really dead, same as the
    // no-marker fallback's own git-lock trick — a main-mode dispatch still
    // takes this same per-track lock even though it has no worktree.
    const lockPath = join(TMP, '.conductor', 'locks', `${track}.lock`);
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ user: 'test', machine: 'test-host', pid: 999999, started_at: new Date(Date.now() - 60000).toISOString(), track_number: track }));

    const state = await poll(async () => {
      const s = await getState(collectorPort);
      const e = s.dispatch.find(d => d.id === dispatchId);
      return e && e.status !== 'claimed' ? s : null;
    }, { timeout: 3000, label: 'TC-3.1 reconciles a main-mode dispatch with no worktree' });

    const entry = state.dispatch.find(d => d.id === dispatchId);
    assert.equal(entry.status, 'failed');
    assert.match(entry.result, /implement/);
    assert.ok(!existsSync(lockPath), 'the stale lock must be released once the main-mode dispatch is reconciled');
  });

  it('TC-3.2: a main-mode dispatch whose primary index.md already shows the finished, matching lane is reconciled as done, with artifact copy skipped (nothing to copy)', async () => {
    const track = '10069';
    mkdirSync(primaryTrackDir(track), { recursive: true });
    // Same lane as the dispatched action, terminal "success" status — the
    // ordinary finished-while-orphaned shape (mirrors TC-4.1), just sourced
    // from the primary since main-mode never created a worktree.
    writeIndex(join(primaryTrackDir(track), 'index.md'), { lane: 'implement', laneStatus: 'success', workspace: 'main' });

    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: track, action: 'implement',
      status: 'claimed', claimed_at: new Date(Date.now() - 60000).toISOString(),
    });

    const state = await poll(async () => {
      const s = await getState(collectorPort);
      const e = s.dispatch.find(d => d.id === dispatchId);
      return e && e.status !== 'claimed' ? s : null;
    }, { timeout: 3000, label: 'TC-3.2 reconciles a main-mode finished dispatch' });

    const entry = state.dispatch.find(d => d.id === dispatchId);
    assert.equal(entry.status, 'done');
  });

  it('TC-3.3 (regression): a branch-mode track with no worktree is left alone, exactly as before this track', async () => {
    const track = '10070';
    mkdirSync(primaryTrackDir(track), { recursive: true });
    // No **Workspace** marker and no bug **Track Kind** — resolves to
    // 'branch' (today's default), so a missing worktree stays unexplained
    // rather than being treated as expected main-mode behavior.
    writeIndex(join(primaryTrackDir(track), 'index.md'), { lane: 'implement', laneStatus: 'running' });
    assert.ok(!existsSync(join(TMP, '.worktrees', track)));

    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: track, action: 'implement',
      status: 'claimed', claimed_at: new Date(Date.now() - 60000).toISOString(),
    });

    await sleepMs(1200); // several ticks
    const state = await getState(collectorPort);
    assert.equal(state.dispatch.find(d => d.id === dispatchId).status, 'claimed',
      'a branch-mode track with no worktree must still be left alone — unchanged from before Phase 3');
  });

  it('TC-3.4 (REQ-7): the no-marker fallback never deletes the git lock before a reconcile decision is actually reached', async () => {
    const track = '10071';
    mkdirSync(primaryTrackDir(track), { recursive: true });
    // Branch-mode, no worktree — TC-3.3's shape, so the dispatch is
    // ultimately left untouched. The no-marker fallback still runs first
    // (it's evaluated before the worktree/source-of-truth check) and must
    // not release the lock just because it concluded runnerExited: true.
    writeIndex(join(primaryTrackDir(track), 'index.md'), { lane: 'implement', laneStatus: 'running' });

    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, track_number: track, action: 'implement',
      status: 'claimed', claimed_at: new Date(Date.now() - 60000).toISOString(),
    });

    const lockPath = join(TMP, '.conductor', 'locks', `${track}.lock`);
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ user: 'test', machine: 'test-host', pid: 999999, started_at: new Date(Date.now() - 60000).toISOString(), track_number: track }));

    await sleepMs(1200); // several ticks — enough for the no-marker fallback to have fired
    const state = await getState(collectorPort);
    assert.equal(state.dispatch.find(d => d.id === dispatchId).status, 'claimed', 'still left alone (TC-3.3\'s shape)');
    assert.ok(existsSync(lockPath), 'the lock must still be present — only released once a reconcile decision is actually reached, never speculatively');
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
