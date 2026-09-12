#!/usr/bin/env node
// conductor/tests/track-10092-move-family-cli.test.mjs
// Track AM-10092: automated coverage for bin/lc.mjs's move-family command
// (move/plan/implement/review/quality-gate/backlog/done/pulse/rerun — one shared
// code branch at `command === 'move' || [...].includes(command)`, bin/lc.mjs:2962).
//
// Two real, live bugs were found and fixed in this exact branch with no
// regression test written for either:
//   1. ac5dd70a — naive `readdirSync(...).find(d => d.startsWith(trackNum + '-'))`
//      folder lookup silently missed every INITIALS-NNN-slug folder.
//   2. 47fa2c59 — a track's persisted Claude session was never invalidated on a
//      real lane change, letting the worker --resume a session whose entire
//      memory was "I already finished this."
//
// Fixture lives under os.tmpdir() (makeSandbox — never inside the repo or a
// worktree), spawns no worker process, needs no database. Every `lc` invocation
// here is a short synchronous script (not a long-running process), so
// execFileSync is used directly rather than spawn+Promise.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox, cleanupSandbox } from './helpers/isolated-worker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const LC = join(ROOT, 'bin/lc.mjs');

// ── Mock collector lifecycle (same pattern every other suite in this repo uses) ──

function startMockCollector() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(__dirname, 'mock-collector.mjs')], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

async function resetCollector(port) {
  await fetch(`http://127.0.0.1:${port}/_reset`, { method: 'POST' }).catch(() => {});
}

// ── Sandbox project setup ────────────────────────────────────────────────────

function laneOf(sandbox, folder) {
  const content = readFileSync(join(sandbox, 'conductor/tracks', folder, 'index.md'), 'utf8');
  return {
    lane: content.match(/\*\*Lane\*\*:\s*([^\n]+)/i)?.[1]?.trim(),
    status: content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim(),
    progress: content.match(/\*\*Progress\*\*:\s*(\d+)%/i)?.[1],
  };
}

function writeTrack(sandbox, folder, { lane = 'done', status = 'success', progress = 100 } = {}) {
  const dir = join(sandbox, 'conductor/tracks', folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track ${folder}`,
    '',
    `**Lane**: ${lane}`,
    `**Lane Status**: ${status}`,
    `**Progress**: ${progress}%`,
  ].join('\n'));
}

function writeConfig(sandbox, { mode = 'local-api', collectors = [] } = {}) {
  writeFileSync(join(sandbox, '.laneconductor.json'), JSON.stringify({
    mode,
    project: { name: 'test-10092', repo_path: sandbox, primary: { cli: 'mock', model: 'mock' } },
    collectors,
    ui: { port: 8090 },
  }, null, 2));
}

function writeWorkflow(sandbox) {
  mkdirSync(join(sandbox, 'conductor'), { recursive: true });
  writeFileSync(join(sandbox, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: {
      plan: { parallel_limit: 1, max_retries: 1, on_success: 'plan:success', on_failure: 'backlog' },
      implement: { parallel_limit: 1, max_retries: 1, on_success: 'review:queue', on_failure: 'implement:failure' },
      done: { parallel_limit: 1, max_retries: 1 },
    },
  }, null, 2));
}

function runLc(sandbox, args) {
  try {
    const out = execFileSync('node', [LC, ...args], { cwd: sandbox, encoding: 'utf8', timeout: 10000 });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

async function seedSession(port, trackNumber, sessionId = 'seed-session-uuid') {
  await fetch(`http://127.0.0.1:${port}/track/${trackNumber}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claude_session_id: sessionId }),
  });
}

// ── Phase 2/3/4: single mock collector shared across the suite ──────────────

describe('Track AM-10092: lc move-family — folder resolution, session invalidation, invocation forms', () => {
  let collectorProc, collectorPort, TMP;

  before(async () => {
    ({ proc: collectorProc, port: collectorPort } = await startMockCollector());
    TMP = makeSandbox('10092-move-family');
    writeConfig(TMP, { collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }] });
    writeWorkflow(TMP);
  });

  after(() => {
    collectorProc?.kill('SIGTERM');
    cleanupSandbox(TMP);
  });

  beforeEach(async () => {
    await resetCollector(collectorPort);
    rmSync(join(TMP, 'conductor/tracks'), { recursive: true, force: true });
    mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  });

  // ── Phase 2: folder resolution ──────────────────────────────────────────

  it('TC-1: bare number resolves a prefixed INITIALS-NNN-slug folder', () => {
    writeTrack(TMP, 'AM-10092-sample', { lane: 'done' });
    const { code } = runLc(TMP, ['plan', '10092']);
    assert.equal(code, 0);
    assert.equal(laneOf(TMP, 'AM-10092-sample').lane, 'plan');
  });

  it('TC-2: prefixed identifier resolves the same folder, stdout reports the bare number', () => {
    writeTrack(TMP, 'AM-10092-sample', { lane: 'done' });
    const { code, out } = runLc(TMP, ['plan', 'AM-10092']);
    assert.equal(code, 0);
    assert.equal(laneOf(TMP, 'AM-10092-sample').lane, 'plan');
    assert.match(out, /Track 10092 updated/);
    assert.doesNotMatch(out, /Track AM-10092 updated/);
  });

  it('TC-3: legacy bare NNN-slug folder still resolves', () => {
    writeTrack(TMP, '10092-sample', { lane: 'done' });
    const { code } = runLc(TMP, ['plan', '10092']);
    assert.equal(code, 0);
    assert.equal(laneOf(TMP, '10092-sample').lane, 'plan');
  });

  it('TC-4: a substring-colliding sibling folder is left untouched', () => {
    writeTrack(TMP, 'AM-10092-sample', { lane: 'done' });
    writeTrack(TMP, 'AM-110092-other', { lane: 'done' });
    const before = readFileSync(join(TMP, 'conductor/tracks/AM-110092-other/index.md'), 'utf8');
    const { code } = runLc(TMP, ['move', '10092', 'implement:queue']);
    assert.equal(code, 0);
    assert.equal(laneOf(TMP, 'AM-10092-sample').lane, 'implement');
    const after = readFileSync(join(TMP, 'conductor/tracks/AM-110092-other/index.md'), 'utf8');
    assert.equal(after, before);
  });

  it('TC-4b: only a substring-colliding folder exists — must fail loudly, not misresolve', () => {
    writeTrack(TMP, 'AM-110092-other', { lane: 'done' });
    const { code, out } = runLc(TMP, ['plan', '10092']);
    assert.notEqual(code, 0);
    assert.match(out, /Track 10092 not found/);
  });

  // ── Phase 3: session invalidation ───────────────────────────────────────

  it('TC-5: a real lane change deletes the seeded session', async () => {
    writeTrack(TMP, 'AM-10092-sample', { lane: 'done' });
    await seedSession(collectorPort, '10092');
    const { code } = runLc(TMP, ['plan', '10092']);
    assert.equal(code, 0);
    const state = await getState(collectorPort);
    assert.equal(state.sessionDeletes.length, 1);
    assert.equal(state.sessionDeletes[0].track_number, '10092');
    assert.equal(state.sessions['10092'], undefined);
  });

  it('TC-6: delete is addressed by the bare number even when invoked with the prefixed identifier', async () => {
    writeTrack(TMP, 'AM-10092-sample', { lane: 'done' });
    await seedSession(collectorPort, '10092');
    const { code } = runLc(TMP, ['plan', 'AM-10092']);
    assert.equal(code, 0);
    const state = await getState(collectorPort);
    assert.equal(state.sessionDeletes.length, 1);
    assert.equal(state.sessionDeletes[0].track_number, '10092');
    assert.equal(state.sessions['AM-10092'], undefined);
  });

  it('TC-7: an unrelated track\'s session is untouched', async () => {
    writeTrack(TMP, 'AM-10092-sample', { lane: 'done' });
    writeTrack(TMP, 'AM-10093-other', { lane: 'done' });
    await seedSession(collectorPort, '10092');
    await seedSession(collectorPort, '10093', 'other-session-uuid');
    const { code } = runLc(TMP, ['plan', '10092']);
    assert.equal(code, 0);
    const state = await getState(collectorPort);
    assert.equal(state.sessionDeletes.length, 1);
    assert.equal(state.sessions['10093'], 'other-session-uuid');
  });

  it('TC-8: a same-lane status-only move issues zero deletes', async () => {
    writeTrack(TMP, 'AM-10092-sample', { lane: 'plan', status: 'running' });
    await seedSession(collectorPort, '10092');
    const { code } = runLc(TMP, ['plan', '10092']);
    assert.equal(code, 0);
    const state = await getState(collectorPort);
    assert.equal(state.sessionDeletes.length, 0);
    assert.equal(state.sessions['10092'], 'seed-session-uuid');
    assert.equal(laneOf(TMP, 'AM-10092-sample').status, 'queue');
  });

  it('TC-9: lc pulse issues zero deletes and never touches Lane', async () => {
    writeTrack(TMP, 'AM-10092-sample', { lane: 'implement', status: 'running', progress: 0 });
    await seedSession(collectorPort, '10092');
    const { code } = runLc(TMP, ['pulse', '10092', 'running', '50']);
    assert.equal(code, 0);
    const state = await getState(collectorPort);
    assert.equal(state.sessionDeletes.length, 0);
    assert.equal(state.sessions['10092'], 'seed-session-uuid');
    const after = laneOf(TMP, 'AM-10092-sample');
    assert.equal(after.lane, 'implement');
    assert.equal(after.status, 'running');
    assert.equal(after.progress, '50');
  });

  // ── Phase 4: invocation-form coverage ────────────────────────────────────

  it('TC-10: generic "lc move <id> <lane>:<status>" form writes both markers and deletes the session', async () => {
    writeTrack(TMP, 'AM-10092-sample', { lane: 'done' });
    await seedSession(collectorPort, '10092');
    const { code } = runLc(TMP, ['move', '10092', 'implement:queue']);
    assert.equal(code, 0);
    const after = laneOf(TMP, 'AM-10092-sample');
    assert.equal(after.lane, 'implement');
    assert.equal(after.status, 'queue');
    const state = await getState(collectorPort);
    assert.equal(state.sessionDeletes.length, 1);
  });

  it('TC-11: "lc implement <id>" alias behaves identically to plan — proves the shared branch', async () => {
    writeTrack(TMP, 'AM-10092-sample', { lane: 'done' });
    await seedSession(collectorPort, '10092');
    const { code } = runLc(TMP, ['implement', '10092']);
    assert.equal(code, 0);
    assert.equal(laneOf(TMP, 'AM-10092-sample').lane, 'implement');
    const state = await getState(collectorPort);
    assert.equal(state.sessionDeletes.length, 1);
  });
});

// ── Phase 4 continued: degraded paths (each needs its own config, separate describe) ──

describe('Track AM-10092: lc move-family — degraded/best-effort paths', () => {
  it('TC-12: local-fs mode issues no HTTP call at all', async () => {
    const { proc, port } = await startMockCollector();
    const TMP = makeSandbox('10092-local-fs');
    try {
      writeConfig(TMP, { mode: 'local-fs', collectors: [{ url: `http://127.0.0.1:${port}`, token: null }] });
      writeWorkflow(TMP);
      writeTrack(TMP, 'AM-10092-sample', { lane: 'done' });
      const { code } = runLc(TMP, ['plan', '10092']);
      assert.equal(code, 0);
      assert.equal(laneOf(TMP, 'AM-10092-sample').lane, 'plan');
      const state = await getState(port);
      assert.equal(state.sessionDeletes.length, 0);
    } finally {
      proc.kill('SIGTERM');
      cleanupSandbox(TMP);
    }
  });

  it('TC-13: a disabled sibling collector receives no delete; the enabled one does', async () => {
    const a = await startMockCollector();
    const b = await startMockCollector();
    const TMP = makeSandbox('10092-disabled-collector');
    try {
      writeConfig(TMP, {
        collectors: [
          { url: `http://127.0.0.1:${a.port}`, token: null, enabled: false },
          { url: `http://127.0.0.1:${b.port}`, token: null },
        ],
      });
      writeWorkflow(TMP);
      writeTrack(TMP, 'AM-10092-sample', { lane: 'done' });
      await seedSession(a.port, '10092');
      await seedSession(b.port, '10092');
      const { code } = runLc(TMP, ['plan', '10092']);
      assert.equal(code, 0);
      const [stateA, stateB] = await Promise.all([getState(a.port), getState(b.port)]);
      assert.equal(stateA.sessionDeletes.length, 0);
      assert.equal(stateB.sessionDeletes.length, 1);
    } finally {
      a.proc.kill('SIGTERM');
      b.proc.kill('SIGTERM');
      cleanupSandbox(TMP);
    }
  });

  it('TC-14: an unreachable collector never blocks the move', () => {
    const TMP = makeSandbox('10092-unreachable-collector');
    try {
      // Port 1 is a privileged, essentially-always-closed port — connection
      // refused immediately, no listener to accidentally bind in a test run.
      writeConfig(TMP, { collectors: [{ url: 'http://127.0.0.1:1', token: null }] });
      writeWorkflow(TMP);
      writeTrack(TMP, 'AM-10092-sample', { lane: 'done' });
      const start = Date.now();
      const { code } = runLc(TMP, ['plan', '10092']);
      const elapsedMs = Date.now() - start;
      assert.equal(code, 0);
      assert.equal(laneOf(TMP, 'AM-10092-sample').lane, 'plan');
      assert.ok(elapsedMs < 10000, `expected best-effort invalidation to not block the move (took ${elapsedMs}ms)`);
    } finally {
      cleanupSandbox(TMP);
    }
  });
});
