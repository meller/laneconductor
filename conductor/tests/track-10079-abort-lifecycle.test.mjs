#!/usr/bin/env node
// conductor/tests/track-10079-abort-lifecycle.test.mjs
// Track 10079 Phase 3: what an abort actually MEANS to the exit handler,
// proven against a real spawned worker and a real long-running mock CLI
// child — following track-10055-waiting-resume.test.mjs's sandbox pattern
// (this is the same exit handler, testing the adjacent park case). See
// test.md TC-3.1..TC-3.13.
//
// Run: env -u NODE_TEST_CONTEXT node --test conductor/tests/track-10079-abort-lifecycle.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { isPidAlive, readProcessCommand, runMarkerPath, parseRunMarker } from '../services/run-marker.mjs';
import { abortRun } from '../services/run-abort.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10079-abort-lifecycle');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readIndex(tracksDir, num) {
  const dir = readdirSync(tracksDir).find(d => new RegExp(`(^|-)${num}(-|$)`).test(d));
  return dir ? readFileSync(join(tracksDir, dir, 'index.md'), 'utf8') : null;
}
function readConversation(tracksDir, num) {
  const dir = readdirSync(tracksDir).find(d => new RegExp(`(^|-)${num}(-|$)`).test(d));
  const p = dir && join(tracksDir, dir, 'conversation.md');
  return p && existsSync(p) ? readFileSync(p, 'utf8') : '';
}
const getLane = c => c?.match(/\*\*Lane\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
const getLaneStatus = c => c?.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
const getWaitingReason = c => c?.match(/\*\*Waiting Reason\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
const getWaitingForReply = c => c?.match(/\*\*Waiting for reply\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null;

async function poll(fn, { timeout = 15000, interval = 250, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

function setupProject() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execSync('git init -q', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: TMP });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
    ui: { port: 8090 },
  }, null, 2));
  // *.log matters here specifically: TC-3.12 reuses one repo across two
  // spawns, and an uncommitted conductor/logs/*.log file left behind by the
  // first (aborted) run otherwise blocks the second **Workspace**: main
  // spawn's dirty-working-tree guard.
  writeFileSync(join(TMP, '.gitignore'), '.worktrees/\n*.log\n');
  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/tracks/.gitkeep'), '');

  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1 },
    lanes: {
      plan: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: 'plan:success', on_failure: 'backlog' },
      implement: { parallel_limit: 2, max_retries: 3, primary_model: 'mock', on_success: 'review:queue', on_failure: 'implement:failure' },
      review: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: 'quality-gate:queue', on_failure: 'implement:queue' },
      'quality-gate': { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: 'done:queue', on_failure: 'plan:queue' },
      done: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_failure: 'done:failure' },
    },
  }, null, 2));

  execSync('git add -A', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m setup', { cwd: TMP });
}

function createTrack(tracksDir, num, { lane, status = 'queue', waitingForReply } = {}) {
  const dir = join(tracksDir, `${num}-test-track-${num}`);
  mkdirSync(dir, { recursive: true });
  const lines = [
    `# Track ${num}: Test Track ${num}`,
    '',
    `**Lane**: ${lane}`,
    `**Lane Status**: ${status}`,
    '**Progress**: 40%',
    // Workspace: main keeps these tests off the worktree machinery, which
    // is orthogonal to what abort semantics are proving here (same
    // reasoning as track-10055-waiting-resume.test.mjs).
    '**Workspace**: main',
    '**Auto Run**: yes',
  ];
  if (waitingForReply !== undefined) lines.push(`**Waiting for reply**: ${waitingForReply ? 'yes' : 'no'}`);
  lines.push('', '## Problem', 'Test problem.');
  writeFileSync(join(dir, 'index.md'), lines.join('\n'));
  writeFileSync(join(dir, 'conversation.md'), '');
  return dir;
}

function startWorker(env = {}) {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: TMP,
    env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '30000', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

async function waitForRunning(tracksDir, num) {
  await poll(() => {
    const c = readIndex(tracksDir, num);
    return c && /\*\*Lane Status\*\*:\s*running/i.test(c) ? true : null;
  }, { label: `track ${num}: claimed and running` });
  const markerPath = runMarkerPath(TMP, num);
  const marker = await poll(() => {
    if (!existsSync(markerPath)) return null;
    return parseRunMarker(readFileSync(markerPath, 'utf8'));
  }, { label: `track ${num}: run marker written` });
  return { markerPath, marker };
}

async function waitForExitHandlerDone(tracksDir, num) {
  return poll(() => {
    const c = readIndex(tracksDir, num);
    return c && /\*\*Last Run\*\*:/i.test(c) ? c : null;
  }, { label: `track ${num}: exit handler finished`, timeout: 25000 });
}

async function sendAbort(num, requestedBy = 'test-human') {
  return abortRun({
    primaryRoot: TMP, trackNumber: num, requestedBy,
    isPidAlive, readProcessCommand, kill: process.kill,
  });
}

describe('Track 10079 Phase 3: abort is a park, not a failure', () => {
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('TC-3.1/3.3/3.4/3.5/3.7/3.11: aborting a live implement run kills the group, parks in-lane with a reason, consumes no retry, posts one cancellation comment, and removes the marker', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '901', { lane: 'implement' });

    const worker = startWorker();
    try {
      const { marker } = await waitForRunning(tracksDir, '901');
      assert.doesNotThrow(() => process.kill(marker.pid, 0), 'child must be alive right before abort');

      const result = await sendAbort('901');
      assert.equal(result.ok, true);
      assert.equal(result.signal, 'SIGINT');

      // TC-3.1: the whole process group is gone within the grace window.
      await poll(() => {
        try { process.kill(-marker.pgid, 0); return null; } catch (e) { return e.code === 'ESRCH' ? true : null; }
      }, { label: 'process group gone', timeout: 10000 });

      const final = await waitForExitHandlerDone(tracksDir, '901');

      // TC-3.3: lane unchanged — an abort in `implement` never advances to
      // review:queue and never falls back to implement:failure either.
      assert.equal(getLane(final), 'implement');
      // TC-3.4: parked, with the fixed reason.
      assert.equal(getLaneStatus(final), 'waiting');
      assert.equal(getWaitingReason(final), 'Cancelled by user');

      // TC-3.5: no retry consumed — the on-disk counter local-fs mode uses
      // must never have been written for this run.
      const dir = readdirSync(tracksDir).find(d => d.startsWith('901-'));
      assert.equal(existsSync(join(tracksDir, dir, '.retry-count')), false);

      // TC-3.7: exactly one new cancellation comment, and no lying
      // "Automation failed" comment anywhere in the file.
      const conv = readConversation(tracksDir, '901');
      const cancelLines = conv.split('\n').filter(l => l.includes('Turn cancelled by user'));
      assert.equal(cancelLines.length, 1, `expected exactly one cancellation comment, got:\n${conv}`);
      assert.match(conv, /> \*\*system\*\*: ⚠️ Turn cancelled by user/);
      assert.doesNotMatch(conv, /Automation failed/);

      // TC-3.11: the run marker is gone once finalization completes.
      assert.equal(existsSync(runMarkerPath(TMP, '901')), false);

      // TC-3.6/AC-3: on this **Auto Run**: yes track, the worker must NOT
      // re-claim it across several further auto-launch cycles — proving
      // absence over time, not just immediately after the park. A
      // re-claim would flip **Lane Status** back to running and write a
      // fresh run marker.
      await sleep(2500);
      const stillParked = readIndex(tracksDir, '901');
      assert.equal(getLaneStatus(stillParked), 'waiting', 'must still be parked — not silently re-claimed');
      assert.equal(existsSync(runMarkerPath(TMP, '901')), false, 'no new run marker — nothing re-dispatched');
    } finally {
      worker.kill('SIGTERM');
      await sleep(300);
    }
  });

  it('TC-3.3 (second half): aborting quality-gate does NOT misroute to plan:queue (its on_failure)', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '902', { lane: 'quality-gate' });

    const worker = startWorker();
    try {
      const { marker } = await waitForRunning(tracksDir, '902');
      await sendAbort('902');
      await poll(() => {
        try { process.kill(-marker.pgid, 0); return null; } catch (e) { return e.code === 'ESRCH' ? true : null; }
      }, { timeout: 10000 });

      const final = await waitForExitHandlerDone(tracksDir, '902');
      assert.equal(getLane(final), 'quality-gate', 'must NOT have been sent to plan:queue');
      assert.equal(getLaneStatus(final), 'waiting');
    } finally {
      worker.kill('SIGTERM');
      await sleep(300);
    }
  });

  it('TC-3.2: escalates SIGINT -> SIGTERM -> SIGKILL against a child that ignores the first two', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '903', { lane: 'implement' });

    const worker = startWorker({ MOCK_CLI_IGNORE_SIGNALS: '1' });
    // abortRun() runs its own escalation timer in WHICHEVER process calls
    // it — here, this test process (standing in for the API server/CLI) —
    // so the grace-window override has to apply here too, not just in the
    // spawned worker's env.
    const prevSigint = process.env.LC_ABORT_SIGINT_GRACE_MS;
    const prevSigterm = process.env.LC_ABORT_SIGTERM_GRACE_MS;
    process.env.LC_ABORT_SIGINT_GRACE_MS = '400';
    process.env.LC_ABORT_SIGTERM_GRACE_MS = '400';
    try {
      const { marker } = await waitForRunning(tracksDir, '903');
      const result = await sendAbort('903');
      assert.equal(result.signal, 'SIGINT');

      // Must still be alive right after SIGINT (it's ignoring it).
      await sleep(150);
      assert.doesNotThrow(() => process.kill(marker.pid, 0), 'child ignoring SIGINT must still be alive shortly after');

      // Eventually gone via the escalation to SIGKILL (2 grace windows + margin).
      await poll(() => {
        try { process.kill(marker.pid, 0); return null; } catch (e) { return e.code === 'ESRCH' ? true : null; }
      }, { label: 'child eventually killed via SIGKILL escalation', timeout: 5000 });
    } finally {
      if (prevSigint === undefined) delete process.env.LC_ABORT_SIGINT_GRACE_MS; else process.env.LC_ABORT_SIGINT_GRACE_MS = prevSigint;
      if (prevSigterm === undefined) delete process.env.LC_ABORT_SIGTERM_GRACE_MS; else process.env.LC_ABORT_SIGTERM_GRACE_MS = prevSigterm;
      worker.kill('SIGTERM');
      await sleep(300);
    }
  });

  it('TC-3.8: the race — an intent on the marker with a clean code-0/no-signal exit is reported as success, never as a cancellation', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '904', { lane: 'implement' });

    const worker = startWorker({ MOCK_CLI_DELAY_MS: '600' });
    try {
      const { marker, markerPath } = await waitForRunning(tracksDir, '904');
      // Write the abort intent directly WITHOUT ever sending a real signal —
      // simulates the narrow race the requirement is about: the child exits
      // cleanly on its own before any signal actually lands.
      writeFileSync(markerPath, JSON.stringify({ ...marker, abort_requested: true, abort_requested_at: new Date().toISOString(), abort_requested_by: 'test' }, null, 2));

      const final = await waitForExitHandlerDone(tracksDir, '904');
      assert.equal(getLane(final), 'review', 'a clean success must still advance the lane despite a stale abort intent');
      assert.equal(getLaneStatus(final), 'queue');
      const conv = readConversation(tracksDir, '904');
      assert.doesNotMatch(conv, /Turn cancelled by user/, 'must not be misreported as a cancellation');
    } finally {
      worker.kill('SIGTERM');
      await sleep(300);
    }
  });

  it('TC-3.12: resuming a parked (aborted) track lets a worker claim and run it again', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '905', { lane: 'implement' });

    const worker = startWorker();
    try {
      const { marker } = await waitForRunning(tracksDir, '905');
      await sendAbort('905');
      await poll(() => {
        try { process.kill(-marker.pgid, 0); return null; } catch (e) { return e.code === 'ESRCH' ? true : null; }
      }, { timeout: 10000 });
      const parked = await waitForExitHandlerDone(tracksDir, '905');
      assert.equal(getLaneStatus(parked), 'waiting');

      // Resume: same lane, status back to queue (what POST .../resume does).
      const dir = readdirSync(tracksDir).find(d => d.startsWith('905-'));
      const indexPath = join(tracksDir, dir, 'index.md');
      let content = readFileSync(indexPath, 'utf8');
      content = content.replace(/\*\*Lane Status\*\*:\s*waiting/i, '**Lane Status**: queue');
      content = content.replace(/\*\*Waiting Reason\*\*:[^\n]*\n?/i, '');
      writeFileSync(indexPath, content);

      // A fresh worker cycle must be able to claim + finish it — not wedged
      // by any leftover claim marker/lock/retry state from the abort. This
      // worker is still running with MOCK_CLI_DELAY_MS=30000, so give it
      // room for a full run, not just the claim.
      const secondFinal = await poll(() => {
        const c = readIndex(tracksDir, '905');
        return c && getLaneStatus(c) === 'queue' && getLane(c) === 'review' ? c : null;
      }, { label: 'resumed track claimed and completed', timeout: 35000 });
      assert.equal(getLane(secondFinal), 'review', 'resumed track must be able to reach a normal success outcome');
    } finally {
      worker.kill('SIGTERM');
      await sleep(300);
    }
  });

  it('TC-3.13: aborting a live conversation reply writes no lane/lane-status change and leaves Waiting for reply: no', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    const dir = createTrack(tracksDir, '906', { lane: 'implement', status: 'success', waitingForReply: true });
    appendFileSync(join(dir, 'conversation.md'), '\n> **human**: are you sure about this approach?\n');

    const worker = startWorker({ MOCK_CLI_DELAY_MS: '30000' });
    try {
      // waitingForReply dispatch does not flip **Lane Status** to `running`
      // the way a lane action does — its liveness signal is the run marker.
      const markerPath = runMarkerPath(TMP, '906');
      const marker = await poll(() => existsSync(markerPath) ? parseRunMarker(readFileSync(markerPath, 'utf8')) : null,
        { label: 'conversation reply run marker written' });

      const laneBefore = getLane(readIndex(tracksDir, '906'));
      const statusBefore = getLaneStatus(readIndex(tracksDir, '906'));

      await sendAbort('906');
      await poll(() => {
        try { process.kill(-marker.pgid, 0); return null; } catch (e) { return e.code === 'ESRCH' ? true : null; }
      }, { timeout: 10000 });

      await poll(() => existsSync(markerPath) ? null : true, { label: 'conversation reply marker removed' });
      await sleep(500); // let the exit handler's file writes settle

      const final = readIndex(tracksDir, '906');
      assert.equal(getLane(final), laneBefore, 'a conversation run must never write **Lane**');
      assert.equal(getLaneStatus(final), statusBefore, 'a conversation run must never write **Lane Status**');
      assert.equal(getWaitingForReply(final), 'no', 'REQ-16: waiting-for-reply must clear so the reply is not re-dispatched');

      // No re-dispatch across a few more auto-launch cycles.
      await sleep(1500);
      assert.equal(existsSync(markerPath), false, 'must not have been re-dispatched');
    } finally {
      worker.kill('SIGTERM');
      await sleep(300);
    }
  });
});
