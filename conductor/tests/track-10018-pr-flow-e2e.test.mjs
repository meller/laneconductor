#!/usr/bin/env node
// conductor/tests/track-10018-pr-flow-e2e.test.mjs
// Track 10018 Phase 11: subprocess-level E2E for the real worker-side PR
// flow (openTrackPrOnDone / reconcilePrTracks) — the one gap flagged since
// Phase 6. Those functions are unit-tested against an injected fake `exec`
// (pr-flow.test.mjs, worktree-audit.test.mjs) but never exercised as the
// real orchestration code running inside a spawned laneconductor.sync.mjs
// worker process, the way local-api-e2e.test.mjs already does for the
// ordinary implement/merge path.
//
// Deliberately does NOT set LC_SKIP_GIT_LOCK (unlike every other E2E test
// in this suite) — that's exactly the worktree-lifecycle block this test
// exists to exercise. Uses a real bare-origin + clone git fixture (same
// pattern as track-1112-git-divergence.test.mjs) so `git push -u origin
// track-N` has somewhere real to push to, and a scriptable mock `gh` on
// PATH (mock-gh.mjs, symlinked as `gh` — same shim-directory approach as
// track-10011-gemini-discovery.test.mjs's mock `agy`) so no real GitHub
// API is ever touched.
//
// Run: node --test conductor/tests/track-10018-pr-flow-e2e.test.mjs

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
const BASE = join(ROOT, '.test-tmp-track-10018-pr-flow-e2e');
const ORIGIN = join(BASE, 'origin.git');
const LOCAL = join(BASE, 'local'); // stands in for the primary checkout the worker runs from
const GH_BIN_DIR = join(BASE, 'gh-bin');
const GH_SCRIPT_PATH = join(BASE, 'mock-gh-script.json');
const TRACK_NUM = '19979'; // fake, distinct from every other test file's fixture range
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
  // otherwise `git remote show origin`'s "HEAD branch: (unknown)" (an
  // empty bare repo has no default branch to report) gets parsed by
  // getMainBranch() as if "(unknown)" were a real, valid branch name and
  // CACHED as such for the worker process's entire lifetime (found live:
  // this is exactly what broke cleanupMergedPrTrack's ancestor check the
  // first time this test ran clean — "isn't an ancestor of local
  // (unknown)"). A real GitHub repo always has a real default branch; this
  // fixture needs one too.
  git(`symbolic-ref HEAD refs/heads/main`, ORIGIN);
  git(`clone -q "${ORIGIN}" "${LOCAL}"`, BASE);
  // Local-scoped git identity (not global) — this repo's own commits, and
  // every gitExec() commit the worker makes inside it (e.g. "sync files
  // before worktree"), must succeed without depending on the test
  // machine's global git config.
  git('config user.email t@t', LOCAL);
  git('config user.name t', LOCAL);

  writeFileSync(join(LOCAL, 'README.md'), 'init\n');
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
  writeFileSync(join(LOCAL, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: null, on_failure: null },
    lanes: {
      'quality-gate': { parallel_limit: 1, max_retries: 1, on_success: 'done', on_failure: 'review' },
    },
  }, null, 2));

  // Seed the track directly at quality-gate:queue, no **Merge Mode**
  // marker — resolveMergeMode() defaults an absent marker to 'pr'
  // (spec.md REQ-2), which is exactly the path this test exercises.
  const trackDir = join(LOCAL, 'conductor/tracks', TRACK_DIR_NAME);
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    `# Track ${TRACK_NUM}: PR Flow E2E`,
    '',
    '**Lane**: quality-gate',
    '**Lane Status**: queue',
    '**Progress**: 90%',
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
  // the basename does. Same shim-directory approach
  // track-10011-gemini-discovery.test.mjs uses for a mock `agy`.
  mkdirSync(GH_BIN_DIR, { recursive: true });
  chmodSync(MOCK_GH, 0o755);
  const ghShimPath = join(GH_BIN_DIR, 'gh');
  rmSync(ghShimPath, { force: true });
  symlinkSync(MOCK_GH, ghShimPath);

  writeGhScript({
    'auth status': { exitCode: 0 },
    'pr create': { stdout: 'https://github.com/example/repo/pull/777', exitCode: 0 },
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

describe('Track 10018 Phase 11: subprocess E2E for the real PR flow', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    ({ proc: collectorProc, port: collectorPort } = await startMockCollector());
  });

  after(() => {
    collectorProc?.kill('SIGTERM');
    rmSync(BASE, { recursive: true, force: true });
  });

  it('opens a real PR via the real worker process, never merges locally, then converges to cleanup once gh reports MERGED', async () => {
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupFixture(collectorPort);

    worker = startWorker();
    try {
      // ── Phase A: quality-gate passes → opens a PR, stays unmerged ────────
      const afterPr = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks[TRACK_NUM];
        return t?.pr_status === 'open' ? t : null;
      }, { label: 'pr_status → open (real worker opened a PR via mock gh)', timeout: 30000 });

      assert.equal(afterPr.pr_number, 777, 'pr_number synced to the collector');
      assert.equal(afterPr.pr_url, 'https://github.com/example/repo/pull/777', 'pr_url synced to the collector');
      assert.equal(afterPr.lane_status, 'done', "lane transitions to done as always — pr_status alone carries approval state (Phase 2's documented deviation)");

      // Real state, not code review: the branch is actually on the fixture's
      // real origin — a plain `git ls-remote` proves the push really ran.
      const remoteRef = git(`ls-remote origin refs/heads/track-${TRACK_NUM}`, LOCAL);
      assert.ok(remoteRef.length > 0, `track-${TRACK_NUM} must exist on the real origin after createTrackPr's push`);

      // No local merge — REQ-5/REQ-6: pr-mode never merges locally, only a
      // human (or GitHub) merging the PR does.
      const localMainSha = git('rev-parse main', LOCAL);
      const trackTipSha = git(`rev-parse track-${TRACK_NUM}`, LOCAL);
      assert.notEqual(localMainSha, trackTipSha, 'local main must not have been fast-forwarded/merged to the track branch');
      assert.equal(git(`merge-base --is-ancestor track-${TRACK_NUM} main; echo $?`, LOCAL), '1', 'track branch must NOT be an ancestor of local main yet');

      // ── Phase B: simulate GitHub reporting the PR merged ─────────────────
      // Mirrors what a real GitHub merge does: the merge commit lands on
      // origin's main. Done here by merging+pushing from LOCAL directly
      // (LOCAL shares the same object database/refs as the worker's
      // worktree, so track-${TRACK_NUM} is already a real local ref) —
      // this is what makes the branch a provable ancestor of mainBranch,
      // the precondition cleanupMergedPrTrack requires before it will
      // delete the local branch.
      //
      // Commit LOCAL's dirty state first — both copyWorktreeArtifactsToPrimary()
      // (Lane/Progress/etc.) and openTrackPrOnDone()'s own primary-side
      // write (Phase 11's fix — PR Number/URL/Status) land on LOCAL's
      // working directory as raw file writes, not commits (a real,
      // working-as-designed side effect, not a bug), and git refuses to
      // merge with a dirty working tree.
      //
      // This LOCAL "wip" commit necessarily touches the same file
      // track-${TRACK_NUM}'s own last commit does (conductor/tracks/.../
      // index.md — the branch was never re-committed after quality-gate
      // finished, since PR mode has no reason to commit inside the
      // worktree), so a plain `--no-ff` merge below hits a real conflict.
      // `-X ours` resolves it by keeping LOCAL's side — the worker's own
      // freshly-written state (including the **PR Number** marker) is
      // exactly what should survive, not track-${TRACK_NUM}'s stale
      // pre-run snapshot of the same file. Tried `git reset --hard`
      // instead of committing, first — that silently discarded the
      // freshly-written **PR Number** marker along with everything else
      // uncommitted, which is what actually caused reconcilePrTracks to
      // find nothing to poll on every subsequent tick (a false read on
      // this test's part, not the real bug this phase's plan.md/commit
      // history documents).
      git('add -A', LOCAL);
      git('-c user.email=t@t -c user.name=t commit -q -m "wip: worker-written status before simulated merge" --allow-empty', LOCAL);
      git('checkout -q main', LOCAL);
      git(`merge -q --no-ff -X ours track-${TRACK_NUM} -m "merge track-${TRACK_NUM}"`, LOCAL);
      git('push -q origin main', LOCAL);

      writeGhScript({
        'auth status': { exitCode: 0 },
        'pr create': { stdout: 'https://github.com/example/repo/pull/777', exitCode: 0 },
        'pr view': { stdout: JSON.stringify({ state: 'MERGED', mergeStateStatus: 'CLEAN', statusCheckRollup: [] }), exitCode: 0 },
        'pr merge': { exitCode: 0 },
      });

      const afterMerge = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks[TRACK_NUM];
        return t?.pr_status === 'merged' ? t : null;
      }, { label: 'pr_status → merged (reconcilePrTracks picked up the MERGED poll)', timeout: 15000 });
      assert.equal(afterMerge.pr_status, 'merged');

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
});
