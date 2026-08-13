#!/usr/bin/env node
// conductor/tests/track-1112-worktree-visibility.test.mjs
// Track 1112 Phase 6: CLI-level coverage for `lc worktrees` itself —
// track-1112-worktree-audit.test.mjs already covers auditWorktrees()'s
// classification logic directly; this file covers the wrapper around it
// (bin/lc.mjs): does the real subprocess exit 0, parse as valid JSON with
// the right keys, honor --stranded, and — REQ-2/AC-3's actual claim — work
// in a scaffolded `mode: local-fs` project with no API or DB reachable at
// all, not just "no code path happens to call one".
//
// Run: node --test conductor/tests/track-1112-worktree-visibility.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const LC_BIN = join(ROOT, 'bin/lc.mjs');
const REPO = join(ROOT, '.test-tmp-worktree-visibility');

function git(cmd, cwd = REPO) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function runLc(args) {
  try {
    const out = execFileSync('node', [LC_BIN, ...args], { cwd: REPO, encoding: 'utf8', env: { ...process.env, LC_SKIP_GIT_LOCK: '1' } });
    return { status: 0, stdout: out };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

function writeTrackIndex(dir, trackNumber, title, lane, laneStatus) {
  const trackDir = join(dir, 'conductor/tracks', `${trackNumber}-${title.toLowerCase().replace(/\s+/g, '-')}`);
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    `# Track ${trackNumber}: ${title}`, '',
    `**Lane**: ${lane}`, `**Lane Status**: ${laneStatus}`, '**Progress**: 0%', '',
  ].join('\n'));
}

function setupLocalFsRepo() {
  rmSync(REPO, { recursive: true, force: true });
  mkdirSync(REPO, { recursive: true });
  git('init -q');
  // REQ-2/AC-3: mode local-fs means no collectors configured at all — the
  // real claim under test is "no API or DB reachable", not just "present
  // but unused".
  writeFileSync(join(REPO, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'visibility-test', repo_path: REPO },
  }, null, 2));
  git('-c user.email=t@t -c user.name=t commit -q --allow-empty -m init');
  git('branch -m main');
}

describe('lc worktrees (CLI)', () => {
  after(() => {
    try {
      const list = git('worktree list --porcelain').split('\n\n').filter(Boolean);
      for (const block of list) {
        const p = block.match(/^worktree (.+)$/m)?.[1];
        if (p && p !== REPO) execSync(`git -C "${REPO}" worktree remove --force "${p}"`, { stdio: 'ignore' });
      }
    } catch { /* ignore */ }
    rmSync(REPO, { recursive: true, force: true });
  });

  it('exits 0 with a clean message when there are no worktrees to show', () => {
    setupLocalFsRepo();
    const result = runLc(['worktrees']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /no unmerged worktrees/i);
  });

  it('--json produces valid JSON with the documented keys, in mode: local-fs with no API/DB', () => {
    setupLocalFsRepo();
    writeTrackIndex(REPO, '301', 'Mergeable Track', 'plan', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');
    git('worktree add -q -B track-301 .worktrees/301 HEAD');
    writeTrackIndex(join(REPO, '.worktrees/301'), '301', 'Mergeable Track', 'done', 'success');
    git('add -A', join(REPO, '.worktrees/301'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 301 done"', join(REPO, '.worktrees/301'));

    const result = runLc(['worktrees', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(result.stdout);
    assert.ok(Array.isArray(rows));
    const row = rows.find(r => r.track === '301');
    assert.ok(row, 'track 301 should appear');
    for (const key of ['track', 'title', 'lane', 'lane_status', 'ahead', 'behind', 'dirty', 'class']) {
      assert.ok(key in row, `row must have key "${key}"`);
    }
    assert.equal(row.class, 'mergeable');
  });

  it('--stranded shows only stranded rows', () => {
    setupLocalFsRepo();
    // A mergeable one (worktree present)...
    writeTrackIndex(REPO, '302', 'Mergeable', 'plan', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base1');
    git('worktree add -q -B track-302 .worktrees/302 HEAD');
    writeTrackIndex(join(REPO, '.worktrees/302'), '302', 'Mergeable', 'done', 'success');
    git('add -A', join(REPO, '.worktrees/302'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 302 done"', join(REPO, '.worktrees/302'));

    // ...and a stranded one (worktree removed after being marked done).
    writeTrackIndex(REPO, '303', 'Stranded', 'plan', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base2');
    git('worktree add -q -B track-303 .worktrees/303 HEAD');
    writeTrackIndex(join(REPO, '.worktrees/303'), '303', 'Stranded', 'done', 'success');
    git('add -A', join(REPO, '.worktrees/303'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 303 done"', join(REPO, '.worktrees/303'));
    git('worktree remove --force .worktrees/303');

    const result = runLc(['worktrees', '--json', '--stranded']);
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(result.stdout);
    assert.ok(rows.length >= 1);
    assert.ok(rows.every(r => r.class === 'stranded'));
    assert.ok(rows.some(r => r.track === '303'));
    assert.ok(!rows.some(r => r.track === '302'));
  });

  it('merge --dry-run reports without mutating anything', () => {
    setupLocalFsRepo();
    writeTrackIndex(REPO, '304', 'Dry Run Track', 'plan', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');
    git('worktree add -q -B track-304 .worktrees/304 HEAD');
    writeTrackIndex(join(REPO, '.worktrees/304'), '304', 'Dry Run Track', 'done', 'success');
    git('add -A', join(REPO, '.worktrees/304'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 304 done"', join(REPO, '.worktrees/304'));

    const beforeCount = git('rev-list --count main..track-304');
    const result = runLc(['worktrees', 'merge', '304', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /would merge cleanly/i);
    assert.equal(git('rev-list --count main..track-304'), beforeCount, 'dry-run must not change branch state');
  });

  it('merge refuses a track that is not done:success without --force', () => {
    setupLocalFsRepo();
    writeTrackIndex(REPO, '305', 'Unfinished Track', 'plan', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');
    git('worktree add -q -B track-305 .worktrees/305 HEAD');
    writeTrackIndex(join(REPO, '.worktrees/305'), '305', 'Unfinished Track', 'implement', 'running');
    git('add -A', join(REPO, '.worktrees/305'));
    git('-c user.email=t@t -c user.name=t commit -q -m "wip"', join(REPO, '.worktrees/305'));

    const result = runLc(['worktrees', 'merge', '305']);
    assert.notEqual(result.status, 0);
  });
});
