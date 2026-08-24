#!/usr/bin/env node
// conductor/tests/track-1112-worktree-merge.test.mjs
// Track 1112 Phase 3 (D-5/REQ-7): mergeWorktreeBranch() merges a track-*
// branch into main WITHOUT ever running a mutating git command (merge,
// checkout, reset) in the primary checkout — verified empirically before
// writing this: git refuses to check out the same branch (main) in two
// worktrees at once, and moving refs/heads/main out from under a checked-
// out worktree via raw update-ref desyncs `git status` there unless the
// touched-but-clean paths are explicitly resynced afterward. That resync
// (skipping anything dirty) is the mechanism under test.
//
// Run: node --test conductor/tests/track-1112-worktree-merge.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { mergeWorktreeBranch } from '../services/worktree-merge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const REPO = join(ROOT, '.test-tmp-worktree-merge');

function git(cmd, cwd = REPO) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function gitQuiet(cmd, cwd = REPO) {
  try { return git(cmd, cwd); } catch (err) { return null; }
}

function setupRepo() {
  rmSync(REPO, { recursive: true, force: true });
  mkdirSync(REPO, { recursive: true });
  git('init -q');
  writeFileSync(join(REPO, 'file.txt'), 'base\n');
  writeFileSync(join(REPO, 'other.txt'), 'other-base\n');
  git('add -A');
  git('-c user.email=t@t -c user.name=t commit -q -m init');
  git('branch -m main');
}

function makeBranch(trackNumber, mutate) {
  const branch = `track-${trackNumber}`;
  git(`worktree add -q -B ${branch} .worktrees/${trackNumber} HEAD`);
  const wt = join(REPO, '.worktrees', String(trackNumber));
  mutate(wt);
  git('add -A', wt);
  git(`-c user.email=t@t -c user.name=t commit -q -m "${branch} commit"`, wt);
  git(`worktree remove --force .worktrees/${trackNumber}`);
  return branch;
}

describe('mergeWorktreeBranch()', () => {
  after(() => {
    try {
      const list = git('worktree list --porcelain').split('\n\n').filter(Boolean);
      for (const block of list) {
        const p = block.match(/^worktree (.+)$/m)?.[1];
        if (p && p !== REPO) execSync(`git -C "${REPO}" worktree remove --force "${p}"`, { stdio: 'ignore' });
      }
    } catch { /* ignore */ }
    rmSync(REPO, { recursive: true, force: true });
  });

  it('merges a branch into main and the primary checkout status is byte-identical before/after', async () => {
    setupRepo();
    makeBranch(201, (wt) => writeFileSync(join(wt, 'file.txt'), 'base\nbranch change\n'));

    const beforeHead = git('rev-parse --abbrev-ref HEAD');
    const beforeStatus = git('status --porcelain');

    const result = await mergeWorktreeBranch({ repoRoot: REPO, trackNumber: '201', mainBranch: 'main' });
    assert.equal(result.merged, true);

    assert.equal(git('rev-parse --abbrev-ref HEAD'), beforeHead, 'primary HEAD branch name must not change');
    assert.equal(git('status --porcelain'), beforeStatus, 'primary status must be byte-identical (AC-6)');

    // The merge really did land on main.
    assert.equal(git('log --oneline -1 main').includes('Merge track 201'), true);
    assert.equal(readFileSync(join(REPO, 'file.txt'), 'utf8'), 'base\nbranch change\n', 'primary working file synced to merged content');
    assert.equal(gitQuiet('branch --list track-201'), '', 'merged branch should be deleted');
  });

  it('merges even when a dirty local edit in the primary checkout overlaps a file the branch also touched — merge succeeds, dirty edit left untouched', async () => {
    setupRepo();
    makeBranch(202, (wt) => writeFileSync(join(wt, 'file.txt'), 'base\nbranch change\n'));

    // Primary checkout has its own uncommitted edit to the SAME file.
    writeFileSync(join(REPO, 'file.txt'), 'base\nMY UNCOMMITTED EDIT\n');

    const result = await mergeWorktreeBranch({ repoRoot: REPO, trackNumber: '202', mainBranch: 'main' });
    assert.equal(result.merged, true, 'merge must succeed even though the primary checkout has an overlapping dirty file');

    assert.equal(readFileSync(join(REPO, 'file.txt'), 'utf8'), 'base\nMY UNCOMMITTED EDIT\n', 'the uncommitted edit must be left exactly as the human left it — content is the load-bearing guarantee here');
    // The status line itself is deliberately NOT " M" (unstaged-only) here: that would require
    // silently rebasing the index's baseline for this path onto the merge's version while leaving
    // the human's edit as-is, which would make the diff shown to them stop reflecting the branch's
    // change at all — an actively worse, silently-lossy-looking outcome. "MM" (both staged, since
    // the committed baseline advanced, and unstaged, since their edit still differs from it) is the
    // honest representation: this file is now both locally modified AND behind the new merge commit.
    assert.equal(git('status --porcelain'), 'MM file.txt', 'file.txt must still be reported as touched — this repo\'s dirty overlap safety net is "leave content alone", not "hide that a merge happened"');
  });

  it('leaves branch and worktree intact on conflict, and never leaves the primary checkout mid-merge', async () => {
    setupRepo();
    // Two branches editing the same line differently — a genuine conflict.
    makeBranch(203, (wt) => writeFileSync(join(wt, 'file.txt'), 'base\nBRANCH VERSION\n'));
    writeFileSync(join(REPO, 'file.txt'), 'base\nMAIN VERSION\n');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m "main diverges on the same line"');

    const beforeHead = git('rev-parse --abbrev-ref HEAD');
    const beforeStatus = git('status --porcelain');

    const result = await mergeWorktreeBranch({ repoRoot: REPO, trackNumber: '203', mainBranch: 'main' });
    assert.equal(result.merged, false);
    assert.equal(result.reason, 'conflict');
    assert.ok(result.conflictPaths.includes('file.txt'));

    assert.equal(git('rev-parse --abbrev-ref HEAD'), beforeHead);
    assert.equal(git('status --porcelain'), beforeStatus, 'a failed merge must not touch the primary checkout at all');
    assert.notEqual(gitQuiet('branch --list track-203'), '', 'branch must survive a conflicted merge');
    assert.equal(existsSync(join(REPO, '.git', 'MERGE_HEAD')), false, 'primary checkout must never show a MERGING state');
  });

  it('auto-resolves a conflict limited to a status-header line in the track\'s own index.md, preferring the branch\'s copy', async () => {
    // Reproduces the track-10014 incident live: main independently touched
    // this same track's index.md (the periodic DB->FS sync writing status
    // headers directly onto main), and the branch ALSO touched it (its own
    // completion record) — same file, same **Progress** line, a real git
    // conflict by content. But since main's own side of the conflict never
    // touched anything but a known status-header line (confirmed against
    // the merge-base, not just "same filename"), it's the sync-mirror
    // artifact, not real content — the branch's copy is the authoritative
    // "what actually happened".
    setupRepo();
    const trackDir = 'conductor/tracks/208-bookkeeping-conflict';
    mkdirSync(join(REPO, trackDir), { recursive: true });
    const content = (lane, laneStatus, progress) =>
      `# Track 208\n\n**Lane**: ${lane}\n**Lane Status**: ${laneStatus}\n**Progress**: ${progress}\n`;
    writeFileSync(join(REPO, trackDir, 'index.md'), content('plan', 'queue', '0%'));
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    makeBranch(208, (wt) => {
      writeFileSync(join(wt, trackDir, 'index.md'), content('done', 'success', '100%'));
    });

    // Main independently bumps Progress (the sync-mirror pattern) — same
    // Lane/Lane Status as base, real content overlap on the Progress line.
    writeFileSync(join(REPO, trackDir, 'index.md'), content('plan', 'queue', '50%'));
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m "main independently re-synced this track\'s status"');

    const result = await mergeWorktreeBranch({ repoRoot: REPO, trackNumber: '208', mainBranch: 'main' });
    assert.equal(result.merged, true, 'a conflict limited to a status-header line must not block the merge');
    assert.equal(readFileSync(join(REPO, trackDir, 'index.md'), 'utf8'), content('done', 'success', '100%'), 'the branch\'s completion record wins, not main\'s stale mirror');
    assert.equal(git('status --porcelain'), '', 'primary checkout must end up clean, not mid-resolution');
  });

  it('still blocks on a real code conflict even when a bookkeeping file ALSO conflicts in the same merge', async () => {
    setupRepo();
    const trackDir = 'conductor/tracks/209-mixed-conflict';
    mkdirSync(join(REPO, trackDir), { recursive: true });
    writeFileSync(join(REPO, trackDir, 'index.md'), '# base\n**Lane**: review\n');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    makeBranch(209, (wt) => {
      writeFileSync(join(wt, trackDir, 'index.md'), '# base\n**Lane**: done\n');
      writeFileSync(join(wt, 'file.txt'), 'base\nBRANCH VERSION\n');
    });

    writeFileSync(join(REPO, trackDir, 'index.md'), '# base\n**Lane**: implement\n');
    writeFileSync(join(REPO, 'file.txt'), 'base\nMAIN VERSION\n');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m "main diverges on both a bookkeeping file and real code"');

    const result = await mergeWorktreeBranch({ repoRoot: REPO, trackNumber: '209', mainBranch: 'main' });
    assert.equal(result.merged, false, 'a real code conflict must still block, even alongside an auto-resolvable bookkeeping conflict');
    assert.equal(result.reason, 'conflict');
    assert.ok(result.conflictPaths.includes('file.txt'));
  });

  it('returns no-branch when the branch does not exist, without touching anything', async () => {
    setupRepo();
    const beforeStatus = git('status --porcelain');
    const result = await mergeWorktreeBranch({ repoRoot: REPO, trackNumber: '999', mainBranch: 'main' });
    assert.equal(result.merged, false);
    assert.equal(result.reason, 'no-branch');
    assert.equal(git('status --porcelain'), beforeStatus);
  });

  it('leaves no scratch worktree behind after success or failure', async () => {
    setupRepo();
    makeBranch(204, (wt) => writeFileSync(join(wt, 'file.txt'), 'base\nchange\n'));
    await mergeWorktreeBranch({ repoRoot: REPO, trackNumber: '204', mainBranch: 'main' });
    const list = git('worktree list --porcelain');
    assert.equal(list.includes('.merge-'), false, 'scratch merge worktree must be removed after the run');
  });

  it('deletes the branch even when its original per-track worktree still exists at call time', async () => {
    // Real bug found live against this repo's own tracks 1053/1069: `git
    // branch -d` refuses (silently, when wrapped in a try/catch) to delete
    // a branch that's still checked out in ANOTHER worktree — the same
    // guard git applies to `branch -f`. A caller that removes the original
    // worktree only AFTER calling mergeWorktreeBranch() leaves the branch
    // merged but permanently undeleted, with no visible error. This test
    // deliberately does NOT pre-remove the worktree (unlike makeBranch(),
    // which always does) — mergeWorktreeBranch() itself must handle it.
    setupRepo();
    const branch = 'track-206';
    git('worktree add -q -B track-206 .worktrees/206 HEAD');
    writeFileSync(join(REPO, '.worktrees/206/file.txt'), 'base\nchange\n');
    git('add -A', join(REPO, '.worktrees/206'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track-206 commit"', join(REPO, '.worktrees/206'));
    assert.ok(existsSync(join(REPO, '.worktrees/206')), 'precondition: original worktree still exists');

    const result = await mergeWorktreeBranch({ repoRoot: REPO, trackNumber: '206', mainBranch: 'main' });
    assert.equal(result.merged, true);
    assert.equal(result.worktreeRemoved, true, 'the original per-track worktree must be reported as removed');
    assert.equal(existsSync(join(REPO, '.worktrees/206')), false, 'the original per-track worktree must actually be gone');
    assert.equal(gitQuiet('branch --list track-206'), '', 'the branch must actually be deleted, not merged-but-orphaned');
  });

  it('resyncs the TRUE primary checkout even when called with repoRoot pointed at a linked worktree', async () => {
    // Real bug found live against this repo's own tracks 1053/1069 — this
    // very session runs `lc worktrees merge` from inside its own linked
    // worktree (.worktrees/1112), which ALSO has a conductor/ directory
    // (it's a full checkout), so a naive "walk up looking for a project
    // root" resolver — findProjectRoot()'s exact behavior in bin/lc.mjs —
    // resolves to the LINKED worktree, not the true primary. Every
    // guarantee this file makes (AC-6, "never touches the shared
    // checkout") then silently applies to the wrong directory: the real
    // primary's index never gets resynced, and the "linked worktree" this
    // function was never supposed to touch gets modified instead.
    setupRepo();
    makeBranch(207, (wt) => writeFileSync(join(wt, 'file.txt'), 'base\nchange\n'));

    // A second, unrelated linked worktree — standing in for this session's
    // own .worktrees/1112, i.e. "some other worktree that happens to be
    // lying around and gets used as the invocation cwd".
    git('worktree add -q -B some-other-branch .worktrees/bystander HEAD');
    const bystanderPath = join(REPO, '.worktrees/bystander');

    const primaryStatusBefore = git('status --porcelain');
    const bystanderStatusBefore = git('status --porcelain', bystanderPath);

    // Call with repoRoot = the BYSTANDER worktree, exactly the mistake
    // findProjectRoot() makes when `lc` is invoked from inside one.
    const result = await mergeWorktreeBranch({ repoRoot: bystanderPath, trackNumber: '207', mainBranch: 'main' });
    assert.equal(result.merged, true);

    assert.equal(readFileSync(join(REPO, 'file.txt'), 'utf8'), 'base\nchange\n', 'the TRUE primary checkout must have received the merged content');
    assert.equal(git('status --porcelain'), primaryStatusBefore, 'the TRUE primary checkout must stay byte-identical (AC-6) regardless of which worktree repoRoot pointed at');
    assert.equal(git('status --porcelain', bystanderPath), bystanderStatusBefore, 'the bystander worktree that was merely used as an invocation path must be completely untouched');
  });

  it('merges a branch whose worktree directory never existed in the first place (RC-A case)', async () => {
    // makeBranch() always removes the worktree dir it created before
    // returning — every branch in this file already reproduces RC-A's
    // trigger. This test just makes the intent explicit.
    setupRepo();
    const branch = makeBranch(205, (wt) => writeFileSync(join(wt, 'file.txt'), 'base\nchange\n'));
    assert.equal(existsSync(join(REPO, '.worktrees', '205')), false, 'precondition: no worktree directory exists');

    const result = await mergeWorktreeBranch({ repoRoot: REPO, trackNumber: '205', mainBranch: 'main' });
    assert.equal(result.merged, true, 'a missing worktree directory must not block the merge');
  });
});
