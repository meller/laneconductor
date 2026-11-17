// Track AM-10117 (TC-2, TC-3): recipe ranking, the two libraries read in order, the freshness warning, and the no-library case.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO } from '../../scripts/build-plugin.mjs';
import { discoverLibraries, rankRecipes, recommend, vocabulary } from '../src/recipes/match.mjs';
import { createRefResolver } from '../src/recipes/references.mjs';
import { rm, writeFile } from './helpers/repo.mjs';
import { makeLibrary, makeRefRepo } from './helpers/recipes.mjs';

const cleanup = [];
after(() => rm(...cleanup));
const lib = (recipes) => { const d = makeLibrary(recipes); cleanup.push(d); return d; };
const sk = (stack, extra = {}) => ({ skill: { stack: `[${stack.join(', ')}]`, ...extra } });

const SHIPPED = {
  'node-container': sk(['nodejs', 'docker'], { verified: '2026-10-01' }),
  'node-firebase': sk(['nodejs', 'firebase-hosting'], { verified: '2026-09-01' }),
  'node-firebase-gcp': sk(['nodejs', 'firebase-hosting', 'gcp'], { verified: '2026-11-01' }),
  'python-lambda': sk(['python', 'aws-lambda']),
};

test('ranking: more shared tags first, then more of the recipe covered, then newer verified, then name', async () => {
  const found = await discoverLibraries({ shipped: lib(SHIPPED) });
  const names = (tags) => rankRecipes(found.recipes, { tags }).map((r) => r.name);
  assert.deepEqual(names(['nodejs', 'firebase-hosting']), ['node-firebase', 'node-firebase-gcp', 'node-container'], '2 shared (full coverage) > 2 shared (2 of 3) > 1 shared');
  assert.deepEqual(names(['python']), ['python-lambda']);
  assert.deepEqual(names(['cobol']), [], 'a recipe sharing no tag is not a match');
  // 1 shared tag: coverage 1/2 (container, verified 2026-10-01) and 1/2 (firebase, 2026-09-01) before 1/3 (firebase-gcp).
  assert.deepEqual(names(['nodejs']), ['node-container', 'node-firebase', 'node-firebase-gcp']);
  assert.equal(rankRecipes(found.recipes, { tags: [] }).length, 4, 'no tags lists them all');
});

test('at most five are shown, and a tag compares case-insensitively', async () => {
  const many = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`r${i}`, sk(['shared', `own${i}`])]));
  const out = await recommend({ shipped: lib(many), tags: ['SHARED'] });
  assert.equal(out.matches.length, 5);
  assert.deepEqual(out.matches.map((m) => m.rank), [1, 2, 3, 4, 5]);
  assert.equal((await recommend({ shipped: lib(many), tags: ['shared'], limit: null })).matches.length, 8);
});

test('the shipped library is read first, then the personal one; a personal recipe replaces a shipped one of the same name', async () => {
  const shipped = lib({ 'node-firebase': sk(['nodejs']), 'only-shipped': sk(['nodejs']) });
  const personal = lib({ 'node-firebase': sk(['nodejs', 'mine']), 'only-mine': sk(['mine']) });
  const found = await discoverLibraries({ shipped, personal });
  assert.deepEqual(found.libraries.map((l) => l.role), ['shipped', 'personal']);
  const byName = Object.fromEntries(found.recipes.map((r) => [r.name, r]));
  assert.deepEqual(Object.keys(byName).sort(), ['node-firebase', 'only-mine', 'only-shipped']);
  assert.equal(byName['node-firebase'].library, 'personal');
  assert.equal(byName['node-firebase'].shadows, 'shipped');
  assert.deepEqual(vocabulary(found.recipes), ['mine', 'nodejs']);
});

test('the personal library comes from the flag, then LC_RECIPES, then recipes.path in .laneconductor.json (with ~ expanded)', async () => {
  const a = lib({ fromflag: sk(['t']) });
  const b = lib({ fromenv: sk(['t']) });
  const c = lib({ fromconfig: sk(['t']) });
  const repo = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-cfg-'));
  cleanup.push(repo);
  writeFile(repo, '.laneconductor.json', JSON.stringify({ recipes: { path: c } }));
  const name = async (o) => (await discoverLibraries(o)).libraries[0];
  assert.deepEqual([(await name({ personal: a, env: { LC_RECIPES: b }, repo })).path, (await name({ personal: a, env: { LC_RECIPES: b }, repo })).named_by], [a, 'flag']);
  assert.deepEqual([(await name({ env: { LC_RECIPES: b }, repo })).path, (await name({ env: { LC_RECIPES: b }, repo })).named_by], [b, 'LC_RECIPES']);
  assert.deepEqual([(await name({ env: {}, repo })).path, (await name({ env: {}, repo })).named_by], [c, 'recipes.path']);
  const home = await name({ personal: '~/lc-nonexistent-library-xyz', env: {} });
  assert.equal(home.path, path.join(os.homedir(), 'lc-nonexistent-library-xyz'));
  assert.equal(home.status, 'no_recipes_folder');
});

test('no library at all: the answer says so and the flow can continue', async () => {
  const none = await recommend({ shipped: null, env: {}, tags: ['nodejs'] });
  assert.deepEqual(none.matches, []);
  assert.deepEqual(none.libraries, []);
  assert.match(none.note, /No recipe library available.*continue without recipes/);
  const emptyShipped = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-empty-'));
  cleanup.push(emptyShipped);
  const out = await recommend({ shipped: emptyShipped, env: {}, tags: ['nodejs'] });
  assert.equal(out.libraries[0].status, 'no_recipes_folder');
  assert.match(out.note, /No recipe library available/);
  const nomatch = await recommend({ shipped: lib(SHIPPED), env: {}, tags: ['cobol'] });
  assert.match(nomatch.note, /No recipe matches these tags/);
});

test('freshness: a changed reference carries a warning; an unresolvable one is only "not checked"', async () => {
  const ref = makeRefRepo();
  cleanup.push(ref.dir);
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-roots-'));
  cleanup.push(root);
  fs.symlinkSync(ref.dir, path.join(root, 'r'));
  const resolver = createRefResolver({ roots: [root] });
  const personal = lib({
    'cites-changed': sk(['t'], { refs: [{ repo: 'o/r', path: 'a.txt', commit: ref.first }] }),
    'cites-nothing-here': sk(['t'], { refs: [{ repo: 'x/unknown', path: 'a.txt', commit: 'abc1234' }] }),
  });
  ref.second(); // the cited file changes after the recipe was verified
  const now = Date.parse('2026-11-18');
  const out = await recommend({ personal, shipped: null, env: {}, tags: ['t'], resolver, now });
  const m = Object.fromEntries(out.matches.map((x) => [x.name, x]));
  assert.deepEqual(m['cites-changed'].warnings, ['reference_changed_since_verified']);
  assert.equal(m['cites-changed'].freshness, 'possibly_stale');
  assert.deepEqual(m['cites-nothing-here'].warnings, [], 'no checkout here is not a freshness warning');
  assert.equal(m['cites-nothing-here'].references_not_checked, true);
  const skipped = await recommend({ personal, shipped: null, env: {}, tags: ['t'], resolver: null, now });
  assert.ok(skipped.matches.every((x) => x.freshness === 'not_checked' && x.references_not_checked));
  // an old verified date warns too
  const old = await recommend({ personal: lib({ stale: sk(['t'], { verified: '2026-01-01', refs: [{ repo: 'x/unknown', path: 'a.txt', commit: 'abc1234' }] }) }), env: {}, tags: ['t'], resolver, now });
  assert.deepEqual(old.matches[0].warnings, ['verified_older_than_90d']);
});

test('lc-recipe-match CLI: tags in, JSON out; the shipped library of this repo holds the synthetic example only', () => {
  const bin = path.join(REPO, 'connector/bin/lc-recipe-match.mjs');
  const personal = lib({ 'mine-one': sk(['example-hello', 'mine']) });
  const r = spawnSync(process.execPath, [bin, '--tag', 'example-hello', '--personal', personal, '--no-freshness', '--repo', os.tmpdir()], { encoding: 'utf8', env: { ...process.env, LC_RECIPES: '' } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.libraries.map((l) => l.role), ['shipped', 'personal']);
  assert.deepEqual(out.matches.map((m) => `${m.library}/${m.name}`).sort(), ['personal/mine-one', 'shipped/example-hello']);
  const vocab = JSON.parse(spawnSync(process.execPath, [bin, '--vocabulary', '--no-freshness', '--repo', os.tmpdir()], { encoding: 'utf8', env: { ...process.env, LC_RECIPES: '' } }).stdout);
  assert.deepEqual(vocab.vocabulary, ['example-hello'], 'the shipped library is empty apart from the synthetic example');
  assert.equal(spawnSync(process.execPath, [bin, '--bogus'], { encoding: 'utf8' }).status, 2);
});
