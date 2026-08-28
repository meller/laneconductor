#!/usr/bin/env node
// conductor/tests/track-10035-migration-cli.test.mjs
// Track 10035 Phase 5 Task 3 / TC-5.3: `lc worktrees migrate-done-lane`
// against a real git fixture (local-fs mode, no DB) — the pure planning
// logic is covered separately in track-10035-migration.test.mjs; this
// exercises the actual file rewrite + git commit + conversation.md
// comment + --dry-run + idempotency end to end.
//
// Run: node --test conductor/tests/track-10035-migration-cli.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const LC = join(ROOT, 'bin/lc.mjs');
const REPO = join(ROOT, '.test-tmp-track-10035-migration-cli');

function git(cmd, cwd = REPO) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function lc(cmd) {
  return execSync(`node "${LC}" ${cmd}`, { cwd: REPO, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function writeTrackIndex(dir, trackNumber, title, lane, laneStatus, mergeMode = 'direct') {
  const trackDir = join(dir, 'conductor/tracks', `${trackNumber}-${title.toLowerCase().replace(/\s+/g, '-')}`);
  mkdirSync(trackDir, { recursive: true });
  writeFileSync(join(trackDir, 'index.md'), [
    `# Track ${trackNumber}: ${title}`, '',
    `**Lane**: ${lane}`, `**Lane Status**: ${laneStatus}`, '**Progress**: 100%',
    `**Merge Mode**: ${mergeMode}`, '',
    '## Problem', 'Test.', '',
  ].join('\n'));
  writeFileSync(join(trackDir, 'conversation.md'), '');
  return trackDir;
}

function setupRepo() {
  rmSync(REPO, { recursive: true, force: true });
  mkdirSync(REPO, { recursive: true });
  git('init -q');
  writeFileSync(join(REPO, '.laneconductor.json'), JSON.stringify({
    mode: 'local-fs',
    project: { name: 'migration-cli-test', repo_path: REPO, primary: { cli: 'mock', model: 'mock' } },
    collectors: [],
  }, null, 2));
  git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m init'); git('branch -m main');
}

describe('lc worktrees migrate-done-lane', () => {
  after(() => rmSync(REPO, { recursive: true, force: true }));

  it('(a) requeues a done:success track with a live unmerged branch to done:queue, committing the change and posting a comment', () => {
    setupRepo();
    // The primary checkout's own copy already mirrors done:success — same
    // as it would in reality, since the existing copy-back mechanism syncs
    // the branch's finished state into primary right after quality-gate
    // exits, well before a migration sweep would ever run.
    writeTrackIndex(REPO, '201', 'Legacy Unmerged', 'done', 'success');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    git('worktree add -q -B track-201 .worktrees/201 HEAD');
    // A genuine extra commit on the branch — otherwise the branch is a
    // plain ancestor of main (nothing to merge) and auditWorktrees() would
    // correctly omit it entirely, defeating this fixture's whole point.
    writeFileSync(join(REPO, '.worktrees/201', 'feature.txt'), 'the actual shipped work\n');
    git('add -A', join(REPO, '.worktrees/201'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 201 done"', join(REPO, '.worktrees/201'));

    // --dry-run must not write anything.
    const dryOutput = lc('worktrees migrate-done-lane --dry-run');
    assert.match(dryOutput, /DRY RUN/);
    assert.match(dryOutput, /requeue-done-success/);

    const primaryDir = join(REPO, 'conductor/tracks/201-legacy-unmerged');
    const beforeContent = readFileSync(join(primaryDir, 'index.md'), 'utf8');
    assert.doesNotMatch(beforeContent, /\*\*Lane Status\*\*:\s*queue/i, 'dry-run must not have written anything yet');

    // Real run.
    const output = lc('worktrees migrate-done-lane');
    assert.match(output, /Migration applied: 1 action/);

    const afterContent = readFileSync(join(primaryDir, 'index.md'), 'utf8');
    assert.match(afterContent, /\*\*Lane\*\*:\s*done/i);
    assert.match(afterContent, /\*\*Lane Status\*\*:\s*queue/i);

    const conversation = readFileSync(join(primaryDir, 'conversation.md'), 'utf8');
    assert.match(conversation, /> \*\*system\*\*: 🔧 Migration \(track 10035\)/);
    assert.match(conversation, /pre-track-10035 state/);

    // The change was actually committed, not just written.
    const status = git('status --porcelain -- conductor/tracks/201-legacy-unmerged/index.md');
    assert.equal(status, '', 'the requeue must be committed, not left dirty');

    // (re-run is a no-op — idempotent)
    const secondRun = lc('worktrees migrate-done-lane');
    assert.match(secondRun, /Nothing to migrate/);
  });

  it('(b) leaves a genuinely, fully merged done:success track untouched (never appears as a live branch to sweep)', () => {
    setupRepo();
    writeTrackIndex(REPO, '202', 'Fully Merged', 'plan', 'queue');
    git('add -A'); git('-c user.email=t@t -c user.name=t commit -q -m base');

    git('worktree add -q -B track-202 .worktrees/202 HEAD');
    writeTrackIndex(join(REPO, '.worktrees/202'), '202', 'Fully Merged', 'done', 'success');
    git('add -A', join(REPO, '.worktrees/202'));
    git('-c user.email=t@t -c user.name=t commit -q -m "track 202 done"', join(REPO, '.worktrees/202'));
    // Actually merge it into main — now it's a plain ancestor, genuinely done.
    git('merge -q --no-ff track-202 -m "merge track-202"');

    const output = lc('worktrees migrate-done-lane');
    assert.match(output, /Nothing to migrate/);

    const primaryDir = join(REPO, 'conductor/tracks/202-fully-merged');
    const content = readFileSync(join(primaryDir, 'index.md'), 'utf8');
    assert.match(content, /\*\*Lane Status\*\*:\s*success/i, 'a genuinely-merged track must be left exactly as-is');
  });
});
