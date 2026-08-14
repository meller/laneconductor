#!/usr/bin/env node
// conductor/tests/track-1113-chat-coordination.test.mjs
// Track 1113 Phase 3: chat turns used to be a fully independent code path
// from lane actions — no shared session (REQ-5), able to spawn a second CLI
// process against the same worktree while a lane action was running (REQ-6),
// and clobbering that lane action's `busy` heartbeat on completion (REQ-7).
//
// REQ-8/9 (reply visibility) are covered separately in
// chat-reply-conversation-md.test.mjs — that fix (append to conversation.md,
// let the existing conv-sync watcher push it to track_comments) landed on
// `main` directly during the same live-incident response that produced this
// file's REQ-5/6/7 fixes on a separate branch; reconciled here rather than
// carrying two different REQ-8 mechanisms.
//
// Run against a real spawned worker via LC_MOCK_CLI — the point of this
// track's own Phase 5 is that none of it is real until it's exercised on an
// actual sync-only worker process, which is the exact configuration where
// the original gap (a message sent to a track in `review` silently never
// resuming it) was invisible.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1113-chat');
const ARGV_LOG = join(TMP, 'argv.log');

// The worker below runs with LC_DISPATCH_POLL_MS=1000 and a 5s mock CLI, so a
// lane action spans ~5 inbox cycles — REQ-6's deferral branch is guaranteed to
// be exercised rather than skipped by luck of timing.
const DISPATCH_POLL_MS = 1000;
const CLI_DELAY_MS = 5000;
const PICKUP_TIMEOUT = 40000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = PICKUP_TIMEOUT, interval = 250, label = '' } = {}) {
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

function findDispatch(state, id) {
  return state.dispatch.find(e => String(e.id) === String(id));
}

function readArgvLog() {
  if (!existsSync(ARGV_LOG)) return [];
  return readFileSync(ARGV_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, 'conductor/tracks/042-chat-target'), { recursive: true });
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'chat-coord-test', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 }, defaults: { parallel_limit: 3, max_retries: 1 },
  }, null, 2));
  writeFileSync(join(TMP, 'conductor/tracks/042-chat-target/index.md'),
    '# Track 042: Chat Target\n\n**Lane**: implement\n**Lane Status**: queue\n**Progress**: 0%\n');
}

describe('Track 1113 Phase 3: chat/lane-action coordination', () => {
  let collectorProc, collectorPort, worker, workerId;
  let workerLog = '';

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        MOCK_CLI_DELAY_MS: String(CLI_DELAY_MS),
        MOCK_CLI_ARGV_LOG: ARGV_LOG,
        LC_DISPATCH_POLL_MS: String(DISPATCH_POLL_MS),
        LC_SKIP_GIT_LOCK: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => { workerLog += d.toString(); });
    worker.stderr.on('data', d => { workerLog += d.toString(); });

    const s = await poll(async () => {
      const st = await getState(collectorPort);
      return st.workers.length > 0 ? st : null;
    }, { label: 'worker registered' });
    workerId = s.workers[0].id;
  });

  after(() => {
    worker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('REQ-5: a track_chat turn persists a session and the next turn resumes it', async () => {
    const first = await enqueueDispatch(collectorPort, {
      worker_id: workerId, action: 'track_chat', track_number: '042',
      payload: { prompt: 'First question', track_number: '042' },
    });
    await poll(async () => {
      const d = findDispatch(await getState(collectorPort), first);
      return d && (d.status === 'done' || d.status === 'failed') ? d : null;
    }, { label: 'first track_chat completes' });

    const afterFirst = await getState(collectorPort);
    const sessionId = afterFirst.sessions['042'];
    assert.ok(sessionId, 'a track_chat turn must persist a track_sessions row (REQ-5)');

    // The first turn had no session to resume, so it must mint one with
    // --session-id; re-injecting track files as raw text is the old behavior.
    const firstArgv = readArgvLog().find(e => e.argv.includes('chat'));
    assert.ok(firstArgv, 'mock CLI should have been invoked for the chat turn');
    assert.ok(firstArgv.argv.includes('--session-id'),
      `first chat turn should mint a session, got: ${firstArgv.argv.join(' ')}`);

    const before2 = readArgvLog().length;
    const second = await enqueueDispatch(collectorPort, {
      worker_id: workerId, action: 'track_chat', track_number: '042',
      payload: { prompt: 'Follow-up question', track_number: '042' },
    });
    await poll(async () => {
      const d = findDispatch(await getState(collectorPort), second);
      return d && (d.status === 'done' || d.status === 'failed') ? d : null;
    }, { label: 'second track_chat completes' });

    const secondArgv = readArgvLog().slice(before2).find(e => e.argv.includes('chat'));
    assert.ok(secondArgv, 'second chat turn should have invoked the CLI');
    assert.ok(secondArgv.argv.includes('--resume'),
      `second chat turn must resume the shared session, got: ${secondArgv.argv.join(' ')}`);
    assert.ok(secondArgv.argv.includes(sessionId),
      'second chat turn must resume the SAME session id the first one persisted');

    // Same session row, not a second one minted per turn.
    const afterSecond = await getState(collectorPort);
    assert.equal(afterSecond.sessions['042'], sessionId, 'session id should be stable across turns');
  });

  it('REQ-6/REQ-7: a chat turn defers behind an in-flight lane action and leaves the heartbeat busy', async () => {
    // Kick off a real lane action (slow mock CLI), then immediately queue a
    // chat turn for the SAME track — the pre-fix behavior spawned both.
    const laneId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, action: 'implement', track_number: '042', payload: {},
    });

    // Wait until the lane action is actually running, not merely claimed.
    await poll(async () => {
      const d = findDispatch(await getState(collectorPort), laneId);
      return d && d.status === 'claimed' ? d : null;
    }, { label: 'lane action claimed' });

    const chatId = await enqueueDispatch(collectorPort, {
      worker_id: workerId, action: 'track_chat', track_number: '042',
      payload: { prompt: 'Question during a running lane action', track_number: '042' },
    });

    // Wait for the worker to actually reach the deferral branch — an inbox
    // cycle that saw this chat entry and declined to claim it. Asserting on
    // "still pending" alone is not enough: it is trivially true in the first
    // moments after enqueue, before any cycle has run, which is how an earlier
    // version of this test passed without exercising REQ-6 at all.
    const observed = await poll(async () => {
      if (!/Deferring chat turn/.test(workerLog)) return null;
      const st = await getState(collectorPort);
      const lane = findDispatch(st, laneId);
      const chat = findDispatch(st, chatId);
      if (lane?.status !== 'claimed') return null;   // lane action no longer in flight
      return { lane, chat, workers: st.workers };
    }, { timeout: CLI_DELAY_MS, label: 'worker defers the chat while the lane action is in flight (REQ-6)' });

    assert.equal(observed.chat.status, 'pending',
      'chat must be left pending (not claimed) while a lane action is in flight for the same track (REQ-6)');

    // REQ-7: the chat handler must not have forced the worker back to idle
    // out from under the still-running lane action.
    const w = observed.workers.find(x => x.id === workerId);
    assert.notEqual(w?.status, 'idle',
      'worker heartbeat must stay busy while a lane action is running (REQ-7)');

    // And once the lane action is done, the deferred chat must actually run —
    // deferral has to mean "later", not "dropped".
    const finishedChat = await poll(async () => {
      const d = findDispatch(await getState(collectorPort), chatId);
      return d && (d.status === 'done' || d.status === 'failed') ? d : null;
    }, { timeout: 60000, label: 'deferred chat eventually runs' });
    assert.equal(finishedChat.status, 'done',
      `deferred chat must still run after the lane action exits, got ${finishedChat.status}: ${finishedChat.result}`);
  });
});
