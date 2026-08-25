#!/usr/bin/env node
// conductor/tests/track-1119-global-main-mode-lock.test.mjs
//
// Dogfooding session 2026-08-25: main mode has no worktree — the session
// runs directly in the primary checkout, sharing one working directory
// with ANY OTHER concurrently-running main-mode session. checkAndClaimGitLock
// already prevents two sessions from claiming the SAME track, but that's
// scoped per-track — it does nothing to stop two DIFFERENT main-mode
// tracks from running at once. Confirmed live: one main-mode session's own
// file operations deleted a second, unrelated main-mode track's
// uncommitted folder mid-run, purely from both being active simultaneously
// with zero isolation between them.
//
// checkAndClaimGlobalMainModeLock() makes "at most one main-mode session
// at a time" an actual invariant. This test proves it directly: two
// tracks, both forced into main mode (the `plan` lane ALWAYS resolves to
// main — D5 row 1, unconditional, no marker needed), dispatched at
// essentially the same instant. Asserts their mock-CLI invocations never
// overlap in wall-clock time, and that both still reach a terminal state
// (the lock must not cause either to hang forever).
//
// Run: node --test conductor/tests/track-1119-global-main-mode-lock.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-1119-global-main-mode-lock');
const ARGV_LOG = join(TMP, 'argv.log');
const DELAY_MS = 600;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function poll(fn, { timeout = 20000, interval = 250, label = '' } = {}) {
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
async function getState(port) { return (await fetch(`http://127.0.0.1:${port}/_state`)).json(); }
async function enqueueDispatch(port, entry) {
  const r = await fetch(`http://127.0.0.1:${port}/_enqueue-dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) });
  return (await r.json()).id;
}

function writeTrack(dir, num, title) {
  const trackDir = join(TMP, `conductor/tracks/${num}-${title}`);
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    `# Track ${num}: ${title}`,
    '',
    '**Lane**: plan', // D5 row 1: plan is ALWAYS main mode, unconditionally — no marker needed
    '**Lane Status**: queue',
    '**Progress**: 0%',
    '',
    '## Problem',
    'Test problem.',
  ].join('\n'));
}

function setupProject(collectorPort) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execSync('git init -q', { cwd: TMP });
  // Mirror the real repo's .gitignore for the paths the lock machinery
  // itself writes to (.conductor/locks/*, conductor/logs/*.log). Without
  // this the fixture's git status --porcelain sees those as untracked
  // dirty paths that the real repo never would, and the (correctly
  // functioning) dirty-checkout guard false-positives on the lock file's
  // own existence — blocking the SECOND track's dispatch for a reason
  // that has nothing to do with the lock behavior under test.
  writeFileSync(join(TMP, '.gitignore'), [
    '.conductor/',
    'conductor/logs/',
    '*.log',
    'conductor/tracks-metadata.json',
    'conductor/tracks/**/conversation.md',
    'conductor/tracks/**/conversation.json',
    '.conv-cursor',
    '',
  ].join('\n'));
  execSync('git add -A', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: TMP });
  execSync('git branch -M main', { cwd: TMP });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 2, max_retries: 1, primary_model: 'mock' },
    lanes: { plan: { parallel_limit: 2, max_retries: 1 } }, // parallel_limit 2: this test exists BECAUSE the app-level limit doesn't stop main-mode collisions
  }, null, 2));

  writeTrack(TMP, '901', 'first-track');
  writeTrack(TMP, '902', 'second-track');

  // The main-mode dirty-checkout guard must see a CLEAN tree at test
  // start, or every dispatch attempt fails before ever reaching the lock
  // this test actually exercises.
  execSync('git add -A', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m "seed fixture"', { cwd: TMP });
}

describe('Track 1119: global main-mode lock prevents two concurrent main-mode sessions', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc; collectorPort = c.port;
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(collectorPort);

    // Deliberately NOT LC_SKIP_GIT_LOCK — this test exists to exercise the
    // real lock acquisition path.
    worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        MOCK_CLI_DELAY_MS: String(DELAY_MS),
        MOCK_CLI_ARGV_LOG: ARGV_LOG,
        LC_DISPATCH_POLL_MS: '150',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
    worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  });

  after(() => { worker?.kill(); collectorProc?.kill(); rmSync(TMP, { recursive: true, force: true }); });

  it('serializes two concurrently-dispatched main-mode tracks — no overlapping subprocess execution, both still finish', async () => {
    const state0 = await poll(async () => { const s = await getState(collectorPort); return s.workers.length > 0 ? s : null; });
    const workerId = state0.workers[0].id;

    // Enqueue BOTH at essentially the same instant — this is the actual
    // collision scenario: two main-mode tracks racing to spawn together.
    await Promise.all([
      enqueueDispatch(collectorPort, { worker_id: workerId, action: 'plan', track_number: '901' }),
      enqueueDispatch(collectorPort, { worker_id: workerId, action: 'plan', track_number: '902' }),
    ]);

    // Both dispatches must eventually resolve (done or failed-and-retried
    // by a later cycle) — the lock must not deadlock either one.
    const resolvedState = await poll(async () => {
      const s = await getState(collectorPort);
      const d901 = s.dispatch.find(e => e.track_number === '901' && e.action === 'plan');
      const d902 = s.dispatch.find(e => e.track_number === '902' && e.action === 'plan');
      const resolved = d => d && d.status !== 'pending' && d.status !== 'claimed';
      return (resolved(d901) && resolved(d902)) ? s : null;
    }, { timeout: 20000, label: 'both initial dispatch attempts resolve one way or another' });

    // The lock's contract is "at most one main-mode session at a time,"
    // NOT "every collision magically self-heals." Whichever track loses
    // the race gets a clean, conservative stop — same as every other
    // workspace-guard block this session (dirty-checkout, etc): it's
    // reverted to queue with a comment explaining why, and needs a fresh
    // dispatch to actually retry. This harness has no auto-queue poller,
    // so simulate that retry explicitly, exactly the way a human or the
    // manager worker would re-trigger it.
    const loserResult = resolvedState.dispatch.find(
      e => (e.track_number === '901' || e.track_number === '902') && e.action === 'plan' && /blocked by global lock/.test(e.result || '')
    );
    if (loserResult) {
      await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'plan', track_number: loserResult.track_number });
      await poll(async () => {
        const s = await getState(collectorPort);
        const retried = s.dispatch.find(e => e.track_number === loserResult.track_number && e.action === 'plan' && e.id !== loserResult.id);
        return (retried && retried.status !== 'pending' && retried.status !== 'claimed') ? true : null;
      }, { timeout: 20000, label: `retried dispatch for track ${loserResult.track_number} (the one blocked by the lock) resolves` });
    }

    // The real proof: read the mock-CLI's own argv log and confirm no two
    // invocations overlapped in wall-clock time. If the lock didn't work,
    // both mock-cli processes would start within milliseconds of each
    // other (they were enqueued together); with the lock, the second
    // must not start until DELAY_MS after the first started.
    const invocations = existsSync(ARGV_LOG)
      ? readFileSync(ARGV_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      : [];
    assert.ok(invocations.length >= 1, 'at least one mock-CLI invocation must have actually run');

    if (invocations.length >= 2) {
      const sorted = [...invocations].sort((a, b) => a.at - b.at);
      for (let i = 1; i < sorted.length; i++) {
        const prevEnd = sorted[i - 1].at + DELAY_MS;
        assert.ok(
          sorted[i].at >= prevEnd - 50, // small tolerance for scheduling jitter
          `invocation ${i} started at ${sorted[i].at}, before the previous one's own ${DELAY_MS}ms run finished at ${prevEnd} — main-mode sessions overlapped`
        );
      }
    }

    // Eventually both tracks' own lane files must show real progress, not
    // stuck reverted-to-queue forever.
    await poll(async () => {
      const c901 = readFileSync(join(TMP, 'conductor/tracks/901-first-track/index.md'), 'utf8');
      const c902 = readFileSync(join(TMP, 'conductor/tracks/902-second-track/index.md'), 'utf8');
      const bothAdvanced = /\*\*Lane Status\*\*:\s*success/i.test(c901) && /\*\*Lane Status\*\*:\s*success/i.test(c902);
      return bothAdvanced ? true : null;
    }, { timeout: 20000, label: 'both tracks eventually reach Lane Status: success (may take a retry cycle for whichever lost the race)' });
  });
});
