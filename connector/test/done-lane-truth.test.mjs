// Track AM-10135: done-lane truth. In the plugin world `done:queue` is gated but not merged, `done:success` is shipped, `done:failure`
// is a failed merge and `done:waiting` a PR that is open. list_tracks hides only done:success by default, the board puts the other
// three in Needs attention, and list_tracks says whether a track-N branch is merged (`git merge-base --is-ancestor`).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from './helpers/mcp.mjs';
import { buildBoard } from '../src/board.mjs';
import { commitAll, git, makeRepo, rm, writeFile, INDEX } from './helpers/repo.mjs';

const LANES = ['plan', 'implement', 'review', 'quality-gate', 'done'];
const NOW = '2026-11-18T10:00:00.000Z';
const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});

const T = (n) => `conductor/tracks/AM-${n}-t${n}`;
function repoWith(tracks) {
  const dir = makeRepo();
  cleanup.push(dir);
  for (const [n, lane, status] of tracks) writeFile(dir, `${T(n)}/index.md`, INDEX(n, `Track ${n}`, { lane, status }));
  commitAll(dir);
  return dir;
}
const DONE = [[1, 'done', 'success'], [2, 'done', 'queue'], [3, 'done', 'failure'], [4, 'done', 'waiting'], [5, 'implement', 'running']];

test('TC-1: list_tracks hides done:success only; done:queue, done:failure and done:waiting stay; include_done and lane done show all', async () => {
  const s = await connect(repoWith(DONE));
  sessions.push(s);
  const def = await s.call('list_tracks');
  assert.deepEqual(def.env.data.tracks.map((t) => t.number).sort(), [2, 3, 4, 5]);
  assert.equal(def.env.data.total, 4);
  const all = await s.call('list_tracks', { include_done: true });
  assert.deepEqual(all.env.data.tracks.map((t) => t.number).sort(), [1, 2, 3, 4, 5]);
  const done = await s.call('list_tracks', { lane: 'done' });
  assert.deepEqual(done.env.data.tracks.map((t) => t.number).sort(), [1, 2, 3, 4]);
});

test('TC-2: the board puts done:queue, done:failure and done:waiting in Needs attention, each with its reason; done:success stays quiet', () => {
  const entries = DONE.map(([n, lane, status]) => ({ folder: `AM-${n}-t${n}`, index: { content: INDEX(n, `Track ${n}`, { lane, status }) } }));
  const b = buildBoard(entries, { lanes: LANES, generatedAt: NOW });
  const by = Object.fromEntries(b.needs_attention.map((a) => [a.number, a.reasons]));
  assert.deepEqual(Object.keys(by).map(Number).sort(), [2, 3, 4]);
  assert.match(by[2][0], /done:queue.*not merged/);
  assert.match(by[3][0], /done:failure.*merge failed/);
  assert.match(by[4][0], /done:waiting.*PR/);
  assert.equal(b.counts.needs_attention, 3);
  assert.equal(b.tracks.find((t) => t.number === 1).needs_attention, false);
});

test('TC-3: list_tracks says whether the track-N branch is merged: true, false, and nothing when there is no branch', async () => {
  const dir = repoWith([[10, 'done', 'queue'], [11, 'done', 'queue'], [12, 'done', 'queue'], [13, 'done', 'success'], [14, 'done', 'success']]);
  // track-10: merged into main. track-11: has a commit main lacks. track-12: no branch. track-13: success but unmerged branch. track-14: success, merged.
  git(dir, 'branch', 'track-10');
  for (const n of [11, 13]) {
    git(dir, 'checkout', '-q', '-b', `track-${n}`);
    writeFile(dir, `code-${n}.txt`, 'x');
    commitAll(dir, `work ${n}`);
    git(dir, 'checkout', '-q', 'main');
  }
  git(dir, 'branch', 'track-14');
  const s = await connect(dir);
  sessions.push(s);
  const def = await s.call('list_tracks');
  const by = Object.fromEntries(def.env.data.tracks.map((t) => [t.number, t]));
  assert.equal(by[10].merged, true);
  assert.equal(by[11].merged, false);
  assert.ok(!('merged' in by[12]), 'no branch, no claim');
  assert.ok(!(13 in by) && !(14 in by), 'done:success is hidden by default');
  assert.ok(def.env.warnings.some((w) => /AM-10 is done:queue but its branch track-10 is already merged/.test(w)), JSON.stringify(def.env.warnings));
  const all = await s.call('list_tracks', { include_done: true });
  const by2 = Object.fromEntries(all.env.data.tracks.map((t) => [t.number, t]));
  assert.equal(by2[13].merged, false);
  assert.equal(by2[14].merged, true);
  assert.ok(all.env.warnings.some((w) => /AM-13 is done:success but its branch track-13 has commits/.test(w)), JSON.stringify(all.env.warnings));
  assert.ok(!all.env.warnings.some((w) => /AM-14 /.test(w)));
  // The check reads refs only: no tracked file changed.
  assert.equal(git(dir, 'status', '--porcelain', '--untracked-files=no'), '');
});

test('TC-3: a list with no done track does not look at branches at all', async () => {
  const dir = repoWith([[20, 'implement', 'queue']]);
  git(dir, 'branch', 'track-20');
  const s = await connect(dir);
  sessions.push(s);
  const l = await s.call('list_tracks');
  assert.ok(!('merged' in l.env.data.tracks[0]));
});

test('TC-3 (review fix): a track-N branch merged by squash or by cherry-pick, not by merge commit, is merged; a different branch with the same files is not', async () => {
  const dir = repoWith([[30, 'done', 'queue'], [31, 'done', 'queue'], [32, 'done', 'queue'], [33, 'done', 'success']]);
  for (const n of [30, 31, 32, 33]) {
    git(dir, 'checkout', '-q', '-b', `track-${n}`, 'main');
    writeFile(dir, `code-${n}.txt`, `work ${n}`);
    if (n === 33) writeFile(dir, 'code-30.txt', 'a different version');
    commitAll(dir, `work ${n}`);
    git(dir, 'checkout', '-q', 'main');
  }
  // track-30: squash merge (one new commit on main, the branch tip is not an ancestor)
  git(dir, 'merge', '--squash', 'track-30');
  git(dir, 'commit', '-q', '-m', 'squash merge of track-30');
  // track-31: cherry-picked onto main after main moved on (same patch, other parent)
  writeFile(dir, 'unrelated.txt', 'moved on');
  commitAll(dir, 'main moves');
  git(dir, 'cherry-pick', 'track-31');
  // track-32: never merged. track-33 changes code-30.txt differently from what main holds.
  const s = await connect(dir);
  sessions.push(s);
  const all = await s.call('list_tracks', { include_done: true });
  const by = Object.fromEntries(all.env.data.tracks.map((t) => [t.number, t]));
  assert.equal(by[30].merged, true, 'squash merge: main holds the branch content for its files');
  assert.equal(by[31].merged, true, 'cherry-pick: patch-equivalent commit on main');
  assert.equal(by[32].merged, false);
  assert.equal(by[33].merged, false, 'the same file with other content is not merged');
  assert.ok(all.env.warnings.some((w) => /AM-30 is done:queue but its branch track-30 is already merged/.test(w)), JSON.stringify(all.env.warnings));
  assert.equal(git(dir, 'status', '--porcelain', '--untracked-files=no'), '', 'read only');
});
