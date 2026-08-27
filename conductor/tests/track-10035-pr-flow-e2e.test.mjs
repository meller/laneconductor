#!/usr/bin/env node
// conductor/tests/track-10035-pr-flow-e2e.test.mjs
// Track 10035 Phase 3: subprocess-level E2E for the done-lane merge
// action's pr-mode path (REQ-5/REQ-7), superseding
// track-10018-pr-flow-e2e.test.mjs (deleted — it exercised the one-shot
// in-process PR-open side effect this track removed; opening the PR is now
// the done-lane merge action's own job, run through the identical
// worker→spawn→claim path as every other lane).
//
// Drives a REAL spawned laneconductor.sync.mjs worker through:
//   quality-gate:queue → done:queue (mock CLI exit 0)
//   done:queue → done:waiting (mock CLI shells out to the REAL
//     `lc worktrees create-pr` — push + `gh pr create` against a mock gh —
//     then self-reports **Lane Status**: waiting, exactly as SKILL.md's
//     merge command step 5 documents)
//   simulated GitHub merge → reconcilePrTracks flips done:waiting to
//     done:success (REQ-7, new in this track) and cleans up the worktree
//     + local branch (pre-existing cleanup, unaffected by this track)
//
// Uses a real bare-origin + clone git fixture (same pattern as
// track-1112-git-divergence.test.mjs) so `git push -u origin track-N` has
// somewhere real to push to, and a scriptable mock `gh` on PATH
// (mock-gh.mjs) so no real GitHub API is ever touched.
//
// Run: node --test conductor/tests/track-10035-pr-flow-e2e.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const MOCK_GH = join(__dirname, 'mock-gh.mjs');
const BASE = join(ROOT, '.test-tmp-track-10035-pr-flow-e2e');
const ORIGIN = join(BASE, 'origin.git');
const LOCAL = join(BASE, 'local'); // stands in for the primary checkout the worker runs from
const GH_BIN_DIR = join(BASE, 'gh-bin');
const GH_SCRIPT_PATH = join(BASE, 'mock-gh-script.json');
const TRACK_NUM = '19980'; // fake, distinct from every other test file's fixture range
const TRACK_DIR_NAME = `${TRACK_NUM}-pr-flow-e2e`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function git(cmd, cwd) {
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

function writeGhScript(script) {
  writeFileSync(GH_SCRIPT_PATH, JSON.stringify(script, null, 2));
}

function primaryIndexPath() {
  return join(LOCAL, 'conductor/tracks', TRACK_DIR_NAME, 'index.md');
}

function setupFixture(collectorPort) {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(BASE, { recursive: true });

  git(`init -q --bare "${ORIGIN}"`);
  // Explicitly point the bare repo's HEAD at `main` before anything else —
  // an empty bare repo has no default branch to report, and getMainBranch()
  // would otherwise cache a garbage value for the worker's whole lifetime.
  git(`symbolic-ref HEAD refs/heads/main`, ORIGIN);
  git(`clone -q "${ORIGIN}" "${LOCAL}"`, BASE);
  git('config user.email t@t', LOCAL);
  git('config user.name t', LOCAL);

  writeFileSync(join(LOCAL, 'README.md'), 'init\n');
  // Mirrors the real repo's .gitignore (`*.log` covers conductor/logs/,
  // `.worktrees/` covers per-track worktrees) — without these, the
  // dirty-checkout guard (workspace-mode.mjs) sees the worker's own
  // per-spawn log files as untracked paths outside the track's own folder
  // and blocks every main-mode spawn, which is a real gitignore-fixture
  // gap here, not a production bug (the real repo's .gitignore already
  // covers both).
  writeFileSync(join(LOCAL, '.gitignore'), '.worktrees/\n*.log\n');
  git('add -A', LOCAL);
  git('commit -q -m init', LOCAL);
  git('branch -m main', LOCAL);
  git('push -q -u origin main', LOCAL);

  // .laneconductor.json — mode MUST be local-api (or remote-api): the
  // worktree-lifecycle block this test exercises is gated on
  // `!getIsLocalFs()` (laneconductor.sync.mjs's spawnCli/exit-handler).
  writeFileSync(join(LOCAL, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'pr-flow-e2e', id: 1, repo_path: LOCAL, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(LOCAL, 'conductor/tracks'), { recursive: true });
  // Mirrors conductor/workflow.json's real shape (Track 10035 Phase 1):
  // quality-gate hands off to done:queue, 'done' is a normal lane action
  // config (claimable, standard retries) with no on_success (a plain
  // success stays in 'done' with status 'success' — resolveTransition's
  // !configValue branch — which the pr-mode merge action never reaches on
  // its own; it always self-reports 'waiting' instead, per SKILL.md).
  writeFileSync(join(LOCAL, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1 },
    lanes: {
      'quality-gate': { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: 'done:queue', on_failure: 'review:queue' },
      done: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_failure: 'done:failure' },
    },
  }, null, 2));

  // Seed the track directly at quality-gate:queue, no **Merge Mode**
  // marker — resolveMergeMode() defaults an absent marker to 'pr'
  // (spec.md REQ-2), which is exactly the path this test exercises.
  // **Auto Run**: yes — both quality-gate and the done-lane merge action
  // must be auto-claimable for this test to drive the whole loop
  // unattended (track 10017's gate).
  const trackDir = join(LOCAL, 'conductor/tracks', TRACK_DIR_NAME);
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    `# Track ${TRACK_NUM}: PR Flow E2E`,
    '',
    '**Lane**: quality-gate',
    '**Lane Status**: queue',
    '**Progress**: 90%',
    '**Auto Run**: yes',
    '',
    '## Problem',
    'Test problem.',
    '',
    '## Solution',
    'Test solution.',
  ].join('\n'));
  git('add -A', LOCAL);
  git('commit -q -m "seed track"', LOCAL);
  git('push -q origin main', LOCAL);

  // Mock `gh` on PATH: a symlink literally named `gh` pointing at
  // mock-gh.mjs — extension doesn't matter for PATH lookup on Unix, only
  // the basename does.
  mkdirSync(GH_BIN_DIR, { recursive: true });
  chmodSync(MOCK_GH, 0o755);
  const ghShimPath = join(GH_BIN_DIR, 'gh');
  rmSync(ghShimPath, { force: true });
  symlinkSync(MOCK_GH, ghShimPath);

  writeGhScript({
    'auth status': { exitCode: 0 },
    'pr create': { stdout: 'https://github.com/example/repo/pull/778', exitCode: 0 },
    'pr view': { stdout: JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN', statusCheckRollup: [] }), exitCode: 0 },
    'pr merge': { exitCode: 0 },
  });
}

function startWorker(extraEnv = {}) {
  const newPath = `${GH_BIN_DIR}:${process.env.PATH}`;
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: LOCAL,
    env: {
      ...process.env,
      PATH: newPath,
      LC_MOCK_CLI: `node ${MOCK_CLI}`,
      MOCK_CLI_EXIT_CODE: '0',
      MOCK_CLI_DELAY_MS: '200',
      MOCK_GH_SCRIPT_PATH: GH_SCRIPT_PATH,
      LC_RECONCILE_INTERVAL_MS: '500',
      // Track 10035: the done-lane 'merge' invocation actually runs
      // `lc worktrees create-pr` for real (against the mock gh above),
      // then self-reports done:waiting — see mock-cli.mjs's own comment.
      MOCK_CLI_RUN_LC_CREATE_PR: '1',
      MOCK_CLI_WRITE_LANE_STATUS: 'waiting',
      // Deliberately NOT setting LC_SKIP_GIT_LOCK — this is the one test
      // in the suite that must exercise the real lock/worktree lifecycle.
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

describe('Track 10035 Phase 3: done-lane merge action pr-mode E2E', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    ({ proc: collectorProc, port: collectorPort } = await startMockCollector());
  });

  after(() => {
    collectorProc?.kill('SIGTERM');
    rmSync(BASE, { recursive: true, force: true });
  });

  it('TC-3.1/3.2: quality-gate hands off to done:queue, the merge action opens a real PR and lands at done:waiting, and a GitHub merge converges to done:success + cleanup', async () => {
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupFixture(collectorPort);

    worker = startWorker();
    try {
      // ── Phase A: quality-gate passes → done:queue (no PR yet — the merge
      // action, not quality-gate, is what opens it now) ────────────────────
      await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks[TRACK_NUM];
        return (t?.lane_status === 'done' && t?.lane_action_status === 'queue') ? t : null;
      }, { label: 'quality-gate → done:queue', timeout: 20000 });

      // ── Phase B: the done-lane merge action claims done:queue, opens a
      // real PR via mock gh, and lands at done:waiting ─────────────────────
      const afterPr = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks[TRACK_NUM];
        return t?.pr_status === 'open' ? t : null;
      }, { label: 'pr_status → open (merge action opened a PR via mock gh)', timeout: 30000 });

      assert.equal(afterPr.pr_number, 778, 'pr_number synced to the collector');
      assert.equal(afterPr.pr_url, 'https://github.com/example/repo/pull/778', 'pr_url synced to the collector');
      assert.equal(afterPr.lane_status, 'done');
      assert.equal(afterPr.lane_action_status, 'waiting', 'REQ-5: a pr-mode merge run that opened a PR lands at done:waiting, not done:success');

      // Real state, not code review: the branch is actually on the fixture's
      // real origin — a plain `git ls-remote` proves the push really ran.
      const remoteRef = git(`ls-remote origin refs/heads/track-${TRACK_NUM}`, LOCAL);
      assert.ok(remoteRef.length > 0, `track-${TRACK_NUM} must exist on the real origin after create-pr's push`);

      // No local merge — pr-mode never merges locally, only a human (or
      // GitHub) merging the PR does.
      const localMainSha = git('rev-parse main', LOCAL);
      const trackTipSha = git(`rev-parse track-${TRACK_NUM}`, LOCAL);
      assert.notEqual(localMainSha, trackTipSha, 'local main must not have been fast-forwarded/merged to the track branch');

      // ── Phase C: simulate GitHub reporting the PR merged ─────────────────
      // Mirrors what a real GitHub merge does: the merge commit lands on
      // origin's main. Done here by merging+pushing from LOCAL directly.
      git('add -A', LOCAL);
      git('-c user.email=t@t -c user.name=t commit -q -m "wip: worker-written status before simulated merge" --allow-empty', LOCAL);
      git('checkout -q main', LOCAL);
      git(`merge -q --no-ff -X ours track-${TRACK_NUM} -m "merge track-${TRACK_NUM}"`, LOCAL);
      git('push -q origin main', LOCAL);

      writeGhScript({
        'auth status': { exitCode: 0 },
        'pr create': { stdout: 'https://github.com/example/repo/pull/778', exitCode: 0 },
        'pr view': { stdout: JSON.stringify({ state: 'MERGED', mergeStateStatus: 'CLEAN', statusCheckRollup: [] }), exitCode: 0 },
        'pr merge': { exitCode: 0 },
      });

      // ── Phase D: REQ-7 — reconciler flips done:waiting → done:success ────
      const afterMerge = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks[TRACK_NUM];
        return t?.pr_status === 'merged' ? t : null;
      }, { label: 'pr_status → merged (reconcilePrTracks picked up the MERGED poll)', timeout: 15000 });
      assert.equal(afterMerge.pr_status, 'merged');
      assert.equal(afterMerge.lane_action_status, 'success', 'REQ-7: a merged PR must flip the track to done:success, not leave it at waiting');

      const finalIndex = readFileSync(primaryIndexPath(), 'utf8');
      assert.match(finalIndex, /\*\*Lane Status\*\*:\s*success/i, 'the primary checkout\'s own index.md must reflect done:success');

      // Cleanup: worktree removed, local branch deleted (real ancestor of
      // main by now — see the merge above).
      await poll(async () => {
        const worktreeGone = !existsSync(join(LOCAL, '.worktrees', TRACK_NUM));
        let branchGone = false;
        try { git(`rev-parse --verify --quiet refs/heads/track-${TRACK_NUM}`, LOCAL); }
        catch { branchGone = true; }
        return (worktreeGone && branchGone) ? true : null;
      }, { label: 'worktree removed + local branch deleted after merge cleanup', timeout: 15000 });
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('TC-3.3/AC-5: a conflicted PR sends the track back to done:queue with a system comment, and the next merge run reaches done:waiting again', async () => {
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupFixture(collectorPort);

    worker = startWorker();
    try {
      // ── Phase A: reach done:waiting with an open PR, same as the happy path ──
      await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks[TRACK_NUM];
        return t?.pr_status === 'open' ? t : null;
      }, { label: 'pr_status → open', timeout: 30000 });

      // ── Phase B: GitHub now reports the PR conflicted with main ──────────
      writeGhScript({
        'auth status': { exitCode: 0 },
        'pr create': { stdout: 'https://github.com/example/repo/pull/778', exitCode: 0 },
        'pr view': { stdout: JSON.stringify({ state: 'OPEN', mergeStateStatus: 'DIRTY', statusCheckRollup: [] }), exitCode: 0 },
        'pr merge': { exitCode: 0 },
      });

      const afterConflict = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks[TRACK_NUM];
        return t?.pr_status === 'conflicted' ? t : null;
      }, { label: 'pr_status → conflicted (reconcilePrTracks picked up the DIRTY poll)', timeout: 15000 });

      // REQ-7: conflicted sends the track back to done:queue, not done:success.
      assert.equal(afterConflict.lane_status, 'done');
      await poll(async () => {
        const s = await getState(collectorPort);
        return s.tracks[TRACK_NUM]?.lane_action_status === 'queue' ? true : null;
      }, { label: 'lane_action_status → queue after conflict', timeout: 10000 });

      const conflictedIndex = readFileSync(primaryIndexPath(), 'utf8');
      assert.match(conflictedIndex, /\*\*Lane Status\*\*:\s*queue/i, "the primary checkout's own index.md must reflect done:queue after a conflict");
      const conversation = readFileSync(join(LOCAL, 'conductor/tracks', TRACK_DIR_NAME, 'conversation.md'), 'utf8');
      assert.match(conversation, /> \*\*system\*\*: ⚠️ PR conflicted/, 'a system comment must explain why the track went back to queue');

      // ── Phase C: GitHub reports the conflict resolved (mergeable again) —
      // the standard retry (Auto Run: yes) reclaims done:queue and the merge
      // action re-runs, reaching done:waiting again. No separate "resolve
      // conflict" code path — this is the same merge action, same as any
      // other retry. ────────────────────────────────────────────────────────
      writeGhScript({
        'auth status': { exitCode: 0 },
        'pr create': { stdout: 'https://github.com/example/repo/pull/778', exitCode: 0 },
        'pr view': { stdout: JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN', statusCheckRollup: [] }), exitCode: 0 },
        'pr merge': { exitCode: 0 },
      });

      await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks[TRACK_NUM];
        return t?.lane_action_status === 'waiting' ? t : null;
      }, { label: 're-run reaches done:waiting again', timeout: 20000 });

      const finalIndex = readFileSync(primaryIndexPath(), 'utf8');
      assert.match(finalIndex, /\*\*Lane Status\*\*:\s*waiting/i);
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });
});
