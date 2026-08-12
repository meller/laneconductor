#!/usr/bin/env node
// conductor/tests/track-1087-worker-chat-dispatch.test.mjs
// Track 1087 Phase 8: the worker-side handler for the Activity panel's
// chat bar. Before this, `worker_adhoc_chat` / `track_chat` dispatches were
// created by the UI but had NO handler at all — they fell through to the
// generic lane-action path and failed with "missing track_number", so the
// chat bar could send but never got a reply. Verified against a real
// spawned worker using LC_MOCK_CLI.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1087-chat');

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
  mkdirSync(join(TMP, 'conductor/tracks/042-chat-target'), { recursive: true });
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'chat-test', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 }, defaults: { parallel_limit: 3, max_retries: 1 },
  }, null, 2));
  writeFileSync(join(TMP, 'conductor/tracks/042-chat-target/index.md'),
    '# Track 042: Chat Target\n\n**Lane**: implement\n**Lane Status**: queue\n**Progress**: 0%\n');
}

describe('Track 1087 Phase 8: worker-side chat dispatch handler', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);

    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '100', LC_SKIP_GIT_LOCK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
    worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  });

  after(() => {
    worker?.kill();
    collectorProc?.kill();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('runs a worker_adhoc_chat prompt and reports the reply — no track needed', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });

    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: state0.workers[0].id,
      action: 'worker_adhoc_chat',
      payload: { prompt: 'Reply with exactly the word: pong' },
    });

    const entry = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => String(e.id) === String(dispatchId));
      return d && (d.status === 'done' || d.status === 'failed') ? d : null;
    }, { label: 'worker_adhoc_chat completes' });

    // The core regression: this used to fail with "missing track_number"
    // because no handler existed for the action at all.
    assert.ok(!/missing track_number/.test(entry.result || ''), `should not fall through to the lane-action handler: ${entry.result}`);
    assert.equal(entry.status, 'done', `expected done, got ${entry.status}: ${entry.result}`);
    // The reply must actually come back — an empty "done" is useless to a
    // chat bar whose whole purpose is showing the response.
    assert.ok(entry.result && entry.result.trim().length > 0, 'dispatch result should carry the CLI reply');
  });

  it('rejects a chat dispatch with no prompt rather than spawning an empty turn', async () => {
    const state0 = await getState(collectorPort);
    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: state0.workers[0].id,
      action: 'worker_adhoc_chat',
      payload: {},
    });

    const entry = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => String(e.id) === String(dispatchId));
      return d && (d.status === 'done' || d.status === 'failed') ? d : null;
    }, { label: 'empty-prompt chat dispatch completes' });

    assert.equal(entry.status, 'failed');
    assert.match(entry.result, /prompt/i);
  });

  it('runs a track_chat prompt against a real track', async () => {
    const state0 = await getState(collectorPort);
    const dispatchId = await enqueueDispatch(collectorPort, {
      worker_id: state0.workers[0].id,
      action: 'track_chat',
      track_number: '042',
      payload: { prompt: 'What is the status?', track_number: '042' },
    });

    const entry = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => String(e.id) === String(dispatchId));
      return d && (d.status === 'done' || d.status === 'failed') ? d : null;
    }, { label: 'track_chat completes' });

    assert.ok(!/missing track_number/.test(entry.result || ''), `should not fall through to the lane-action handler: ${entry.result}`);
    assert.equal(entry.status, 'done', `expected done, got ${entry.status}: ${entry.result}`);
  });
});
