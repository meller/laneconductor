// Track AM-10115 Phase 0 (task 0.1, 0.7): the board manifest and the partial publish. `lc-board.mjs --site` writes manifest.json (a sha256 per
// file); `--json --previous <the manifest read from the live artifact>` names only the files that changed, the removed ones and whether the
// page changed, and gives the ready `publish` map. Without --previous the output is exactly what the base `board` command relies on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, writeFile, commitAll, rm, INDEX } from './helpers/repo.mjs';
import { FAKES } from './helpers/fakes.mjs';
import { buildManifest, parseManifest, planPublish, sha256, carriesWithheld, MANIFEST_VERSION } from '../src/board-manifest.mjs';

const BIN = new URL('../bin/lc-board.mjs', import.meta.url).pathname;
const T1 = '2026-11-19T10:00:00.000Z';
const T2 = '2026-11-19T11:00:00.000Z';
const cleanup = [];
after(() => rm(...cleanup));
const real = fs.realpathSync(os.tmpdir());
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const FOLDER = { 401: 'AM-401-planned', 402: 'AM-402-built', 403: 'AM-403-shipped' };

function fixture() {
  const dir = makeRepo();
  cleanup.push(dir);
  writeFile(dir, '.laneconductor.json', JSON.stringify({ project: { name: 'Manifest Fixture' } }));
  const t = (n, title, lane, status) => writeFile(dir, `conductor/tracks/${FOLDER[n]}/index.md`, INDEX(n, title, { lane, status }));
  t(401, 'Planned one', 'plan', 'queue');
  t(402, 'Built one', 'implement', 'running');
  t(403, 'Shipped one', 'done', 'success');
  for (const n of [401, 402, 403]) {
    writeFile(dir, `conductor/tracks/${FOLDER[n]}/plan.md`, `# Plan ${n}\n\n- [ ] task for ${n}\n`);
    writeFile(dir, `conductor/tracks/${FOLDER[n]}/spec.md`, `# Spec ${n}\n\nspec text ${n}\n`);
  }
  writeFile(dir, 'conductor/product.md', '# Product: Demo\n\n## What it is\nA demo product.\n');
  commitAll(dir);
  return dir;
}

/** Runs the board script; returns { site, out (parsed stdout), stderr, manifest (path of the site's manifest.json) }. */
function board(repo, { now = T1, previous, liveBoard } = {}) {
  const site = tmp('lc-man-site-');
  const args = [BIN, '--repo', repo, '--now', now, '--site', site, '--json'];
  if (previous !== undefined) args.push('--previous', previous);
  if (liveBoard !== undefined) args.push('--live-board', liveBoard);
  const r = spawnSync('node', args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { site, out: JSON.parse(r.stdout), stderr: r.stderr, manifest: path.join(site, 'manifest.json') };
}
/** The manifest of a first run, copied to a place of its own (what Claude reads back from the live artifact and saves). */
function saved(run, name = 'prev-manifest.json') {
  const dir = tmp('lc-man-live-');
  const p = path.join(dir, name);
  fs.copyFileSync(run.manifest, p);
  fs.copyFileSync(path.join(run.site, 'board.json'), path.join(dir, 'board.json'));
  return { manifest: p, board: path.join(dir, 'board.json') };
}
const edit = (repo, n, file, text) => { writeFile(repo, `conductor/tracks/${FOLDER[n]}/${file}`, text); commitAll(repo); };

test('the default output is unchanged: { page, root, files } with no partial-publish fields and no manifest in files; manifest.json is on disk', () => {
  const repo = fixture();
  const a = board(repo);
  assert.deepEqual(Object.keys(a.out), ['page', 'root', 'files']);
  assert.ok(a.out.files.includes('board.json') && a.out.files.includes('docs/401.json') && a.out.files.includes('docs/402.json'));
  assert.ok(!a.out.files.includes('docs/403.json'), 'a done track has no document of its own: it is in a shard');
  assert.ok(!a.out.files.includes('manifest.json') && !a.out.files.includes('version.json'), 'neither the manifest nor the version index is listed in files');
  const m = readJson(a.manifest);
  assert.equal(m.version, MANIFEST_VERSION);
  assert.deepEqual(Object.keys(m.files).sort(), [...a.out.files].sort(), 'it hashes exactly the listed files');
  assert.equal(m.page, sha256(fs.readFileSync(a.out.page)));
  for (const f of a.out.files) assert.equal(m.files[f], sha256(fs.readFileSync(path.join(a.site, f))), `${f}: sha256 over the exact bytes`);
  // The same run with --previous only ADDS fields; it never shortens files.
  const p = board(repo, { previous: saved(a).manifest });
  assert.deepEqual(p.out.files, a.out.files);
  assert.deepEqual(Object.keys(p.out), ['page', 'root', 'files', 'mode', 'changed', 'removed', 'pageChanged', 'publish']);
});

test('an unchanged board: only board.json (its generated time), manifest.json and version.json are sent; the page is unchanged', () => {
  const repo = fixture();
  const first = board(repo, { now: T1 });
  const prev = saved(first);
  const second = board(repo, { now: T2, previous: prev.manifest });
  assert.equal(second.out.mode, 'partial');
  assert.deepEqual(second.out.changed, ['board.json']);
  assert.deepEqual(second.out.removed, []);
  assert.equal(second.out.pageChanged, false);
  assert.deepEqual(second.out.publish, { 'board.json': 'board.json', 'manifest.json': 'manifest.json', 'version.json': 'version.json' });
});

test('one track edited: board.json, that track\'s document, manifest.json and version.json, nothing else', () => {
  const repo = fixture();
  const prev = saved(board(repo, { now: T1 }));
  edit(repo, 401, 'plan.md', '# Plan 401\n\n- [x] task for 401\n- [ ] one more\n');
  const r = board(repo, { now: T2, previous: prev.manifest, liveBoard: prev.board });
  assert.equal(r.out.mode, 'partial');
  assert.deepEqual(r.out.changed, ['board.json', 'docs/401.json']);
  assert.deepEqual(r.out.publish, { 'board.json': 'board.json', 'docs/401.json': 'docs/401.json', 'manifest.json': 'manifest.json', 'version.json': 'version.json' });
  assert.deepEqual(r.out.removed, []);
  // The files not named are the unchanged ones: their hashes in the new manifest equal the old ones.
  const was = readJson(prev.manifest).files;
  const now = readJson(r.manifest).files;
  for (const f of Object.keys(was)) if (!r.out.changed.includes(f)) assert.equal(now[f], was[f], f);
  assert.notEqual(now['docs/401.json'], was['docs/401.json']);
});

test('a track that became done: its document is removed with null, and board.json changes', () => {
  const repo = fixture();
  const prev = saved(board(repo, { now: T1 }));
  assert.ok(readJson(prev.manifest).files['docs/402.json']);
  writeFile(repo, `conductor/tracks/${FOLDER[402]}/index.md`, INDEX(402, 'Built one', { lane: 'done', status: 'success' }));
  commitAll(repo);
  const r = board(repo, { now: T2, previous: prev.manifest });
  assert.equal(r.out.mode, 'partial');
  assert.deepEqual(r.out.removed, ['docs/402.json']);
  // The finished tracks' documents are in a shard (track AM-10155): 402 joins 403 there, so that shard changes.
  assert.deepEqual(r.out.publish, { 'board.json': 'board.json', 'docs-done/1.json': 'docs-done/1.json', 'docs/402.json': null, 'manifest.json': 'manifest.json', 'version.json': 'version.json' });
  assert.ok(!('docs/402.json' in readJson(r.manifest).files));
});

test('a new track and a changed project file are changed; the page changing is reported', () => {
  const repo = fixture();
  const prev = saved(board(repo, { now: T1 }));
  writeFile(repo, 'conductor/tracks/AM-404-new/index.md', INDEX(404, 'New one', { lane: 'plan', status: 'queue' }));
  writeFile(repo, 'conductor/product.md', '# Product: Demo\n\n## What it is\nA changed demo product.\n');
  commitAll(repo);
  const r = board(repo, { now: T2, previous: prev.manifest });
  assert.deepEqual(r.out.changed, ['board.json', 'ctx/overview.json', 'docs/404.json']);
  // The page hash in the previous manifest differs (an old page): pageChanged is true, the files are still only the changed ones.
  const old = readJson(prev.manifest);
  old.page = sha256('an older page');
  fs.writeFileSync(prev.manifest, JSON.stringify(old));
  const r2 = board(repo, { now: T2, previous: prev.manifest });
  assert.equal(r2.out.pageChanged, true);
  assert.equal(r2.out.mode, 'partial');
});

test('no previous manifest, a missing, corrupt, wrong-version or foreign one: mode full, every file, and the manifest in publish', () => {
  const repo = fixture();
  const first = board(repo, { now: T1 });
  const dir = tmp('lc-man-bad-');
  const write = (name, text) => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };
  const good = readJson(first.manifest);
  const cases = {
    none: 'none',
    missing: path.join(dir, 'does-not-exist.json'),
    corrupt: write('corrupt.json', '{"version":1,"page":'),
    empty: write('empty.json', ''),
    wrongVersion: write('v2.json', JSON.stringify({ ...good, version: 2 })),
    noVersion: write('nov.json', JSON.stringify({ page: good.page, files: good.files })),
    badHash: write('badhash.json', JSON.stringify({ ...good, files: { 'board.json': 'xyz' } })),
    foreignPath: write('foreign.json', JSON.stringify({ ...good, files: { ...good.files, '../../etc/passwd': 'a'.repeat(64) } })),
    array: write('array.json', '[]'),
  };
  for (const [name, previous] of Object.entries(cases)) {
    const r = board(repo, { now: T2, previous });
    assert.equal(r.out.mode, 'full', name);
    assert.deepEqual(r.out.changed, r.out.files, `${name}: the full list`);
    assert.deepEqual(r.out.removed, [], name);
    assert.equal(r.out.pageChanged, true, name);
    assert.deepEqual(Object.keys(r.out.publish).sort(), [...r.out.files, 'manifest.json', 'version.json'].sort(), `${name}: everything plus the manifest and the version index`);
    assert.ok(Object.values(r.out.publish).every((v) => typeof v === 'string'), `${name}: nothing removed`);
    assert.equal(r.out.reason, 'no-previous-manifest', name);
  }
});

test('--live-board: a live board.json that is not the one the manifest describes (published by something else since) gives full; a matching one stays partial', () => {
  const repo = fixture();
  const prev = saved(board(repo, { now: T1 }));
  const ok = board(repo, { now: T2, previous: prev.manifest, liveBoard: prev.board });
  assert.equal(ok.out.mode, 'partial');
  const stale = path.join(path.dirname(prev.board), 'other-board.json');
  fs.writeFileSync(stale, '{"generated_at":"some other publish"}\n');
  const r = board(repo, { now: T2, previous: prev.manifest, liveBoard: stale });
  assert.equal(r.out.mode, 'full');
  assert.equal(r.out.reason, 'live-board-mismatch');
  const none = board(repo, { now: T2, previous: prev.manifest, liveBoard: path.join(path.dirname(prev.board), 'nope.json') });
  assert.equal(none.out.mode, 'full');
});

test('privacy: a withheld document is absent from the manifest (so every later publish retries it), is still sent with its placeholder, and the secret is in no output', () => {
  const repo = fixture();
  const secret = FAKES['Google API key'];
  edit(repo, 402, 'spec.md', `# Spec\n\nuse the key ${secret}\n`);
  const first = board(repo, { now: T1 });
  const m = readJson(first.manifest);
  assert.ok(!('docs/402.json' in m.files), 'withheld: not in the manifest');
  assert.ok(first.out.files.includes('docs/402.json'), 'but still listed and published with its placeholder');
  assert.ok('docs/401.json' in m.files);
  const prev = saved(first);
  const second = board(repo, { now: T2, previous: prev.manifest });
  assert.deepEqual(second.out.changed, ['board.json', 'docs/402.json'], 'retried although nothing changed');
  assert.equal(second.out.publish['docs/402.json'], 'docs/402.json');
  for (const x of [first, second]) {
    assert.ok(!JSON.stringify(x.out).includes(secret) && !x.stderr.includes(secret) && !fs.readFileSync(x.manifest, 'utf8').includes(secret));
  }
  // Once the cause is gone the file is hashed again and is "unchanged" from then on.
  edit(repo, 402, 'spec.md', '# Spec\n\nclean now\n');
  const third = board(repo, { now: T2, previous: prev.manifest });
  assert.ok(third.out.changed.includes('docs/402.json'));
  const fourth = board(repo, { now: T2, previous: saved(third, 'm3.json').manifest });
  assert.ok(!fourth.out.changed.includes('docs/402.json'));
});

test('unit: buildManifest leaves withheld files out; parseManifest checks version, hashes and paths; planPublish rules', () => {
  const page = Buffer.from('<html>');
  const files = { 'board.json': '{"a":1}\n', 'docs/1.json': '{"n":1}\n', 'docs/2.json': '{"n":2,"withheld":{"spec":"x"}}\n', 'ctx/tech-stack.json': '{"k":"tech-stack","md":"## a\\n\\n*withheld: possible secret or personal data (1 match); read it in the repository.*"}\n' };
  const m = buildManifest({ pageBytes: page, files });
  assert.deepEqual(Object.keys(m.files), ['board.json', 'docs/1.json']);
  assert.equal(carriesWithheld(files['docs/2.json']), true);
  assert.equal(carriesWithheld(files['docs/1.json']), false);
  assert.equal(carriesWithheld('not json'), false);
  assert.deepEqual(parseManifest(JSON.stringify(m)), m);
  assert.equal(parseManifest(JSON.stringify({ ...m, version: 2 })), null);
  assert.equal(parseManifest(null), null);
  const all = Object.keys(files);
  const same = planPublish({ current: m, allFiles: all, previous: m });
  assert.deepEqual(same.changed, ['ctx/tech-stack.json', 'docs/2.json'], 'the withheld ones are always sent');
  assert.deepEqual(same.removed, []);
  assert.equal(same.pageChanged, false);
  const gone = planPublish({ current: m, allFiles: ['board.json'], previous: m });
  assert.deepEqual(gone.removed, ['docs/1.json']);
  assert.equal(gone.publish['docs/1.json'], null);
  assert.equal(planPublish({ current: m, allFiles: all, previous: m, liveBoardSha: 'f'.repeat(64) }).mode, 'full');
  assert.equal(planPublish({ current: m, allFiles: all, previous: m, liveBoardSha: m.files['board.json'] }).mode, 'partial');
});

test('version.json: a tiny index with the board\'s generated time, written with every site, equal to board.json\'s generated_at and never listed in files', () => {
  const r = board(fixture());
  const v = JSON.parse(fs.readFileSync(path.join(r.site, 'version.json'), 'utf8'));
  const b = JSON.parse(fs.readFileSync(path.join(r.site, 'board.json'), 'utf8'));
  assert.deepEqual(Object.keys(v).sort(), ['generated_at', 'version']);
  assert.equal(v.version, 1);
  assert.equal(v.generated_at, b.generated_at);
  assert.ok(fs.statSync(path.join(r.site, 'version.json')).size < 200, 'a few dozen bytes: polling it is cheap');
  assert.ok(!r.out.files.includes('version.json'));
});
