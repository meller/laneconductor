#!/usr/bin/env node
// conductor/tests/track-1102-f21-mid-run-doc-sync-clobber.test.mjs
// Track 1102 F21 (escalated variant): a lane-action dispatch must not be
// closed out while the spawned CLI child is still alive and working.
//
// Root cause: syncWorktreeDocsToPrimary() (added by track 10019 Phase 4,
// runs every 60s for every live worktree, deliberately including
// actively-locked ones) merges the WORKTREE's own index.md markers —
// including **Lane**/**Lane Status** — onto the PRIMARY checkout's copy via
// copyWorktreeArtifactsToPrimary() -> mergeIndexMarkers(). The worktree's
// own index.md Lane Status is ONLY ever written by the exit handler, at the
// very end of a run (see worktree-artifact-merge.mjs's own comment).
//
// For a brand-new worktree this is safe: checkAndClaimGitLock() commits
// primary's "running" write to git BEFORE createWorktree() runs, so a fresh
// `git worktree add ... HEAD` checkout already has "running" baked in. But
// createWorktree() REUSES an existing worktree outright when
// worktree_lifecycle is 'per-cycle' and the directory already exists (the
// normal case for a track's 2nd+ lane action — e.g. review, then
// quality-gate, both against the same worktree) — that reuse path never
// touches the worktree's files at all. The reused worktree's index.md is
// still sitting at whatever the PREVIOUS cycle's exit handler last wrote
// (e.g. "success" from the review run) — not "running" — for the entire
// new dispatch, until ITS OWN exit handler runs at the end. Any mid-run
// doc-sync tick in between merges that stale, previous-cycle status onto
// primary, clobbering the "running" marker the current dispatch just wrote,
// and immediately pushes it to the DB via syncTrack(). The next
// reconcileActiveDispatch() tick then sees a non-"running" status on
// primary and closes the dispatch as done — while the real child process
// (this dispatch's own agent) is still running.
//
// Live incident: track 10019's review AND quality-gate dispatches (2026-08-19)
// — both closed with the generic "lane status: queue" result while the
// `claude` process (with its Playwright MCP session) was confirmed still
// alive in the worktree, git lock still legitimately held. Both dispatches
// ran against the track's one persistent per-cycle worktree — exactly this
// reuse path.
//
// This test reproduces the mechanism with a real worktree-based dispatch:
// pre-create the worktree (as if left over from a prior cycle) with a
// deliberately stale, non-"running" Lane Status, then dispatch a new lane
// action against the same track and confirm a still-running mock CLI
// survives several doc-sync ticks without the dispatch being prematurely
// closed.
//
// Run: node --test conductor/tests/track-1102-f21-mid-run-doc-sync-clobber.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');

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

async function getState(port) {
  const r = await fetch(`http://127.0.0.1:${port}/_state`);
  return r.json();
}

function killAndWait(proc) {
  return new Promise(resolve => {
    if (!proc || proc.exitCode !== null || (proc.killed && proc.exitCode !== null)) return resolve();
    proc.once('exit', resolve);
    proc.kill();
    setTimeout(resolve, 3000);
  });
}

async function enqueueDispatch(port, entry) {
  const r = await fetch(`http://127.0.0.1:${port}/_enqueue-dispatch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
  });
  return (await r.json()).id;
}

function setupProject(tmpDir, collectorPort) {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  execSync('git init -q', { cwd: tmpDir });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: tmpDir });

  // NOTE: mode 'local-api' and no LC_SKIP_GIT_LOCK — this test needs REAL
  // git-lock/worktree creation, since the bug lives entirely in the
  // worktree<->primary doc-sync path, which local-fs / LC_SKIP_GIT_LOCK
  // bypass entirely.
  writeFileSync(join(tmpDir, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'test-project', id: 1, repo_path: tmpDir, primary: { cli: 'mock', model: 'mock' }, worktree_lifecycle: 'per-cycle' },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(tmpDir, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(tmpDir, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: { plan: { parallel_limit: 1, max_retries: 1 } },
  }, null, 2));

  const trackDir = join(tmpDir, 'conductor/tracks/001-test-track');
  mkdirSync(trackDir, { recursive: true });
  // Realistically sized (>=10 lines) — copyWorktreeArtifactsToPrimary's
  // shrink guard treats a <10-line index.md as "suspicious" and skips the
  // merge outright regardless of this bug, which would silently mask the
  // very thing this test exists to catch. Real track index.md files are
  // never this small.
  writeFileSync(join(trackDir, 'index.md'), [
    '# Track 001: Test Track', '',
    '**Lane**: plan', '**Lane Status**: queue', '**Progress**: 0%',
    '**Phase**: Planning', '**Summary**: A realistically-sized fixture track for the F21 regression test',
    '', '## Problem', 'Some description of the problem this track addresses, spread across a couple of lines',
    'so the file is long enough to look like a real track document instead of a bare-minimum stub.',
    '', '## Solution', '[Empty — awaiting scaffolding]',
    '', '## Phases', '- [ ] Phase 1: Planning',
  ].join('\n'));

  execSync('git add -A', { cwd: tmpDir });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m init2', { cwd: tmpDir });
}

// Simulates a worktree left over from a track's PRIOR lane-action cycle
// (e.g. a finished "review" run) that a later dispatch (e.g.
// "quality-gate") will reuse verbatim, per createWorktree()'s per-cycle
// reuse short-circuit. Its index.md deliberately does NOT say "running" —
// that's the whole point: nothing updates it until ITS OWN exit handler
// runs, which for THIS test never happens (the worktree is never actually
// worked in), so it stays stuck at this stale value for the mid-run
// doc-sync to (wrongly) propagate onto primary.
function preCreateReusedWorktree(tmpDir, trackNumber) {
  const wtPath = join(tmpDir, '.worktrees', trackNumber);
  execSync(`git worktree add -B track-${trackNumber} "${wtPath}" HEAD`, { cwd: tmpDir });
  const wtIndexPath = join(wtPath, 'conductor/tracks/001-test-track/index.md');
  writeFileSync(wtIndexPath, [
    '# Track 001: Test Track', '',
    '**Lane**: plan', '**Lane Status**: success', '**Progress**: 100%',
    '**Phase**: Planning', '**Summary**: Stale copy left over from a prior lane-action cycle',
    '', '## Problem', 'Some description of the problem this track addresses, spread across a couple of lines',
    'so the file is long enough to look like a real track document instead of a bare-minimum stub.',
    '', '## Solution', '[Empty — awaiting scaffolding]',
    '', '## Phases', '- [ ] Phase 1: Planning',
  ].join('\n'), 'utf8');
}

describe('Track 1102 F21: mid-run doc-sync must not close a dispatch whose CLI child is still alive', () => {
  let collectorProc, collectorPort;

  before(async () => {
    const c = await startMockCollector();
    collectorProc = c.proc;
    collectorPort = c.port;
  });

  after(() => {
    collectorProc?.kill();
  });

  it('a still-running worktree dispatch survives multiple mid-run doc-sync ticks, then completes normally', async () => {
    const TMP = join(ROOT, '.test-tmp-track-1102-f21');
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupProject(TMP, collectorPort);
    preCreateReusedWorktree(TMP, '001');

    const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs'), '--sync-only'], {
      cwd: TMP,
      env: {
        ...process.env,
        LC_MOCK_CLI: `node ${MOCK_CLI}`,
        LC_SPAWN_TIMEOUT_MS: '60000',       // comfortably above this test's whole run — F11's keepalive killer must not fire
        MOCK_CLI_DELAY_MS: '10000',         // the "CLI" stays alive for 10s, touching nothing in its own worktree
        LC_DOC_SYNC_INTERVAL_MS: '500',     // several doc-sync ticks well within the 10s run
        LC_DISPATCH_POLL_MS: '500',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let workerOutput = '';
    worker.stdout.on('data', d => { workerOutput += d.toString(); process.stdout.write(`[worker] ${d}`); });
    worker.stderr.on('data', d => { workerOutput += d.toString(); process.stderr.write(`[worker] ${d}`); });

    const indexPath = join(TMP, 'conductor/tracks/001-test-track/index.md');

    try {
      const state0 = await poll(async () => {
        const s = await getState(collectorPort);
        return s.workers.length > 0 ? s : null;
      }, { label: 'worker registered' });
      const workerId = state0.workers[0].id;

      const dispatchId = await enqueueDispatch(collectorPort, { worker_id: workerId, action: 'plan', track_number: '001' });

      await poll(async () => {
        const s = await getState(collectorPort);
        const entry = s.dispatch.find(d => d.id === dispatchId);
        return entry?.status === 'claimed' ? s : null;
      }, { label: 'dispatch claimed' });

      // Real agents routinely touch their OWN worktree's index.md mid-run
      // (e.g. bumping **Progress**) without ever touching **Lane Status** —
      // that field is understood to be the exit handler's exclusively. Any
      // such edit bumps the worktree file's mtime past whenever primary's
      // "running" write landed, which is what makes copyWorktreeArtifactsToPrimary's
      // skipUnchanged staleness guard let the (still Lane-Status-stale) merge
      // through. Simulate exactly that one, ordinary mid-run edit — no mock
      // CLI can produce it on its own since it never touches index.md.
      const wtIndexPath = join(TMP, '.worktrees', '001', 'conductor/tracks/001-test-track/index.md');
      await poll(async () => existsSync(wtIndexPath) || null, { label: 'worktree index.md exists' });
      await sleep(300); // let the claimed dispatch's own "running" write on primary land first
      const wtContent = readFileSync(wtIndexPath, 'utf8');
      writeFileSync(wtIndexPath, wtContent.replace(/\*\*Progress\*\*:\s*\d+%/i, '**Progress**: 40%'), 'utf8');

      // Give doc-sync several ticks (500ms each) and reconcileActiveDispatch
      // at least one tick (fixed 5s cadence) — all while the mock CLI is
      // still comfortably short of its 10s MOCK_CLI_DELAY_MS and has
      // touched nothing in its own worktree copy of index.md. This is the
      // steady-state every real lane action spends most of its time in.
      await sleep(6500);

      const midRunState = await getState(collectorPort);
      const midRunEntry = midRunState.dispatch.find(d => d.id === dispatchId);
      assert.equal(
        midRunEntry?.status, 'claimed',
        `Dispatch was closed out (status=${midRunEntry?.status}, result=${midRunEntry?.result}) while the CLI child is still running — mid-run doc-sync clobbered the "running" marker on primary's index.md.`
      );

      const midRunContent = readFileSync(indexPath, 'utf8');
      assert.match(
        midRunContent, /\*\*Lane Status\*\*:\s*running/i,
        `Primary's index.md Lane Status was overwritten mid-run (now: ${midRunContent.match(/\*\*Lane Status\*\*:[^\n]*/)?.[0]}) — the periodic doc-sync merged the worktree's stale pre-dispatch marker onto primary.`
      );

      // Let the CLI actually finish and confirm the run completes normally
      // afterward — the fix must not break real end-of-run reporting.
      const finalState = await poll(async () => {
        const s = await getState(collectorPort);
        const entry = s.dispatch.find(d => d.id === dispatchId);
        return (entry?.status === 'done' || entry?.status === 'failed') ? s : null;
      }, { timeout: 15000, label: 'dispatch eventually completes' });

      const finalEntry = finalState.dispatch.find(d => d.id === dispatchId);
      assert.equal(finalEntry.status, 'done');
    } finally {
      await killAndWait(worker);
      rmSync(TMP, { recursive: true, force: true });
    }
  });
});
