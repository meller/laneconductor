#!/usr/bin/env node
// conductor/tests/track-10076-reconcile-done-status.test.mjs
// Track 10076 Phase 4: reconcileDoneLaneStatus() is the continuous
// counterpart to planDoneLaneMigration's one-time `lc worktrees
// migrate-done-lane` sweep (track 10035 REQ-11) — it runs the exact same
// decision on every reconcile cycle of the REAL worker, so a track parked
// at done:success with a genuinely unmerged branch is reachable again
// (requeued to done:queue) without a human ever invoking the CLI.
//
// Spawns the real worker (helpers/isolated-worker.mjs) against a real,
// throwaway git repo — same reasoning as track-1112-worktree-audit's own
// fixture: git/branch introspection is exactly the kind of thing that's
// easy to get subtly wrong against a mock. All fixtures use
// **Merge Mode**: pr so classification resolves straight to 'pr-open'
// without a real conflict computation, AND so the pre-existing direct-mode
// merge safety net (reconcileWorktrees()'s own loop, track 1112 Phase 3)
// never fires on these tracks — this suite tests ONLY the new done-lane
// self-heal, not that unrelated, already-tested mechanism.
//
// Run: node --test conductor/tests/track-10076-reconcile-done-status.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { makeSandbox, cleanupSandbox, startIsolatedWorker, stopWorker } from './helpers/isolated-worker.mjs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function git(cmd, cwd) {
  return execFileSync('git', cmd.split(' '), { cwd, encoding: 'utf8' }).trim();
}

// Commit messages contain spaces — git()'s naive cmd.split(' ') would
// mangle them into separate argv entries. Takes the argv array directly.
function gitArgs(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function poll(fn, { timeout = 8000, interval = 200, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (fn()) return;
    await sleep(interval);
  }
  throw new Error(`poll timeout (${timeout}ms)${label ? ': ' + label : ''}`);
}

// Lets several LC_RECONCILE_INTERVAL_MS (300ms) cycles pass.
async function settle(ms = 1200) { await sleep(ms); }

function trackFolderName(num) { return `${num}-test-track-${num}`; }
function trackDir(sandbox, num) { return join(sandbox, 'conductor/tracks', trackFolderName(num)); }
function indexPath(sandbox, num) { return join(trackDir(sandbox, num), 'index.md'); }
function conversationPath(sandbox, num) { return join(trackDir(sandbox, num), 'conversation.md'); }

function readIndex(sandbox, num) {
  const p = indexPath(sandbox, num);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}
function getLane(content) { return content?.match(/\*\*Lane\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null; }
function getLaneStatus(content) { return content?.match(/\*\*Lane Status\*\*:\s*([^\n]+)/i)?.[1]?.trim() ?? null; }

function indexContent(num, lane, laneStatus, mergeMode) {
  return [
    `# Track ${num}: Test Track ${num}`, '',
    `**Lane**: ${lane}`, `**Lane Status**: ${laneStatus}`, '**Progress**: 100%',
    `**Merge Mode**: ${mergeMode}`, '',
    '## Problem', 'Test.', '',
  ].join('\n');
}

// Writes PRIMARY's own (uncommitted — same as createTrack() in
// local-fs-e2e.test.mjs) copy of the track's docs. This is what
// reconcileDoneLaneStatus() itself reads and writes (REQ-8
// single-writer).
function writePrimaryIndex(sandbox, num, { lane, laneStatus, mergeMode = 'pr' }) {
  const dir = trackDir(sandbox, num);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), indexContent(num, lane, laneStatus, mergeMode));
  writeFileSync(join(dir, 'conversation.md'), '# Conversation\n\n<!-- Last synced comment ID: 0 -->\n');
}

// Commits the track-N branch's OWN copy — auditWorktrees classifies from
// this (via `git show branch:path`), never from the primary working
// tree's live file. Deliberately a SEPARATE call from writePrimaryIndex so
// the two can be given different lane/status combinations where a test
// needs that (none currently do, but it mirrors the real shape: the
// branch's committed content and primary's own bookkeeping copy are two
// different things this whole track exists to reconcile).
function commitBranchTrackState(sandbox, num, { lane, laneStatus, mergeMode = 'pr' }) {
  git(`worktree add -q -B track-${num} .worktrees/${num} HEAD`, sandbox);
  const wt = join(sandbox, '.worktrees', num);
  const dir = join(wt, 'conductor/tracks', trackFolderName(num));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.md'), indexContent(num, lane, laneStatus, mergeMode));
  git('add -A', wt);
  gitArgs(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `track ${num} ${lane}:${laneStatus}`], wt);
}

function setupProject(name) {
  const sandbox = makeSandbox(name);
  git('-c user.email=t@t -c user.name=t commit -q --allow-empty -m init', sandbox);
  // getMainBranch()'s no-remote fallback is hardcoded 'master' — name the
  // real branch to match, regardless of this host's init.defaultBranch.
  git('branch -m master', sandbox);

  writeFileSync(join(sandbox, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'test-project', id: 1, repo_path: sandbox, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
    ui: { port: 8090 },
  }, null, 2));
  mkdirSync(join(sandbox, 'conductor/tracks'), { recursive: true });
  writeFileSync(join(sandbox, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 3 },
    defaults: { parallel_limit: 1, max_retries: 1, primary_model: 'mock', on_success: null, on_failure: null },
    lanes: {},
  }, null, 2));
  return sandbox;
}

function startWorker(sandbox, env = {}) {
  return startIsolatedWorker({
    sandbox,
    args: ['--sync-only'],
    env: { LC_RECONCILE_INTERVAL_MS: '300', ...env },
  });
}

describe('reconcileDoneLaneStatus — Phase 4 continuous self-heal (TC-4)', () => {
  it('TC-4.1: done:success with a genuinely unmerged branch is requeued, with a system comment naming why', async () => {
    const sandbox = setupProject('reconcile-4-1');
    try {
      commitBranchTrackState(sandbox, '801', { lane: 'done', laneStatus: 'success' });
      writePrimaryIndex(sandbox, '801', { lane: 'done', laneStatus: 'success' });

      const worker = await startWorker(sandbox);
      try {
        await poll(() => getLaneStatus(readIndex(sandbox, '801')) === 'queue', { label: 'track 801 requeued' });
        const convo = readFileSync(conversationPath(sandbox, '801'), 'utf8');
        assert.match(convo, /Moved back to done:queue/);
        assert.match(convo, /unmerged/);
      } finally {
        await stopWorker(worker);
      }
    } finally {
      cleanupSandbox(sandbox);
    }
  });

  it('TC-4.2: a second reconcile cycle does not re-write or re-comment (idempotent)', async () => {
    const sandbox = setupProject('reconcile-4-2');
    try {
      commitBranchTrackState(sandbox, '802', { lane: 'done', laneStatus: 'success' });
      writePrimaryIndex(sandbox, '802', { lane: 'done', laneStatus: 'success' });

      const worker = await startWorker(sandbox);
      try {
        await poll(() => getLaneStatus(readIndex(sandbox, '802')) === 'queue', { label: 'track 802 requeued' });
        await settle(1200); // several more reconcile cycles
        const convo = readFileSync(conversationPath(sandbox, '802'), 'utf8');
        const hits = convo.match(/Moved back to done:queue/g) || [];
        assert.equal(hits.length, 1, `expected exactly one comment, got ${hits.length}`);
      } finally {
        await stopWorker(worker);
      }
    } finally {
      cleanupSandbox(sandbox);
    }
  });

  it('TC-4.3: a track holding a LIVE lock is never touched (REQ-7)', async () => {
    const sandbox = setupProject('reconcile-4-3');
    try {
      commitBranchTrackState(sandbox, '803', { lane: 'done', laneStatus: 'success' });
      writePrimaryIndex(sandbox, '803', { lane: 'done', laneStatus: 'success' });
      mkdirSync(join(sandbox, '.conductor/locks'), { recursive: true });
      // This test process's own pid is guaranteed alive for the test's duration.
      writeFileSync(join(sandbox, '.conductor/locks/803.lock'), JSON.stringify({ machine: os.hostname(), pid: process.pid }));

      const worker = await startWorker(sandbox);
      try {
        await settle(1200);
        assert.equal(getLaneStatus(readIndex(sandbox, '803')), 'success', 'a track holding a live lock must be left untouched');
        const convo = readFileSync(conversationPath(sandbox, '803'), 'utf8');
        assert.doesNotMatch(convo, /Moved back to done:queue/);
      } finally {
        await stopWorker(worker);
      }
    } finally {
      cleanupSandbox(sandbox);
    }
  });

  it('TC-4.4: a lock naming a DEAD pid is orphaned — self-heal proceeds anyway', async () => {
    const sandbox = setupProject('reconcile-4-4');
    try {
      commitBranchTrackState(sandbox, '804', { lane: 'done', laneStatus: 'success' });
      writePrimaryIndex(sandbox, '804', { lane: 'done', laneStatus: 'success' });
      mkdirSync(join(sandbox, '.conductor/locks'), { recursive: true });
      // A pid essentially guaranteed not to exist on this machine.
      writeFileSync(join(sandbox, '.conductor/locks/804.lock'), JSON.stringify({ machine: os.hostname(), pid: 999999 }));

      const worker = await startWorker(sandbox);
      try {
        await poll(() => getLaneStatus(readIndex(sandbox, '804')) === 'queue', { label: 'track 804 requeued despite dead-PID lock' });
      } finally {
        await stopWorker(worker);
      }
    } finally {
      cleanupSandbox(sandbox);
    }
  });

  it('TC-4.5: done:queue with an unmerged branch is already correct — no action, no comment', async () => {
    const sandbox = setupProject('reconcile-4-5');
    try {
      commitBranchTrackState(sandbox, '805', { lane: 'done', laneStatus: 'queue' });
      writePrimaryIndex(sandbox, '805', { lane: 'done', laneStatus: 'queue' });

      const worker = await startWorker(sandbox);
      try {
        await settle(1200);
        assert.equal(getLaneStatus(readIndex(sandbox, '805')), 'queue');
        const convo = readFileSync(conversationPath(sandbox, '805'), 'utf8');
        assert.doesNotMatch(convo, /Moved back to done:queue/);
      } finally {
        await stopWorker(worker);
      }
    } finally {
      cleanupSandbox(sandbox);
    }
  });

  it('TC-4.6: a fully-merged branch (absent from the audit entirely) never promotes done:queue to success — demote-only (REQ-6)', async () => {
    const sandbox = setupProject('reconcile-4-6');
    try {
      // Deliberately no track-N branch at all — simulates auditWorktrees
      // omitting an already-merged branch (its own isAncestor
      // early-continue). Primary sits at done:queue, as it would right
      // after quality-gate handed off.
      writePrimaryIndex(sandbox, '806', { lane: 'done', laneStatus: 'queue' });

      const worker = await startWorker(sandbox);
      try {
        await settle(1200);
        assert.equal(getLaneStatus(readIndex(sandbox, '806')), 'queue', 'an absent classification must never promote a track to success');
      } finally {
        await stopWorker(worker);
      }
    } finally {
      cleanupSandbox(sandbox);
    }
  });

  it('TC-4.8: a non-done lane with an unmerged branch is untouched — self-heal is done-lane-scoped', async () => {
    const sandbox = setupProject('reconcile-4-8');
    try {
      commitBranchTrackState(sandbox, '808', { lane: 'implement', laneStatus: 'success' });
      writePrimaryIndex(sandbox, '808', { lane: 'implement', laneStatus: 'success' });

      const worker = await startWorker(sandbox);
      try {
        await settle(1200);
        const content = readIndex(sandbox, '808');
        assert.equal(getLane(content), 'implement');
        assert.equal(getLaneStatus(content), 'success');
      } finally {
        await stopWorker(worker);
      }
    } finally {
      cleanupSandbox(sandbox);
    }
  });

  // TC-4.9 (local-fs mode: index.md write still happens, no collector
  // patch attempted, no crash) is exercised implicitly by every test
  // above — setupProject() always configures mode: 'local-fs', and
  // patchTrackPrFields() no-ops under getIsLocalFs() before ever
  // attempting a network call (see laneconductor.sync.mjs). TC-4.1's own
  // pass is proof the write and comment both still happen without one.
  //
  // TC-4.7 (shouldBlockLaneWrite() returns blocked -> no write) is not
  // independently exercised here: reconcileDoneLaneStatus only ever asks
  // for a same-lane ('done' -> 'done') status change, which
  // shouldBlockLaneWrite's own rank check always allows regardless of
  // producedByThisRun (see lane-regression-guard.mjs — same-lane writes
  // return unblocked before any rank comparison runs at all). The call is
  // still routed through applyGuardedLaneWrite for REQ-7's structural
  // consistency with every other marker-write site, not because this
  // particular call site can trigger a block today.
});
