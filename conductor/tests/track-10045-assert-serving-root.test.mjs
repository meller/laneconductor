#!/usr/bin/env node
// conductor/tests/track-10045-assert-serving-root.test.mjs
// Track 10045 Phase 2: unit tests for the pure comparison logic behind the
// opt-in LC_ASSERT_SERVING_ROOT startup guard (spec.md REQ-3), plus
// integration tests spawning the real worker to prove the guard actually
// fires (TC-4/TC-5/TC-6) and stays a no-op when unset (AC-5).
//
// Run: node --test conductor/tests/track-10045-assert-serving-root.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { checkServingRoot } from '../services/assert-serving-root.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_REPO_ROOT = join(__dirname, '../..');
const WORKER_SCRIPT = join(REAL_REPO_ROOT, 'conductor/laneconductor.sync.mjs');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function killAndConfirmDead(worker, termMs = 3000) {
  worker.kill('SIGTERM');
  const deadline = Date.now() + termMs;
  while (Date.now() < deadline) {
    try { process.kill(worker.pid, 0); } catch { return; }
    await sleep(100);
  }
  try { process.kill(worker.pid, 'SIGKILL'); } catch { /* already gone */ }
}

// A minimal, self-contained local-fs sandbox (its own git repo, so cwd
// normalization never redirects it elsewhere -- Phase 1 already proved
// that mechanism; this phase is testing a DIFFERENT guard, so the sandbox
// here is deliberately the "isolation already holds" shape).
function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'lc10045-assertroot-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'sandbox', repo_path: root, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
  }, null, 2));
  mkdirSync(join(root, 'conductor/tracks'), { recursive: true });
  return root;
}

function spawnWorker(sandbox, extraEnv = {}) {
  return spawn('node', [WORKER_SCRIPT, '--sync-only'], {
    cwd: sandbox,
    env: { ...process.env, LC_SKIP_WORKER_LOCK: '1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Waits for either the worker to exit, or a timeout, collecting all output.
// Guarantees the process is dead before returning/throwing either way — a
// timeout here (e.g. the guard not being implemented yet, so the worker
// just runs normally forever) must never leak a live process, which is
// exactly the bug class this whole track exists to prevent.
async function runToExit(worker, timeoutMs = 5000) {
  let out = '';
  let exited = false;
  worker.stdout.on('data', d => { out += d.toString(); });
  worker.stderr.on('data', d => { out += d.toString(); });
  worker.on('exit', () => { exited = true; });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`worker did not exit within ${timeoutMs}ms. Output so far:\n${out}`)), timeoutMs);
      worker.on('exit', (code) => { clearTimeout(timer); resolve({ code, out: () => out }); });
      worker.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  } finally {
    if (!exited) await killAndConfirmDead(worker);
  }
}

// Waits for the startup provenance line, then treats the worker as
// "started normally" and kills it -- used for the TC-4/TC-6 "no assertion
// fired" cases, where the process would otherwise run indefinitely.
async function runUntilProvenanceThenKill(worker, timeoutMs = 10000) {
  let out = '';
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for provenance. Output so far:\n${out}`)), timeoutMs);
      worker.stdout.on('data', d => {
        out += d.toString();
        if (/\[LaneConductor\].*Serving from/.test(out)) { clearTimeout(timer); resolve(out); }
      });
      worker.stderr.on('data', d => { out += d.toString(); });
      worker.on('exit', (code) => { clearTimeout(timer); reject(new Error(`worker exited (code ${code}) before provenance. Output:\n${out}`)); });
      worker.on('error', reject);
    });
  } finally {
    await killAndConfirmDead(worker);
  }
}

describe('Track 10045 Phase 2: checkServingRoot (pure helper) — TC-7', () => {
  it('exact match: identical absolute paths are ok', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc10045-exact-'));
    try {
      const result = checkServingRoot(dir, dir);
      assert.equal(result.ok, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('trailing slash on either side does not cause a false mismatch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc10045-trail-'));
    try {
      const result = checkServingRoot(dir + '/', dir);
      assert.equal(result.ok, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a symlinked path resolves to the same real path as its target', () => {
    const real = mkdtempSync(join(tmpdir(), 'lc10045-real-'));
    const linkParent = mkdtempSync(join(tmpdir(), 'lc10045-linkparent-'));
    const link = join(linkParent, 'link-to-real');
    try {
      symlinkSync(real, link);
      const result = checkServingRoot(link, real);
      assert.equal(result.ok, true);
    } finally {
      rmSync(linkParent, { recursive: true, force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });

  it('genuinely different directories do not match', () => {
    const a = mkdtempSync(join(tmpdir(), 'lc10045-a-'));
    const b = mkdtempSync(join(tmpdir(), 'lc10045-b-'));
    try {
      const result = checkServingRoot(a, b);
      assert.equal(result.ok, false);
      assert.equal(result.expected, a);
      assert.equal(result.actual, b);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});

describe('Track 10045 Phase 2: LC_ASSERT_SERVING_ROOT integration', () => {
  let sandboxA, sandboxB;

  after(() => {
    if (sandboxA) rmSync(sandboxA, { recursive: true, force: true });
    if (sandboxB) rmSync(sandboxB, { recursive: true, force: true });
  });

  it('TC-6: unset LC_ASSERT_SERVING_ROOT — worker starts normally, no assertion output (AC-5)', async () => {
    sandboxA = makeSandbox();
    const worker = spawnWorker(sandboxA);
    const out = await runUntilProvenanceThenKill(worker);
    assert.doesNotMatch(out, /LC_ASSERT_SERVING_ROOT/);
  });

  it('TC-4: LC_ASSERT_SERVING_ROOT set to the TRUE serving root — worker starts normally, no assertion output', async () => {
    sandboxB = makeSandbox();
    const worker = spawnWorker(sandboxB, { LC_ASSERT_SERVING_ROOT: sandboxB });
    const out = await runUntilProvenanceThenKill(worker);
    assert.doesNotMatch(out, /ASSERT_SERVING_ROOT mismatch/);
  });

  it('TC-5: LC_ASSERT_SERVING_ROOT set to a path that does NOT match — worker exits 9 before any sync work, naming both roots', async () => {
    const expectedRoot = join(tmpdir(), 'lc10045-does-not-exist-' + Date.now());
    const worker = spawnWorker(sandboxB, { LC_ASSERT_SERVING_ROOT: expectedRoot });
    const { code, out } = await runToExit(worker);
    assert.equal(code, 9);
    const text = out();
    assert.match(text, /ASSERT_SERVING_ROOT mismatch/);
    assert.ok(text.includes(expectedRoot), 'stderr must name the expected root');
    assert.ok(text.includes(sandboxB), 'stderr must name the actual root');
    // No sync work should have started: the worker's own subsequent
    // startup logging (worker-lock acquisition, chokidar watch messages)
    // must not appear.
    assert.doesNotMatch(text, /watching/i);
  });
});
