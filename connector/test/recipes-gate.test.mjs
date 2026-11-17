// Track AM-10117 (TC-4, AC-5): the privacy gate refuses a recipe with a secret, an email, a phone number, a .env file or a denied
// name, and passes a clean one. Fixtures only: every "private" name below is invented, every secret is built at test time, and no
// finding may echo the matched text or the deny term.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO } from '../../scripts/build-plugin.mjs';
import { gateTarget, parseDenyList, readDenyList } from '../src/recipes/privacy-gate.mjs';
import { rm } from './helpers/repo.mjs';
import { fakeGoogleKey, fakeGithubToken, makeLibrary } from './helpers/recipes.mjs';

const cleanup = [];
after(() => rm(...cleanup));
const BIN = path.join(REPO, 'connector/bin/lc-recipe-gate.mjs');
const TERM = 'zzz-fake-private-site';
const DENY = parseDenyList(`# invented names, for the test only\n${TERM}\n\nFake-Project-0042\n`);
const lib = (recipes) => { const d = makeLibrary(recipes); cleanup.push(d); return d; };
const kinds = (res, recipe) => res.results.find((r) => r.recipe === recipe).findings.map((f) => f.kind).sort();
const phone = () => `+1 ${'555'} ${'010'} ${'0199'}`; // built at test time

test('parseDenyList: comments and blank lines are skipped, terms are lower-cased, line numbers are kept', () => {
  assert.deepEqual(DENY, [{ term: TERM, line: 2 }, { term: 'fake-project-0042', line: 4 }]);
});

test('a clean recipe passes', async () => {
  const d = lib({ 'clean-one': { files: { 'a.json': '{ "ok": true }\n', '.env.example.tmpl': 'KEY=\n' } } });
  const res = await gateTarget(d, DENY);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.recipes, 1);
});

test('a secret, an email, a phone number and a .env file are each refused', async () => {
  const d = lib({
    'has-secret': { files: { 'c.ts': `const k = "${fakeGoogleKey()}";\n` } },
    'has-token': { files: { 'notes.md': `token ${fakeGithubToken()}\n` } },
    'has-email': { files: { 'notes.md': 'ask jane.doe@acme-corp.io for access\n' } },
    'has-phone': { files: { 'notes.md': `call ${phone()}\n` } },
    'has-env': { files: { '.env': 'A=1\n' } },
    'placeholder-email-ok': { files: { 'notes.md': 'mail user@example.com\n' } },
  });
  const res = await gateTarget(d, DENY);
  assert.deepEqual(kinds(res, 'has-secret'), ['secret']);
  assert.deepEqual(kinds(res, 'has-token'), ['secret']);
  assert.deepEqual(kinds(res, 'has-email'), ['email']);
  assert.deepEqual(kinds(res, 'has-phone'), ['phone']);
  assert.deepEqual(kinds(res, 'has-env'), ['env_file']);
  assert.deepEqual(kinds(res, 'placeholder-email-ok'), []);
  assert.equal(res.ok, false);
});

test('a denied name is refused in the recipe text, a file, a file path and the recipe name; case does not matter', async () => {
  const d = lib({
    'in-skill': { skill: { description: `Host a site named ${TERM.toUpperCase()} on shared hosting.` } },
    'in-file': { files: { 'deploy.sh': `echo deploying fake-project-0042\n` } },
    'in-path': { files: { [`${TERM}/x.json`]: '{}\n' } },
    [`name-${TERM}`]: {},
  });
  const res = await gateTarget(d, DENY);
  assert.ok(kinds(res, 'in-skill').includes('denied_name'));
  assert.ok(kinds(res, 'in-file').includes('denied_name'));
  assert.ok(kinds(res, 'in-path').includes('denied_name'));
  assert.ok(kinds(res, `name-${TERM}`).includes('denied_name'));
});

test('findings never contain the matched text or the deny term', async () => {
  const key = fakeGoogleKey();
  const d = lib({ leak: { files: { 'a.txt': `${key} and ${TERM}\n` } } });
  const res = await gateTarget(d, DENY);
  const dump = JSON.stringify(res).toLowerCase();
  assert.ok(res.results[0].findings.length >= 2);
  assert.ok(!dump.includes(key.toLowerCase()) && !dump.includes(TERM), 'neither the secret nor the term is echoed');
  assert.match(JSON.stringify(res), /deny-list entry on line 2/, 'only which entry matched');
});

test('the gate accepts a single recipe folder as well as a library', async () => {
  const d = lib({ single: { files: { 'x.md': 'fine\n' } } });
  const res = await gateTarget(path.join(d, 'recipes/single'), DENY);
  assert.equal(res.recipes, 1);
  assert.equal(res.ok, true);
});

test('readDenyList: a missing file is reported, not an error', async () => {
  assert.deepEqual(await readDenyList(path.join(os.tmpdir(), 'lc-no-such-deny-file.txt')), { terms: null, missing: true });
});

test('lc-recipe-gate CLI: refuses with exit 1 and no deny text, requires a deny list unless told otherwise, passes a clean library', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-gate-'));
  cleanup.push(dir);
  const denyFile = path.join(dir, 'deny.local.txt');
  fs.writeFileSync(denyFile, `${TERM}\n`);
  const bad = lib({ 'leaks-a-name': { files: { 'a.txt': `see ${TERM}\n` } } });
  const good = lib({ 'fine': { files: { 'a.txt': 'nothing private\n' } } });
  const run = (...a) => spawnSync(process.execPath, [BIN, ...a], { encoding: 'utf8', cwd: dir, env: { ...process.env, LC_RECIPE_DENY: '' } });
  const refused = run(bad, '--deny-file', denyFile);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /refused leaks-a-name: files\/a\.txt:1 denied_name/);
  assert.ok(!refused.stdout.includes(TERM), 'the CLI never prints the denied term');
  assert.match(refused.stdout, /1 recipe gated: 0 clean, 1 refused, 1 deny-list entries used/);
  const clean = run(good, '--deny-file', denyFile);
  assert.equal(clean.status, 0, clean.stdout);
  const noList = run(good); // no deny file in cwd, none given
  assert.equal(noList.status, 1);
  assert.match(noList.stdout, /no deny list at .*recipe-deny\.local\.txt/);
  const skip = run(good, '--no-deny-list');
  assert.equal(skip.status, 0);
  assert.match(skip.stdout, /private names were NOT checked/);
  assert.equal(run().status, 2);
});

test('the deny file is git-ignored and nothing tracked contains a deny-list file', () => {
  const r = spawnSync('git', ['-C', REPO, 'check-ignore', '-q', 'conductor/recipe-deny.local.txt']);
  assert.equal(r.status, 0, 'conductor/recipe-deny.local.txt must be in .gitignore');
  const tracked = spawnSync('git', ['-C', REPO, 'ls-files', '--', 'conductor/recipe-deny.local.txt'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(tracked, '');
});

test('the recipe that ships in this repo passes the gate with a fixture deny list', async () => {
  const shipped = path.join(REPO, '.claude/skills/laneconductor');
  const res = await gateTarget(shipped, DENY);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.results.map((r) => r.recipe), ['example-hello']);
});
