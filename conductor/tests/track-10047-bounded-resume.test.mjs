#!/usr/bin/env node
// conductor/tests/track-10047-bounded-resume.test.mjs
// Track 10047 Phase 4 (TC-14..TC-19): resolveTrackSession's cap applied
// end-to-end against a real worker process, same harness as
// track-1086-session-worker.test.mjs.
//
// Run: node --test conductor/tests/track-10047-bounded-resume.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');

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

// The real worker authenticates every collector call with ITS OWN
// registered machine_token (resolveCollectorToken's step 1b — outranks
// the config file's token: null the moment registration hands one back),
// never the config's raw `token` value. The mock scopes sessionsByToken
// per bearer token (track 1113), so seeding a session BEFORE the worker
// has registered — or without its actual token — writes into a bucket
// the worker's own GET can never see. Callers must poll for the worker's
// registration first and pass its real machine_token here.
async function seedSession(port, machineToken, trackNumber, claudeSessionId, contextTokens) {
  const body = { claude_session_id: claudeSessionId };
  if (contextTokens !== undefined) body.context_tokens = contextTokens;
  await fetch(`http://127.0.0.1:${port}/track/${trackNumber}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${machineToken}` },
    body: JSON.stringify(body),
  });
}

function readIfExists(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

function laneStatusOf(tmp, num) {
  const path = join(tmp, 'conductor/tracks', `${num}-test-track`, 'index.md');
  const content = readIfExists(path);
  return content?.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim();
}

function writeTrack(tmp, num, lane, laneStatus) {
  const dir = join(tmp, 'conductor/tracks', `${num}-test-track`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track ${num}: Test Track`,
    '',
    `**Lane**: ${lane}`,
    `**Lane Status**: ${laneStatus}`,
    '**Progress**: 0%',
  ].join('\n'));
}

function setupProject(tmp, collectorPort) {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: tmp, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));
  mkdirSync(join(tmp, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(tmp, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 3, max_retries: 1, primary_model: 'mock' },
    lanes: { implement: { parallel_limit: 3, max_retries: 1 } },
  }, null, 2));
  // Same marker convention as track-1086-session-worker.test.mjs: presence
  // in the launched prompt is how a test tells "full context injected"
  // (fresh/capped run) apart from "not injected" (resumed run).
  writeFileSync(join(tmp, 'conductor/product.md'), 'PRODUCT_MD_MARKER');
}

function startWorker(tmp, envOverrides = {}, extraArgs = ['--sync-only']) {
  let log = '';
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), ...extraArgs], {
    cwd: tmp,
    env: {
      ...process.env,
      LC_MOCK_CLI: `node ${MOCK_CLI}`,
      MOCK_CLI_DELAY_MS: '150',
      LC_SKIP_GIT_LOCK: '1',
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => { log += d.toString(); process.stdout.write(`[bounded-resume] ${d}`); });
  worker.stderr.on('data', d => { log += d.toString(); process.stderr.write(`[bounded-resume] ${d}`); });
  return { worker, getLog: () => log };
}

describe('Track 10047 Phase 4: bounded session resume, end to end', () => {
  let collectorProc, collectorPort;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
  });

  after(() => collectorProc?.kill());

  it('TC-14/TC-15 (AC-1, AC-2): an over-threshold session is retired — next dispatch cold-starts with a NEW id and full context injection', async () => {
    const TMP = join(ROOT, '.test-tmp-track-10047-tc14');
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(TMP, collectorPort);
    writeTrack(TMP, '4101', 'implement', 'idle');

    const { worker, getLog } = startWorker(TMP, { LC_SESSION_MAX_CONTEXT_TOKENS: '400000' });
    try {
      // Seed AFTER the worker registers, WITH its own machine_token — the
      // worker authenticates every collector call with that token (never
      // the config's token: null), so seeding without it — or before it
      // exists — writes into a bucket the worker's own GET can never see.
      const state = await poll(async () => {
        const s = await getState(collectorPort);
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registered' });
      const workerId = state.workers[0].id;
      const machineToken = state.workers[0].machine_token;

      const staleSessionId = '99999999-9999-9999-9999-999999999999';
      await seedSession(collectorPort, machineToken, '4101', staleSessionId, 500000); // over the 400000 default

      await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '4101', action: 'implement' });
      await poll(async () => (laneStatusOf(TMP, '4101') === 'success') || null, { label: 'dispatch completes' });

      const after = await poll(async () => {
        const s = await getState(collectorPort);
        return (s.sessions['4101'] && s.sessions['4101'] !== staleSessionId) ? s : null;
      }, { label: 'a NEW session id replaces the retired one' });
      assert.notEqual(after.sessions['4101'], staleSessionId, 'AC-1: the over-threshold session id must be gone, replaced by a new one');
      assert.match(after.sessions['4101'], /^[0-9a-f-]{36}$/);

      // Neither argv nor the FRESH_SESSION marker are reliable assertion
      // surfaces under LC_MOCK_CLI: buildCliArgs returns early for the mock
      // path (laneconductor.sync.mjs's `if (process.env.LC_MOCK_CLI)`
      // branch), before freshnessMarker/buildClaudeArgs are ever reached —
      // matching track-1086-session-worker.test.mjs's own choice to assert
      // on the PRODUCT_MD_MARKER context-injection signal instead, which
      // IS gated on session.isFresh (spawnCli's context-injection fallback)
      // and so proves the same thing: a capped run isn't starting blind.
      assert.match(getLog(), /PRODUCT_MD_MARKER/, 'AC-2: a capped/cold-started run still receives full file-based context — not starting blind');
      assert.match(getLog(), /capping session/, 'the cap decision is logged (REQ-12)');
    } finally {
      worker.kill('SIGTERM');
      await sleep(300);
      rmSync(TMP, { recursive: true, force: true });
    }
  });

  it('TC-16 (AC-3): an under-threshold session still resumes the same uuid, unchanged from today', async () => {
    const TMP = join(ROOT, '.test-tmp-track-10047-tc16');
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(TMP, collectorPort);
    writeTrack(TMP, '4102', 'implement', 'idle');

    const { worker, getLog } = startWorker(TMP, { LC_SESSION_MAX_CONTEXT_TOKENS: '400000' });
    try {
      const state = await poll(async () => {
        const s = await getState(collectorPort);
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registered' });
      const workerId = state.workers[0].id;
      const machineToken = state.workers[0].machine_token;

      const goodSessionId = '88888888-8888-8888-8888-888888888888';
      await seedSession(collectorPort, machineToken, '4102', goodSessionId, 164000); // well under 400000

      await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '4102', action: 'implement' });
      await poll(async () => (laneStatusOf(TMP, '4102') === 'success') || null, { label: 'dispatch completes' });
      await sleep(500);

      const after = await getState(collectorPort);
      assert.equal(after.sessions['4102'], goodSessionId, 'AC-3: an under-threshold session must still be resumed, not replaced');
      // PRODUCT_MD_MARKER presence isn't a usable signal here: under
      // LC_MOCK_CLI, spawnCli's own context-injection fallback (mock-
      // cli.mjs's header comment) injects it unconditionally regardless of
      // session.isFresh — the real claude path's isFresh-gated suppression
      // (spec Correction 1) isn't exercised by this harness at all.
      // "capping session" never logging IS a direct, reliable check of the
      // actual decision this test verifies.
      assert.doesNotMatch(getLog(), /capping session/, 'AC-3: an under-threshold session must never trigger the cap decision at all');
    } finally {
      worker.kill('SIGTERM');
      await sleep(300);
      rmSync(TMP, { recursive: true, force: true });
    }
  });

  it('TC-17 (AC-6): a collector omitting both new fields behaves identically to today — no cap, session resumed', async () => {
    const TMP = join(ROOT, '.test-tmp-track-10047-tc17');
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(TMP, collectorPort);
    writeTrack(TMP, '4103', 'implement', 'idle');

    // Seed via the state-mutating dispatch flow's own first call, i.e. no
    // last_context_tokens/resume_count present in the collector's picture
    // at all yet for this track — GET returns null/0, the collector-omits-
    // fields case AC-6 describes (the mock always returns these fields
    // once queried, but a genuinely never-seeded track has null/0, the
    // same "unknown" shape a legacy collector would report).
    const { worker, getLog } = startWorker(TMP, { LC_SESSION_MAX_CONTEXT_TOKENS: '400000', LC_SESSION_MAX_RESUMES: '12' });
    try {
      const state = await poll(async () => {
        const s = await getState(collectorPort);
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registered' });
      const workerId = state.workers[0].id;

      await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '4103', action: 'implement' });
      await poll(async () => (laneStatusOf(TMP, '4103') === 'success') || null, { label: 'first dispatch completes' });
      const afterFirst = await poll(async () => {
        const s = await getState(collectorPort);
        return s.sessions['4103'] ? s : null;
      }, { label: 'first session minted' });
      const sessionId = afterFirst.sessions['4103'];

      await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '4103', action: 'implement' });
      await poll(async () => {
        const launches = getLog().split('\n').filter(l => l.includes('Launched') && l.includes('mock-cli.mjs'));
        return launches.length >= 2 ? true : null;
      }, { label: 'second dispatch launches' });
      await sleep(500);

      const afterSecond = await getState(collectorPort);
      assert.equal(afterSecond.sessions['4103'], sessionId, 'AC-6: unknown/never-measured token data must never cap — behaves like today');
    } finally {
      worker.kill('SIGTERM');
      await sleep(300);
      rmSync(TMP, { recursive: true, force: true });
    }
  });

  it('TC-18 (AC-7): local-fs mode reaches no session traffic at all and caps nothing', async () => {
    const TMP = join(ROOT, '.test-tmp-track-10047-tc18');
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
      mode: 'local-fs',
      project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
      collectors: [],
      ui: { port: 8090 },
    }, null, 2));
    mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
    writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
      global: { total_parallel_limit: 3 },
      defaults: { parallel_limit: 3, max_retries: 1, primary_model: 'mock' },
      lanes: { implement: { parallel_limit: 3, max_retries: 1 } },
    }, null, 2));
    writeTrack(TMP, '4104', 'implement', 'queue');
    writeFileSync(join(TMP, 'conductor/tracks', '4104-test-track', 'index.md'),
      readFileSync(join(TMP, 'conductor/tracks', '4104-test-track', 'index.md'), 'utf8') + '\n**Auto Run**: yes\n');

    const { worker, getLog } = startWorker(TMP, { LC_SESSION_MAX_CONTEXT_TOKENS: '400000' }, []);
    try {
      await poll(async () => (laneStatusOf(TMP, '4104') === 'success') || null, { label: 'local-fs dispatch completes', timeout: 10000 });
      assert.doesNotMatch(getLog(), /\[session\]/, 'AC-7: no session-cap logic reached in local-fs mode');
    } finally {
      worker.kill('SIGTERM');
      await sleep(300);
      rmSync(TMP, { recursive: true, force: true });
    }
  });

  it('TC-19 (REQ-4): LC_SESSION_MAX_CONTEXT_TOKENS=0 disables the check even with a huge stored session', async () => {
    const TMP = join(ROOT, '.test-tmp-track-10047-tc19');
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(TMP, collectorPort);
    writeTrack(TMP, '4105', 'implement', 'idle');

    const { worker, getLog } = startWorker(TMP, { LC_SESSION_MAX_CONTEXT_TOKENS: '0', LC_SESSION_MAX_RESUMES: '0' });
    try {
      const state = await poll(async () => {
        const s = await getState(collectorPort);
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registered' });
      const workerId = state.workers[0].id;
      const machineToken = state.workers[0].machine_token;

      const hugeSessionId = '77777777-7777-7777-7777-777777777777';
      await seedSession(collectorPort, machineToken, '4105', hugeSessionId, 900000);

      await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '4105', action: 'implement' });
      await poll(async () => (laneStatusOf(TMP, '4105') === 'success') || null, { label: 'dispatch completes' });
      await sleep(500);

      const after = await getState(collectorPort);
      assert.equal(after.sessions['4105'], hugeSessionId, 'REQ-4: threshold 0 disables the check — a 900K-token session must still resume');
      assert.doesNotMatch(getLog(), /capping session/, 'REQ-4: disabled check must never even reach the cap decision');
    } finally {
      worker.kill('SIGTERM');
      await sleep(300);
      rmSync(TMP, { recursive: true, force: true });
    }
  });
});
