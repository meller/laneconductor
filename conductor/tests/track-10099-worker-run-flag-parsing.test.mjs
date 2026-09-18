#!/usr/bin/env node
// conductor/tests/track-10099-worker-run-flag-parsing.test.mjs
// Track AM-10099 Phase 4 (item c1, REQ-6, AC-8): `lc worker run <track>
// --worker-number N` must read N as the worker identity flag, never as a
// second track number.
//
// Reproduces exactly the reported log line
// (`scoped to track(s) 10094, 900094`) against the OLD
// `subArgs.filter(a => !a.startsWith('--'))` parsing, then confirms
// splitPositionalArgs's fix logs a single track number.
//
// Run: node --test conductor/tests/track-10099-worker-run-flag-parsing.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const LC = join(ROOT, 'bin/lc.mjs');
// Track AM-10099 Phase 1 (REQ-1): sandbox lives under os.tmpdir(), git
// init'd before any real spawn — see spec.md item (a).
const TMP = join(tmpdir(), 'lc-worker-run-flag-parsing');

function setupProject() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: TMP });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: TMP });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: TMP });
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'worker-run-flag-parsing-test', id: 1, repo_path: TMP, primary: { cli: 'mock' } },
  }, null, 2));
  writeFileSync(join(TMP, 'conductor/workflow.json'), JSON.stringify({
    global: { total_parallel_limit: 1 },
    defaults: { parallel_limit: 1, max_retries: 1 },
  }, null, 2));
}

// Only cares about the log line `spawnSync` prints BEFORE actually
// launching the real worker — kills the process the instant that line
// appears, so this never waits out a real (queue-empty, exits fast anyway)
// worker cycle.
function runAndCaptureScopedLine(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [LC, 'worker', 'run', ...args], { cwd: TMP, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`timeout. Output so far:\n${out}`)); }, 15000);
    function checkForLine() {
      const m = out.match(/scoped to track\(s\) ([^\n—]+)/);
      if (m) {
        clearTimeout(timer);
        proc.kill('SIGKILL');
        resolve(m[1].trim());
      }
    }
    proc.stdout.on('data', d => { out += d.toString(); checkForLine(); });
    proc.stderr.on('data', d => { out += d.toString(); checkForLine(); });
    proc.on('exit', () => { clearTimeout(timer); if (!out.includes('scoped to track(s)')) reject(new Error(`worker exited before printing provenance. Output:\n${out}`)); });
  });
}

describe('Track AM-10099 Phase 4: lc worker run --worker-number flag parsing', () => {
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('TC-4.1 (AC-8): logs exactly one track number, not the --worker-number value too', async () => {
    setupProject();
    const scoped = await runAndCaptureScopedLine(['10094', '--worker-number', '900094']);
    assert.equal(scoped, '10094', `expected only "10094", got "${scoped}" — the flag value leaked into the track list`);
  });

  it('TC-4.6: still parses correctly with multiple real tracks before the flag', async () => {
    setupProject();
    const scoped = await runAndCaptureScopedLine(['10094', '10095', '--worker-number', '7']);
    assert.equal(scoped, '10094, 10095');
  });
});
