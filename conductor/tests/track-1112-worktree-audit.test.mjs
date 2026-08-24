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

// Track 10018: this whole suite exercises local-merge classification
// (mergeable/stranded/conflicted), which only applies to merge_mode:
// 'direct' tracks now that unspecified defaults to 'pr' — so every fixture
// here declares itself 'direct' by default, same as the real migration
// Phase 6 applies to this repo's own e2e/canary tracks. Pass
// mergeMode: null explicitly for the one test that specifically covers the
// pr-open classification itself.
function writeTrackIndex(dir, trackNumber, title, lane, laneStatus, problemText = 'Test.', mergeMode = 'direct') {
  const trackDir = join(dir, 'conductor/tracks', `${trackNumber}-${title.toLowerCase().replace(/\s+/g, '-')}`);
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    `# Track ${trackNumber}: ${title}`, '',
    `**Lane**: ${lane}`, `**Lane Status**: ${laneStatus}`, '**Progress**: 0%',
    ...(mergeMode ? [`**Merge Mode**: ${mergeMode}`] : []), '',
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
    assert.equal(row.mergeMode, 'direct');
  });

  // Track 10018 (TC-4.1-ish, at the audit layer): a pr-mode track that's
  // otherwise identical to the 'mergeable' fixture above must NEVER
  // classify as mergeable — that classification is what the panel wires
  // to a plain local-merge button, which would silently bypass PR review.
  it('classifies a done:success pr-mode branch as pr-open, never mergeable', async () => {
    setupRepo();
    writeTrackIndex(REPO, '201', 'PR Track', 'plan', 'queue', 'Test.', null);
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    git('worktree add -q -B track-201 .worktrees/201 HEAD');
    writeTrackIndex(join(REPO, '.worktrees/201'), '201', 'PR Track', 'done', 'success', 'Test.', null);
    git('add -A', join(REPO, '.worktrees/201'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 201 done, unspecified merge mode"', join(REPO, '.worktrees/201'));

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '201');
    assert.ok(row, 'track 201 should appear in the audit');
    assert.equal(row.classification, 'pr-open');
    assert.equal(row.mergeMode, 'pr'); // unspecified marker resolves to 'pr'
    assert.equal(row.hasWorktree, true);
  });

  it('carries PR Number/URL/Status markers through to the row once a PR is opened', async () => {
    setupRepo();
    writeTrackIndex(REPO, '202', 'PR With Number', 'plan', 'queue', 'Test.', null);
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    git('worktree add -q -B track-202 .worktrees/202 HEAD');
    const trackDir = join(REPO, '.worktrees/202', 'conductor/tracks/202-pr-with-number');
    mkdirSync(trackDir, { recursive: true });
    writeFileSync(join(trackDir, 'index.md'), [
      '# Track 202: PR With Number', '',
      '**Lane**: done', '**Lane Status**: success', '**Progress**: 100%',
      '**Merge Mode**: pr', '**PR Number**: 42', '**PR URL**: https://github.com/org/repo/pull/42',
      '**PR Status**: open', '',
    ].join('\n'));
    git('add -A', join(REPO, '.worktrees/202'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 202 pr open"', join(REPO, '.worktrees/202'));

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '202');
    assert.equal(row.classification, 'pr-open');
    assert.equal(row.prNumber, '42');
    assert.equal(row.prUrl, 'https://github.com/org/repo/pull/42');
    assert.equal(row.prStatus, 'open');
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

  it('classifies as mergeable when the only conflict is a status-header line (Progress) inside the track\'s own index.md', async () => {
    // Track 1114 Phase 17: main and the branch both changed the SAME
    // **Progress** line differently — a real git conflict, but confined
    // to a known status-header field (not Problem/Solution prose), which
    // mergeWorktreeBranch() can now auto-resolve by taking the branch's
    // copy. Lane/Lane Status deliberately left unchanged on main (still
    // plan/queue, same as base) so the reopened-independently guard
    // doesn't fire — isolating this test to the conflict-classification
    // change alone. Classification must agree with mergeWorktreeBranch's
    // own resolution, or the 60s reconciler (which only attempts
    // 'mergeable'/'stranded' rows) will never even try merging it.
    setupRepo();
    const dir = join(REPO, 'conductor/tracks/111-bookkeeping-conflict');
    mkdirSync(dir, { recursive: true });
    const content = (lane, laneStatus, progress) =>
      `# Track 111: Bookkeeping Conflict\n\n**Lane**: ${lane}\n**Lane Status**: ${laneStatus}\n**Progress**: ${progress}\n**Merge Mode**: direct\n\n## Problem\nSame problem text everywhere.\n`;
    writeFileSync(join(dir, 'index.md'), content('plan', 'queue', '0%'));
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    git('worktree add -q -B track-111 .worktrees/111 HEAD');
    writeFileSync(join(REPO, '.worktrees/111/conductor/tracks/111-bookkeeping-conflict/index.md'), content('done', 'success', '100%'));
    git('add -A', join(REPO, '.worktrees/111'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 111 done"', join(REPO, '.worktrees/111'));

    // Main bumps Progress independently — same Lane/Lane Status as base.
    writeFileSync(join(dir, 'index.md'), content('plan', 'queue', '50%'));
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m "main bumped progress independently"');

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '111');
    assert.ok(row);
    assert.equal(row.classification, 'mergeable', 'a conflict limited to a status-header line must not be reported as conflicted');
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

  it('fully resolves a dead "running" marker on main to mergeable — the exact track-10011/10014 shape', async () => {
    // Reproduces this repo's own track-10011 incident: an earlier, premature
    // merge landed the track on main while it was still mid-pipeline. Main's
    // own copy then got auto-launched forward independently and got stuck at
    // quality-gate:running with its worker long gone (no lock — the process
    // that was "running" it is dead). Meanwhile the ORIGINAL branch kept
    // going on its own and reached a real, later done:success. Because a
    // stale "running" marker alone used to be enough to trip the
    // reopened-independently guard, the branch's real completion was
    // permanently stuck as 'open' — invisible, indistinguishable from an
    // ordinary track still being worked on — and never auto-merged; it took
    // a manual, out-of-band `git merge` to land it.
    //
    // A `running` status with no corresponding conductor/locks/<track>.lock
    // is not live independent progress (nothing can legitimately be running
    // without holding that lock — the same invariant reconcileWorktrees()
    // already leans on to avoid merging out from under a genuinely active
    // run), so it no longer blocks classification outright (first fix).
    // What's left — main and the branch both rewrote the exact same
    // **Lane**/**Lane Status** header lines — used to still require a human
    // (surfaced as 'conflicted') until Phase 17's content-aware check: since
    // main's side of the conflict never touched anything but known
    // status-header lines relative to the merge-base, it's confirmed to be
    // the periodic sync-mirror artifact, not real content — so this now
    // resolves all the way to 'mergeable', matching what actually happened
    // to track 10014 (found live in this exact shape) once both fixes
    // landed together.
    setupRepo();
    writeTrackIndex(REPO, '109', 'Stranded By Stale Running', 'review', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    git('worktree add -q -B track-109 .worktrees/109 HEAD');
    writeTrackIndex(join(REPO, '.worktrees/109'), '109', 'Stranded By Stale Running', 'done', 'success');
    git('add -A', join(REPO, '.worktrees/109'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 109 really finished"', join(REPO, '.worktrees/109'));

    // Main independently advances the SAME stale pre-merge copy through the
    // pipeline and gets stuck "running" with no live process behind it.
    writeTrackIndex(REPO, '109', 'Stranded By Stale Running', 'quality-gate', 'running');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m "main independently ran this further and got stuck"');

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '109');
    assert.ok(row);
    assert.equal(row.classification, 'mergeable', 'a dead running marker with a header-only conflict must fully resolve, not sit as conflicted or open');
  });

  it('still treats a "running" marker on main as independent reopening when a real lock backs it', async () => {
    // The other half of the fix above: a `running` marker IS trusted, and
    // still blocks the merge, when a matching lock file proves it's a
    // genuinely live, in-progress run — the exact case the guard exists to
    // protect in the first place.
    setupRepo();
    writeTrackIndex(REPO, '110', 'Genuinely Running', 'review', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    git('worktree add -q -B track-110 .worktrees/110 HEAD');
    writeTrackIndex(join(REPO, '.worktrees/110'), '110', 'Genuinely Running', 'done', 'success');
    git('add -A', join(REPO, '.worktrees/110'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 110 done on the branch"', join(REPO, '.worktrees/110'));

    writeTrackIndex(REPO, '110', 'Genuinely Running', 'quality-gate', 'running');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m "main is actively running this track right now"');
    mkdirSync(join(REPO, '.conductor', 'locks'), { recursive: true });
    writeFileSync(join(REPO, '.conductor', 'locks', '110.lock'), 'held');

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '110');
    assert.ok(row);
    assert.equal(row.classification, 'open', 'a live-locked running run must still block the merge');
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

  it('resolves the lock-file check against the PRIMARY checkout even when called with a linked worktree repoRoot (track 10019 / S11)', async () => {
    // Real bug found live (track 10019): mainHasReopenedTrackIndependently()
    // built its `.conductor/locks/<n>.lock` path from whatever `repoRoot`
    // was passed in — correct only when the caller runs from the primary.
    // reconcileWorktrees() calls auditWorktrees({ repoRoot: process.cwd() })
    // on a 60s tick; if the worker's own cwd is ever a linked worktree
    // (the exact class this track exists to close), the lock check misses
    // a real, live lock and misclassifies an actively-reopened,
    // still-locked track as `mergeable` — safe to auto-merge out from
    // under a running worker.
    setupRepo();
    writeTrackIndex(REPO, '109', 'Reopened Track', 'done', 'success');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m "track 109 done"');
    git('worktree add -q -B track-109 .worktrees/109 HEAD');
    // Branch must have its own unmerged commit, or it's just an ancestor of
    // main and auditWorktrees skips it entirely as "fully merged".
    writeTrackIndex(join(REPO, '.worktrees/109'), '109', 'Reopened Track', 'done', 'success', 'Worktree-only commit.');
    git('add -A', join(REPO, '.worktrees/109'));
    git('-c user.email=t@t -c user.name=t commit -q -m "worktree unrelated commit"', join(REPO, '.worktrees/109'));

    mkdirSync(join(REPO, '.conductor/locks'), { recursive: true });
    writeFileSync(join(REPO, '.conductor/locks/109.lock'), '{"track_number":"109"}');
    writeTrackIndex(REPO, '109', 'Reopened Track', 'plan', 'running');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m "main reopened track 109 (locked)"');

    const fromPrimary = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const fromWorktree = await auditWorktrees({ repoRoot: join(REPO, '.worktrees/109'), mainBranch: 'main' });

    assert.equal(fromPrimary.find(r => r.trackNumber === '109')?.classification, 'open',
      'sanity check: a live lock protects the track when called from the primary');
    assert.equal(fromWorktree.find(r => r.trackNumber === '109')?.classification, 'open',
      'must still see the live lock — and refuse to classify as mergeable — when called with a linked worktree repoRoot');
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
