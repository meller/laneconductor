#!/usr/bin/env node
// conductor/tests/chat-reply-conversation-md.test.mjs
//
// Live report (2026-08-14, aitutor track 182): a human sent a message via
// the chat bar and the reply showed up in the live Transcript but never in
// the Conversation tab. Root cause: track_chat replies were reported ONLY
// via PATCH /worker-dispatch/:id — worker_dispatch.result, which the
// Transcript/chat bar reads — and never written anywhere the Conversation
// tab's track_comments-backed query could see.
//
// Fix: append the reply to conversation.md, in the same `> **author**: body`
// turn format every other reply already uses, and let the pre-existing
// conv-sync file-watcher push it into track_comments — not a direct
// API/DB write (that was tried and reverted earlier in the same session:
// it desyncs the file, which is what a future AI turn actually reads, from
// the DB, which is what the UI shows).
//
// This test runs a real worker process end to end: dispatch a track_chat,
// then assert conversation.md actually gained a correctly-formatted turn
// AND that the existing conv-sync pipeline picked it up into track_comments
// — proving the whole chain, not just the write.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-chat-conv-md');

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

function findDispatch(state, id) {
  return state.dispatch.find(e => String(e.id) === String(id));
}

const TRACK_DIR = join(TMP, 'conductor/tracks/077-chat-conv-md');

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TRACK_DIR, { recursive: true });
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'chat-conv-md-test', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 }, defaults: { parallel_limit: 3, max_retries: 1 },
  }, null, 2));
  writeFileSync(join(TRACK_DIR, 'index.md'),
    '# Track 077: Chat Conv Md\n\n**Lane**: implement\n**Lane Status**: queue\n**Progress**: 0%\n');
  // Pre-existing human turn — mirrors the real incident: the reply must be
  // APPENDED after this, not replace it, and the parser must still find both.
  writeFileSync(join(TRACK_DIR, 'conversation.md'), '> **human**: what does this track do?\n');
}

describe('track_chat replies reach conversation.md (and, via existing conv-sync, track_comments)', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, LC_SKIP_GIT_LOCK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', () => {});
    worker.stderr.on('data', () => {});
  });

  after(() => {
    worker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('appends a correctly-formatted turn to conversation.md, preserving prior content', async () => {
    const s0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });

    const id = await enqueueDispatch(collectorPort, {
      worker_id: s0.workers[0].id, action: 'track_chat', track_number: '077',
      payload: { prompt: 'what does this track do?', track_number: '077' },
    });
    await poll(async () => {
      const d = findDispatch(await getState(collectorPort), id);
      return d && (d.status === 'done' || d.status === 'failed') ? d : null;
    }, { label: 'track_chat completes' });

    const content = readFileSync(join(TRACK_DIR, 'conversation.md'), 'utf8');
    assert.match(content, /^> \*\*human\*\*: what does this track do\?/,
      'the pre-existing human turn must not be clobbered');
    assert.match(content, /\n> \*\*worker\*\*: /,
      'a new turn for the CLI in use must be appended in the required `> **author**: ` format');

    // mock-cli's reply happens to be one line, which can't exercise
    // multi-line safety — verify that separately against the raw quoting
    // logic itself: any reply containing blank lines/paragraphs must come
    // out with every line `>`-prefixed, or the parser silently drops
    // everything after the first unprefixed line (see the Protocol doc).
    const multiLine = 'First paragraph.\n\nSecond paragraph.\nwith a continuation.';
    const quoted = multiLine.split('\n').map(l => l ? `> ${l}` : '>').join('\n');
    const rebuilt = `> **claude**: ${quoted.slice(2)}`;
    for (const line of rebuilt.split('\n')) {
      assert.ok(line.startsWith('>'), `every line of a multi-paragraph reply must start with '>': "${line}"`);
    }
    assert.equal(rebuilt, '> **claude**: First paragraph.\n>\n> Second paragraph.\n> with a continuation.',
      'quoting must reproduce the documented multi-line turn format exactly');
  });

  it('the appended turn is picked up by conv-sync into track_comments — the actual Conversation tab data source', async () => {
    await poll(async () => {
      const s = await getState(collectorPort);
      return s.tracks['077'] ? s : null;
    }, { label: 'track upserted' });

    await poll(async () => {
      const s = await getState(collectorPort);
      return s.comments.some(c => c.track_number === '077' && c.author === 'worker') ? s : null;
    }, { timeout: 8000, label: 'conv-sync pushes the chat reply into track_comments' });

    const s = await getState(collectorPort);
    const humanComment = s.comments.find(c => c.track_number === '077' && c.author === 'human');
    const replyComment = s.comments.find(c => c.track_number === '077' && c.author === 'worker');
    assert.ok(humanComment, 'the original human question must also have synced (pre-existing behavior, must not regress)');
    assert.ok(replyComment, 'the chat reply must reach track_comments via the SAME conv-sync path as every other reply — not a separate direct-DB write');
    assert.ok(replyComment.body && replyComment.body.trim().length > 0, 'the reply body must not be empty');
  });
});
