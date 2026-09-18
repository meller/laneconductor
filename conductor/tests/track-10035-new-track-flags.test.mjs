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

// Track AM-10099 item (g)/Phase 5 Task 12 (REQ-14, TC-5.15): was
// `.find(d => d.includes(titleSlugFragment))` — a substring match, which
// is exactly why this suite never caught D2 (a flag leaking into the
// title still produces A folder whose name CONTAINS the expected
// fragment, just with extra garbage before/after it). Asserts the exact
// slug suffix instead: `AM-NNN-<exact-slug>`, nothing more.
function readCreatedIndex(exactSlug) {
  const tracksDir = join(REPO, 'conductor/tracks');
  const dirs = readdirSync(tracksDir);
  const dir = dirs.find(d => new RegExp(`^[A-Za-z]+-\\d+-${exactSlug}$`).test(d));
  assert.ok(dir, `expected exactly one track folder matching /^[A-Za-z]+-\\d+-${exactSlug}$/, got: ${dirs.join(', ') || '(none)'}`);
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

  it('writes the default direct/yes markers when neither flag is passed (default flipped 2026-09-08 — see SKILL.md newTrack)', () => {
    setupProject();
    lc(['new', 'Plain Track', 'desc']);
    const content = readCreatedIndex('plain-track');
    assert.match(content, /\*\*Merge Mode\*\*:\s*direct/);
    assert.match(content, /\*\*Auto Run\*\*:\s*yes/);
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

  // Fixed 2026-09-04 (found live: tracks 10056-10058's own write-ups came back
  // truncated): a long description used to go straight into
  // **Summary**, the one marker the sync worker's parseSummaryMarker()
  // unconditionally truncates to 200 chars for the DB's content_summary. The
  // next sync tick then found the file's full Summary no longer matching the
  // DB's truncated one, read that as "DB is newer", and overwrote the file's
  // Summary with the truncated value — permanently; nothing else stored the
  // original. Fixed by writing the description into **Problem** instead,
  // which parseSummary()'s own existing fallback derives a display Summary
  // from at READ time only, and which the DB->disk pull path never writes to.
  it('a long description is written in full to **Problem**, not truncated into **Summary**', () => {
    setupProject();
    const longDesc = 'x'.repeat(500);
    lc(['new', 'Long Desc Track', longDesc]);
    const content = readCreatedIndex('long-desc-track');
    assert.doesNotMatch(content, /\*\*Summary\*\*/, 'no Summary marker should be written at all — it is derived, not stored');
    assert.match(content, new RegExp(`\\*\\*Problem\\*\\*:\\s*${longDesc}`), 'the full, untruncated description must be in **Problem**');
  });

  it('a short description also goes to **Problem**, and omits both markers when there is no description', () => {
    setupProject();
    lc(['new', 'Short Desc Track', 'a short description']);
    const shortContent = readCreatedIndex('short-desc-track');
    assert.match(shortContent, /\*\*Problem\*\*:\s*a short description/);

    setupProject();
    lc(['new', 'No Desc Track']);
    const noDescContent = readCreatedIndex('no-desc-track');
    assert.doesNotMatch(noDescContent, /\*\*Problem\*\*/);
    assert.doesNotMatch(noDescContent, /\*\*Summary\*\*/);
  });
});
