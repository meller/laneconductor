#!/usr/bin/env node
// conductor/tests/track-10045-isolated-worker-helper.test.mjs
// Track 10045 Phase 3: direct tests for conductor/tests/helpers/isolated-worker.mjs
// — the shared helper every worker-spawning suite should route through
// (Phase 5 does the actual migration; this phase proves the helper itself
// is correct in isolation).
//
// Run: node --test conductor/tests/track-10045-isolated-worker-helper.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  makeSandbox,
  cleanupSandbox,
  startIsolatedWorker,
  stopWorker,
} from './helpers/isolated-worker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_REPO_ROOT = join(__dirname, '..', '..');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('Track 10045 Phase 3: makeSandbox / cleanupSandbox', () => {
  it('TC-8: sandbox lives outside the repo, is its own primary (git-dir === git-common-dir), and leaves the repo clean (AC-11)', async () => {
    const sandbox = makeSandbox('tc8');
    try {
      assert.ok(!sandbox.startsWith(REAL_REPO_ROOT), `sandbox "${sandbox}" must not be inside the repo "${REAL_REPO_ROOT}"`);

      const gitDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-dir'], { cwd: sandbox, encoding: 'utf8' }).trim();
      const gitCommonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: sandbox, encoding: 'utf8' }).trim();
      assert.equal(gitDir, gitCommonDir, 'a freshly-init sandbox must be its own primary, not a worktree of anything');

      const { resolvePrimaryRepoRoot } = await import(join(REAL_REPO_ROOT, 'conductor/services/worktree-merge.mjs'));
      assert.equal(resolvePrimaryRepoRoot(sandbox), sandbox);

      const status = execFileSync('git', ['status', '--porcelain'], { cwd: REAL_REPO_ROOT, encoding: 'utf8' });
      assert.doesNotMatch(status, /lc-tc8-/, 'creating a sandbox must never dirty the real repo checkout');
    } finally {
      cleanupSandbox(sandbox);
    }
  });

  it('TC-12: cleanupSandbox is idempotent — calling it twice does not throw', () => {
    const sandbox = makeSandbox('tc12');
    cleanupSandbox(sandbox);
    assert.ok(!existsSync(sandbox));
    assert.doesNotThrow(() => cleanupSandbox(sandbox));
  });
});

describe('Track 10045 Phase 3: startIsolatedWorker', () => {
  it('TC-9: the spawned worker reports the sandbox as its serving root, and script resolution is independent of the caller\'s own cwd', async () => {
    // Simulates "called from a test file physically inside a worktree" —
    // the property that actually matters is that script resolution does
    // NOT depend on process.cwd() at call time (unlike the old
    // `join(__dirname, '../..')` pattern this helper replaces). Proven by
    // moving the calling process's own cwd to a throwaway directory
    // outside any git repo before calling the helper, then confirming
    // resolution still finds the real worker script and the spawned
    // worker still isolates correctly.
    const outsideAnyRepo = mkdtempSync(join(tmpdir(), 'lc-tc9-callercwd-'));
    const originalCwd = process.cwd();
    const sandbox = makeSandbox('tc9');
    let worker;
    try {
      process.chdir(outsideAnyRepo);
      worker = await startIsolatedWorker({ sandbox, args: ['--sync-only'] });
      const servingRoot = await worker.waitForServingRoot();
      assert.equal(servingRoot, sandbox);
    } finally {
      process.chdir(originalCwd);
      if (worker) await stopWorker(worker);
      cleanupSandbox(sandbox);
      cleanupSandbox(outsideAnyRepo);
    }
  });

  it('defaults to a refusing collector port — no real collector reachable unless explicitly requested', async () => {
    const sandbox = makeSandbox('tc-refuse');
    let worker;
    try {
      worker = await startIsolatedWorker({ sandbox, args: ['--sync-only'] });
      await worker.waitForServingRoot();
      const config = JSON.parse(execFileSync('cat', [join(sandbox, '.laneconductor.json')], { encoding: 'utf8' }));
      assert.equal(config.collectors.length, 1);
      const port = new URL(config.collectors[0].url).port;
      // Confirm the port genuinely refuses — nothing bound to it.
      await assert.rejects(fetch(`http://127.0.0.1:${port}/`), /fetch failed|ECONNREFUSED/i);
    } finally {
      if (worker) await stopWorker(worker);
      cleanupSandbox(sandbox);
    }
  });
});

describe('Track 10045 Phase 3: stopWorker', () => {
  it('TC-10: escalates to SIGKILL within the window and confirms death for a SIGTERM-ignoring child', async () => {
    const sandbox = makeSandbox('tc10');
    // A tiny standalone script that ignores SIGTERM, so stopWorker MUST escalate.
    const scriptPath = join(sandbox, 'ignore-sigterm.mjs');
    writeFileSync(scriptPath, `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n`);
    const proc = spawn('node', [scriptPath], { stdio: ['ignore', 'ignore', 'ignore'] });
    try {
      await sleep(200); // let it actually start
      const start = Date.now();
      await stopWorker(proc, { termMs: 500 });
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 3000, `escalation took too long: ${elapsed}ms`);
      assert.throws(() => process.kill(proc.pid, 0), 'process must actually be dead, not merely signalled');
    } finally {
      cleanupSandbox(sandbox);
    }
  });

  it('TC-11: a well-behaved child exits on SIGTERM alone, never escalates', async () => {
    const sandbox = makeSandbox('tc11');
    const scriptPath = join(sandbox, 'well-behaved.mjs');
    writeFileSync(scriptPath, `process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);\n`);
    const proc = spawn('node', [scriptPath], { stdio: ['ignore', 'ignore', 'ignore'] });
    try {
      await sleep(200);
      const start = Date.now();
      await stopWorker(proc, { termMs: 3000 });
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 1000, `should have exited quickly on SIGTERM alone, took ${elapsed}ms`);
      assert.throws(() => process.kill(proc.pid, 0));
    } finally {
      cleanupSandbox(sandbox);
    }
  });

  it('is safe to call on an already-exited process', async () => {
    const proc = spawn('node', ['-e', 'process.exit(0)'], { stdio: ['ignore', 'ignore', 'ignore'] });
    await new Promise(resolve => proc.on('exit', resolve));
    await assert.doesNotReject(stopWorker(proc));
  });
});
