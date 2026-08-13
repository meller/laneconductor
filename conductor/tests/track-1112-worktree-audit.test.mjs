#!/usr/bin/env node
// conductor/tests/track-1112-worktree-audit.test.mjs
// Track 1112 Phase 2: auditWorktrees() joins git worktree/branch state to
// each track's own lane state, classifying every unmerged track-* branch
// as mergeable/stranded/open/conflicted — the core logic behind `lc
// worktrees`.
//
// Uses a real, throwaway git repo (not mocked) — worktree/branch
// introspection is exactly the kind of thing that's easy to get subtly
// wrong against a fake, and this repo's own live state (48 worktrees, 44
// unmerged) is what motivated this track in the first place.
//
// Run: node --test conductor/tests/track-1112-worktree-audit.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { auditWorktrees } from '../services/worktree-audit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const REPO = join(ROOT, '.test-tmp-worktree-audit');

function git(cmd, cwd = REPO) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function writeTrackIndex(dir, trackNumber, title, lane, laneStatus, problemText = 'Test.') {
  const trackDir = join(dir, 'conductor/tracks', `${trackNumber}-${title.toLowerCase().replace(/\s+/g, '-')}`);
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    `# Track ${trackNumber}: ${title}`, '',
    `**Lane**: ${lane}`, `**Lane Status**: ${laneStatus}`, '**Progress**: 0%', '',
    '## Problem', problemText, '',
  ].join('\n'));
}

function setupRepo() {
  rmSync(REPO, { recursive: true, force: true });
  mkdirSync(REPO, { recursive: true });
  git('init -q');
  git('-c user.email=t@t -c user.name=t commit -q --allow-empty -m init');
  git('branch -m main'); // normalize default branch name across git configs
}

describe('auditWorktrees()', () => {
  after(() => {
    // best-effort: remove any worktrees this suite created before deleting the dir
    try {
      const list = git('worktree list --porcelain').split('\n\n').filter(Boolean);
      for (const block of list) {
        const p = block.match(/^worktree (.+)$/m)?.[1];
        if (p && p !== REPO) execSync(`git -C "${REPO}" worktree remove --force "${p}"`, { stdio: 'ignore' }).toString();
      }
    } catch { /* ignore */ }
    rmSync(REPO, { recursive: true, force: true });
  });

  it('classifies a done:success branch with its worktree present as mergeable', async () => {
    setupRepo();
    writeTrackIndex(REPO, '101', 'Mergeable Track', 'plan', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    git('worktree add -q -B track-101 .worktrees/101 HEAD');
    writeTrackIndex(join(REPO, '.worktrees/101'), '101', 'Mergeable Track', 'done', 'success');
    git('add -A', join(REPO, '.worktrees/101'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 101 done"', join(REPO, '.worktrees/101'));

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '101');
    assert.ok(row, 'track 101 should appear in the audit');
    assert.equal(row.classification, 'mergeable');
    assert.equal(row.hasWorktree, true);
    assert.ok(row.ahead >= 1);
  });

  it('classifies a done:success branch whose worktree directory is gone as stranded', async () => {
    setupRepo();
    writeTrackIndex(REPO, '102', 'Stranded Track', 'plan', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    git('worktree add -q -B track-102 .worktrees/102 HEAD');
    writeTrackIndex(join(REPO, '.worktrees/102'), '102', 'Stranded Track', 'done', 'success');
    git('add -A', join(REPO, '.worktrees/102'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 102 done"', join(REPO, '.worktrees/102'));
    // Remove the worktree directory WITHOUT deleting the branch — this is
    // exactly RC-A's real-world trigger (removeWorktree on a failure path,
    // a manual `rm -rf`, `git worktree prune` after manual deletion, etc).
    git('worktree remove --force .worktrees/102');

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '102');
    assert.ok(row, 'track 102 should appear even with no worktree directory (git worktree list alone misses this)');
    assert.equal(row.classification, 'stranded');
    assert.equal(row.hasWorktree, false);
  });

  it('classifies a track not yet at done:success as open, regardless of the branch', async () => {
    setupRepo();
    writeTrackIndex(REPO, '103', 'Open Track', 'implement', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    git('worktree add -q -B track-103 .worktrees/103 HEAD');
    writeTrackIndex(join(REPO, '.worktrees/103'), '103', 'Open Track', 'implement', 'running');
    git('add -A', join(REPO, '.worktrees/103'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 103 in progress"', join(REPO, '.worktrees/103'));

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '103');
    assert.ok(row);
    assert.equal(row.classification, 'open');
  });

  it('classifies as conflicted when main edits the exact same line the branch touched, without progressing the track\'s own lane', async () => {
    // Deliberately does NOT change **Lane**/**Lane Status** on main — that
    // would trip the "reopened independently" signal (a different, correct
    // classification tested separately below). This represents a real,
    // narrower case: something else edited the same Problem text (a human
    // hand-editing spec content directly, as happens throughout this
    // project's own history) while the track's lane stayed put on main.
    setupRepo();
    writeTrackIndex(REPO, '104', 'Conflict Track', 'plan', 'queue', 'Original problem text.');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    git('worktree add -q -B track-104 .worktrees/104 HEAD');
    writeTrackIndex(join(REPO, '.worktrees/104'), '104', 'Conflict Track', 'done', 'success', 'Branch rewrote this problem text.');
    git('add -A', join(REPO, '.worktrees/104'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 104 done"', join(REPO, '.worktrees/104'));

    // Main edits the SAME line differently, but the lane marker is
    // unchanged from the merge-base (still "plan"/"queue") — not a lane
    // progression, just an overlapping edit.
    writeTrackIndex(REPO, '104', 'Conflict Track', 'plan', 'queue', 'Main rewrote this problem text differently.');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m "main edited the same line, unrelated to lane progress"');

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '104');
    assert.ok(row);
    assert.equal(row.classification, 'conflicted');
  });

  it('classifies as open (not mergeable) when main independently re-opened the track after the branch diverged', async () => {
    // Real-world trigger, confirmed against this repo's own history (track
    // 1084): an old worktree branch's own tip commit says done:success from
    // an early run, but the track was later re-planned/continued directly
    // on main, through a completely different path than that branch. The
    // branch's own snapshot is stale — merging it now would silently fight
    // main's newer, independent progress on the same track.
    setupRepo();
    writeTrackIndex(REPO, '106', 'Reopened Track', 'plan', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    git('worktree add -q -B track-106 .worktrees/106 HEAD');
    writeTrackIndex(join(REPO, '.worktrees/106'), '106', 'Reopened Track', 'done', 'success');
    git('add -A', join(REPO, '.worktrees/106'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 106 done (old run)"', join(REPO, '.worktrees/106'));

    // Main independently moves the SAME track forward afterward, without
    // ever touching the branch — e.g. a human re-planning it directly.
    writeTrackIndex(REPO, '106', 'Reopened Track', 'review', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m "main re-opened track 106 separately"');

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '106');
    assert.ok(row, 'a superseded branch must still be listed, not silently dropped');
    assert.equal(row.classification, 'open', 'a stale done:success snapshot must not be trusted once main has independently moved the same track');
  });

  it('lists a detached-HEAD worktree with no track-* branch as detached, never mergeable', async () => {
    // Reproduces the live `.worktrees/1063/.worktrees/9998` shape: a nested
    // worktree checked out at a detached HEAD, with no `track-*` branch at
    // all. `git branch --list track-*` can never surface this — it has to
    // come from the worktree list itself.
    setupRepo();
    writeTrackIndex(REPO, '107', 'Detached Parent', 'plan', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');
    const headSha = git('rev-parse HEAD');

    git(`worktree add -q --detach .worktrees/detached-scratch ${headSha}`);

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.worktreePath?.endsWith('.worktrees/detached-scratch'));
    assert.ok(row, 'a detached worktree with no track-* branch must still be listed');
    assert.equal(row.classification, 'detached');
    assert.equal(row.trackNumber, null);
  });

  it('does not misreport the primary checkout as a detached worktree when run from inside a linked worktree', async () => {
    // Real bug found while live-verifying against this repo: this session
    // itself runs from a linked worktree (.worktrees/1112), not the primary
    // checkout. auditWorktrees used to identify "the primary checkout" by
    // comparing each worktree path to the `repoRoot` argument — which,
    // called from a linked worktree, is the linked worktree's own path, not
    // the primary's. The primary checkout then fell through into the
    // "no track-* branch" bucket and was misreported as `detached`.
    setupRepo();
    writeTrackIndex(REPO, '108', 'Primary Repo Track', 'plan', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');
    git('worktree add -q -B track-108 .worktrees/108 HEAD');

    // Call auditWorktrees with repoRoot pointed at the LINKED worktree, the
    // same way a real invocation from inside .worktrees/108 would.
    const rows = await auditWorktrees({ repoRoot: join(REPO, '.worktrees/108'), mainBranch: 'main' });
    const primaryRow = rows.find(r => r.worktreePath === REPO);
    assert.equal(primaryRow, undefined, 'the primary checkout must never be reported as its own row');
  });

  it('does not merge, delete, or otherwise mutate anything — read-only', async () => {
    setupRepo();
    writeTrackIndex(REPO, '105', 'Readonly Track', 'plan', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');
    git('worktree add -q -B track-105 .worktrees/105 HEAD');

    const beforeBranch = git('rev-parse main');
    const beforeStatus = git('status --porcelain');
    await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    assert.equal(git('rev-parse main'), beforeBranch, 'main must not move');
    assert.equal(git('status --porcelain'), beforeStatus, 'working tree must not change');
    assert.ok(git('worktree list').includes('.worktrees/105'), 'worktree must still exist — audit must not remove anything');
  });
});
