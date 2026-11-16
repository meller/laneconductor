// Phase 5: push policy (D4), plan-lane fetch advice.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, git, writeFile, commitAll, addRemote, rm } from './helpers/repo.mjs';
import { LocalGitStore } from '../src/store-local.mjs';
import { PUSH_IDLE_MS, pushWarnings, readPushPolicy } from '../src/push-policy.mjs';
import { parseLog } from '../src/advice-log.mjs';

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});
const fixture = (opts) => {
  const dir = makeRepo(opts);
  cleanup.push(dir);
  return dir;
};
const withRemote = () => {
  const dir = fixture({ files: { 'conductor/tracks/AM-1-a/plan.md': 'v1\n', 'src/x.js': '1\n' } });
  const bare = addRemote(dir);
  cleanup.push(bare);
  return { dir, bare };
};
const remoteHead = (bare) => execFileSync('git', ['--git-dir', bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
const P = 'conductor/tracks/AM-1-a/plan.md';

/** A timer spy standing in for setTimeout: tests fire the callback by hand ("injected clock"). */
function fakeTimers() {
  const t = { sets: [], cleared: [], set(fn, ms) { const h = { fn, ms }; t.sets.push(h); return h; }, clear(h) { t.cleared.push(h); } };
  return t;
}
const write = (store, content, extra = {}) => store.commitFiles({ preconditions: [], changes: [{ path: P, content }], message: 'chore(track-1): test via lc-connector', ...extra });

// TC-5.1
test('default policy "ask": a connector commit never pushes and starts no timer; the response says the commit is unpushed and tells Claude to ask', async () => {
  const { dir, bare } = withRemote();
  const before = remoteHead(bare);
  const timers = fakeTimers();
  const store = new LocalGitStore({ repo: dir, timers });
  assert.equal(store.pushStatus().policy, 'ask');
  assert.equal((await write(store, 'v2\n')).ok, true);
  assert.equal(timers.sets.length, 0, 'no push is ever scheduled under "ask"');
  assert.equal(remoteHead(bare), before);

  const s = await connect(dir);
  sessions.push(s);
  const r = await s.call('list_tracks');
  assert.equal(r.env.provenance.upstream.ahead, 1);
  assert.ok(r.env.provenance.stale_reasons.includes('unpushed_local_commits'));
  assert.ok(r.env.warnings.some((w) => /1 local commit not pushed.*ask the human/.test(w)), JSON.stringify(r.env.warnings));
  assert.equal(remoteHead(bare), before, 'still not pushed');
  assert.deepEqual(pushWarnings({ policy: 'ask', ahead: 0, last: null }), []);
});

// TC-5.2
test('"auto-state": after 60 s idle (injected timer) the conductor-only commits of a write burst are pushed once, fast-forward, and logged', async () => {
  const { dir, bare } = withRemote();
  const timers = fakeTimers();
  const store = new LocalGitStore({ repo: dir, pushPolicy: 'auto-state', timers });
  await write(store, 'v2\n');
  await write(store, 'v3\n');
  assert.equal(timers.sets.length, 2);
  assert.ok(timers.sets.every((h) => h.ms === PUSH_IDLE_MS && h.ms === 60_000));
  assert.deepEqual(timers.cleared, [timers.sets[0]], 'a new write restarts the countdown');
  assert.notEqual(remoteHead(bare), git(dir, 'rev-parse', 'HEAD'), 'nothing is pushed before the idle time');
  await timers.sets[1].fn();
  assert.equal(remoteHead(bare), git(dir, 'rev-parse', 'HEAD'));
  assert.equal(store.pushStatus().last.ok, true);
  assert.equal(store.pushStatus().last.commits.length, 2);
  const push = parseLog(fs.readFileSync(path.join(dir, `conductor/advice-log/${new Date().toISOString().slice(0, 7)}.jsonl`), 'utf8')).lines.filter((l) => l.kind === 'push');
  assert.equal(push.length, 1);
  assert.equal(push[0].ok, true);
  assert.equal(push[0].commits.length, 2);
  assert.deepEqual(pushWarnings({ policy: 'auto-state', ahead: 2, last: null }).map((w) => /not pushed yet.*60 s/.test(w)), [true]);
});

// TC-5.3
test('"auto-state" with an unpushed commit that touches src/x.js: no push, and the warning names the commit', async () => {
  const { dir, bare } = withRemote();
  const before = remoteHead(bare);
  writeFile(dir, 'src/x.js', '2\n');
  const codeCommit = commitAll(dir, 'code change').slice(0, 7);
  const timers = fakeTimers();
  const store = new LocalGitStore({ repo: dir, pushPolicy: 'auto-state', timers });
  await write(store, 'v2\n');
  const res = await timers.sets[0].fn();
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'non_state_commit');
  assert.deepEqual(res.commits, [codeCommit]);
  assert.equal(remoteHead(bare), before);
  const [w] = pushWarnings({ policy: 'auto-state', ahead: 2, last: store.pushStatus().last });
  assert.ok(w.includes(codeCommit) && /outside conductor\//.test(w) && /Ask the human/.test(w), w);
});

// TC-5.4
test('"auto-state" when the remote moved (non fast-forward): no push, no force, behind_upstream', async () => {
  const { dir, bare } = withRemote();
  const other = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-conn-other-'));
  cleanup.push(other);
  execFileSync('git', ['clone', '-q', bare, other]);
  git(other, 'config', 'user.name', 'Other');
  git(other, 'config', 'user.email', 'other@example.invalid');
  writeFile(other, 'conductor/other.md', 'theirs\n');
  commitAll(other, 'their commit');
  git(other, 'push', '-q', 'origin', 'main');
  const theirs = remoteHead(bare);
  git(dir, 'fetch', '-q');
  const timers = fakeTimers();
  const store = new LocalGitStore({ repo: dir, pushPolicy: 'auto-state', timers });
  await write(store, 'v2\n');
  const res = await timers.sets[0].fn();
  assert.deepEqual({ ok: res.ok, reason: res.reason }, { ok: false, reason: 'behind_upstream' });
  assert.equal(remoteHead(bare), theirs, 'the remote is untouched and nothing was forced');
  const [w] = pushWarnings({ policy: 'auto-state', ahead: 1, last: store.pushStatus().last });
  assert.match(w, /newer commits.*never forced/);
});

test('"auto-state" without an upstream and with a rejected push reports why and never throws', async () => {
  const dir = fixture({ files: { [P]: 'v1\n' } });
  const timers = fakeTimers();
  const store = new LocalGitStore({ repo: dir, pushPolicy: 'auto-state', timers });
  await write(store, 'v2\n');
  assert.equal((await timers.sets[0].fn()).reason, 'no_upstream');
  const { dir: d2, bare } = withRemote();
  const t2 = fakeTimers();
  const s2 = new LocalGitStore({ repo: d2, pushPolicy: 'auto-state', timers: t2 });
  await write(s2, 'v2\n');
  fs.writeFileSync(path.join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.equal((await t2.sets[0].fn()).reason, 'push_rejected');
});

test('an unpushed merge commit is not pushed automatically', async () => {
  const { dir } = withRemote();
  git(dir, 'checkout', '-q', '-b', 'side');
  writeFile(dir, 'conductor/side.md', 's\n');
  commitAll(dir, 'side');
  git(dir, 'checkout', '-q', 'main');
  writeFile(dir, 'conductor/main.md', 'm\n');
  commitAll(dir, 'main');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  const store = new LocalGitStore({ repo: dir, pushPolicy: 'auto-state', timers: fakeTimers() });
  assert.equal((await store.pushState()).reason, 'merge_commit');
});

test('readPushPolicy: absent file and absent key mean ask; auto-state is read; anything else falls back to ask with a problem', () => {
  const dir = fixture();
  assert.deepEqual(readPushPolicy(dir), { policy: 'ask' });
  writeFile(dir, '.laneconductor.json', JSON.stringify({ project: { id: 1 } }));
  assert.deepEqual(readPushPolicy(dir), { policy: 'ask' });
  writeFile(dir, '.laneconductor.json', JSON.stringify({ connector: { push: 'auto-state' } }));
  assert.deepEqual(readPushPolicy(dir), { policy: 'auto-state' });
  writeFile(dir, '.laneconductor.json', JSON.stringify({ connector: { push: 'always' } }));
  assert.equal(readPushPolicy(dir).policy, 'ask');
  assert.match(readPushPolicy(dir).problem, /connector\.push must be one of/);
  writeFile(dir, '.laneconductor.json', '{nope');
  assert.equal(readPushPolicy(dir).policy, 'ask');
  assert.match(readPushPolicy(dir).problem, /not valid JSON/);
});

test('the server reads connector.push from .laneconductor.json and its responses say so', async () => {
  const { dir } = withRemote();
  writeFile(dir, '.laneconductor.json', JSON.stringify({ connector: { push: 'auto-state' } }));
  commitAll(dir, 'config'); // one unpushed commit
  const s = await connect(dir);
  sessions.push(s);
  assert.match(s.stderr(), /push policy auto-state/);
  const r = await s.call('list_tracks');
  assert.ok(r.env.warnings.some((w) => /auto-state pushes conductor-only commits 60 s after the last write/.test(w)), JSON.stringify(r.env.warnings));
});

test('the plan lane guide tells Claude to git fetch when the last fetch is old; other lanes do not', async () => {
  const dir = fixture();
  const s = await connect(dir);
  sessions.push(s);
  const plan = (await s.call('get_context', { lane: 'plan' })).env.data.lane_guide.advice;
  assert.match(plan, /last fetch is over 1 hour old.*`git fetch`/);
  const review = (await s.call('get_context', { lane: 'review' })).env.data.lane_guide.advice;
  assert.doesNotMatch(review, /git fetch/);
});
