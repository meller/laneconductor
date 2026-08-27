#!/usr/bin/env node
// conductor/tests/track-10035-new-track-flags.test.mjs
// Track 10035 Phase 5 Task 4 (REQ-12, AC-8, TC-5.4): `lc new` gains
// --merge-mode direct|pr and --auto-run yes|no so a track can declare
// merge intent at creation time, instead of a human editing index.md by
// hand afterward.
//
// Run: node --test conductor/tests/track-10035-new-track-flags.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const LC = join(ROOT, 'bin/lc.mjs');
const REPO = join(ROOT, '.test-tmp-track-10035-new-flags');

function lc(argv, { expectFailure = false } = {}) {
  try {
    const out = execFileSync('node', [LC, ...argv], { cwd: REPO, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (expectFailure) throw new Error(`expected lc ${argv.join(' ')} to fail, but it exited 0: ${out}`);
    return { stdout: out, code: 0 };
  } catch (err) {
    if (!expectFailure) throw err;
    return { stdout: (err.stdout || '') + (err.stderr || ''), code: err.status ?? 1 };
  }
}

function setupProject() {
  rmSync(REPO, { recursive: true, force: true });
  mkdirSync(REPO, { recursive: true });
  writeFileSync(join(REPO, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'new-track-flags-test', repo_path: REPO, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
  }, null, 2));
  mkdirSync(join(REPO, 'conductor/tracks'), { recursive: true });
}

function readCreatedIndex(titleSlugFragment) {
  const tracksDir = join(REPO, 'conductor/tracks');
  const dir = readdirSync(tracksDir).find(d => d.includes(titleSlugFragment));
  assert.ok(dir, `expected a track folder containing "${titleSlugFragment}"`);
  return readFileSync(join(tracksDir, dir, 'index.md'), 'utf8');
}

describe('lc new --merge-mode / --auto-run (Track 10035 REQ-12)', () => {
  after(() => rmSync(REPO, { recursive: true, force: true }));

  it('AC-8: writes both **Merge Mode** and **Auto Run** markers when both flags are passed', () => {
    setupProject();
    lc(['new', 'Direct Auto Track', 'desc', '--merge-mode', 'direct', '--auto-run', 'yes']);
    const content = readCreatedIndex('direct-auto-track');
    assert.match(content, /\*\*Merge Mode\*\*:\s*direct/);
    assert.match(content, /\*\*Auto Run\*\*:\s*yes/);
  });

  it('TC-5.4: --merge-mode pr --auto-run yes writes exactly those values', () => {
    setupProject();
    lc(['new', 'PR Mode Track', 'desc', '--merge-mode', 'pr', '--auto-run', 'yes']);
    const content = readCreatedIndex('pr-mode-track');
    assert.match(content, /\*\*Merge Mode\*\*:\s*pr/);
    assert.match(content, /\*\*Auto Run\*\*:\s*yes/);
  });

  it('omits both markers when neither flag is passed (sparse-emission, same convention as --workspace)', () => {
    setupProject();
    lc(['new', 'Plain Track', 'desc']);
    const content = readCreatedIndex('plain-track');
    assert.doesNotMatch(content, /\*\*Merge Mode\*\*/);
    assert.doesNotMatch(content, /\*\*Auto Run\*\*/);
  });

  it('rejects an invalid --merge-mode value with a usage error, no track created', () => {
    setupProject();
    const { stdout, code } = lc(['new', 'Bad Merge Mode', 'desc', '--merge-mode', 'squash'], { expectFailure: true });
    assert.notEqual(code, 0);
    assert.match(stdout, /Invalid merge mode/);
    assert.equal(readdirSync(join(REPO, 'conductor/tracks')).length, 0);
  });

  it('rejects an invalid --auto-run value with a usage error, no track created', () => {
    setupProject();
    const { stdout, code } = lc(['new', 'Bad Auto Run', 'desc', '--auto-run', 'maybe'], { expectFailure: true });
    assert.notEqual(code, 0);
    assert.match(stdout, /Invalid --auto-run value/);
    assert.equal(readdirSync(join(REPO, 'conductor/tracks')).length, 0);
  });
});
