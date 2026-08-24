#!/usr/bin/env node
// conductor/tests/track-10024-reconcile-missing-pr.test.mjs
//
// Dogfooding session on 2026-08-24: openTrackPrOnDone is normally fired
// once, in-process, by spawnCli's own exit handler right after a track
// reaches done:success — a fire-and-forget call with no retry. Anything
// interrupting that continuation (a worker restart at the wrong instant,
// or anything else) drops PR creation silently, forever, with nothing to
// notice or retry. Confirmed live across FIVE real tracks in this repo,
// one of them (1111) sitting at done:success with merge_mode 'pr' and no
// PR since 2026-08-20 — four days, long before anything done this session
// — proving this isn't just a today's-restart problem.
//
// Fix: reconcilePrTracks() (which already runs on a periodic interval,
// polling PR status for tracks that already have one) now ALSO opens a
// missing PR for any track sitting at done:success with merge_mode 'pr'
// and no PR number yet — the same self-healing treatment
// reconcileWorktrees() already gives direct-mode merges.
//
// This test seeds a track ALREADY at done:success with a real pushed
// branch and no PR (simulating the "interrupted after done, before PR
// creation" state directly, rather than trying to time a real interrupt)
// and asserts the periodic reconcile loop opens one on its own — with NO
// dispatch, NO CLI spawn, nothing but the passage of time.
//
// Run: node --test conductor/tests/track-10024-reconcile-missing-pr.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_GH = join(__dirname, 'mock-gh.mjs');
const BASE = join(ROOT, '.test-tmp-track-10024-reconcile-missing-pr');
const ORIGIN = join(BASE, 'origin.git');
const LOCAL = join(BASE, 'local');
const GH_BIN_DIR = join(BASE, 'gh-bin');
const GH_SCRIPT_PATH = join(BASE, 'mock-gh-script.json');
const TRACK_NUM = '19980';
const TRACK_DIR_NAME = `${TRACK_NUM}-reconcile-missing-pr`;

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

function setupFixture(collectorPort) {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(BASE, { recursive: true });

  git(`init -q --bare "${ORIGIN}"`);
  git(`symbolic-ref HEAD refs/heads/main`, ORIGIN);
  git(`clone -q "${ORIGIN}" "${LOCAL}"`, BASE);
  git('config user.email t@t', LOCAL);
  git('config user.name t', LOCAL);

  writeFileSync(join(LOCAL, 'README.md'), 'init\n');
  git('add -A', LOCAL);
  git('commit -q -m init', LOCAL);
  git('branch -m main', LOCAL);
  git('push -q -u origin main', LOCAL);

  writeFileSync(join(LOCAL, '.laneconductor.json'), JSON.stringify({
    mode: 'local-api',
    project: { name: 'reconcile-missing-pr', id: 1, repo_path: LOCAL, primary: { cli: 'mock', model: 'mock' } },
    collectors: [{ url: `http://127.0.0.1:${collectorPort}`, token: null }],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(LOCAL, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(LOCAL, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock' },
    lanes: {},
  }, null, 2));

  // Seed the track directly at done:success, no PR marker at all — the
  // exact state a "died right after the exit handler wrote Lane Status but
  // before openTrackPrOnDone finished" interruption leaves behind. No merge
  // marker set — resolveMergeMode() defaults an absent marker to 'pr'.
  const trackDir = join(LOCAL, 'conductor/tracks', TRACK_DIR_NAME);
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    `# Track ${TRACK_NUM}: Reconcile Missing PR`,
    '',
    '**Lane**: done',
    '**Lane Status**: success',
    '**Progress**: 100%',
    '',
    '## Problem',
    'Test problem.',
    '',
    '## Solution',
    'Test solution.',
  ].join('\n'));
  git('add -A', LOCAL);
  git('commit -q -m "seed track already at done:success"', LOCAL);
  git('push -q origin main', LOCAL);

  // A real worktree + branch, already pushed — exactly what a genuinely
  // finished track leaves behind, just missing the PR.
  git(`worktree add -q -b track-${TRACK_NUM} .worktrees/${TRACK_NUM} main`, LOCAL);
  git(`push -q -u origin track-${TRACK_NUM}`, LOCAL);

  mkdirSync(GH_BIN_DIR, { recursive: true });
  chmodSync(MOCK_GH, 0o755);
  const ghShimPath = join(GH_BIN_DIR, 'gh');
  rmSync(ghShimPath, { force: true });
  symlinkSync(MOCK_GH, ghShimPath);

  writeGhScript({
    'auth status': { exitCode: 0 },
    'pr create': { stdout: 'https://github.com/example/repo/pull/888', exitCode: 0 },
    'pr view': { stdout: JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN', statusCheckRollup: [] }), exitCode: 0 },
  });
}

function startWorker() {
  const newPath = `${GH_BIN_DIR}:${process.env.PATH}`;
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: LOCAL,
    env: {
      ...process.env,
      PATH: newPath,
      MOCK_GH_SCRIPT_PATH: GH_SCRIPT_PATH,
      LC_RECONCILE_INTERVAL_MS: '500',
      // Deliberately NOT LC_SKIP_GIT_LOCK, NOT dispatching anything — this
      // test proves the periodic reconcile loop alone (no dispatch, no CLI
      // spawn) is what creates the PR.
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

describe('Track 10024: reconcilePrTracks opens a missing PR for a track already at done:success', () => {
  let collectorProc, collectorPort, worker;

  before(async () => {
    ({ proc: collectorProc, port: collectorPort } = await startMockCollector());
  });

  after(() => {
    collectorProc?.kill('SIGTERM');
    rmSync(BASE, { recursive: true, force: true });
  });

  it('opens a PR on its own, with no dispatch at all — just the passage of time', async () => {
    await fetch(`http://127.0.0.1:${collectorPort}/_reset`, { method: 'POST' });
    setupFixture(collectorPort);

    worker = startWorker();
    try {
      const afterPr = await poll(async () => {
        const s = await getState(collectorPort);
        const t = s.tracks[TRACK_NUM];
        return t?.pr_number ? t : null;
      }, { label: 'reconcilePrTracks opened the missing PR unprompted', timeout: 15000 });

      assert.equal(afterPr.pr_number, 888);
      assert.equal(afterPr.pr_url, 'https://github.com/example/repo/pull/888');
      assert.equal(afterPr.pr_status, 'open');

      const remoteRef = git(`ls-remote origin refs/heads/track-${TRACK_NUM}`, LOCAL);
      assert.ok(remoteRef.length > 0, 'branch must still be real and pushed');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });
});
