#!/usr/bin/env node
// conductor/tests/track-1086-session-worker.test.mjs
// Track 1086 Phase 2: buildCliArgs/spawnCli session-id/resume selection,
// verified end-to-end against a real worker process (not just the pure
// mock-collector unit tests).
//
// Tests:
//   1. First dispatched call for a track mints a session and passes
//      --session-id <uuid>, with full context injected into the prompt.
//   2. A second dispatched call for the SAME track resumes with
//      --resume <same-uuid>, and does NOT re-inject project/track context.
//
// Run: node --test conductor/tests/track-1086-session-worker.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1086-session');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 12000, interval = 250, label = '' } = {}) {
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
  // Track 1086's context injection reads these — presence lets the test
  // confirm the first (fresh) call includes them and the second (resumed)
  // call doesn't.
  writeFileSync(join(TMP, 'conductor/product.md'), 'PRODUCT_MD_MARKER');
}

function writeTrack(num, lane, laneStatus) {
  const dir = join(TMP, 'conductor/tracks', `${num}-test-track`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track ${num}: Test Track`,
    '',
    `**Lane**: ${lane}`,
    `**Lane Status**: ${laneStatus}`,
    '**Progress**: 0%',
  ].join('\n'));
}

function laneStatusOf(num) {
  const path = join(TMP, 'conductor/tracks', `${num}-test-track`, 'index.md');
  const content = readFileSync(path, 'utf8');
  return content.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim();
}

describe('Track 1086 Phase 2: session-id/resume selection', () => {
  let collectorProc, collectorPort, worker, log = '';

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;

    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);
    writeTrack('3001', 'implement', 'idle');

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        MOCK_CLI_DELAY_MS: '150',
        LC_SKIP_GIT_LOCK: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => { log += d.toString(); process.stdout.write(`[session-worker] ${d}`); });
    worker.stderr.on('data', d => { log += d.toString(); process.stderr.write(`[session-worker] ${d}`); });
  });

  after(() => {
    worker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('mints a fresh session and injects full context on the first call', async () => {
    const state = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state.workers[0].id;

    await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '3001', action: 'implement' });
    await poll(async () => (laneStatusOf('3001') === 'success') || null, { label: 'first dispatch completes' });

    // The worker posts its session id to the collector right after spawn
    // (spawnCli, not buildCliArgs) — poll rather than assume it's landed by
    // the time the track itself reaches success.
    const afterFirst = await poll(async () => {
      const s = await getState(collectorPort);
      return s.sessions['3001'] ? s : null;
    }, { label: 'session persisted after first call' });
    assert.match(afterFirst.sessions['3001'], /^[0-9a-f-]{36}$/, 'first call should mint and persist a session id');

    const launchLines = log.split('\n').filter(l => l.includes('Launched') && l.includes('mock-cli.mjs'));
    assert.equal(launchLines.length, 1, `expected exactly one launch so far, got ${launchLines.length}`);
    assert.match(log, /PRODUCT_MD_MARKER/, 'first call should inject full context (product.md)');
  });

  it('resumes the same session and skips context injection on a second call', async () => {
    const beforeSecond = await getState(collectorPort);
    const sessionId = beforeSecond.sessions['3001'];
    const workerId = beforeSecond.workers[0].id;
    const contextMarkerCountBefore = log.split('PRODUCT_MD_MARKER').length - 1;

    await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '3001', action: 'implement' });

    await poll(async () => {
      const launchLines = log.split('\n').filter(l => l.includes('Launched') && l.includes('mock-cli.mjs'));
      return launchLines.length >= 2 ? true : null;
    }, { label: 'second dispatch launches' });

    // Give spawnCli's post-spawn session persist a moment to land, then
    // confirm the collector still has the SAME session id — a resume, not
    // a second fresh mint.
    await sleep(500);
    const afterSecond = await getState(collectorPort);
    assert.equal(afterSecond.sessions['3001'], sessionId, 'second call should resume the exact same session id, not mint a new one');

    const contextMarkerCountAfter = log.split('PRODUCT_MD_MARKER').length - 1;
    assert.equal(contextMarkerCountAfter, contextMarkerCountBefore, 'second (resumed) call should not re-inject full context');
  });

  it('Phase 4 Task 2: appends a derived audit-trail entry to conversation.md for both turns, and it syncs to track_comments', async () => {
    const convPath = join(TMP, 'conductor/tracks', '3001-test-track', 'conversation.md');
    const convContent = await poll(async () => {
      const c = readIfExists(convPath);
      return (c && c.includes('started session') && c.includes('resumed session')) ? c : null;
    }, { label: 'conversation.md has both derived entries' });

    assert.match(convContent, /> \*\*system\*\*: Session turn — dispatch-implement \(started session\): PASS \(exit 0\)\./);
    assert.match(convContent, /> \*\*system\*\*: Session turn — dispatch-implement \(resumed session\): PASS \(exit 0\)\./);

    // The whole point of appending via a normal file write is that it
    // flows through the existing conversation.md FS→DB sync unmodified —
    // confirm it actually reached track_comments, not just the file.
    const finalState = await poll(async () => {
      const s = await getState(collectorPort);
      const turns = s.comments.filter(c => c.track_number === '3001' && c.body?.includes('Session turn'));
      return turns.length >= 2 ? s : null;
    }, { label: 'both derived entries synced to track_comments' });
    const synced = finalState.comments.filter(c => c.track_number === '3001' && c.body?.includes('Session turn'));
    assert.equal(synced.length, 2);
    assert.ok(synced.every(c => c.author === 'system'));
  });
});

function readIfExists(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}
