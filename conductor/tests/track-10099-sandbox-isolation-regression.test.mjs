#!/usr/bin/env node
// conductor/tests/track-10099-sandbox-isolation-regression.test.mjs
// Track AM-10099 Phase 1, Task 6 (REQ-1, AC-3): proves that REQ-1's fix
// pattern — a sandbox that is itself `git init`'d, even while physically
// NESTED inside a linked git worktree — actually prevents the escape that
// conductor/tests/track-10045-worktree-isolation.test.mjs's TC-1 reproduces
// for an ungitted sandbox in the identical position. That file is a
// deliberate permanent-red canary demonstrating the raw mechanism; this
// file is the positive case: the fix this track applies across AM-10089's
// 25 files, exercised end to end with a real worker spawn.
//
// TC-A is the regression: revert it (git-init the sandbox with a fresh,
// UNPROTECTED directory instead) and it fails exactly like TC-1 does.
//
// Run: node --test conductor/tests/track-10099-sandbox-isolation-regression.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_REPO_ROOT = join(__dirname, '../..');
const WORKER_SCRIPT = join(REAL_REPO_ROOT, 'conductor/laneconductor.sync.mjs');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

// Same disposable-fake-primary approach as track-10045-worktree-isolation's
// own helpers — deliberately not imported from that file (not exported),
// and deliberately never touching the real repo (REQ-15).
function makeFakePrimary() {
  const root = mkdtempSync(join(tmpdir(), 'lc10099-fakeprimary-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'fake primary — track 10099 Phase 1 regression\n');
  git(['add', '.'], root);
  git(['commit', '-q', '-m', 'init'], root);
  writeFileSync(join(root, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'fake-primary', repo_path: root, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
  }, null, 2));
  mkdirSync(join(root, 'conductor/tracks'), { recursive: true });
  return root;
}

function addWorktree(primaryRoot) {
  const wtPath = mkdtempSync(join(tmpdir(), 'lc10099-fakewt-'));
  rmSync(wtPath, { recursive: true, force: true }); // git worktree add requires the path not exist yet
  const branch = `track-10099-fake-${Date.now()}`;
  git(['worktree', 'add', '-q', '-b', branch, wtPath], primaryRoot);
  return wtPath;
}

function removeWorktree(primaryRoot, wtPath) {
  try { git(['worktree', 'remove', '--force', wtPath], primaryRoot); } catch { /* best-effort */ }
  rmSync(wtPath, { recursive: true, force: true });
}

async function killAndConfirmDead(worker, termMs = 3000, killMs = 2000) {
  worker.kill('SIGTERM');
  const termDeadline = Date.now() + termMs;
  while (Date.now() < termDeadline) {
    try { process.kill(worker.pid, 0); } catch { return; }
    await sleep(100);
  }
  try { process.kill(worker.pid, 'SIGKILL'); } catch { return; }
  const killDeadline = Date.now() + killMs;
  while (Date.now() < killDeadline) {
    try { process.kill(worker.pid, 0); } catch { return; }
    await sleep(50);
  }
}

async function captureServingRoot(sandboxCwd) {
  const worker = spawn('node', [WORKER_SCRIPT, '--sync-only'], {
    cwd: sandboxCwd,
    env: { ...process.env, LC_SKIP_WORKER_LOCK: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout waiting for provenance line. Output so far:\n${out}`)),
        15000
      );
      worker.stdout.on('data', d => {
        out += d.toString();
        const m = out.match(/\[LaneConductor\].*Serving from ([^\s(]+)/);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      });
      worker.stderr.on('data', d => { out += d.toString(); });
      worker.on('error', (err) => { clearTimeout(timer); reject(err); });
      worker.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`worker exited (code ${code}) before printing provenance. Output:\n${out}`));
      });
    });
  } finally {
    await killAndConfirmDead(worker);
  }
}

describe('Track AM-10099 Phase 1 Task 6: git-init\'d sandbox under a linked worktree resists the escape', () => {
  let primaryRoot, worktreePath;

  after(() => {
    if (worktreePath) removeWorktree(primaryRoot, worktreePath);
    if (primaryRoot) rmSync(primaryRoot, { recursive: true, force: true });
  });

  it('TC-A (AC-3): a sandbox nested inside a linked worktree, but git-init\'d itself, reports ITS OWN path as serving root — no chdir into the fake primary', async () => {
    primaryRoot = makeFakePrimary();
    worktreePath = addWorktree(primaryRoot);

    const { resolvePrimaryRepoRoot } = await import(join(REAL_REPO_ROOT, 'conductor/services/worktree-merge.mjs'));

    const sandbox = join(worktreePath, '.test-tmp-tc-a-protected');
    mkdirSync(sandbox, { recursive: true });
    // This is REQ-1's minimum fix, applied here exactly as it was applied
    // across the 25 AM-10089 files: the sandbox becomes its own git repo,
    // so resolvePrimaryRepoRoot's upward .git walk stops at the sandbox
    // itself instead of continuing past it into the worktree's linked
    // primary.
    execFileSync('git', ['init', '-q'], { cwd: sandbox });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: sandbox });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: sandbox });

    // Unit-level confirmation first (fast, precise failure signal).
    assert.equal(
      resolvePrimaryRepoRoot(sandbox), sandbox,
      'a git-init\'d sandbox must resolve to itself even when nested inside a linked worktree'
    );

    // Then the real end-to-end spawn, same harness as TC-1/TC-2 in
    // track-10045-worktree-isolation.test.mjs.
    const servingRoot = await captureServingRoot(sandbox);
    assert.equal(
      servingRoot, sandbox,
      `Regression: a git-init'd sandbox under a linked worktree leaked into "${servingRoot}" instead ` +
      `of serving from its own path "${sandbox}" — REQ-1's fix no longer holds. Revert the git-init ` +
      `calls above to see this test fail exactly like track-10045-worktree-isolation.test.mjs's TC-1.`
    );
  });
});
