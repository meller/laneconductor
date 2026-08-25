#!/usr/bin/env node
// conductor/tests/track-1102-f6-cli-mode-vocabulary.test.mjs
// Track 1102 F6: `sync-only` / `sync+poll` name the mechanism (does the
// worker poll the queue?), not the choice the user is actually making
// (manual vs automatic work-claiming). The UI already renders this as
// MANUAL/AUTOMATIC (WorkersList.jsx) — the CLI's help text and `worker
// status` output still said "sync-only"/"SYNC-AND-WORK" with no MANUAL/
// AUTOMATIC wording anywhere, which is exactly the wrong inference that
// led to F1's original misdiagnosis. Wire values (worker.mode,
// --sync-and-work) are unchanged — this is display/help text only.
//
// Run: node --test conductor/tests/track-1102-f6-cli-mode-vocabulary.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const LC = join(ROOT, 'bin/lc.mjs');
const TMP = join(ROOT, '.test-tmp-f6-cli-mode');

function setupProject(workerMode) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, 'conductor/tracks'), { recursive: true });
  const cfg = {
    mode: 'local-fs',
    project: { name: 'f6-test', id: 1, repo_path: TMP, primary: { cli: 'mock' } },
  };
  if (workerMode) cfg.worker = { mode: workerMode };
  writeFileSync(join(TMP, '.laneconductor.json'), JSON.stringify(cfg, null, 2));
  // Track 1102 F16/F17's own lesson: resolvePrimaryRepoRoot() walks up via
  // `git rev-parse` from cwd. Without its own .git, a tmp project nested
  // inside this worktree resolves to the OUTER laneconductor repo's root
  // instead of itself, silently reading the wrong .laneconductor.json.
  execSync('git init -q', { cwd: TMP });
  execSync('git add -A', { cwd: TMP });
  execSync('git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: TMP });
}

describe('Track 1102 F6: CLI uses MANUAL/AUTOMATIC vocabulary', () => {
  after(() => rmSync(TMP, { recursive: true, force: true }));

  it('lc --help mentions both MANUAL and AUTOMATIC for the worker start section', () => {
    // Deliberately the bare `--help` form, not `worker start --help` — the
    // latter has no dedicated help path and would fall through to actually
    // starting a real detached worker process, which this test must not do.
    const r = spawnSync('node', [LC, '--help'], { encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.match(out, /MANUAL/, `expected MANUAL in help output:\n${out}`);
    assert.match(out, /AUTOMATIC/, `expected AUTOMATIC in help output:\n${out}`);
  });

  it('lc worker status labels a sync-only-configured project MANUAL', () => {
    setupProject('sync-only');
    const r = spawnSync('node', [LC, 'worker', 'status'], { cwd: TMP, encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.match(out, /MANUAL/i, `expected MANUAL in status output:\n${out}`);
  });

  it('lc worker status labels a sync+poll-configured project AUTOMATIC', () => {
    setupProject('sync+poll');
    const r = spawnSync('node', [LC, 'worker', 'status'], { cwd: TMP, encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.match(out, /AUTOMATIC/i, `expected AUTOMATIC in status output:\n${out}`);
  });

  it('lc worker status labels a project with no worker.mode set AUTOMATIC (matches the sync worker\'s own default)', () => {
    setupProject(null);
    const r = spawnSync('node', [LC, 'worker', 'status'], { cwd: TMP, encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.match(out, /AUTOMATIC/i, `expected AUTOMATIC in status output:\n${out}`);
  });
});
