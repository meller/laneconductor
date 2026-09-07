#!/usr/bin/env node
// conductor/tests/track-10077-merge-mode-fallback.test.mjs
// Track 10077 Phase 3 (REQ-8/REQ-9): readTrackStateFromBranch() reads
// **Merge Mode** straight off the branch tip via `git show`, but that
// marker structurally can never be there for a track whose merge mode was
// set via the database — the DB->FS pull only ever writes the PRIMARY
// checkout's index.md, never the topic branch (F1/F6 in spec.md). Sampling
// found three live tracks (10050, 10067, 1119) misclassified 'pr' this way.
//
// Fix: fall back to the primary checkout's own **Merge Mode** marker when
// the branch's own copy has none, before falling back to the 'pr' default —
// mirroring the PR-fields fallback added for the same worktree-vanishes
// class of bug (e84a27eb).
//
// Run: node --test conductor/tests/track-10077-merge-mode-fallback.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { auditWorktrees } from '../services/worktree-audit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const REPO = join(ROOT, '.test-tmp-merge-mode-fallback');

function git(cmd, cwd = REPO) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function setupRepo() {
  rmSync(REPO, { recursive: true, force: true });
  mkdirSync(REPO, { recursive: true });
  git('init -q');
  git('-c user.email=t@t -c user.name=t commit -q --allow-empty -m init');
  git('branch -m main');
}

// Writes an index.md with an OPTIONAL Merge Mode line — pass null to omit
// the marker entirely (the exact shape of a branch that never committed one).
function writeIndex(dir, trackNumber, title, lane, laneStatus, mergeMode) {
  const trackDir = join(dir, 'conductor/tracks', `${trackNumber}-${title.toLowerCase().replace(/\s+/g, '-')}`);
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    `# Track ${trackNumber}: ${title}`, '',
    `**Lane**: ${lane}`, `**Lane Status**: ${laneStatus}`, '**Progress**: 100%',
    ...(mergeMode ? [`**Merge Mode**: ${mergeMode}`] : []), '',
  ].join('\n'));
  return trackDir;
}

describe('auditWorktrees() Merge Mode fallback (track 10077)', () => {
  after(() => {
    try {
      const list = git('worktree list --porcelain').split('\n\n').filter(Boolean);
      for (const block of list) {
        const p = block.match(/^worktree (.+)$/m)?.[1];
        if (p && p !== REPO) execSync(`git -C "${REPO}" worktree remove --force "${p}"`, { stdio: 'ignore' }).toString();
      }
    } catch { /* ignore */ }
    rmSync(REPO, { recursive: true, force: true });
  });

  it('TC-19: falls back to the primary checkout\'s Merge Mode when the branch has none', async () => {
    setupRepo();
    // Base commit has no track folder at all yet.
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q --allow-empty -m base');

    git('worktree add -q -B track-301 .worktrees/301 HEAD');
    // Branch's own copy: done, but NEVER committed a Merge Mode marker —
    // the exact track-10050 shape (F1: Merge Mode only ever enters the
    // primary checkout via the DB->FS pull, never a feat(track-N) commit).
    writeIndex(join(REPO, '.worktrees/301'), '301', 'No Marker On Branch', 'done', 'queue', null);
    git('add -A', join(REPO, '.worktrees/301'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 301 done, no merge mode marker"', join(REPO, '.worktrees/301'));

    // Primary checkout's own copy: direct, written by the DB->FS pull,
    // uncommitted (same as the real pull's behavior).
    writeIndex(REPO, '301', 'No Marker On Branch', 'plan', 'queue', 'direct');

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '301');
    assert.ok(row, 'track 301 should appear in the audit');
    assert.equal(row.mergeMode, 'direct', 'must fall back to the primary checkout\'s Merge Mode marker');
    assert.notEqual(row.classification, 'pr-open', 'a direct-mode track must never be misclassified pr-open');
  });

  it('TC-20: the branch\'s own marker still wins when present, even if the primary checkout disagrees', async () => {
    setupRepo();
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q --allow-empty -m base');

    git('worktree add -q -B track-302 .worktrees/302 HEAD');
    writeIndex(join(REPO, '.worktrees/302'), '302', 'Branch Wins', 'done', 'queue', 'pr');
    git('add -A', join(REPO, '.worktrees/302'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 302 done, pr on branch"', join(REPO, '.worktrees/302'));

    // Primary disagrees (stale or wrong) — branch's own opinion must win.
    writeIndex(REPO, '302', 'Branch Wins', 'plan', 'queue', 'direct');

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '302');
    assert.ok(row);
    assert.equal(row.mergeMode, 'pr', 'the branch\'s own committed marker must take precedence over the primary checkout\'s');
  });

  it('TC-21: resolves the unchanged "pr" default when neither branch nor primary has a marker', async () => {
    setupRepo();
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q --allow-empty -m base');

    git('worktree add -q -B track-303 .worktrees/303 HEAD');
    writeIndex(join(REPO, '.worktrees/303'), '303', 'No Marker Anywhere', 'done', 'queue', null);
    git('add -A', join(REPO, '.worktrees/303'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 303 done, no marker at all"', join(REPO, '.worktrees/303'));

    writeIndex(REPO, '303', 'No Marker Anywhere', 'plan', 'queue', null);

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '303');
    assert.ok(row);
    assert.equal(row.mergeMode, 'pr', 'the documented default must be unchanged when nobody has an opinion');
  });

  it('TC-22: does not throw when the primary checkout has no folder for the track at all', async () => {
    setupRepo();
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q --allow-empty -m base');

    git('worktree add -q -B track-304 .worktrees/304 HEAD');
    writeIndex(join(REPO, '.worktrees/304'), '304', 'No Primary Folder', 'done', 'queue', null);
    git('add -A', join(REPO, '.worktrees/304'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 304 done, primary never has this folder"', join(REPO, '.worktrees/304'));

    // Deliberately do NOT create conductor/tracks/304-... in the primary checkout.

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '304');
    assert.ok(row, 'must not throw or silently drop the row');
    assert.equal(row.mergeMode, 'pr', 'falls through to the default when there is nothing to fall back to');
  });

  it('TC-23 regression: the PR-fields fallback (e84a27eb) still resolves PR number/URL/status unaffected by the Merge Mode fallback', async () => {
    setupRepo();
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q --allow-empty -m base');

    git('worktree add -q -B track-305 .worktrees/305 HEAD');
    writeIndex(join(REPO, '.worktrees/305'), '305', 'Pr Fields Still Work', 'done', 'queue', null);
    git('add -A', join(REPO, '.worktrees/305'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 305 done"', join(REPO, '.worktrees/305'));

    // Primary supplies BOTH the Merge Mode fallback AND the PR fields —
    // exactly the shape a real pr-mode track with no worktree marker and an
    // open PR would have.
    const trackDir = writeIndex(REPO, '305', 'Pr Fields Still Work', 'plan', 'queue', 'pr');
    writeFileSync(join(trackDir, 'index.md'),
      readFileSync(join(trackDir, 'index.md'), 'utf8') +
      '**PR Number**: 55\n**PR URL**: https://github.com/org/repo/pull/55\n**PR Status**: open\n');

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '305');
    assert.ok(row);
    assert.equal(row.mergeMode, 'pr');
    assert.equal(row.prNumber, '55');
    assert.equal(row.prUrl, 'https://github.com/org/repo/pull/55');
    assert.equal(row.prStatus, 'open');
    assert.equal(row.classification, 'pr-open');
  });

  it('TC-24 regression: the no-merge-base discard path (tracks 9997/10011) still classifies as open, not pr-open, once Merge Mode falls back', async () => {
    setupRepo();
    writeIndex(REPO, '306', 'Discarded Post Rewrite', 'plan', 'queue', null);
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    git('worktree add -q -B track-306 .worktrees/306 HEAD');
    writeIndex(join(REPO, '.worktrees/306'), '306', 'Discarded Post Rewrite', 'done', 'success', null);
    git('add -A', join(REPO, '.worktrees/306'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 306 done"', join(REPO, '.worktrees/306'));
    git('worktree remove --force .worktrees/306');

    // Simulate the rewrite: no merge-base between the branch and main.
    git('checkout -q --orphan main-rewritten');
    git('-c user.email=t@t -c user.name=t commit -q --allow-empty -m "rewritten root"');
    git('branch -f main main-rewritten');
    git('checkout -q main');

    // discard-track's own action, committed onto the primary checkout only —
    // and it happens to also carry a Merge Mode marker now, from the DB/FS
    // pull, exactly like track 10050's own primary copy.
    writeIndex(REPO, '306', 'Discarded Post Rewrite', 'backlog', 'queue', 'direct');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m "Track 306: discarded"');

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '306');
    assert.ok(row, 'a discarded-but-still-unmerged branch must still be listed');
    assert.equal(row.classification, 'open', 'must still resolve to open, not be pulled toward pr-open/mergeable by the new fallback');
  });

  it('TC-25 regression: the forward-completion path (track 10067 shape) is unaffected by the fallback', async () => {
    setupRepo();
    writeIndex(REPO, '307', 'Done Via Primary Not Reopened', 'plan', 'queue', null);
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    git('worktree add -q -B track-307 .worktrees/307 HEAD');
    writeIndex(join(REPO, '.worktrees/307'), '307', 'Done Via Primary Not Reopened', 'done', 'queue', null);
    git('add -A', join(REPO, '.worktrees/307'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 307: quality-gate handed off to done"', join(REPO, '.worktrees/307'));

    git('checkout -q --orphan main-rewritten');
    git('-c user.email=t@t -c user.name=t commit -q --allow-empty -m "rewritten root"');
    git('branch -f main main-rewritten');
    git('checkout -q main');

    // The done lane's own merge action just succeeded — recorded on the
    // PRIMARY checkout only, now also carrying a Merge Mode marker.
    writeIndex(REPO, '307', 'Done Via Primary Not Reopened', 'done', 'success', 'pr');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m "Track 307: merged — track shipped to main"');

    const rows = await auditWorktrees({ repoRoot: REPO, mainBranch: 'main' });
    const row = rows.find(r => r.trackNumber === '307');
    assert.ok(row, 'a still-unmerged-by-git branch must still be listed');
    assert.equal(row.classification, 'pr-open', 'a normal done-lane success recorded on primary must not be mistaken for an independent reopen');
  });
});
