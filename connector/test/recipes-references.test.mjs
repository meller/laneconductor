// Phase 2 (TC-2.11, TC-2.12): reference resolution by origin URL, and recipe freshness.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, rm } from './helpers/repo.mjs';
import { makeRefRepo } from './helpers/recipes.mjs';
import { checkReference, createRefResolver, normalizeRepoUrl, recipeFreshness } from '../src/recipes/references.mjs';

const cleanup = [];
after(() => rm(...cleanup));

/** A root holding the given checkouts under chosen folder names (symlinks, so the repos stay where they are). */
function rootWith(entries) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-roots-'));
  cleanup.push(root);
  for (const [folder, dir] of Object.entries(entries)) fs.symlinkSync(dir, path.join(root, folder));
  return root;
}
const ref = (extra = {}) => ({ repo: 'o/r', path: 'a.txt', commit: '', proves: 'x', ...extra });

test('normalizeRepoUrl handles ssh, https, scp-like, trailing .git and slash', () => {
  for (const u of ['git@github.com:o/r.git', 'https://github.com/o/r', 'https://github.com/o/r.git', 'https://github.com/o/r/', 'ssh://git@github.com/o/r.git', 'https://user@github.com/O/R.git']) {
    assert.equal(normalizeRepoUrl(u), 'o/r', u);
  }
  assert.equal(normalizeRepoUrl('/some/local/path'), null);
  assert.equal(normalizeRepoUrl(null), null);
});

test('TC-2.11: both origin spellings resolve o/r, and a folder named r with another origin does not (V6)', async () => {
  const ssh = makeRefRepo({ origin: 'git@github.com:o/r.git' });
  const https = makeRefRepo({ origin: 'https://github.com/o/r2' });
  const decoy = makeRefRepo({ origin: 'https://github.com/o/other' });
  cleanup.push(ssh.dir, https.dir, decoy.dir);
  const root = rootWith({ unrelated: ssh.dir, r: decoy.dir, third: https.dir });
  const res = createRefResolver({ roots: [root] });
  assert.equal(fs.realpathSync(await res.resolve('o/r')), ssh.dir);
  assert.equal(fs.realpathSync(await res.resolve('o/r2')), https.dir);
  assert.equal(await res.resolve('o/missing'), null);
  assert.equal(fs.realpathSync(await res.resolve('o/other')), decoy.dir, 'folder "r" is found by its origin o/other, not by its name');
});

test('a folder that is not itself a checkout is ignored, and a missing root is fine', async () => {
  const plain = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-plain-'));
  cleanup.push(plain);
  const root = rootWith({ plain });
  const res = createRefResolver({ roots: [root, path.join(root, 'nope')] });
  assert.equal(await res.resolve('o/r'), null);
});

test('TC-2.12: freshness per reason', async () => {
  const r = makeRefRepo();
  cleanup.push(r.dir);
  const resolver = createRefResolver({ roots: [rootWith({ r: r.dir })] });
  const NOW = Date.parse('2026-11-17T00:00:00Z');
  const md = (over = {}) => ({ verified: '2026-11-15', reference: [ref({ commit: r.first })], ...over });
  const fresh = (m) => recipeFreshness(m, { resolver, now: NOW });

  const ok = await fresh(md());
  assert.deepEqual([ok.freshness, ok.stale_reasons], ['fresh', []]);
  assert.equal(ok.references[0].status, 'ok');

  const unresolvable = await recipeFreshness(md({ reference: [ref({ repo: 'o/elsewhere', commit: r.first })] }), { resolver, now: NOW });
  assert.deepEqual([unresolvable.freshness, unresolvable.stale_reasons], ['possibly_stale', ['reference_unresolvable']]);
  const noResolver = await recipeFreshness(md(), { resolver: null, now: NOW });
  assert.deepEqual(noResolver.stale_reasons, ['reference_unresolvable']);

  const d91 = await fresh(md({ verified: '2026-08-18' }));
  assert.deepEqual([d91.freshness, d91.stale_reasons], ['possibly_stale', ['verified_older_than_90d']]);
  assert.deepEqual((await fresh(md({ verified: '2026-08-19' }))).stale_reasons, [], '90 days exactly is not older than 90 days');

  const draft = await fresh(md({ verified: null }));
  assert.deepEqual([draft.freshness, draft.stale_reasons], ['stale', ['verified_missing']]);

  r.second();
  const changed = await fresh(md());
  assert.deepEqual([changed.freshness, changed.stale_reasons], ['possibly_stale', ['reference_changed_since_verified']]);
  const atNew = await fresh(md({ reference: [ref({ commit: git(r.dir, 'rev-parse', 'HEAD') })] }));
  assert.equal(atNew.freshness, 'fresh');

  r.remove();
  const gone = await fresh(md());
  assert.deepEqual([gone.freshness, gone.stale_reasons], ['stale', ['reference_missing']]);
});

test('a cited commit without the path, or an unknown commit, is missing_at_commit (the recipe is wrong, not the repo)', async () => {
  const r = makeRefRepo();
  cleanup.push(r.dir);
  const resolver = createRefResolver({ roots: [rootWith({ r: r.dir })] });
  assert.equal((await checkReference(ref({ commit: r.first, path: 'nope.txt' }), resolver)).status, 'missing_at_commit');
  assert.equal((await checkReference(ref({ commit: 'deadbee' }), resolver)).status, 'missing_at_commit');
});

test('the resolver never writes: the reference repo is unchanged afterwards', async () => {
  const r = makeRefRepo();
  cleanup.push(r.dir);
  const before = git(r.dir, 'status', '--porcelain') + git(r.dir, 'rev-parse', 'HEAD');
  await recipeFreshness({ verified: '2026-11-15', reference: [ref({ commit: r.first })] }, { resolver: createRefResolver({ roots: [rootWith({ r: r.dir })] }), now: Date.now() });
  assert.equal(git(r.dir, 'status', '--porcelain') + git(r.dir, 'rev-parse', 'HEAD'), before);
});
