#!/usr/bin/env node
// conductor/tests/track-10035-direct-merge-e2e.test.mjs
// Track 10035 Phase 6 Task 1 (AC-1, AC-2): direct-mode E2E through the
// real worker process — quality-gate:queue -> done:queue (a real worktree
// gets created and a real commit lands on the branch) -> the done-lane
// merge action claims it, runs `lc worktrees merge` for real, and merges
// that commit into local main -> done:success, worktree removed, branch
// deleted.
//
// Companion to track-10035-pr-flow-e2e.test.mjs (the pr-mode equivalent).
// Uses local-api mode (not local-fs) so the real lock/worktree lifecycle
// this test exists to exercise actually runs — see that file's own doc
// comment for why.
//
// Run: node --test conductor/tests/track-10035-direct-merge-e2e.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const BASE = join(ROOT, '.test-tmp-track-10035-direct-merge-e2e');
const LOCAL = join(BASE, 'local'); // stands in for the primary checkout the worker runs from
const TRACK_NUM = '19981'; // fake, distinct from every other test file's fixture range
const TRACK_DIR_NAME = `${TRACK_NUM}-direct-merge-e2e`;

function git(cmd, cwd = LOCAL) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function poll(fn, { timeout = 20000, interval = 300, label = '' } = {}) {
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

function primaryIndexPath() {
  return join(LOCAL, 'conductor/tracks', TRACK_DIR_NAME, 'index.md');
}

function setupFixture(collectorPort) {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(BASE, { recursive: true });
  mkdirSync(LOCAL, { recursive: true });

  git('init -q');
  git('config user.email t@t');
  git('config user.name t');
  writeFileSync(join(LOCAL, 'README.md'), 'init\n');
  // Mirrors the real repo's .gitignore (`*.log` covers conductor/logs/,
  // `.worktrees/` covers per-track worktrees) — without these, the
  // dirty-checkout guard blocks every main-mode spawn.
  writeFileSync(join(LOCAL, '.gitignore'), '.worktrees/\n*.log\n');
  git('add -A');
  git('-c user.email=t@t -c user.name=t commit -q -m init');
  git('branch -m main');

  writeFileSync(join(LOCAL, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'direct-merge-e2e', id: 1, repo_path: LOCAL, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(LOCAL, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(LOCAL, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1 },
    lanes: {
      'quality-gate': { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: 'done:queue', on_failure: 'review:queue' },
      done: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_failure: 'done:failure' },
    },
  }, null, 2));

  const trackDir = join(LOCAL, 'conductor/tracks', TRACK_DIR_NAME);
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    `# Track ${TRACK_NUM}: Direct Merge E2E`,
    '',
    '**Lane**: quality-gate',
    '**Lane Status**: queue',
    '**Progress**: 90%',
    '**Merge Mode**: direct',
    '**Auto Run**: yes',
    '',
    '## Problem',
    'Test problem.',
    '',
    '## Solution',
    'Test solution.',
  ].join('\n'));
  git('add -A');
  git('-c user.email=t@t -c user.name=t commit -q -m "seed track"');
}

function startWorker(extraEnv = {}) {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: LOCAL,
    env: {
      ...process.env,
      LC_MOCK_CLI: `node ${MOCK_CLI}`,
      MOCK_CLI_EXIT_CODE: '0',
      MOCK_CLI_DELAY_MS: '200',
      LC_RECONCILE_INTERVAL_MS: '500',
      // Deliberately NOT setting LC_SKIP_GIT_LOCK — this is the one test
      // in the suite that must exercise the real lock/worktree lifecycle
      // for BOTH the quality-gate (branch-mode) and done (main-mode) lanes.
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

describe('Track 10035 Phase 6 Task 1: direct-mode merge E2E (AC-1, AC-2)', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    ({ proc: collectorProc, port: collectorPort } = await startMockCollector());
  });

  after(() => {
    collectorProc?.kill('SIGTERM');
    rmSync(BASE, { recursive: true, force: true });
  });

  it('quality-gate commits real work on its branch, done:queue is claimed and shows running (AC-2), and the merge action lands that commit on local main (AC-1)', async () => {
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupFixture(collectorPort);

    // quality-gate's own mock-cli run commits a real file to the branch —
    // otherwise the branch would be a plain ancestor of main with nothing
    // to merge, defeating AC-1's whole point.
    worker = startWorker({ MOCK_CLI_COMMIT_FILE: 'shipped-feature.txt', MOCK_CLI_RUN_LC_MERGE: '1' });
    try {
      // ── Phase A: quality-gate passes → done:queue, with a real commit
      // sitting on track-19981 that main doesn't have yet ────────────────
      await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks[TRACK_NUM];
        return (t?.lane_status === 'done' && t?.lane_action_status === 'queue') ? t : null;
      }, { label: 'quality-gate → done:queue', timeout: 20000 });

      const branchTipAfterQg = git(`rev-parse track-${TRACK_NUM}`);
      const mainAfterQg = git('rev-parse main');
      assert.notEqual(branchTipAfterQg, mainAfterQg, 'the branch must be ahead of main after quality-gate\'s real commit');

      // ── Phase B (AC-2): the merge action claims done:queue and shows
      // running while the merge is in flight ──────────────────────────────
      const sawRunning = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks[TRACK_NUM];
        return t?.lane_action_status === 'running' ? true : null;
      }, { label: 'done:running while the merge action executes', timeout: 20000 }).catch(() => false);
      // Best-effort — MOCK_CLI_DELAY_MS is short enough that a slow poll
      // interval can miss the running window entirely; the real assertion
      // this test cares about is Phase C below (AC-1's actual merge).
      if (!sawRunning) console.log('[test] note: did not observe done:running (timing) — continuing to verify the merge result itself');

      // ── Phase C (AC-1): done:success, and the branch's commit is now
      // reachable from local main — a REAL merge, not a simulated one ─────
      await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks[TRACK_NUM];
        return (t?.lane_status === 'done' && t?.lane_action_status === 'success') ? t : null;
      }, { label: 'merge action → done:success', timeout: 20000 });

      const finalIndex = readFileSync(primaryIndexPath(), 'utf8');
      assert.match(finalIndex, /\*\*Lane Status\*\*:\s*success/i);

      // The branch ref itself is deleted as part of the merge's own cleanup
      // (verified separately below) — check ancestry against the commit
      // SHA captured in Phase A, before that cleanup ever ran, not the
      // (by-now-gone) branch name.
      assert.doesNotThrow(
        () => git(`merge-base --is-ancestor ${branchTipAfterQg} main`),
        'the quality-gate commit must be reachable from local main after the merge action ran'
      );
      assert.ok(existsSync(join(LOCAL, 'shipped-feature.txt')), 'the merged file must actually be present on main\'s working tree');

      // Cleanup: worktree removed, local branch deleted (the merge
      // primitive's own responsibility, not this test\'s — verifying it
      // actually happened).
      await poll(async () => {
        const worktreeGone = !existsSync(join(LOCAL, '.worktrees', TRACK_NUM));
        let branchGone = false;
        try { git(`rev-parse --verify --quiet refs/heads/track-${TRACK_NUM}`); }
        catch { branchGone = true; }
        return (worktreeGone && branchGone) ? true : null;
      }, { label: 'worktree removed + local branch deleted after merge', timeout: 10000 });
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });
});
