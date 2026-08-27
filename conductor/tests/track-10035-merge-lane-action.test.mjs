#!/usr/bin/env node
// conductor/tests/track-10035-merge-lane-action.test.mjs
// Track 10035: merging as a done-lane action.
//
// The most load-bearing, least obvious piece of this track is the exit
// handler's binary success/failure transition model gaining a third
// outcome for the done lane specifically: a pr-mode merge run that opened
// a PR is a genuine success (exit 0) but must land at done:waiting, not
// done:success (approval/merge happens on GitHub, not in this run). These
// tests drive a REAL spawned worker process against mock-cli.mjs (via
// LC_MOCK_CLI) to prove the actual exit-handler code path, not just the
// pure-function pieces already covered elsewhere
// (track-1115-workspace-mode.test.mjs, track-1114-auto-complete.test.mjs).
//
// Run: node --test conductor/tests/track-10035-merge-lane-action.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10035-merge-lane');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readIndex(tracksDir, trackNum) {
  const dirs = readdirSync(tracksDir).filter(d => new RegExp(`(^|-)${trackNum}(-|$)`).test(d));
  if (!dirs.length) return null;
  const p = join(tracksDir, dirs[0], 'index.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function getLane(content) { return content?.match(/\*\*Lane\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null; }
function getLaneStatus(content) { return content?.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null; }

async function poll(fn, { timeout = 15000, interval = 300, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

// Real git repo (not LC_SKIP_GIT_LOCK) — the done lane always resolves
// workspace: main (Track 1115 machinery), whose dirty-checkout guard shells
// out to real git commands even in local-fs mode.
function setupProject() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execSync('git init -q', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: TMP });

  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'test-project', id: 1, repo_path: TMP, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
    ui: { port: 8090 },
  }, null, 2));

  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  // git never tracks an empty directory — without a placeholder, adding a
  // NEW track subfolder later makes `git status --porcelain` report the
  // whole (never-previously-tracked) conductor/tracks/ as one untracked
  // line instead of scoping it to just that track's own subfolder, which
  // defeats the dirty-checkout guard's ownFolderPrefix exemption below.
  writeFileSync(join(TMP, 'conductor/tracks/.gitkeep'), '');
  // Mirrors conductor/workflow.json's real shape (Track 10035 Phase 1):
  // quality-gate hands off to done:queue, done is a normal lane action
  // config with no on_success (so a plain success stays in 'done' with
  // status 'success' — see resolveTransition's !configValue branch).
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1 },
    lanes: {
      'quality-gate': { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: 'done:queue', on_failure: 'plan:queue' },
      done: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_failure: 'done:failure' },
    },
  }, null, 2));

  // workspace: main's dirty-checkout guard (conductor/services/workspace-mode.mjs)
  // flags any dirty path outside the track's own folder — commit the
  // project-level setup files so only each test's own track folder (already
  // exempted by ownFolderPrefix) is left untracked.
  execSync('git add -A', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m setup', { cwd: TMP });
}

function createDoneQueueTrack(tracksDir, num, mergeMode) {
  const dir = join(tracksDir, `${num}-test-track-${num}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), [
    `# Track ${num}: Test Track ${num}`,
    '',
    '**Lane**: done',
    '**Lane Status**: queue',
    '**Progress**: 100%',
    `**Merge Mode**: ${mergeMode}`,
    '**Auto Run**: yes',
    '',
    '## Problem',
    'Test problem.',
    '',
    '## Solution',
    'Test solution.',
  ].join('\n'));
  return dir;
}

function startWorker(env = {}) {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: TMP,
    env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '300', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

describe('Track 10035: done lane is a standard, claimable lane action', () => {
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('TC-2.1/2.3-ish: a done:queue track is claimed, spawns in workspace:main (no worktree), and a clean exit lands at done:success', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createDoneQueueTrack(tracksDir, '701', 'direct');

    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '0' });
    try {
      await poll(() => getLaneStatus(readIndex(tracksDir, '701')) === 'running' ? true : null,
        { label: 'track 701 claimed and running', timeout: 10000 });

      const final = await poll(() => {
        const c = readIndex(tracksDir, '701');
        return getLaneStatus(c) === 'success' ? c : null;
      }, { label: 'track 701 → done:success', timeout: 10000 });

      assert.equal(getLane(final), 'done');
      assert.equal(getLaneStatus(final), 'success');
      // workspace: main — no per-track worktree should have been created.
      assert.ok(!existsSync(join(TMP, '.worktrees', '701')), 'no worktree should exist for a workspace:main lane action');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('(track 10035) pr-mode merge run that opens a PR lands at done:waiting, not done:success, on a clean exit', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createDoneQueueTrack(tracksDir, '702', 'pr');

    // Simulates the merge action's own last action (SKILL.md step 5c):
    // writing **Lane Status**: waiting before the CLI session exits 0.
    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '0', MOCK_CLI_WRITE_LANE_STATUS: 'waiting' });
    try {
      const final = await poll(() => {
        const c = readIndex(tracksDir, '702');
        const s = getLaneStatus(c);
        return (s === 'waiting' || s === 'success') ? c : null;
      }, { label: 'track 702 reaches a terminal status', timeout: 10000 });

      assert.equal(getLane(final), 'done');
      assert.equal(getLaneStatus(final), 'waiting', 'exit handler must preserve the agent-self-reported waiting outcome, not overwrite it to success');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('(track 10035) a done:queue track with no Auto Run marker is left untouched (same gate as every other lane)', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    const dir = join(tracksDir, '703-test-track-703');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.md'), [
      '# Track 703: Test Track 703',
      '',
      '**Lane**: done',
      '**Lane Status**: queue',
      '**Progress**: 100%',
      '**Merge Mode**: direct',
      '',
      '## Problem',
      'Test problem.',
    ].join('\n'));

    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '0' });
    try {
      await sleep(6000);
      const content = readIndex(tracksDir, '703');
      assert.equal(getLaneStatus(content), 'queue', 'no Auto Run marker — must not be auto-claimed');
      assert.equal(getLane(content), 'done');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });
});
