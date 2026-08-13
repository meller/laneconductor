#!/usr/bin/env node
// conductor/tests/track-1112-git-divergence.test.mjs
// Track 1112 Phase 5: out-of-band git sync — detect when `origin/main` has
// commits a local worker never saw (a third party pushing directly, not
// through LaneConductor at all), and pull only when it's provably safe.
//
// Fixture: a bare "origin" repo plus a "local" clone that stands in for the
// primary checkout. Run: node --test conductor/tests/track-1112-git-divergence.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { checkDivergence, safePull } from '../services/git-divergence.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const BASE = join(ROOT, '.test-tmp-git-divergence');
const ORIGIN = join(BASE, 'origin.git');
const LOCAL = join(BASE, 'local');
const OTHER = join(BASE, 'other');

function git(cmd, cwd) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function setupFixture() {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(BASE, { recursive: true });
  git(`init -q --bare ${ORIGIN}`);

  git(`clone -q "${ORIGIN}" "${LOCAL}"`, BASE);
  writeFileSync(join(LOCAL, 'file.txt'), 'base\n');
  git('add -A', LOCAL);
  git('-c user.email=t@t -c user.name=t commit -q -m init', LOCAL);
  git('branch -m main', LOCAL);
  git('push -q -u origin main', LOCAL);

  git(`clone -q "${ORIGIN}" "${OTHER}"`, BASE);
  // Don't rely on clone's default-branch guess (varies with git version /
  // init.defaultBranch) — explicitly track the same `main` LOCAL pushed.
  git('checkout -q -B main origin/main', OTHER);
}

// Simulates a third party pushing directly to origin, bypassing LOCAL entirely.
function pushFromOther(mutate, message) {
  // Some tests have LOCAL push its own commits to origin AFTER OTHER was
  // cloned (to seed fixture state) — stay current so this push is a clean
  // fast-forward from OTHER's perspective too, same as any real contributor.
  git('fetch -q origin main', OTHER);
  git('merge -q --ff-only origin/main', OTHER);
  mutate(OTHER);
  git('add -A', OTHER);
  git(`-c user.email=other@t -c user.name=other commit -q -m "${message}"`, OTHER);
  git('push -q origin main', OTHER);
}

describe('checkDivergence()', () => {
  after(() => rmSync(BASE, { recursive: true, force: true }));

  it('reports zero divergence when nothing has changed remotely', async () => {
    setupFixture();
    const d = await checkDivergence({ repoRoot: LOCAL, mainBranch: 'main' });
    assert.equal(d.fetchOk, true);
    assert.equal(d.ahead, 0);
    assert.equal(d.behind, 0);
    assert.equal(d.canFastForward, false); // nothing to fast-forward TO
  });

  it('reports behind + fast-forward-available after an out-of-band push', async () => {
    setupFixture();
    pushFromOther((dir) => writeFileSync(join(dir, 'other.txt'), 'new\n'), 'third party push');

    const d = await checkDivergence({ repoRoot: LOCAL, mainBranch: 'main' });
    assert.equal(d.behind, 1);
    assert.equal(d.ahead, 0);
    assert.equal(d.canFastForward, true);
  });

  it('reports diverged (not fast-forwardable) when local has its own unpushed commit too', async () => {
    setupFixture();
    pushFromOther((dir) => writeFileSync(join(dir, 'other.txt'), 'new\n'), 'third party push');

    writeFileSync(join(LOCAL, 'local-only.txt'), 'mine\n');
    git('add -A', LOCAL);
    git('-c user.email=t@t -c user.name=t commit -q -m "local unpushed commit"', LOCAL);

    const d = await checkDivergence({ repoRoot: LOCAL, mainBranch: 'main' });
    assert.equal(d.ahead, 1);
    assert.equal(d.behind, 1);
    assert.equal(d.canFastForward, false);
  });

  it('performs no mutation — a fetch is read-only', async () => {
    setupFixture();
    pushFromOther((dir) => writeFileSync(join(dir, 'other.txt'), 'new\n'), 'third party push');
    const beforeSha = git('rev-parse main', LOCAL);
    const beforeStatus = git('status --porcelain', LOCAL);
    await checkDivergence({ repoRoot: LOCAL, mainBranch: 'main' });
    assert.equal(git('rev-parse main', LOCAL), beforeSha, 'local main must not move from a divergence check alone');
    assert.equal(git('status --porcelain', LOCAL), beforeStatus);
  });
});

describe('safePull()', () => {
  after(() => rmSync(BASE, { recursive: true, force: true }));

  it('pulls via fast-forward when safe, and reports which conductor/tracks/**/index.md files changed', async () => {
    setupFixture();
    mkdirSync(join(LOCAL, 'conductor/tracks/500-example'), { recursive: true });
    writeFileSync(join(LOCAL, 'conductor/tracks/500-example/index.md'), '# Track 500\n\n**Lane**: plan\n');
    git('add -A', LOCAL); git('-c user.email=t@t -c user.name=t commit -q -m "seed track 500"', LOCAL);
    git('push -q origin main', LOCAL);

    pushFromOther((dir) => {
      mkdirSync(join(dir, 'conductor/tracks/500-example'), { recursive: true });
      writeFileSync(join(dir, 'conductor/tracks/500-example/index.md'), '# Track 500\n\n**Lane**: review\n');
    }, 'track 500 progressed out of band');

    const beforeSha = git('rev-parse main', LOCAL);
    const result = await safePull({ repoRoot: LOCAL, mainBranch: 'main' });
    assert.equal(result.pulled, true);
    assert.equal(result.beforeSha, beforeSha);
    assert.notEqual(result.afterSha, beforeSha);
    assert.ok(result.changedTrackFiles.includes('conductor/tracks/500-example/index.md'));
    assert.equal(readFileSync(join(LOCAL, 'conductor/tracks/500-example/index.md'), 'utf8').includes('review'), true);
  });

  it('refuses to pull when local has diverged (its own unpushed commit)', async () => {
    setupFixture();
    pushFromOther((dir) => writeFileSync(join(dir, 'other.txt'), 'new\n'), 'third party push');
    writeFileSync(join(LOCAL, 'local-only.txt'), 'mine\n');
    git('add -A', LOCAL);
    git('-c user.email=t@t -c user.name=t commit -q -m "local unpushed commit"', LOCAL);

    const beforeSha = git('rev-parse main', LOCAL);
    const result = await safePull({ repoRoot: LOCAL, mainBranch: 'main' });
    assert.equal(result.pulled, false);
    assert.equal(result.reason, 'diverged');
    assert.equal(git('rev-parse main', LOCAL), beforeSha, 'diverged case must not mutate local main at all');
  });

  it('refuses to pull when a dirty local file overlaps an incoming change, and leaves that file untouched', async () => {
    setupFixture();
    writeFileSync(join(LOCAL, 'file.txt'), 'MY UNCOMMITTED EDIT\n');

    pushFromOther((dir) => writeFileSync(join(dir, 'file.txt'), 'remote change\n'), 'remote touches the same file');

    const beforeSha = git('rev-parse main', LOCAL);
    const result = await safePull({ repoRoot: LOCAL, mainBranch: 'main' });
    assert.equal(result.pulled, false);
    assert.equal(result.reason, 'dirty-overlap');
    assert.ok(result.overlapPaths.includes('file.txt'));
    assert.equal(git('rev-parse main', LOCAL), beforeSha);
    assert.equal(readFileSync(join(LOCAL, 'file.txt'), 'utf8'), 'MY UNCOMMITTED EDIT\n', 'the dirty file must be completely untouched');
  });

  it('pulls when dirty files exist but none overlap the incoming change', async () => {
    setupFixture();
    writeFileSync(join(LOCAL, 'unrelated-dirty.txt'), 'my other unrelated work\n');
    git('add -A', LOCAL); git('-c user.email=t@t -c user.name=t commit -q -m seed', LOCAL); git('push -q origin main', LOCAL);
    writeFileSync(join(LOCAL, 'unrelated-dirty.txt'), 'STILL DIRTY, UNCOMMITTED\n');

    pushFromOther((dir) => writeFileSync(join(dir, 'other.txt'), 'new\n'), 'unrelated remote change');

    const result = await safePull({ repoRoot: LOCAL, mainBranch: 'main' });
    assert.equal(result.pulled, true);
    assert.equal(readFileSync(join(LOCAL, 'unrelated-dirty.txt'), 'utf8'), 'STILL DIRTY, UNCOMMITTED\n', 'unrelated dirty work must survive the pull untouched');
  });

  it('never leaves the repo mid-merge, and never runs a bare `git pull`', async () => {
    setupFixture();
    pushFromOther((dir) => writeFileSync(join(dir, 'other.txt'), 'new\n'), 'third party push');
    await safePull({ repoRoot: LOCAL, mainBranch: 'main' });
    assert.equal(existsSync(join(LOCAL, '.git', 'MERGE_HEAD')), false);
    // Static check: the implementation must only ever invoke `merge --ff-only`.
    const src = readFileSync(join(ROOT, 'conductor/services/git-divergence.mjs'), 'utf8');
    assert.equal(/\bgit\(\s*\[\s*['"]pull['"]/.test(src), false, 'must never shell out to a bare `git pull`');
  });

  it('respects auto_pull:false — reports divergence but never mutates', async () => {
    setupFixture();
    pushFromOther((dir) => writeFileSync(join(dir, 'other.txt'), 'new\n'), 'third party push');
    const beforeSha = git('rev-parse main', LOCAL);
    const result = await safePull({ repoRoot: LOCAL, mainBranch: 'main', autoPull: false });
    assert.equal(result.pulled, false);
    assert.equal(result.reason, 'auto-pull-disabled');
    assert.equal(git('rev-parse main', LOCAL), beforeSha);
  });
});
