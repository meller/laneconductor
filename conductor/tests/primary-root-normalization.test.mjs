#!/usr/bin/env node
// conductor/tests/primary-root-normalization.test.mjs
// Track 10019 (REQ-1/REQ-1a): the sync worker's correctness for ~60
// process.cwd()-relative reads (`.env`, HARDCODED_DEFAULTS.repo_path,
// chokidar watch roots, .conductor/locks, tracks dir, logs, the 60s
// reconcile/summary ticks) previously depended entirely on the launcher
// happening to pass `cwd: workerRoot` — untrue for a direct `node
// conductor/laneconductor.sync.mjs` run from inside a linked worktree.
// resolvePrimaryCwdDecision() is the pure decision logic; laneconductor.sync.mjs
// itself can't be imported here (module-load side effects), so this
// exercises the extracted function plus a real chdir integration case.
//
// Run: node --test conductor/tests/primary-root-normalization.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'node:child_process';
import { resolvePrimaryCwdDecision } from '../services/primary-cwd.mjs';
import { resolvePrimaryRepoRoot } from '../services/worktree-merge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const REPO = join(ROOT, '.test-tmp-primary-root-normalization');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function setupRepoWithWorktree() {
  rmSync(REPO, { recursive: true, force: true });
  mkdirSync(REPO, { recursive: true });
  git(['init', '-q'], REPO);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], REPO);
  git(['branch', '-m', 'main'], REPO);
  git(['worktree', 'add', '-q', '-B', 'track-999', '.worktrees/999', 'HEAD'], REPO);
}

describe('resolvePrimaryCwdDecision', () => {
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

  it('recommends chdir when launched from inside a linked worktree', () => {
    setupRepoWithWorktree();
    const linkedWorktreeCwd = join(REPO, '.worktrees/999');
    const decision = resolvePrimaryCwdDecision({ cwd: linkedWorktreeCwd, isManager: false, resolvePrimaryRepoRoot });
    assert.equal(decision.shouldChdir, true);
    assert.equal(decision.primaryRoot, REPO);
    assert.equal(decision.launchCwd, linkedWorktreeCwd);
  });

  it('is a no-op when already launched from the primary checkout', () => {
    setupRepoWithWorktree();
    const decision = resolvePrimaryCwdDecision({ cwd: REPO, isManager: false, resolvePrimaryRepoRoot });
    assert.equal(decision.shouldChdir, false);
  });

  it('never redirects a --manager process, even from inside a worktree (REQ-1a)', () => {
    setupRepoWithWorktree();
    const linkedWorktreeCwd = join(REPO, '.worktrees/999');
    const decision = resolvePrimaryCwdDecision({ cwd: linkedWorktreeCwd, isManager: true, resolvePrimaryRepoRoot });
    assert.equal(decision.shouldChdir, false);
    assert.equal(decision.primaryRoot, null);
  });

  it('degrades to no-op, not a throw, when the resolver fails (outside any git repo) (REQ-1a)', () => {
    const notARepo = '/tmp';
    const decision = resolvePrimaryCwdDecision({
      cwd: notARepo,
      isManager: false,
      resolvePrimaryRepoRoot: () => { throw new Error('not a git repository'); },
    });
    assert.equal(decision.shouldChdir, false);
    assert.equal(decision.primaryRoot, null);
  });

  it('integration: a real chdir following the decision lands the process on the primary checkout', () => {
    setupRepoWithWorktree();
    const linkedWorktreeCwd = join(REPO, '.worktrees/999');
    const before = process.cwd();
    try {
      const decision = resolvePrimaryCwdDecision({ cwd: linkedWorktreeCwd, isManager: false, resolvePrimaryRepoRoot });
      assert.equal(decision.shouldChdir, true);
      process.chdir(decision.primaryRoot);
      assert.equal(process.cwd(), REPO);
    } finally {
      process.chdir(before);
    }
  });
});
