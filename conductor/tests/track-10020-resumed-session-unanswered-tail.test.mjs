#!/usr/bin/env node
// conductor/tests/track-10020-resumed-session-unanswered-tail.test.mjs
// Track 10020: a resumed Claude session (Track 1086's persistent-session
// design) skips full context re-injection by design — it never gets a
// fresh read of conversation.md. Caught live on track 1102: a human's
// follow-up instruction sat in conversation.md, already present before the
// resumed dispatch even started, and the session still concluded "nothing
// new has arrived from you yet" — because nothing ever told it to look.
//
// Fix: even on a resumed session, spawnCli now injects the trailing
// unanswered human message(s) from conversation.md (extractUnansweredHumanTail,
// conversation-tail.mjs) — a small, targeted addition, not the full reload
// Track 1086 was avoiding. Verified here against a real spawned worker: a
// human note written between the first and second dispatch must show up in
// the SECOND (resumed) call's actual prompt.
//
// Run: node --test conductor/tests/track-10020-resumed-session-unanswered-tail.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10020-resumed-tail');
const ARGV_LOG = join(TMP, 'argv.log');

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
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
}
async function getState(port) { return (await fetch(`http://127.0.0.1:${port}/_state`)).json(); }
async function enqueueDispatch(port, entry) {
  const r = await fetch(`http://127.0.0.1:${port}/_enqueue-dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) });
  return (await r.json()).id;
}

const trackDir = join(TMP, 'conductor/tracks/3002-test-track');
const indexPath = join(trackDir, 'index.md');
const convPath = join(trackDir, 'conversation.md');

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));
  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 3, max_retries: 1, primary_model: 'mock' },
    lanes: { implement: { parallel_limit: 3, max_retries: 1 } },
  }, null, 2));
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(indexPath, ['# Track 3002: Test Track', '', '**Lane**: implement', '**Lane Status**: idle', '**Progress**: 0%'].join('\n'));
  writeFileSync(convPath, '> **claude**: closing response from an earlier turn — nothing pending.\n');
}

function laneStatusOf() {
  return readFileSync(indexPath, 'utf8').match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim();
}

function readArgvLog() {
  if (!existsSync(ARGV_LOG)) return [];
  return readFileSync(ARGV_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

describe('Track 10020: resumed sessions must be told about a new human message', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc; collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '150', LC_SKIP_GIT_LOCK: '1', MOCK_CLI_ARGV_LOG: ARGV_LOG },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
    worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  });

  after(() => { worker?.kill(); collectorProc?.kill(); rmSync(TMP, { recursive: true, force: true }); });

  it('injects the new human message into the resumed call\'s actual prompt', async () => {
    const state0 = await poll(async () => { const s = await getState(collectorPort); return s.workers.length > 0 ? s : null; });
    const workerId = state0.workers[0].id;

    // First call: mints a fresh session.
    await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '3002', action: 'implement' });
    await poll(async () => (laneStatusOf() === 'success') || null, { label: 'first dispatch completes' });
    await poll(async () => {
      const s = await getState(collectorPort);
      return s.sessions['3002'] ? s : null;
    }, { label: 'session persisted' });

    // A human posts a genuinely new instruction between the two dispatches
    // — this is the exact scenario caught live on track 1102.
    writeFileSync(convPath, readFileSync(convPath, 'utf8') + '\n> **human** (note, implement): please also verify with playwright\n');

    // Re-queue for a second, RESUMED call.
    const content = readFileSync(indexPath, 'utf8').replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, '**Lane Status**: queue');
    writeFileSync(indexPath, content);
    await enqueueDispatch(collectorPort, { worker_id: workerId, track_number: '3002', action: 'implement' });
    await poll(async () => (readArgvLog().length >= 2) ? true : null, { label: 'second (resumed) call launches' });

    const calls = readArgvLog();
    assert.equal(calls.length, 2, 'exactly two mock-cli invocations');

    const secondCallArgv = calls[1].argv.join(' ');
    assert.match(secondCallArgv, /UNANSWERED MESSAGE\(S\) FROM THE HUMAN/, 'resumed call\'s prompt must flag the new human message');
    assert.match(secondCallArgv, /please also verify with playwright/, 'resumed call\'s prompt must include the actual new message text');
  });
});
