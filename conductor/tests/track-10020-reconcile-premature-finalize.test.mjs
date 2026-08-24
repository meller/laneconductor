#!/usr/bin/env node
// conductor/tests/track-10020-reconcile-premature-finalize.test.mjs
// Track 10020: reconcileActiveDispatch() used to trust the worktree's
// current **Lane Status** text alone — the instant a poll read anything
// other than "running", it finalized the dispatch. But the agent doing the
// actual work can transiently write a different value mid-session (e.g.
// while investigating something unrelated) without having actually exited.
//
// Caught live while dogfooding: track 1102's implement dispatch got marked
// 'done' and the DB pushed to a stale resolved state while the underlying
// claude process (confirmed via a live PID with the log file still open)
// kept working for several more minutes — the agent's own session even
// self-corrected by writing Lane Status: running back and committing
// "reclaim after premature review advance".
//
// Fix: reconcileActiveDispatch() now checks runningTrackMap first —
// spawnCli's own proc.on('exit') handler is the ONLY thing that ever
// removes an entry from it, so if this process's own spawned child for a
// track is still in there, the CLI genuinely hasn't exited yet, regardless
// of what the file currently says. This is timing-independent (no poll
// count to race against): a track stays protected for as long as its real
// process is alive, however long that transient blip lasts.
//
// Run: node --test conductor/tests/track-10020-reconcile-premature-finalize.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10020-reconcile');

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

const trackDir = join(TMP, 'conductor/tracks/001-test-track');
const indexPath = join(trackDir, 'index.md');

function writeLaneStatus(status) {
  const content = readFileSync(indexPath, 'utf8').replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, `**Lane Status**: ${status}`);
  writeFileSync(indexPath, content, 'utf8');
}

// Mirrors what the agent's own in-session commands (e.g. /laneconductor
// pulse, or a conv-command) push directly to the collector — the file-only
// write above can otherwise get silently overwritten by the worker's own
// periodic DB->FS pull before reconcileActiveDispatch ever reads it, since
// the DB side still holds the claim-time 'running' value. Pushing both
// mirrors how a real agent's transient status write actually sticks.
async function pushLaneActionStatus(port, trackNumber, status) {
  await fetch(`http://127.0.0.1:${port}/track/${trackNumber}/action`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lane_action_status: status }),
  });
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

  mkdirSync(trackDir, { recursive: true });
  writeFileSync(indexPath, [
    '# Track 001: Test Track',
    '',
    '**Lane**: implement',
    '**Lane Status**: queue',
    '**Progress**: 0%',
    '',
    '## Problem',
    'Test problem.',
  ].join('\n'));
}

describe('Track 10020: reconcileActiveDispatch must not finalize on a transient non-"running" marker', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });

    setupProject(collectorPort);

    // LC_SKIP_GIT_LOCK: no real worktree ceremony needed — this test is
    // purely about reconcileActiveDispatch's own completion-detection
    // logic, not the worktree lifecycle. MOCK_CLI_DELAY_MS is generous
    // (3s) so there's plenty of room to write a transient blip and let it
    // sit for well over a naive single-poll window before the real
    // process actually exits.
    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_SKIP_GIT_LOCK: '1',
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        MOCK_CLI_DELAY_MS: '4000',
        MOCK_CLI_PROGRESS_INTERVAL_MS: '300',
        LC_DISPATCH_POLL_MS: '300',
        LC_RECONCILE_ACTIVE_POLL_MS: '300',
      },
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

  it('stays claimed through a transient blip, and only finalizes once the real process actually exits', async () => {
    const state0 = await poll(async () => {
      const s = await getState(collectorPort);
      return s.workers.length > 0 ? s : null;
    }, { label: 'worker registered' });
    const workerId = state0.workers[0].id;

    await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'implement', track_number: '001' });

    // Wait until the dispatch is claimed and spawnCli has written "running".
    await poll(async () => {
      const content = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
      return /\*\*Lane Status\*\*:\s*running/i.test(content) ? true : null;
    }, { label: 'dispatch claimed and marked running' });

    // Simulate the agent transiently writing something else mid-session —
    // the real mock CLI is still sleeping (4s delay), nowhere near exit.
    writeLaneStatus('success');
    await pushLaneActionStatus(collectorPort, '001', 'success');

    // reconcileActiveDispatch ticks every 300ms here (LC_RECONCILE_ACTIVE_POLL_MS)
    // — 1.5s comfortably spans several ticks, well beyond what a single-read
    // implementation would have needed to wrongly finalize this.
    await sleep(1500);
    let mid = await getState(collectorPort);
    let entry = mid.dispatch.find(e => e.action === 'implement');
    assert.equal(entry.status, 'claimed', 'must NOT finalize while the real spawned process is still alive, even after a sustained transient blip spanning several reconcile ticks');

    // Simulate the agent going back to real work.
    writeLaneStatus('running');
    await sleep(1000);
    mid = await getState(collectorPort);
    entry = mid.dispatch.find(e => e.action === 'implement');
    assert.equal(entry.status, 'claimed', 'still claimed — the real process has not exited yet');

    // Now let the mock CLI actually exit (delay elapses at 3s from spawn;
    // comfortably past that point by now) and confirm real completion is
    // still correctly detected afterward.
    const finalState = await poll(async () => {
      const s = await getState(collectorPort);
      const d = s.dispatch.find(e => e.action === 'implement');
      return d && d.status !== 'claimed' ? s : null;
    }, { timeout: 15000, label: 'dispatch resolves once the real process exits' });

    const finalEntry = finalState.dispatch.find(e => e.action === 'implement');
    assert.equal(finalEntry.status, 'done', 'the real exit must still be detected and reported correctly');
  });
});
