// Track AM-10096: createWorktree() copied the repo's .claude into a worktree
// with `cp -r "<repo>/.claude" "<worktree>/.claude"`. Because this repo
// tracks files under .claude/, git worktree add checks that directory out
// FIRST, so cp -r's destination-exists trap fires every time: cp -r copies
// SRC itself into an existing DEST instead of DEST's contents, producing
// <worktree>/.claude/.claude. One extra nesting level landed on main per
// track lifecycle — 5 levels deep, 480 tracked files, before this fix.
//
// TC-9 is the primary regression guard: it fails against the old cp -r
// behavior (verified by hand — see spec.md) and must pass here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { shouldCopyClaudeEntry, copyClaudeDir } from '../services/claude-dir-copy.mjs';

function mkTmp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function findNestedClaudeDirs(root) {
  // Returns every path (relative to root) named .claude found anywhere
  // under root, including the top-level one — so ['.claude'] means "exactly
  // one, un-nested", [] means "no .claude at all", and anything with a
  // second '.claude/.claude...' entry means the bug reproduced.
  const found = [];
  function walk(dir, rel) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === '.git' || e.name === '.worktrees') continue;
      if (!e.isDirectory()) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === '.claude') found.push(relPath);
      walk(join(dir, e.name), relPath);
    }
  }
  walk(root, '');
  return found;
}

describe('shouldCopyClaudeEntry', () => {
  it('TC-1: copies the canonical skill file', () => {
    assert.equal(shouldCopyClaudeEntry('skills/laneconductor/SKILL.md'), true);
  });

  it('TC-2: copies MEMORY.md', () => {
    assert.equal(shouldCopyClaudeEntry('MEMORY.md'), true);
  });

  it('TC-3: refuses to copy an already-nested .claude (REQ-3)', () => {
    assert.equal(shouldCopyClaudeEntry('.claude'), false);
  });

  it('TC-4: refuses anything beneath a nested .claude', () => {
    assert.equal(shouldCopyClaudeEntry('.claude/skills/social-content/SKILL.md'), false);
  });

  it('TC-5: excludes settings.local.json (machine-local, REQ-4)', () => {
    assert.equal(shouldCopyClaudeEntry('settings.local.json'), false);
  });

  it('TC-6: excludes scheduled_tasks.lock and worktrees', () => {
    assert.equal(shouldCopyClaudeEntry('scheduled_tasks.lock'), false);
    assert.equal(shouldCopyClaudeEntry('worktrees'), false);
  });

  it('TC-7: exclusions are anchored at the .claude root, not any depth', () => {
    assert.equal(shouldCopyClaudeEntry('skills/my-settings.local.json'), true);
  });
});

describe('copyClaudeDir', () => {
  it('TC-8: destination does not exist — copies contents, no extra nesting', () => {
    const repoRoot = mkTmp('lc-src-');
    const worktreePath = join(mkTmp('lc-dst-parent-'), 'wt-missing');
    mkdirSync(join(repoRoot, '.claude', 'skills', 'laneconductor'), { recursive: true });
    writeFileSync(join(repoRoot, '.claude', 'skills', 'laneconductor', 'SKILL.md'), 'skill content');

    copyClaudeDir(repoRoot, worktreePath);

    assert.ok(existsSync(join(worktreePath, '.claude', 'skills', 'laneconductor', 'SKILL.md')));
    assert.ok(!existsSync(join(worktreePath, '.claude', '.claude')));
  });

  it('TC-9: destination already exists (the real git-worktree-add case) — still exactly one .claude (REQ-1)', () => {
    const repoRoot = mkTmp('lc-src-');
    const worktreePath = mkTmp('lc-dst-existing-');
    mkdirSync(join(repoRoot, '.claude', 'skills', 'laneconductor'), { recursive: true });
    writeFileSync(join(repoRoot, '.claude', 'skills', 'laneconductor', 'SKILL.md'), 'skill content');
    // Simulate git worktree add having already checked .claude out.
    mkdirSync(join(worktreePath, '.claude', 'skills', 'laneconductor'), { recursive: true });
    writeFileSync(join(worktreePath, '.claude', 'skills', 'laneconductor', 'SKILL.md'), 'stale checkout');

    copyClaudeDir(repoRoot, worktreePath);

    assert.ok(!existsSync(join(worktreePath, '.claude', '.claude')),
      'cp -r would have produced <dest>/.claude/.claude here — this is the bug');
    assert.equal(
      readFileSync(join(worktreePath, '.claude', 'skills', 'laneconductor', 'SKILL.md'), 'utf8'),
      'skill content'
    );
  });

  it('TC-10: idempotent across three consecutive calls (REQ-2)', () => {
    const repoRoot = mkTmp('lc-src-');
    const worktreePath = mkTmp('lc-dst-repeat-');
    mkdirSync(join(repoRoot, '.claude', 'skills'), { recursive: true });
    writeFileSync(join(repoRoot, '.claude', 'MEMORY.md'), 'mem');

    copyClaudeDir(repoRoot, worktreePath);
    copyClaudeDir(repoRoot, worktreePath);
    copyClaudeDir(repoRoot, worktreePath);

    assert.deepEqual(findNestedClaudeDirs(worktreePath), ['.claude']);
  });

  it('TC-11: self-healing — source already nested does not propagate the nest (REQ-3)', () => {
    const repoRoot = mkTmp('lc-src-nested-');
    const worktreePath = mkTmp('lc-dst-nested-');
    mkdirSync(join(repoRoot, '.claude', 'skills'), { recursive: true });
    writeFileSync(join(repoRoot, '.claude', 'MEMORY.md'), 'top');
    // Corrupt the source with 3 levels of nesting, as main currently has.
    mkdirSync(join(repoRoot, '.claude', '.claude', '.claude'), { recursive: true });
    writeFileSync(join(repoRoot, '.claude', '.claude', 'MEMORY.md'), 'nested-1');
    writeFileSync(join(repoRoot, '.claude', '.claude', '.claude', 'MEMORY.md'), 'nested-2');

    copyClaudeDir(repoRoot, worktreePath);

    assert.deepEqual(findNestedClaudeDirs(worktreePath), ['.claude']);
    assert.equal(readFileSync(join(worktreePath, '.claude', 'MEMORY.md'), 'utf8'), 'top');
  });

  it('TC-12: machine-local state never crosses into the worktree (REQ-4)', () => {
    const repoRoot = mkTmp('lc-src-');
    const worktreePath = mkTmp('lc-dst-');
    mkdirSync(join(repoRoot, '.claude', 'worktrees'), { recursive: true });
    writeFileSync(join(repoRoot, '.claude', 'settings.local.json'), '{}');
    writeFileSync(join(repoRoot, '.claude', 'scheduled_tasks.lock'), 'lock');
    writeFileSync(join(repoRoot, '.claude', 'worktrees', 'note.txt'), 'x');

    copyClaudeDir(repoRoot, worktreePath);

    assert.ok(!existsSync(join(worktreePath, '.claude', 'settings.local.json')));
    assert.ok(!existsSync(join(worktreePath, '.claude', 'scheduled_tasks.lock')));
    assert.ok(!existsSync(join(worktreePath, '.claude', 'worktrees')));
  });

  it('TC-13: source .claude absent — no-op, no throw', () => {
    const repoRoot = mkTmp('lc-src-empty-');
    const worktreePath = mkTmp('lc-dst-empty-');

    assert.doesNotThrow(() => copyClaudeDir(repoRoot, worktreePath));
    assert.ok(!existsSync(join(worktreePath, '.claude')));
  });
});

describe('copyClaudeDir end-to-end with a real git worktree', () => {
  function initRepo() {
    const repoRoot = mkTmp('lc-e2e-repo-');
    execFileSync('git', ['init', '-q'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: repoRoot });
    mkdirSync(join(repoRoot, '.claude', 'skills', 'laneconductor'), { recursive: true });
    writeFileSync(join(repoRoot, '.claude', 'MEMORY.md'), 'mem');
    writeFileSync(join(repoRoot, '.claude', 'skills', 'laneconductor', 'SKILL.md'), 'skill v1');
    writeFileSync(join(repoRoot, 'README.md'), 'readme');
    execFileSync('git', ['add', '-A'], { cwd: repoRoot });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repoRoot });
    return repoRoot;
  }

  it('TC-14: real `git worktree add` + copyClaudeDir leaves exactly one .claude', () => {
    const repoRoot = initRepo();
    const worktreePath = join(repoRoot, '.worktrees', 'w1');
    execFileSync('git', ['worktree', 'add', '-b', 'track-w1', worktreePath], { cwd: repoRoot });

    // Sanity: git worktree add already materialized .claude before our copy runs.
    assert.ok(existsSync(join(worktreePath, '.claude', 'skills', 'laneconductor', 'SKILL.md')));

    copyClaudeDir(repoRoot, worktreePath);

    assert.deepEqual(findNestedClaudeDirs(worktreePath), ['.claude']);
    assert.equal(
      readFileSync(join(worktreePath, '.claude', 'skills', 'laneconductor', 'SKILL.md'), 'utf8'),
      'skill v1'
    );
  });

  it('TC-15: repo whose committed .claude is already nested still yields a clean worktree', () => {
    const repoRoot = initRepo();
    mkdirSync(join(repoRoot, '.claude', '.claude'), { recursive: true });
    writeFileSync(join(repoRoot, '.claude', '.claude', 'MEMORY.md'), 'nested');
    execFileSync('git', ['add', '-A'], { cwd: repoRoot });
    execFileSync('git', ['commit', '-q', '-m', 'corrupt'], { cwd: repoRoot });

    const worktreePath = join(repoRoot, '.worktrees', 'w2');
    execFileSync('git', ['worktree', 'add', '-b', 'track-w2', worktreePath], { cwd: repoRoot });

    copyClaudeDir(repoRoot, worktreePath);

    assert.deepEqual(findNestedClaudeDirs(worktreePath), ['.claude']);
  });

  it('TC-16: create/remove/re-create cycle three times stays at depth 1', () => {
    const repoRoot = initRepo();
    const worktreePath = join(repoRoot, '.worktrees', 'w3');

    for (let i = 0; i < 3; i++) {
      execFileSync('git', ['worktree', 'add', '-B', 'track-w3', worktreePath], { cwd: repoRoot });
      copyClaudeDir(repoRoot, worktreePath);
      assert.deepEqual(findNestedClaudeDirs(worktreePath), ['.claude'], `cycle ${i}`);
      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot });
    }
  });
});
