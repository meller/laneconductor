import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalGitStore } from '../src/store-local.mjs';
import { buildProvenance, computeFreshness, provenanceLine, formatAge } from '../src/provenance.mjs';
import { makeRepo, git, writeFile, commitAll, addRemote, rm } from './helpers/repo.mjs';

const cleanup = [];
after(() => rm(...cleanup));
const synced = () => {
  const dir = makeRepo();
  const bare = addRemote(dir);
  cleanup.push(dir, bare);
  git(dir, 'fetch', '-q', 'origin');
  return { dir, bare, store: new LocalGitStore({ repo: dir }) };
};
const prov = (store, now) => buildProvenance(store, { now });

// TC-2.15
test('clean, synced and recently fetched is fresh', async () => {
  const { store } = synced();
  const p = await prov(store);
  assert.equal(p.freshness, 'fresh', JSON.stringify(p));
  assert.deepEqual(p.stale_reasons, []);
  assert.deepEqual([p.upstream.ahead, p.upstream.behind], [0, 0]);
  assert.equal(p.upstream.ref, 'origin/main');
});

test('ahead 2 gives possibly_stale + unpushed_local_commits', async () => {
  const { dir, store } = synced();
  writeFile(dir, 'conductor/a.md', '1');
  commitAll(dir);
  writeFile(dir, 'conductor/b.md', '2');
  commitAll(dir);
  const p = await prov(store);
  assert.equal(p.freshness, 'possibly_stale');
  assert.deepEqual(p.stale_reasons, ['unpushed_local_commits']);
  assert.equal(p.upstream.ahead, 2);
});

test('behind 1 after a fetch gives stale + behind_upstream', async () => {
  const { dir, bare, store } = synced();
  // a second clone pushes a commit
  const other = fs.mkdtempSync(path.join(fs.realpathSync(path.dirname(dir)), 'lc-conn-other-'));
  cleanup.push(other);
  git(other, 'clone', '-q', bare, '.');
  git(other, 'config', 'user.name', 'o');
  git(other, 'config', 'user.email', 'o@example.invalid');
  git(other, 'config', 'commit.gpgsign', 'false');
  writeFile(other, 'conductor/remote.md', 'r');
  commitAll(other);
  git(other, 'push', '-q', 'origin', 'main');
  git(dir, 'fetch', '-q', 'origin');
  const p = await prov(store);
  assert.equal(p.freshness, 'stale');
  assert.deepEqual(p.stale_reasons, ['behind_upstream']);
  assert.equal(p.upstream.behind, 1);
});

test('no upstream gives no_upstream', async () => {
  const dir = makeRepo();
  cleanup.push(dir);
  const p = await prov(new LocalGitStore({ repo: dir }));
  assert.equal(p.freshness, 'possibly_stale');
  assert.deepEqual(p.stale_reasons, ['no_upstream']);
  assert.equal(p.upstream, null);
});

test('FETCH_HEAD older than 1 h gives last_fetch_older_than_1h', async () => {
  const { dir, store } = synced();
  const fh = path.join(dir, '.git', 'FETCH_HEAD');
  const old = new Date(Date.now() - 2 * 3600_000);
  fs.utimesSync(fh, old, old);
  const p = await prov(store);
  assert.deepEqual(p.stale_reasons, ['last_fetch_older_than_1h']);
});

test('a dirty conductor/ file gives dirty_state_files (and a dirty non-state file does not)', async () => {
  const { dir, store } = synced();
  writeFile(dir, 'src/code.js', 'x');
  assert.equal((await prov(store)).freshness, 'fresh');
  writeFile(dir, 'conductor/tracks/AM-9-x/plan.md', 'draft');
  const p = await prov(store);
  assert.deepEqual(p.stale_reasons, ['dirty_state_files']);
  assert.deepEqual(p.dirty_paths, ['conductor/tracks/AM-9-x/plan.md']);
});

test('stale outranks possibly_stale and reasons keep the rule order', () => {
  const r = computeFreshness({
    dirtyPaths: ['x'], now: Date.now(),
    upstream: { ref: 'origin/main', ahead: 1, behind: 2, lastFetchAt: new Date().toISOString() },
  });
  assert.equal(r.freshness, 'stale');
  assert.deepEqual(r.stale_reasons, ['behind_upstream', 'unpushed_local_commits', 'dirty_state_files']);
});

test('github-only rules: remote_head_older_than_24h, cache_age_over_60s, served_from_cache_rate_limited', () => {
  const now = Date.now();
  const r = computeFreshness({ backend: 'github', now, headTime: new Date(now - 25 * 3600_000).toISOString(), cache: { age_s: 61 } });
  assert.deepEqual(r.stale_reasons, ['remote_head_older_than_24h', 'cache_age_over_60s']);
  assert.equal(computeFreshness({ backend: 'github', now, cache: { rate_limited: true, age_s: 0 } }).freshness, 'stale');
});

// TC-2.16
test('the provenance line has the short commit, branch, backend, ahead/behind and the fetch age', async () => {
  const { dir, store } = synced();
  const fh = path.join(dir, '.git', 'FETCH_HEAD');
  const t = new Date(Date.now() - 3 * 3600_000 - 60_000);
  fs.utimesSync(fh, t, t);
  writeFile(dir, 'conductor/a.md', '1');
  commitAll(dir);
  const p = await prov(store);
  const short = git(dir, 'rev-parse', '--short=7', 'HEAD');
  assert.ok(p.line.startsWith(`LaneConductor state as of ${short} on main (local, clean); origin/main: ahead 1, behind 0; last fetch 3h ago.`), p.line);
  assert.match(p.line, /Freshness: possibly_stale \(unpushed_local_commits, last_fetch_older_than_1h\)\./);
});

test('the line for a fresh repo with dirty files and for never-fetched upstreams', () => {
  const base = { backend: 'local', branch: 'main', commit: 'abcdef1234567', dirty_paths: ['a', 'b'], upstream: { ref: 'origin/main', ahead: 0, behind: 0, last_fetch_at: null }, freshness: 'fresh', stale_reasons: [] };
  assert.equal(provenanceLine(base, 0), 'LaneConductor state as of abcdef1 on main (local, 2 uncommitted state files); origin/main: ahead 0, behind 0; never fetched.');
  assert.equal(formatAge(5_000), '5s');
  assert.equal(formatAge(90 * 60_000), '1h');
  assert.equal(formatAge(3 * 86_400_000), '3d');
});

test('an empty repo (no commits) does not throw', async () => {
  const { execFileSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-conn-empty-'));
  cleanup.push(dir);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  const p = await prov(new LocalGitStore({ repo: dir }));
  assert.equal(p.commit, null);
  assert.match(p.line, /no commits/);
});
