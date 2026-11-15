import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LocalGitStore } from '../src/store-local.mjs';
import { blobSha } from '../src/blob.mjs';
import { makeRepo, git, writeFile, readFile, commitAll, addRemote, rm } from './helpers/repo.mjs';

const cleanup = [];
after(() => rm(...cleanup));
const fixture = (opts) => {
  const dir = makeRepo(opts);
  cleanup.push(dir);
  return dir;
};
const store = (dir, extra = {}) => new LocalGitStore({ repo: dir, indexLockBackoffMs: 100, ...extra });
const P = 'conductor/tracks/AM-1-a/plan.md';
const commitCount = (dir) => Number(git(dir, 'rev-list', '--count', 'HEAD'));

// TC-2.8
test('a matching precondition lands the write in exactly one commit that touches only the written paths', async () => {
  const dir = fixture({ files: { [P]: 'v1\n', 'conductor/other.md': 'o\n', 'src/x.js': '1\n' } });
  writeFile(dir, 'conductor/other.md', 'dirty\n'); // unrelated dirty file
  writeFile(dir, 'src/x.js', 'staged\n');
  git(dir, 'add', 'src/x.js'); // unrelated staged file
  const before = commitCount(dir);
  const r = await store(dir).commitFiles({
    preconditions: [{ path: P, sha: blobSha('v1\n') }],
    changes: [{ path: P, content: 'v2\n' }],
    message: 'chore(track-1): test write via lc-connector\n\nBase: x',
  });
  assert.equal(r.ok, true);
  assert.match(r.commit, /^[0-9a-f]{40}$/);
  assert.equal(readFile(dir, P), 'v2\n');
  assert.equal(commitCount(dir), before + 1);
  assert.deepEqual(git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n'), [P]);
  assert.equal(git(dir, 'log', '-1', '--format=%B').split('\n')[0], 'chore(track-1): test write via lc-connector');
  assert.match(git(dir, 'status', '--porcelain'), /^ M conductor\/other.md$/m);
  assert.match(git(dir, 'status', '--porcelain'), /^M  src\/x.js$/m, 'staged file is still staged and uncommitted');
});

// TC-2.9
test('a precondition mismatch is a conflict: bytes unchanged, no commit', async () => {
  const dir = fixture({ files: { [P]: 'v1\n' } });
  const before = commitCount(dir);
  const r = await store(dir).commitFiles({
    preconditions: [{ path: P, sha: blobSha('something else') }],
    changes: [{ path: P, content: 'v2\n' }],
    message: 'm',
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.conflict, [{ path: P, expected: blobSha('something else'), actual: blobSha('v1\n') }]);
  assert.equal(readFile(dir, P), 'v1\n');
  assert.equal(commitCount(dir), before);
});

// TC-2.10
test('precondition sha:null while the file exists conflicts (create never overwrites)', async () => {
  const dir = fixture({ files: { [P]: 'v1\n' } });
  const r = await store(dir).commitFiles({ preconditions: [{ path: P, sha: null }], changes: [{ path: P, content: 'new\n' }], message: 'm' });
  assert.equal(r.ok, false);
  assert.equal(r.conflict[0].actual, blobSha('v1\n'));
  assert.equal(readFile(dir, P), 'v1\n');
  const fresh = await store(dir).commitFiles({ preconditions: [{ path: 'conductor/new.md', sha: null }], changes: [{ path: 'conductor/new.md', content: 'x\n' }], message: 'm' });
  assert.equal(fresh.ok, true);
  assert.equal(git(dir, 'show', 'HEAD:conductor/new.md'), 'x');
});

// TC-2.11
test('two concurrent writers from the same base: exactly one wins (20 iterations, two store instances)', async () => {
  const dir = fixture({ files: { [P]: 'v0\n' } });
  const a = store(dir);
  const b = store(dir);
  for (let i = 0; i < 20; i++) {
    const baseContent = readFile(dir, P);
    const sha = blobSha(baseContent);
    const [ra, rb] = await Promise.all([
      a.commitFiles({ preconditions: [{ path: P, sha }], changes: [{ path: P, content: `a${i}\n` }], message: `a${i}` }),
      b.commitFiles({ preconditions: [{ path: P, sha }], changes: [{ path: P, content: `b${i}\n` }], message: `b${i}` }),
    ]);
    assert.equal([ra, rb].filter((r) => r.ok).length, 1, `iteration ${i}`);
    const winner = ra.ok ? `a${i}\n` : `b${i}\n`;
    assert.equal(readFile(dir, P), winner);
    assert.equal(git(dir, 'show', `HEAD:${P}`) + '\n', winner);
  }
  assert.ok(!fs.existsSync(path.join(dir, '.git', 'lc-connector.lock')), 'lock released');
});

// TC-2.12
test('writes off the state branch are refused; reads work and the provenance says so', async () => {
  const dir = fixture({ files: { [P]: 'v1\n' } });
  git(dir, 'switch', '-q', '-c', 'feature');
  const s = store(dir);
  await assert.rejects(
    s.commitFiles({ preconditions: [], changes: [{ path: 'conductor/z.md', content: 'z' }], message: 'm' }),
    (e) => e.code === 'NOT_ON_STATE_BRANCH' && /git switch main/.test(e.hint),
  );
  assert.ok(!fs.existsSync(path.join(dir, 'conductor/z.md')));
  assert.equal((await s.readFiles([P])).get(P).content, 'v1\n');
  assert.equal((await s.freshness()).checkoutBranch, 'feature');
});

// TC-2.13
test('a failing pre-commit hook leaves the write on disk with commit:null and commitError, nothing staged', async () => {
  const dir = fixture({ files: { [P]: 'v1\n' } });
  const hook = path.join(dir, '.git', 'hooks', 'pre-commit');
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, '#!/bin/sh\necho "hook says no" >&2\nexit 1\n', { mode: 0o755 });
  const before = commitCount(dir);
  const r = await store(dir).commitFiles({ preconditions: [{ path: P, sha: blobSha('v1\n') }], changes: [{ path: P, content: 'v2\n' }], message: 'm' });
  assert.equal(r.ok, true);
  assert.equal(r.commit, null);
  assert.match(r.commitError, /hook says no/);
  assert.equal(readFile(dir, P), 'v2\n', 'write stays on disk');
  assert.equal(commitCount(dir), before);
  assert.equal(git(dir, 'diff', '--cached', '--name-only'), '', 'nothing left staged');
});

// TC-2.14
test('an .git/index.lock present for ~500 ms is retried and succeeds; held throughout it is WRITE_FAILED and rolled back', async () => {
  const dir = fixture({ files: { [P]: 'v1\n' } });
  const lock = path.join(dir, '.git', 'index.lock');
  fs.writeFileSync(lock, '');
  setTimeout(() => fs.rmSync(lock, { force: true }), 500);
  const ok = await store(dir, { indexLockBackoffMs: 200 }).commitFiles({ preconditions: [], changes: [{ path: P, content: 'v2\n' }], message: 'm' });
  assert.equal(ok.ok, true);
  assert.ok(ok.commit);

  fs.writeFileSync(lock, '');
  await assert.rejects(
    store(dir, { indexLockBackoffMs: 20 }).commitFiles({ preconditions: [], changes: [{ path: P, content: 'v3\n' }], message: 'm' }),
    { code: 'WRITE_FAILED' },
  );
  assert.equal(readFile(dir, P), 'v2\n', 'rolled back');
  fs.rmSync(lock, { force: true });
});

// TC-2.15 / 2.16 are in provenance.test.mjs (they need the store and the rules together)

// TC-2.17
test('a gitignored conversation.md is written, not committed, never force-added', async () => {
  const dir = fixture({ files: { '.gitignore': 'conductor/tracks/**/conversation.md\n' } });
  const c = 'conductor/tracks/AM-1-a/conversation.md';
  const before = commitCount(dir);
  const r = await store(dir).commitFiles({ preconditions: [{ path: c, sha: null }], changes: [{ path: c, content: '> **claude**: hi\n' }], message: 'm' });
  assert.equal(r.ok, true);
  assert.equal(r.commit, null);
  assert.match(r.commitError, /gitignored.*D5/);
  assert.deepEqual(r.ignored, [c]);
  assert.equal(readFile(dir, c), '> **claude**: hi\n');
  assert.equal(commitCount(dir), before);
  assert.equal(git(dir, 'ls-files', c), '', 'never added');
});

test('when ignored and committable paths are mixed, the committable ones are committed and the ignored are reported', async () => {
  const dir = fixture({ files: { '.gitignore': 'conductor/tracks/**/conversation.md\n' } });
  const c = 'conductor/tracks/AM-1-a/conversation.md';
  const r = await store(dir).commitFiles({ preconditions: [], changes: [{ path: P, content: 'p\n' }, { path: c, content: 'c\n' }], message: 'm' });
  assert.ok(r.commit);
  assert.deepEqual(r.ignored, [c]);
  assert.deepEqual(git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n'), [P]);
});

test('delete changes are committed', async () => {
  const dir = fixture({ files: { [P]: 'v1\n' } });
  const r = await store(dir).commitFiles({ preconditions: [{ path: P, sha: blobSha('v1\n') }], changes: [{ path: P, delete: true }], message: 'rm' });
  assert.ok(r.commit);
  assert.ok(!fs.existsSync(path.join(dir, P)));
  assert.equal(git(dir, 'ls-files', P), '');
});

test('path safety: writes only under conductor/, no .., no .git, no symlink escape', async () => {
  const dir = fixture();
  const s = store(dir);
  for (const bad of ['src/x.js', '../escape.md', 'conductor/../src/x.js', '.git/config', '/etc/passwd', 'conductor\\x']) {
    await assert.rejects(s.commitFiles({ preconditions: [], changes: [{ path: bad, content: 'x' }], message: 'm' }), { code: 'VALIDATION_FAILED' }, bad);
  }
  await assert.rejects(s.readFiles(['../../etc/passwd']), { code: 'VALIDATION_FAILED' });
  const outside = fs.mkdtempSync(path.join(fs.realpathSync(path.dirname(dir)), 'lc-conn-outside-'));
  cleanup.push(outside);
  fs.symlinkSync(outside, path.join(dir, 'conductor', 'link'));
  await assert.rejects(s.commitFiles({ preconditions: [], changes: [{ path: 'conductor/link/x.md', content: 'x' }], message: 'm' }), { code: 'VALIDATION_FAILED' });
  assert.ok(!fs.existsSync(path.join(outside, 'x.md')));
});

test('reads: listDir, readFiles (missing is null), isAncestor, upstreamDirs', async () => {
  const dir = fixture({ files: { [P]: 'v1\n' } });
  const bare = addRemote(dir);
  cleanup.push(bare);
  const first = git(dir, 'rev-parse', 'HEAD');
  const s = store(dir);
  assert.deepEqual((await s.listDir('conductor/tracks')).map((e) => [e.name, e.type]), [['.gitkeep', 'file'], ['AM-1-a', 'dir']]);
  assert.deepEqual(await s.listDir('conductor/nope'), []);
  const m = await s.readFiles([P, 'conductor/missing.md']);
  assert.equal(m.get(P).sha, blobSha('v1\n'));
  assert.equal(m.get('conductor/missing.md'), null);
  assert.equal(await s.isAncestor(first), true);
  assert.equal(await s.isAncestor('0123456789abcdef0123456789abcdef01234567'), false);
  assert.equal(await s.isAncestor('not-a-sha'), false);
  assert.deepEqual(await s.upstreamDirs('conductor/tracks'), ['AM-1-a']);
  writeFile(dir, 'conductor/tracks/AM-2-b/index.md', 'x');
  assert.deepEqual(await s.upstreamDirs('conductor/tracks'), ['AM-1-a'], 'local-only folders are not upstream');
  commitAll(dir);
  assert.equal(await s.isAncestor(first), true, 'older commit is an ancestor of the new head');
});
