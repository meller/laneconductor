#!/usr/bin/env node
// conductor/tests/worktree-create-path-resolution.test.mjs
// Regression test for the nested-worktree bug: createWorktree()/removeWorktree()
// in laneconductor.sync.mjs used to build `.worktrees/<track>` off
// `process.cwd()` directly. When a worker's cwd is itself inside a linked
// worktree (e.g. running track 1112's own work from .worktrees/1112),
// that put new worktrees at .worktrees/1112/.worktrees/9998 instead of the
// primary repo's top-level .worktrees/9998 — exactly the live shape
// documented in track-1112-worktree-audit.test.mjs:172. Once the parent
// worktree is later removed, the nested one is orphaned: prunable,
// detached HEAD, reappearing on every worktree scan.
//
// The fix routes both functions through resolvePrimaryRepoRoot() (already
// used by mergeWorktreeBranch for the same reason) before composing the
// `.worktrees` path. This test exercises that primitive directly against a
// real, throwaway git repo with a linked worktree, since laneconductor.sync.mjs
// itself can't be imported in a test (module-load side effects: setInterval,
// chokidar) — the same constraint documented in path-isolation.mjs.
//
// Run: node --test conductor/tests/worktree-create-path-resolution.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'node:child_process';
import { resolvePrimaryRepoRoot } from '../services/worktree-merge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const REPO = join(ROOT, '.test-tmp-worktree-create-path-resolution');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

describe('worktree creation path resolution', () => {
  after(() => {
    try {
      const list = git(['worktree', 'list', '--porcelain'], REPO).split('\n\n').filter(Boolean);
      for (const block of list) {
        const p = block.match(/^worktree (.+)$/m)?.[1];
        if (p && p !== REPO) execFileSync('git', ['-C', REPO, 'worktree', 'remove', '--force', p], { stdio: 'ignore' });
      }
    } catch { /* ignore */ }
    rmSync(REPO, { recursive: true, force: true });
  });

  it('resolves the primary repo root even when cwd is inside a linked worktree, so a new .worktrees/<track> path never nests under the current worktree', () => {
    rmSync(REPO, { recursive: true, force: true });
    mkdirSync(REPO, { recursive: true });
    git(['init', '-q'], REPO);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], REPO);
    git(['branch', '-m', 'main'], REPO);

    // A worker is "running track 1112's work" from inside its own linked worktree.
    git(['worktree', 'add', '-q', '-B', 'track-1112', '.worktrees/1112', 'HEAD'], REPO);
    const linkedWorktreeCwd = join(REPO, '.worktrees/1112');

    // Old, buggy behavior: process.cwd() (the linked worktree) used directly.
    const buggyPath = join(linkedWorktreeCwd, '.worktrees', '9998');
    assert.ok(
      buggyPath.startsWith(join(linkedWorktreeCwd, '.worktrees')),
      'sanity check: the buggy path is the nested shape we are guarding against'
    );

    // Fixed behavior: resolve the primary first.
    const resolvedRoot = resolvePrimaryRepoRoot(linkedWorktreeCwd);
    assert.equal(resolvedRoot, REPO, 'must resolve to the primary checkout, not the linked worktree it was called from');

    const fixedPath = join(resolvedRoot, '.worktrees', '9998');
    assert.equal(fixedPath, join(REPO, '.worktrees', '9998'));
    assert.ok(
      !fixedPath.startsWith(join(linkedWorktreeCwd, '.worktrees')),
      'the resolved path must not nest inside the linked worktree that triggered creation'
    );
  });

  it('is a no-op when cwd already is the primary checkout', () => {
    rmSync(REPO, { recursive: true, force: true });
    mkdirSync(REPO, { recursive: true });
    git(['init', '-q'], REPO);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], REPO);
    git(['branch', '-m', 'main'], REPO);

    assert.equal(resolvePrimaryRepoRoot(REPO), REPO);
  });
});
