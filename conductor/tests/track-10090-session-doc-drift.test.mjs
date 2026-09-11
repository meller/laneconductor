#!/usr/bin/env node
// conductor/tests/track-10090-session-doc-drift.test.mjs
// Track AM-10090: end-to-end proof that resolveTrackSession() refuses to
// resume a session whose stored doc_digest no longer matches the track's
// current documents, using a real spawned worker process (not just the
// pure track-doc-digest.mjs unit tests).
//
// TMP gets its OWN `git init` (see track-10064-collector-health-e2e.test.mjs's
// comment) — without it, running this file from inside a track's own git
// worktree silently redirects the spawned worker to register against the
// REAL primary checkout instead of TMP (conductor/services/config-root.mjs's
// resolveConfigRoot walking up to find A git repo, and finding the wrong
// one). Confirmed live while implementing this track: track-1086-session-
// worker.test.mjs and track-10047-bounded-resume.test.mjs both lack this
// and both fail with "which is not the primary checkout" when run from a
// worktree — a known, pre-existing environmental gap, not something this
// test should repeat.
//
// Run: node --test conductor/tests/track-10090-session-doc-drift.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10090-session-drift');
const ARGV_LOG = join(TMP, 'argv.jsonl');

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

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: TMP });
  const collectorUrl = `http://127.0.0.1:${collectorPort}`;

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: collectorUrl, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 3, max_retries: 1, primary_model: 'mock' },
    lanes: { implement: { parallel_limit: 3, max_retries: 1 } },
  }, null, 2));
  writeFileSync(join(TMP, 'conductor/product.md'), 'PRODUCT_MD_MARKER');
}

function trackDir(num) { return join(TMP, 'conductor/tracks', `${num}-test-track`); }

function writeTrack(num, { lane = 'implement', laneStatus = 'idle', specBody = 'original spec body' } = {}) {
  const dir = trackDir(num);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track ${num}: Test Track`,
    '',
    `**Lane**: ${lane}`,
    `**Lane Status**: ${laneStatus}`,
    '**Progress**: 0%',
  ].join('\n'));
  writeFileSync(join(dir, 'spec.md'), specBody);
  writeFileSync(join(dir, 'plan.md'), 'original plan body');
  writeFileSync(join(dir, 'test.md'), 'original test body');
  writeFileSync(join(dir, 'conversation.md'), '# Conversation\n');
}

function readArgvLog() {
  try {
    return readFileSync(ARGV_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch {
    return [];
  }
}

function readIfExists(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

describe('Track AM-10090: resumed session refuses to resume across doc drift', () => {
  let collectorProc, collectorPort, worker, log = '';

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;

    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);
    writeTrack('9101', { lane: 'implement', laneStatus: 'idle' });

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        MOCK_CLI_DELAY_MS: '150',
        MOCK_CLI_ARGV_LOG: ARGV_LOG,
        LC_SKIP_GIT_LOCK: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => { log += d.toString(); process.stdout.write(`[drift-worker] ${d}`); });
    worker.stderr.on('data', d => { log += d.toString(); process.stderr.write(`[drift-worker] ${d}`); });
  });

  after(() => {
    worker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('TC-10/TC-11 setup: first dispatch mints a fresh session and records a doc_digest', async () => {
    const state = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state.workers[0].id;

    await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '9101', action: 'implement' });
    await poll(async () => {
      const entries = readArgvLog();
      return entries.length >= 1 ? entries : null;
    }, { label: 'first dispatch launches' });

    // TC-10 (REQ-11, REQ-12): after the run completes, the session row must
    // carry a doc_digest — even though this run's own logs never mention a
    // measurable context-token count (mock-cli emits no stream-json usage
    // data at all), proving persist fires on digest alone (REQ-12).
    const afterFirst = await poll(async () => {
      const s = await getState(collectorPort);
      const entry = s.sessionsByToken?.[Object.keys(s.sessionsByToken)[0]]?.['9101'];
      return entry?.doc_digest ? entry : null;
    }, { label: 'doc_digest recorded after first dispatch' });
    assert.match(afterFirst.claude_session_id, /^[0-9a-f-]{36}$/);
    assert.match(afterFirst.doc_digest, /^[0-9a-f]{64}$/);

    const firstCall = readArgvLog()[0];
    assert.ok(firstCall.argv.some(a => typeof a === 'string' && a.includes('PRODUCT_MD_MARKER')), 'first call should inject full context (fresh session)');
  });

  it('TC-12: a second dispatch with NO doc changes resumes (no drift)', async () => {
    const beforeState = await getState(collectorPort);
    const token = Object.keys(beforeState.sessionsByToken)[0];
    const sessionBefore = beforeState.sessionsByToken[token]['9101'];
    const workerId = beforeState.workers[0].id;
    const callsBefore = readArgvLog().length;

    await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '9101', action: 'implement' });
    await poll(async () => (readArgvLog().length > callsBefore) ? true : null, { label: 'second dispatch launches' });
    await sleep(500);

    // Track 10047's own note (buildCliArgs) applies here too: FRESH_SESSION
    // text is only ever added to the REAL claude CLI's args (buildClaudeArgs)
    // — LC_MOCK_CLI's argv never carries it. The verifiable signals for the
    // mock path are session-id continuity (below) and context-injection
    // presence/absence, exactly as track-1086-session-worker.test.mjs itself
    // asserts (PRODUCT_MD_MARKER), not argv text that doesn't exist here.
    const secondCall = readArgvLog()[callsBefore];
    assert.ok(!secondCall.argv.some(a => typeof a === 'string' && a.includes('PRODUCT_MD_MARKER')), 'a resumed call should not re-inject full context');

    const afterState = await getState(collectorPort);
    const sessionAfter = afterState.sessionsByToken[token]['9101'];
    assert.equal(sessionAfter.claude_session_id, sessionBefore.claude_session_id, 'no-drift dispatch should resume the SAME session id');
  });

  it('TC-11/TC-14 (the AM-1020 replay): rewriting spec.md/plan.md out-of-band forces a cold start, and the rewrite survives', async () => {
    const beforeState = await getState(collectorPort);
    const token = Object.keys(beforeState.sessionsByToken)[0];
    const sessionBefore = beforeState.sessionsByToken[token]['9101'];
    const workerId = beforeState.workers[0].id;
    const callsBefore = readArgvLog().length;

    // Simulate the AM-1020 shape: a DIFFERENT party (a human, or a fresh
    // planning session) rewrites the track's real documents AND leaves no
    // unanswered human tail (a `> **system**:` reply, not `> **human**:`),
    // so extractUnansweredHumanTail() alone would find nothing new.
    const dir = trackDir('9101');
    writeFileSync(join(dir, 'spec.md'), 'RESPECCED spec body — real requirements now');
    writeFileSync(join(dir, 'plan.md'), 'RESPECCED plan body — real phases now');
    appendFileSync(join(dir, 'conversation.md'), '\n> **system**: Replanned with real requirements.\n');

    await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '9101', action: 'implement' });
    await poll(async () => (readArgvLog().length > callsBefore) ? true : null, { label: 'third dispatch launches' });
    await sleep(500);

    const thirdCall = readArgvLog()[callsBefore];
    assert.ok(thirdCall.argv.some(a => typeof a === 'string' && a.includes('PRODUCT_MD_MARKER')), 'a cold-started (drifted) call must re-inject full context');

    const afterState = await getState(collectorPort);
    const sessionAfter = afterState.sessionsByToken[token]['9101'];
    assert.notEqual(sessionAfter.claude_session_id, sessionBefore.claude_session_id, 'drift must mint a NEW session id, not keep resuming the stale one');

    // The clobber-prevention outcome: the respecced content is still on disk.
    assert.equal(readIfExists(join(dir, 'spec.md')), 'RESPECCED spec body — real requirements now');
    assert.equal(readIfExists(join(dir, 'plan.md')), 'RESPECCED plan body — real phases now');

    // And the worker itself flagged the drift for a human to see.
    const convContent = readIfExists(join(dir, 'conversation.md'));
    assert.match(convContent, /Track documents changed since this session's last turn/);
  });

  it('TC-15 (REQ-3 in situ): patching only Lane/Progress between dispatches does NOT force a cold start', async () => {
    const beforeState = await getState(collectorPort);
    const token = Object.keys(beforeState.sessionsByToken)[0];
    const sessionBefore = beforeState.sessionsByToken[token]['9101'];
    const workerId = beforeState.workers[0].id;
    const callsBefore = readArgvLog().length;

    const dir = trackDir('9101');
    const indexContent = readFileSync(join(dir, 'index.md'), 'utf8');
    writeFileSync(join(dir, 'index.md'), indexContent
      .replace('**Lane Status**: idle', '**Lane Status**: running')
      .replace('**Progress**: 0%', '**Progress**: 40%'));

    await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '9101', action: 'implement' });
    await poll(async () => (readArgvLog().length > callsBefore) ? true : null, { label: 'fourth dispatch launches' });
    await sleep(500);

    const fourthCall = readArgvLog()[callsBefore];
    assert.ok(!fourthCall.argv.some(a => typeof a === 'string' && a.includes('PRODUCT_MD_MARKER')), 'volatile marker changes must not force a cold start (context should not be re-injected)');

    const afterState = await getState(collectorPort);
    const sessionAfter = afterState.sessionsByToken[token]['9101'];
    assert.equal(sessionAfter.claude_session_id, sessionBefore.claude_session_id, 'should still be resuming the same session — track 1086 must stay intact');
  });
});
