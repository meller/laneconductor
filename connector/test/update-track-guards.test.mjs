// Track AM-10140: Lane is an implicit precondition for Lane Status, a done track needs `reopen` to leave, and a CONFLICT carries the
// current head and markers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, writeFile, readFile, commitAll, rm, INDEX } from './helpers/repo.mjs';

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});
const T = (n) => `conductor/tracks/AM-${n}-t${n}/index.md`;

async function open(files) {
  const dir = makeRepo();
  cleanup.push(dir);
  for (const [n, opts] of Object.entries(files)) writeFile(dir, T(n), INDEX(n, `Track ${n}`, opts));
  commitAll(dir, 'fixture');
  const s = await connect(dir);
  sessions.push(s);
  return { dir, s };
}

// TC-1 (regression): a stale `success` must not land on the lane a human just moved the track to.
test('a Lane Status-only write from a base that predates a lane move is a CONFLICT on Lane, and writes nothing', async () => {
  const { dir, s } = await open({ 1: { lane: 'implement', status: 'running' } });
  const mine = (await s.call('get_track', { track: '1', files: ['index'] })).env.data.base;
  // a human moves the track to review (a second session, fresh base)
  const theirs = (await s.call('get_track', { track: '1', files: ['index'] })).env.data.base;
  const moved = await s.call('update_track', { track: '1', base: theirs, markers: { Lane: 'review', 'Lane Status': 'queue' } });
  assert.equal(moved.isError, false, moved.text);
  const before = readFile(dir, T(1));
  const stale = await s.call('update_track', { track: '1', base: mine, markers: { 'Lane Status': 'success' } });
  assert.equal(stale.isError, true);
  assert.equal(stale.env.error.code, 'CONFLICT');
  const items = stale.env.error.details.map((d) => d.marker);
  assert.ok(items.includes('Lane'), `Lane is compared: ${items}`);
  assert.equal(stale.env.error.details.find((d) => d.marker === 'Lane').current, 'review');
  assert.equal(readFile(dir, T(1)), before, 'nothing written');
  // CONFLICT carries the current head and markers, so a caller can see what changed and does not retry with the same base
  const b = stale.env.error.base;
  assert.equal(b.markers['Lane'], 'review');
  assert.equal(b.markers['Lane Status'], 'queue');
  assert.deepEqual(b.files, {});
  const retry = await s.call('update_track', { track: '1', base: b, markers: { Progress: '10%' } });
  assert.equal(retry.isError, false, retry.text);
});

test('a Lane Status write from a current base still works, and Lane in the same call is not compared twice', async () => {
  const { s } = await open({ 1: { lane: 'implement', status: 'queue' } });
  const g = (await s.call('get_track', { track: '1', files: ['index'] })).env.data.base;
  const ok = await s.call('update_track', { track: '1', base: g, markers: { 'Lane Status': 'running' } });
  assert.equal(ok.isError, false, ok.text);
  const both = await s.call('update_track', { track: '1', base: ok.env.data.base, markers: { Lane: 'review', 'Lane Status': 'queue' } });
  assert.equal(both.isError, false, both.text);
});

// TC-2
test('leaving done needs reopen: Lane, files.index and outcome are refused without it, and work with it', async () => {
  const { dir, s } = await open({ 2: { lane: 'done', status: 'success' } });
  const g = (await s.call('get_track', { track: '2', files: ['index'] })).env.data.base;
  const refused = await s.call('update_track', { track: '2', base: g, markers: { Lane: 'plan', 'Lane Status': 'queue' } });
  assert.equal(refused.isError, true);
  assert.equal(refused.env.error.code, 'VALIDATION_FAILED');
  assert.match(refused.env.error.message, /done.*reopen/);
  assert.match(refused.env.error.hint, /Ask the human/);
  assert.match(readFile(dir, T(2)), /\*\*Lane\*\*: done/);
  const viaFile = await s.call('update_track', { track: '2', base: g, files: { index: readFile(dir, T(2)).replace('**Lane**: done', '**Lane**: plan') } });
  assert.equal(viaFile.env.error.code, 'VALIDATION_FAILED');
  // staying in done is fine: a Progress edit, and a Lane Status edit that keeps the lane
  const stay = await s.call('update_track', { track: '2', base: g, markers: { Progress: '100%' } });
  assert.equal(stay.isError, false, stay.text);
  const reopened = await s.call('update_track', { track: '2', base: stay.env.data.base, reopen: true, markers: { Lane: 'plan', 'Lane Status': 'queue' } });
  assert.equal(reopened.isError, false, reopened.text);
  assert.match(readFile(dir, T(2)), /\*\*Lane\*\*: plan/);
});

test('the done guard comes after the conflict check: a stale base to leave done is a CONFLICT, not a refusal', async () => {
  const { s } = await open({ 3: { lane: 'review', status: 'queue' } });
  const old = (await s.call('get_track', { track: '3', files: ['index'] })).env.data.base;
  const cur = (await s.call('get_track', { track: '3', files: ['index'] })).env.data.base;
  await s.call('update_track', { track: '3', base: cur, markers: { Lane: 'done', 'Lane Status': 'success' } });
  const r = await s.call('update_track', { track: '3', base: old, markers: { Lane: 'plan' } });
  assert.equal(r.env.error.code, 'CONFLICT');
});
