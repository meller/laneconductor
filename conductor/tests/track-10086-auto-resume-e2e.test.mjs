#!/usr/bin/env node
// conductor/tests/track-10086-auto-resume-e2e.test.mjs
// Track AM-10086 Phase 2 + Phase 4, against a REAL spawned worker.
//
// The claim under test is that `reconcileParkedDependencyTracks()` — a
// periodic pass registered alongside reconcileWorktrees()/reconcilePrTracks()
// — actually notices a `<lane>:waiting` park whose named dependency has
// since shipped, and resumes it (moves it back to `queue`) with no human
// action, on a running worker process. None of this can be proven by
// unit-testing the pure decision module alone (that's
// track-10086-dependency-resume.test.mjs) — it requires a real setInterval
// firing inside a real process against real files on disk.
//
// Isolation: this TMP fixture gets its OWN git repo (execSync('git init'))
// so resolvePrimaryRepoRoot(cwd) resolves it as its own primary checkout
// instead of walking up to the real enclosing repo — found live, the hard
// way, planning this exact fix for conductor/tests/track-1119-phase3-depends-on.test.mjs
// during this same track: without it, a worker spawned from a TMP dir
// nested inside a track worktree silently registers against the REAL
// primary checkout's collector/DB.
//
// Run: node --test conductor/tests/track-10086-auto-resume-e2e.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const MOCK_CLI = join(__dirname, 'mock-cli.mjs');
const TMP = join(ROOT, '.test-tmp-track-10086-auto-resume');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readIndex(tracksDir, trackNum) {
  const dirs = readdirSync(tracksDir).filter(d => new RegExp(`(^|-)${trackNum}(-|$)`).test(d));
  if (!dirs.length) return null;
  const p = join(tracksDir, dirs[0], 'index.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}
function indexPathFor(tracksDir, trackNum) {
  const dir = readdirSync(tracksDir).find(d => new RegExp(`(^|-)${trackNum}(-|$)`).test(d));
  return dir ? join(tracksDir, dir, 'index.md') : null;
}
function conversationFor(tracksDir, trackNum) {
  const dir = readdirSync(tracksDir).find(d => new RegExp(`(^|-)${trackNum}(-|$)`).test(d));
  const p = dir ? join(tracksDir, dir, 'conversation.md') : null;
  return p && existsSync(p) ? readFileSync(p, 'utf8') : '';
}
const getLane = c => c?.match(/^[ \t]*\*\*Lane\*\*:[ \t]*([^\n]*)$/im)?.[1]?.trim() ?? null;
const getLaneStatus = c => c?.match(/^[ \t]*\*\*Lane Status\*\*:[ \t]*([^\n]*)$/im)?.[1]?.trim() ?? null;
const getWaitingReason = c => c?.match(/^[ \t]*\*\*Waiting Reason\*\*:[ \t]*([^\n]*)$/im)?.[1]?.trim() ?? null;
const getAutoResumed = c => c?.match(/^[ \t]*\*\*Auto Resumed\*\*:[ \t]*([^\n]*)$/im)?.[1]?.trim() ?? null;

async function poll(fn, { timeout = 15000, interval = 250, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

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
  writeFileSync(join(TMP, '.gitignore'), '.worktrees/\n');
  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(TMP, 'conductor/tracks/.gitkeep'), '');

  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1 },
    lanes: {
      implement: { parallel_limit: 2, max_retries: 3, primary_model: 'mock', on_success: 'review:queue', on_failure: 'implement:failure' },
    },
  }, null, 2));

  execSync('git add -A', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m setup', { cwd: TMP });
}

// workspace: main keeps every track off the worktree/branch machinery,
// which is orthogonal to what these tests are proving.
function createTrack(tracksDir, num, { lane, status = 'queue', dependsOn = null, waitingReason = null, extraLines = [], dirPrefix = null } = {}) {
  const dirName = dirPrefix ? `${dirPrefix}-${num}-test-track-${num}` : `${num}-test-track-${num}`;
  const dir = join(tracksDir, dirName);
  mkdirSync(dir, { recursive: true });
  const lines = [
    `# Track ${num}: Test Track ${num}`,
    '',
    `**Lane**: ${lane}`,
    `**Lane Status**: ${status}`,
    '**Progress**: 40%',
    '**Workspace**: main',
    '**Auto Run**: yes',
  ];
  if (dependsOn) lines.push(`**Depends On**: ${dependsOn}`);
  if (waitingReason) lines.push(`**Waiting Reason**: ${waitingReason}`);
  lines.push(...extraLines);
  lines.push('', '## Problem', 'Test problem.', '', '## Solution', 'Test solution.');
  writeFileSync(join(dir, 'index.md'), lines.join('\n'));
  return dir;
}

function startWorker(env = {}) {
  const worker = spawn('node', [join(ROOT, 'conductor/laneconductor.sync.mjs')], {
    cwd: TMP,
    env: { ...process.env, LC_MOCK_CLI: `node ${MOCK_CLI}`, MOCK_CLI_DELAY_MS: '300', LC_RECONCILE_INTERVAL_MS: '1000', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', d => process.stdout.write(`[worker] ${d}`));
  worker.stderr.on('data', d => process.stderr.write(`[worker] ${d}`));
  return worker;
}

describe('Track AM-10086: reconcileParkedDependencyTracks — real spawned worker', () => {
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('TC-4.1 (AC-1): a park attributable to a shipped dependency is auto-resumed and then claimed', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '1000', { lane: 'done', status: 'success' });
    createTrack(tracksDir, '1001', {
      lane: 'implement', status: 'waiting',
      dependsOn: '1000', waitingReason: 'AM-1000 unmerged; Phase 4 done; awaiting merge order',
    });

    const worker = startWorker({ MOCK_CLI_EXIT_CODE: '0' });
    try {
      // First: the reconciler flips it back to queue (or the worker has
      // already claimed it by the time we look — either is the resume
      // having happened).
      await poll(() => {
        const c = readIndex(tracksDir, '1001');
        const s = getLaneStatus(c);
        return s === 'queue' || s === 'running' ? c : null;
      }, { label: 'track 1001 auto-resumed off waiting', timeout: 8000 });

      // Then: a real worker actually claims and runs it through to
      // completion — the resume is not just a status flip nobody acts on.
      const final = await poll(() => {
        const c = readIndex(tracksDir, '1001');
        return getLane(c) === 'review' ? c : null;
      }, { label: 'track 1001 claimed and advanced to review', timeout: 20000 });

      assert.equal(getLane(final), 'review');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('TC-4.3 (AC-6) + TC-4.4 (AC-7) + TC-4.5: resume clears Waiting Reason, posts one comment, writes Auto Resumed', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '1000', { lane: 'done', status: 'success' });
    createTrack(tracksDir, '1001', {
      lane: 'implement', status: 'waiting',
      dependsOn: '1000', waitingReason: 'AM-1000 unmerged; Phase 4 done; awaiting merge order',
    });

    // No mock CLI success needed for this assertion set — stop the worker
    // the moment the resume itself has happened, before it gets claimed,
    // so the file state under test is exactly the reconciler's own write.
    const worker = startWorker({ MOCK_CLI_DELAY_MS: '5000' });
    try {
      const resumed = await poll(() => {
        const c = readIndex(tracksDir, '1001');
        return getLaneStatus(c) === 'queue' ? c : null;
      }, { label: 'track 1001 auto-resumed off waiting', timeout: 8000 });

      assert.equal(getWaitingReason(resumed), null, 'AC-6: Waiting Reason is gone after resume');

      const autoResumed = getAutoResumed(resumed);
      assert.ok(autoResumed, 'the Auto Resumed loop-guard marker was written');
      assert.match(autoResumed, /deps=1000/, 'names the dependency that was checked and found shipped');

      const conv = conversationFor(tracksDir, '1001');
      const systemComments = conv.split('\n').filter(l => /^>\s+\*\*system\*\*:/.test(l));
      assert.equal(systemComments.length, 1, 'AC-7: exactly one audit comment');
      assert.match(systemComments[0], /1000/, 'the comment names the cleared dependency');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('TC-4.2 (AC-2): stays parked while the dependency is unmerged (done:queue, not done:success)', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '1000', { lane: 'done', status: 'queue' }); // quality-gate passed, not merged
    createTrack(tracksDir, '1001', {
      lane: 'implement', status: 'waiting',
      dependsOn: '1000', waitingReason: 'AM-1000 unmerged; awaiting merge order',
    });

    const worker = startWorker({ MOCK_CLI_DELAY_MS: '5000' });
    try {
      // Wait out several reconcile cycles (1s each) plus margin.
      await sleep(4500);
      const c = readIndex(tracksDir, '1001');
      assert.equal(getLaneStatus(c), 'waiting', 'done:queue must not satisfy the dependency — the blocker is literally still true');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('AC-3: a Depends On present but not named in an unrelated (human-judgment) reason stays parked', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '1000', { lane: 'done', status: 'success' });
    createTrack(tracksDir, '1002', {
      lane: 'implement', status: 'waiting',
      dependsOn: '1000', waitingReason: 'Needs approval to run the destructive 0042 migration on prod',
    });

    const worker = startWorker({ MOCK_CLI_DELAY_MS: '5000' });
    try {
      await sleep(4500);
      const c = readIndex(tracksDir, '1002');
      assert.equal(getLaneStatus(c), 'waiting', 'an unrelated human-judgment park must never be auto-resumed');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('AC-4: **Waiting On Tracks** requires every named dependency shipped, not just one', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '1000', { lane: 'done', status: 'success' });
    createTrack(tracksDir, '1003', { lane: 'implement', status: 'queue' }); // not shipped
    createTrack(tracksDir, '1004', {
      lane: 'implement', status: 'waiting',
      extraLines: ['**Waiting On Tracks**: 1000, 1003'],
    });

    const worker = startWorker({ MOCK_CLI_DELAY_MS: '5000' });
    try {
      await sleep(4500);
      assert.equal(getLaneStatus(readIndex(tracksDir, '1004')), 'waiting', 'only one of two named dependencies shipped — must stay parked');

      // Now ship the second dependency and confirm it resumes.
      writeFileSync(indexPathFor(tracksDir, '1003'),
        readFileSync(indexPathFor(tracksDir, '1003'), 'utf8')
          .replace(/\*\*Lane\*\*:\s*[^\n]+/i, '**Lane**: done')
          .replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, '**Lane Status**: success'));

      await poll(() => getLaneStatus(readIndex(tracksDir, '1004')) === 'queue' ? true : null,
        { label: 'track 1004 resumes once BOTH named dependencies ship', timeout: 8000 });
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('AC-5: a park with no Depends On and no Waiting On Tracks is never touched', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '1005', { lane: 'implement', status: 'waiting', waitingReason: 'Some question needing a human.' });

    const worker = startWorker({ MOCK_CLI_DELAY_MS: '5000' });
    try {
      await sleep(4500);
      assert.equal(getLaneStatus(readIndex(tracksDir, '1005')), 'waiting');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('AC-8: a track re-parked on the SAME already-satisfied dependency set is not auto-resumed a second time', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '1000', { lane: 'done', status: 'success' });
    const dir = createTrack(tracksDir, '1006', {
      lane: 'implement', status: 'waiting',
      dependsOn: '1000', waitingReason: 'AM-1000 unmerged; awaiting merge order',
      // Simulates a track that has already been auto-resumed once for this
      // exact dependency set and has since parked again on it.
      extraLines: ['**Auto Resumed**: 2026-01-01T00:00:00.000Z deps=1000'],
    });

    const worker = startWorker({ MOCK_CLI_DELAY_MS: '5000' });
    try {
      await sleep(4500);
      const c = readIndex(tracksDir, '1006');
      assert.equal(getLaneStatus(c), 'waiting', 'the same dependency set having already triggered one auto-resume must not trigger a second');
      assert.match(getAutoResumed(c) || '', /deps=1000/, 'the original marker is untouched');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('AC-9 / TC-4.7: a dependency naming no known track stays parked, and the pass never crashes on an unreadable/bogus folder', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '1007', {
      lane: 'implement', status: 'waiting',
      dependsOn: '9999', waitingReason: 'blocked on 9999 landing first',
    });
    // A bogus numbered folder with no index.md at all, sitting alongside the
    // real ones — the scan must skip it, not throw and abandon the whole pass.
    mkdirSync(join(tracksDir, '9998-bogus-no-index'), { recursive: true });

    const worker = startWorker({ MOCK_CLI_DELAY_MS: '5000' });
    try {
      await sleep(4500);
      assert.equal(getLaneStatus(readIndex(tracksDir, '1007')), 'waiting', 'an unknown dependency must be treated as unmet, never satisfied');
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });

  it('TC-4.6: an INITIALS-NNN-slug folder is reconciled identically to a legacy NNN-slug folder', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '1000', { lane: 'done', status: 'success' });
    createTrack(tracksDir, '1008', {
      lane: 'implement', status: 'waiting',
      dependsOn: '1000', waitingReason: 'AM-1000 unmerged; awaiting merge order',
      dirPrefix: 'AM',
    });

    const worker = startWorker({ MOCK_CLI_DELAY_MS: '5000' });
    try {
      await poll(() => getLaneStatus(readIndex(tracksDir, '1008')) === 'queue' ? true : null,
        { label: 'track 1008 (AM-prefixed folder) auto-resumed', timeout: 8000 });
    } finally {
      worker.kill('SIGTERM');
      await sleep(500);
    }
  });
});

describe('Track AM-10086 Phase 3: human resume clears the loop guard', () => {
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('TC-5.1 (AC-8): a human-style resume (Lane Status → queue, waiting_reason cleared) also retires Auto Resumed and Waiting On Tracks', async () => {
    setupProject();
    const tracksDir = join(TMP, 'conductor/tracks');
    createTrack(tracksDir, '1000', { lane: 'done', status: 'queue' }); // still unmet, so the reconciler itself won't touch this one
    const dir = createTrack(tracksDir, '1009', {
      lane: 'implement', status: 'waiting',
      dependsOn: '1000', waitingReason: 'AM-1000 unmerged; awaiting merge order',
      extraLines: ['**Auto Resumed**: 2026-01-01T00:00:00.000Z deps=1000', '**Waiting On Tracks**: 1000'],
    });
    const indexPath = join(dir, 'index.md');

    // What ui/server/index.mjs's syncTrackToFile does on POST .../resume,
    // reduced to its filesystem effect (same reduction track-10055's own
    // e2e test uses for its resume assertion).
    let content = readFileSync(indexPath, 'utf8');
    content = content.replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, '**Lane Status**: queue');
    content = content.replace(/^[ \t]*\*\*Waiting Reason\*\*:[^\n]*\n?/im, '');
    content = content.replace(/^[ \t]*\*\*Waiting On Tracks\*\*:[^\n]*\n?/im, '');
    content = content.replace(/^[ \t]*\*\*Auto Resumed\*\*:[^\n]*\n?/im, '');
    writeFileSync(indexPath, content, 'utf8');

    assert.equal(getAutoResumed(readFileSync(indexPath, 'utf8')), null, 'a human resume clears the loop guard, unlike the reconciler leaving it for a repeat park');
  });
});
