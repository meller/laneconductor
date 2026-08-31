#!/usr/bin/env node
// conductor/tests/track-10045-worktree-isolation.test.mjs
// Track 10045 Phase 1: reproduces the worktree-cwd-normalization escape
// described in conductor/tracks/AM-10045-e2e-tests-leak-real-worker-from-worktree/spec.md.
//
// Uses a throwaway "fake primary" git repo + linked worktree — NEVER the
// real laneconductor checkout — so the reproduction itself can never reach
// a real Collector or real tracks regardless of whether the escape fires
// (spec.md REQ-4). Both the fake primary and the fake worktree carry a
// `mode: local-fs` config with zero collectors, so even a full escape (the
// worker chdir-ing into the fake primary and reading ITS config) lands
// somewhere inert.
//
// TC-1 is expected to FAIL until Phase 2/3 land the sandbox-isolation fix
// — that is the point: it is the red test this phase exists to produce.
//
// Run: node --test conductor/tests/track-10045-worktree-isolation.test.mjs

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

// A disposable git repo standing in for "the primary checkout" — entirely
// independent of the real laneconductor repo. resolvePrimaryRepoRoot()
// resolves purely from git plumbing relative to a given directory, so this
// reproduces the exact mechanism without touching anything real.
function makeFakePrimary() {
  const root = mkdtempSync(join(tmpdir(), 'lc10045-fakeprimary-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'fake primary — track 10045 Phase 1 reproduction\n');
  git(['add', '.'], root);
  git(['commit', '-q', '-m', 'init'], root);
  // local-fs + zero collectors: even a full chdir-escape into this "primary"
  // and a real config read lands somewhere that can never reach a network.
  writeFileSync(join(root, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'fake-primary', repo_path: root, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
  }, null, 2));
  mkdirSync(join(root, 'conductor/tracks'), { recursive: true });
  return root;
}

function addWorktree(primaryRoot) {
  const wtPath = mkdtempSync(join(tmpdir(), 'lc10045-fakewt-'));
  rmSync(wtPath, { recursive: true, force: true }); // git worktree add requires the path not exist yet
  const branch = `track-10045-fake-${Date.now()}`;
  git(['worktree', 'add', '-q', '-b', branch, wtPath], primaryRoot);
  return wtPath;
}

function removeWorktree(primaryRoot, wtPath) {
  try { git(['worktree', 'remove', '--force', wtPath], primaryRoot); } catch { /* best-effort */ }
  rmSync(wtPath, { recursive: true, force: true });
}

// Confirms a signalled process has actually exited, not merely been sent a
// signal — bounded SIGTERM -> SIGKILL escalation (spec.md REQ-6).
async function killAndConfirmDead(worker, termMs = 3000, killMs = 2000) {
  worker.kill('SIGTERM');
  const termDeadline = Date.now() + termMs;
  while (Date.now() < termDeadline) {
    try { process.kill(worker.pid, 0); } catch { return; } // ESRCH -> already dead
    await sleep(100);
  }
  try { process.kill(worker.pid, 'SIGKILL'); } catch { return; }
  // SIGKILL is asynchronous too — confirm it, don't just fire-and-return
  // (found live in Phase 3's own stopWorker: an immediate liveness check
  // right after sending SIGKILL could still observe the process as alive).
  const killDeadline = Date.now() + killMs;
  while (Date.now() < killDeadline) {
    try { process.kill(worker.pid, 0); } catch { return; }
    await sleep(50);
  }
}

// Spawns the REAL worker script with cwd = sandbox, captures its startup
// provenance line, then kills it immediately — well before any sync or
// collector work could begin. LC_SKIP_WORKER_LOCK avoids colliding with
// the real project worker's lock (this sandbox is never that project's
// identity anyway, since it never resolves to the real repo).
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

describe('Track 10045 Phase 1: worktree isolation reproduction', () => {
  let primaryRoot, worktreePath;

  after(() => {
    if (worktreePath) removeWorktree(primaryRoot, worktreePath);
    if (primaryRoot) rmSync(primaryRoot, { recursive: true, force: true });
  });

  it('TC-3: resolvePrimaryRepoRoot resolves a worktree sandbox to the fake primary, and a primary sandbox to itself', async () => {
    const { resolvePrimaryRepoRoot } = await import(join(REAL_REPO_ROOT, 'conductor/services/worktree-merge.mjs'));
    primaryRoot = makeFakePrimary();
    worktreePath = addWorktree(primaryRoot);

    const primarySandbox = join(primaryRoot, '.test-tmp-probe');
    mkdirSync(primarySandbox, { recursive: true });
    assert.equal(resolvePrimaryRepoRoot(primarySandbox), primarySandbox);

    const worktreeSandbox = join(worktreePath, '.test-tmp-probe');
    mkdirSync(worktreeSandbox, { recursive: true });
    assert.equal(resolvePrimaryRepoRoot(worktreeSandbox), primaryRoot);
  });

  it('TC-2: worker spawned with cwd inside the fake PRIMARY reports its own sandbox as serving root (isolation holds)', async () => {
    const sandbox = join(primaryRoot, '.test-tmp-tc2');
    mkdirSync(sandbox, { recursive: true });
    const servingRoot = await captureServingRoot(sandbox);
    assert.equal(servingRoot, sandbox);
  });

  it('TC-1: worker spawned with cwd inside a linked WORKTREE reports the sandbox as serving root — EXPECTED TO FAIL pre-fix (the leak)', async () => {
    const sandbox = join(worktreePath, '.test-tmp-tc1');
    mkdirSync(sandbox, { recursive: true });
    const servingRoot = await captureServingRoot(sandbox);
    // Today (pre Phase 2/3 fix): servingRoot === primaryRoot, so this fails.
    // That failure IS Phase 1's deliverable — see plan.md Task 1.2 and
    // spec.md's Solution section for what makes it pass.
    assert.equal(
      servingRoot,
      sandbox,
      `Isolation escape reproduced: worker launched from a worktree sandbox reports serving root ` +
      `"${servingRoot}" instead of its own sandbox "${sandbox}" — it chdir'd into the primary ` +
      `checkout before reading any config. See spec.md's Root Cause section.`
    );
  });
});
