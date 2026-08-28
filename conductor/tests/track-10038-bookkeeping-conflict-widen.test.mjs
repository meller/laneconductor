#!/usr/bin/env node
// conductor/tests/track-10038-bookkeeping-conflict-widen.test.mjs
// Track 10038: widens isSafeToAutoResolveBookkeepingConflict() beyond the
// track-1114 header-only rule to also recognize a conflict where main's
// content is byte-identical to the BRANCH's content — i.e. main and the
// branch independently converged on the same real state (e.g. the live
// sync worker mirroring checkbox ticks into main's copy of plan.md while
// the branch mirrors the same ticks via its own real commits, as happened
// on track 10037). Either rule passing is sufficient; a genuine divergence
// from both base and branch must still block.
//
// Run: node --test conductor/tests/track-10038-bookkeeping-conflict-widen.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { isSafeToAutoResolveBookkeepingConflict } from '../services/track-metadata-conflict.mjs';
import { mergeWorktreeBranch } from '../services/worktree-merge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const UNIT_REPO = join(ROOT, '.test-tmp-10038-conflict-widen-unit');
const E2E_REPO = join(ROOT, '.test-tmp-10038-conflict-widen-e2e');

function git(cmd, cwd) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function gitQuiet(cmd, cwd) {
  try { return git(cmd, cwd); } catch { return null; }
}

// --- Unit-test repo builder: three divergent commits (base, branch, main)
// on plain branches — no worktrees needed since isSafeToAutoResolveBookkeepingConflict
// only reads refs via `git show`/`git merge-base`, it never merges anything.
function setupUnitRepo() {
  rmSync(UNIT_REPO, { recursive: true, force: true });
  mkdirSync(UNIT_REPO, { recursive: true });
  git('init -q', UNIT_REPO);
  git('-c user.email=t@t -c user.name=t commit -q -m init --allow-empty', UNIT_REPO);
  git('branch -m main', UNIT_REPO);
}

function makeDivergence({ trackNumber, path, baseContent, branchContent, mainContent }) {
  const trackDir = `conductor/tracks/${trackNumber}-test-track`;
  mkdirSync(join(UNIT_REPO, trackDir), { recursive: true });
  const fullPath = join(UNIT_REPO, trackDir, path);
  writeFileSync(fullPath, baseContent);
  git('add -A', UNIT_REPO);
  git('-c user.email=t@t -c user.name=t commit -q -m base', UNIT_REPO);

  const branch = `track-${trackNumber}`;
  git(`checkout -q -b ${branch}`, UNIT_REPO);
  writeFileSync(fullPath, branchContent);
  git('add -A', UNIT_REPO);
  git(`-c user.email=t@t -c user.name=t commit -q -m "${branch} commit"`, UNIT_REPO);

  git('checkout -q main', UNIT_REPO);
  writeFileSync(fullPath, mainContent);
  git('add -A', UNIT_REPO);
  git('-c user.email=t@t -c user.name=t commit -q -m "main independently diverges"', UNIT_REPO);

  return { trackDir, branch, conflictPath: `${trackDir}/${path}` };
}

describe('isSafeToAutoResolveBookkeepingConflict() — track 10038 widening', () => {
  after(() => {
    rmSync(UNIT_REPO, { recursive: true, force: true });
  });

  it('TC-1: header-only divergence on main (existing track-1114 case) is still safe', () => {
    setupUnitRepo();
    const content = (lane, progress) => `# Track 301\n\n**Lane**: ${lane}\n**Progress**: ${progress}\n`;
    const { branch, conflictPath } = makeDivergence({
      trackNumber: 301,
      path: 'index.md',
      baseContent: content('plan', '0%'),
      branchContent: content('done', '100%'),
      mainContent: content('plan', '50%'), // only header lines changed relative to base
    });

    const safe = isSafeToAutoResolveBookkeepingConflict({
      repoRoot: UNIT_REPO, mainBranch: 'main', branch, conflictPaths: [conflictPath], trackNumber: '301',
    });
    assert.equal(safe, true, 'AC-2: header-only divergence must still auto-resolve, no regression');
  });

  it('TC-2: checkbox-line divergence on main identical to the branch\'s content is now safe', () => {
    setupUnitRepo();
    const { branch, conflictPath } = makeDivergence({
      trackNumber: 302,
      path: 'plan.md',
      baseContent: '# Plan\n\n- [ ] Task 1\n- [ ] Task 2\n',
      branchContent: '# Plan\n\n- [x] Task 1\n- [x] Task 2\n',
      // main independently mirrors the exact same ticks (e.g. the DB->FS
      // sync worker) — real content divergence from base, but identical to
      // the branch's own independently-arrived-at result.
      mainContent: '# Plan\n\n- [x] Task 1\n- [x] Task 2\n',
    });

    const safe = isSafeToAutoResolveBookkeepingConflict({
      repoRoot: UNIT_REPO, mainBranch: 'main', branch, conflictPaths: [conflictPath], trackNumber: '302',
    });
    assert.equal(safe, true, 'AC-1: main and branch converging on identical content must be classified safe');
  });

  it('TC-3: divergence matching NEITHER base NOR branch still blocks', () => {
    setupUnitRepo();
    const { branch, conflictPath } = makeDivergence({
      trackNumber: 303,
      path: 'plan.md',
      baseContent: '# Plan\n\n- [ ] Task 1\n- [ ] Task 2\n',
      branchContent: '# Plan\n\n- [x] Task 1\n- [x] Task 2\n',
      // A human hand-edited plan.md prose directly on main — differs from
      // both the base (stripped) and the branch's content.
      mainContent: '# Plan\n\n- [x] Task 1\n- [ ] Task 2\n- [ ] Task 3 added by hand on main\n',
    });

    const safe = isSafeToAutoResolveBookkeepingConflict({
      repoRoot: UNIT_REPO, mainBranch: 'main', branch, conflictPaths: [conflictPath], trackNumber: '303',
    });
    assert.equal(safe, false, 'AC-3: genuine un-mirrored divergence on main must still block');
  });

  it('TC-4: a conflict path outside the bookkeeping whitelist is never safe, regardless of content', () => {
    setupUnitRepo();
    const { branch } = makeDivergence({
      trackNumber: 304,
      path: 'plan.md',
      baseContent: 'base\n',
      branchContent: 'same\n',
      mainContent: 'same\n',
    });

    const safe = isSafeToAutoResolveBookkeepingConflict({
      repoRoot: UNIT_REPO, mainBranch: 'main', branch, conflictPaths: ['ui/server/index.mjs'], trackNumber: '304',
    });
    assert.equal(safe, false, 'isTrackBookkeepingConflict gate must still be enforced');
  });

  it('TC-5: multiple conflicting paths — one safe, one unsafe — must block overall (AND semantics)', () => {
    setupUnitRepo();
    const trackNumber = 305;
    const branch = `track-${trackNumber}`;
    const trackDir = `conductor/tracks/${trackNumber}-test-track`;
    mkdirSync(join(UNIT_REPO, trackDir), { recursive: true });

    const safePath = join(UNIT_REPO, trackDir, 'index.md');
    const unsafePath = join(UNIT_REPO, trackDir, 'plan.md');

    writeFileSync(safePath, '**Lane**: plan\n');
    writeFileSync(unsafePath, '# Plan\n\n- [ ] Task 1\n');
    git('add -A', UNIT_REPO);
    git('-c user.email=t@t -c user.name=t commit -q -m base', UNIT_REPO);

    git(`checkout -q -b ${branch}`, UNIT_REPO);
    writeFileSync(safePath, '**Lane**: done\n');
    writeFileSync(unsafePath, '# Plan\n\n- [x] Task 1\n');
    git('add -A', UNIT_REPO);
    git(`-c user.email=t@t -c user.name=t commit -q -m "${branch} commit"`, UNIT_REPO);

    git('checkout -q main', UNIT_REPO);
    writeFileSync(safePath, '**Lane**: plan\n'); // header-only vs base -> safe on its own
    writeFileSync(unsafePath, '# Plan\n\n- [x] Task 1\n- [ ] Task 2 hand-added on main\n'); // matches neither -> unsafe
    git('add -A', UNIT_REPO);
    git('-c user.email=t@t -c user.name=t commit -q -m "main diverges, mixed safety"', UNIT_REPO);

    const safe = isSafeToAutoResolveBookkeepingConflict({
      repoRoot: UNIT_REPO,
      mainBranch: 'main',
      branch,
      conflictPaths: [`${trackDir}/index.md`, `${trackDir}/plan.md`],
      trackNumber: String(trackNumber),
    });
    assert.equal(safe, false, 'every conflicting path must independently be safe for the overall result to be safe');
  });
});

// --- End-to-end repro via the real mergeWorktreeBranch() primitive.
function setupE2eRepo() {
  rmSync(E2E_REPO, { recursive: true, force: true });
  mkdirSync(E2E_REPO, { recursive: true });
  git('init -q', E2E_REPO);
  writeFileSync(join(E2E_REPO, 'file.txt'), 'base\n');
  git('add -A', E2E_REPO);
  git('-c user.email=t@t -c user.name=t commit -q -m init', E2E_REPO);
  git('branch -m main', E2E_REPO);
}

function makeBranch(trackNumber, mutate) {
  const branch = `track-${trackNumber}`;
  git(`worktree add -q -B ${branch} .worktrees/${trackNumber} HEAD`, E2E_REPO);
  const wt = join(E2E_REPO, '.worktrees', String(trackNumber));
  mutate(wt);
  git('add -A', wt);
  git(`-c user.email=t@t -c user.name=t commit -q -m "${branch} commit"`, wt);
  git(`worktree remove --force .worktrees/${trackNumber}`, E2E_REPO);
  return branch;
}

describe('mergeWorktreeBranch() — track 10038 checkbox-mirroring repro', () => {
  after(() => {
    try {
      const list = git('worktree list --porcelain', E2E_REPO).split('\n\n').filter(Boolean);
      for (const block of list) {
        const p = block.match(/^worktree (.+)$/m)?.[1];
        if (p && p !== E2E_REPO) execSync(`git -C "${E2E_REPO}" worktree remove --force "${p}"`, { stdio: 'ignore' });
      }
    } catch { /* ignore */ }
    rmSync(E2E_REPO, { recursive: true, force: true });
  });

  it('TC-6: track-10037 shape — main mirrors the branch\'s exact final checkbox state independently — merges cleanly, no manual intervention', async () => {
    // Note on this test's shape, found while implementing this track: git's
    // own 3-way merge already auto-resolves a path where both sides'
    // committed blobs are fully byte-identical — verified empirically
    // against plain `git merge` before writing this (a checkbox-only tick
    // plus an unrelated same-file addition on ONE side only DOES still
    // conflict, since the sides then differ; only a fully-converged file
    // merges silently). So a real `git merge --no-ff` conflict on a path
    // can only ever occur when mainContent !== branchContent for that path
    // — which means rule 2 (isSafeToAutoResolveBookkeepingConflict's new
    // "identical to branch" check) can never be the deciding factor for a
    // conflict reached through mergeWorktreeBranch()/auditWorktrees() (both
    // go through a real git merge/merge-tree). Rule 2 is proven correct and
    // meaningful at the predicate level directly (TC-2 above, which goes
    // red before the fix and green after) — it's forward-looking defense
    // for any future caller that classifies conflictPaths by a coarser
    // mechanism than an actual attempted git merge. This test instead
    // confirms the full checkbox-mirroring-convergence shape behaves
    // correctly end-to-end (AC-1's outcome: auto-resolved, no manual
    // intervention needed) — here via git's own native resolution, since
    // main and branch reach byte-identical content.
    setupE2eRepo();
    const trackDir = 'conductor/tracks/310-checkbox-mirror';
    mkdirSync(join(E2E_REPO, trackDir), { recursive: true });
    writeFileSync(join(E2E_REPO, trackDir, 'plan.md'), '# Plan\n\n- [ ] Task 1\n- [ ] Task 2\n');
    git('add -A', E2E_REPO);
    git('-c user.email=t@t -c user.name=t commit -q -m base', E2E_REPO);

    const finalContent = '# Plan\n\n- [x] Task 1\n- [x] Task 2\n\n## Complete\n';
    makeBranch(310, (wt) => {
      writeFileSync(join(wt, trackDir, 'plan.md'), finalContent);
    });

    // Main independently mirrors the exact same final state via the live
    // sync worker (e.g. the DB already held this track's completed
    // plan.md content and the periodic sync wrote it verbatim onto main).
    writeFileSync(join(E2E_REPO, trackDir, 'plan.md'), finalContent);
    git('add -A', E2E_REPO);
    git('-c user.email=t@t -c user.name=t commit -q -m "chore(track-310): sync files before worktree"', E2E_REPO);

    const result = await mergeWorktreeBranch({ repoRoot: E2E_REPO, trackNumber: '310', mainBranch: 'main' });
    assert.equal(result.merged, true, 'AC-1: checkbox-mirroring convergence must auto-resolve without manual intervention');
    assert.equal(readFileSync(join(E2E_REPO, trackDir, 'plan.md'), 'utf8'), finalContent);
  });

  it('TC-6b: main mirrors ticks but is missing content the branch added afterward — a genuine divergence, correctly still blocks', async () => {
    // The counterpart to TC-6: if main's mirror is only a partial/stale
    // snapshot (ticks match, but the branch has since added more, e.g. a
    // completion summary main never saw), mainContent !== branchContent —
    // rule 2 correctly does NOT apply, and this remains a real conflict
    // per REQ-3/AC-3, exactly like a hand-edit would.
    setupE2eRepo();
    const trackDir = 'conductor/tracks/312-partial-mirror';
    mkdirSync(join(E2E_REPO, trackDir), { recursive: true });
    writeFileSync(join(E2E_REPO, trackDir, 'plan.md'), '# Plan\n\n- [ ] Task 1\n- [ ] Task 2\n');
    git('add -A', E2E_REPO);
    git('-c user.email=t@t -c user.name=t commit -q -m base', E2E_REPO);

    makeBranch(312, (wt) => {
      writeFileSync(join(wt, trackDir, 'plan.md'), '# Plan\n\n- [x] Task 1\n- [x] Task 2\n\n## Complete\n');
    });

    // Main's mirror only captured the checkbox ticks, not the branch's
    // later "## Complete" addition — a real, unmirrored difference.
    writeFileSync(join(E2E_REPO, trackDir, 'plan.md'), '# Plan\n\n- [x] Task 1\n- [x] Task 2\n');
    git('add -A', E2E_REPO);
    git('-c user.email=t@t -c user.name=t commit -q -m "chore(track-312): sync files before worktree"', E2E_REPO);

    const result = await mergeWorktreeBranch({ repoRoot: E2E_REPO, trackNumber: '312', mainBranch: 'main' });
    assert.equal(result.merged, false, 'a partial/stale mirror is a real divergence and must still block');
    assert.equal(result.reason, 'conflict');
  });

  it('TC-7: main has a genuine unrelated hand-edit — merge still reports conflict', async () => {
    setupE2eRepo();
    const trackDir = 'conductor/tracks/311-real-divergence';
    mkdirSync(join(E2E_REPO, trackDir), { recursive: true });
    writeFileSync(join(E2E_REPO, trackDir, 'plan.md'), '# Plan\n\n- [ ] Task 1\n- [ ] Task 2\n');
    git('add -A', E2E_REPO);
    git('-c user.email=t@t -c user.name=t commit -q -m base', E2E_REPO);

    makeBranch(311, (wt) => {
      writeFileSync(join(wt, trackDir, 'plan.md'), '# Plan\n\n- [x] Task 1\n- [x] Task 2\n');
    });

    // Main hand-edits plan.md prose directly — not a mirror of the branch's
    // result at all.
    writeFileSync(join(E2E_REPO, trackDir, 'plan.md'), '# Plan\n\n- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3 added by hand on main\n');
    git('add -A', E2E_REPO);
    git('-c user.email=t@t -c user.name=t commit -q -m "human hand-edits plan.md directly on main"', E2E_REPO);

    const result = await mergeWorktreeBranch({ repoRoot: E2E_REPO, trackNumber: '311', mainBranch: 'main' });
    assert.equal(result.merged, false, 'AC-3: genuine divergence on main must still block');
    assert.equal(result.reason, 'conflict');
    assert.ok(result.conflictPaths.includes(`${trackDir}/plan.md`));
  });
});
