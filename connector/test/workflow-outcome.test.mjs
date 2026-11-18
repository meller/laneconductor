// Track AM-10131 (TC-6 to TC-9): the connector exposes the shared resolver. get_track carries `valid.next` for the track's lane,
// get_context carries `valid.next_by_lane`, and update_track accepts `outcome: success | failure` and applies the resolved
// transition in one commit. Run over the real stdio server (the SDK client) against a scratch repo whose workflow.json is
// fixture A, otralingo's real legacy file (bare targets, planning / in-progress).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './helpers/mcp.mjs';
import { git, makeRepo, rm } from './helpers/repo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_A = fs.readFileSync(path.join(HERE, 'fixtures', 'workflow', 'a-otralingo-legacy.json'), 'utf8');
const FIXTURE_B = fs.readFileSync(path.join(HERE, 'fixtures', 'workflow', 'b-current-default.json'), 'utf8');

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});
async function open(workflow = FIXTURE_A) {
  const dir = makeRepo({ files: { 'conductor/workflow.json': workflow } });
  cleanup.push(dir);
  const s = await connect(dir);
  sessions.push(s);
  return { s, dir };
}
/** A track created and moved to `lane` (the project's own lane name) with `status`; returns its number and a fresh base. */
async function trackIn(s, lane, status = 'running') {
  const made = await s.call('create_track', { title: `Probe ${lane}`, problem: 'outcome probe' });
  assert.equal(made.isError, false, made.text);
  const number = made.env.data.track.number;
  const t = await s.call('get_track', { track: number });
  const moved = await s.call('update_track', { track: number, base: t.env.data.base, markers: { Lane: lane, 'Lane Status': status } });
  assert.equal(moved.isError, false, moved.text);
  return { number, base: moved.env.data.base };
}
const commitsTouching = (dir, since) => git(dir, 'log', '--format=%H', `${since}..HEAD`).split('\n').filter(Boolean);

test('TC-6: get_track carries valid.next for the track\'s lane; get_context carries the table for every lane; both are additive', async () => {
  const { s } = await open();
  const { number } = await trackIn(s, 'in-progress');
  const t = await s.call('get_track', { track: number });
  assert.deepEqual(t.env.data.valid.next, { success: 'review:queue', failure: 'in-progress:failure' });
  assert.equal(t.env.data.valid.next_lane, 'in-progress');
  assert.deepEqual(t.env.data.valid.lanes, ['planning', 'backlog', 'in-progress', 'review', 'quality-gate', 'done'], 'valid.lanes unchanged');
  assert.deepEqual(t.env.data.valid.statuses, ['queue', 'running', 'success', 'failure', 'waiting']);
  assert.equal(t.env.data.valid.guide_lanes.implement, 'in-progress');
  assert.ok(t.env.data.track && t.env.data.files && t.env.data.base && 'conversation' in t.env.data);

  const c = await s.call('get_context');
  assert.deepEqual(c.env.data.valid.next_by_lane['in-progress'], { success: 'review:queue', failure: 'in-progress:failure' });
  assert.deepEqual(c.env.data.valid.next_by_lane.planning, { success: 'backlog:queue', failure: 'backlog:queue' });
  assert.deepEqual(c.env.data.valid.next_by_lane.done, { success: null, failure: null });
  assert.deepEqual(c.env.data.valid.next_by_lane.backlog, { success: null, failure: null }, 'backlog has no automatic move');
  assert.ok(c.env.data.manifest && c.env.data.workflow_transitions && c.env.data.lane_guides);
  const g = await s.call('get_context', { lane: 'implement' });
  assert.deepEqual(g.env.data.valid.next_by_lane['in-progress'], { success: 'review:queue', failure: 'in-progress:failure' });
});

test('TC-6: a track in a lane the workflow does not have gets valid.next null and says why, never a guess', async () => {
  const { s, dir } = await open(FIXTURE_B);
  const { number } = await trackIn(s, 'implement');
  const t = await s.call('get_track', { track: number });
  assert.deepEqual(t.env.data.valid.next, { success: 'review:queue', failure: 'implement:failure' });
  // A hand edit into a lane the workflow lacks (validation only guards connector writes).
  const idx = fs.readdirSync(path.join(dir, 'conductor/tracks')).find((n) => n.includes(String(number)));
  const file = path.join(dir, 'conductor/tracks', idx, 'index.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\*\*Lane\*\*: implement/, '**Lane**: sideways'));
  git(dir, 'add', file);
  git(dir, 'commit', '-q', '-m', 'hand edit');
  const u = await s.call('get_track', { track: number });
  assert.equal(u.env.data.valid.next, null);
  assert.match(u.env.data.valid.next_error, /sideways/);
});

test('TC-7: outcome success on an in-progress track lands in review:queue in ONE commit touching only that track\'s index.md (and the summary); failure lands in in-progress:failure', async () => {
  const { s, dir } = await open();
  const { number, base } = await trackIn(s, 'in-progress');
  const before = git(dir, 'rev-parse', 'HEAD');
  const ok = await s.call('update_track', { track: number, base, outcome: 'success' });
  assert.equal(ok.isError, false, ok.text);
  assert.deepEqual(ok.env.data.transition, { outcome: 'success', from: 'in-progress', to: 'review:queue' });
  const commits = commitsTouching(dir, before);
  assert.equal(commits.length, 1, 'one commit');
  const files = git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter((f) => f && !f.startsWith('conductor/advice-log'));
  const idxFiles = files.filter((f) => f.endsWith('/index.md'));
  assert.equal(idxFiles.length, 1);
  assert.ok(files.every((f) => f.endsWith('/index.md') || f.endsWith('tracks-summary.md')), `only the index and the summary: ${files.join(', ')}`);
  const t = await s.call('get_track', { track: number });
  assert.equal(t.env.data.track.markers.Lane, 'review');
  assert.equal(t.env.data.track.markers['Lane Status'], 'queue');
  assert.deepEqual(ok.env.data.base.markers.Lane, 'review', 'the returned base is usable for the next write');
  assert.deepEqual(t.env.data.valid.next, { success: 'quality-gate:queue', failure: 'in-progress:queue' });

  // failure
  const second = await trackIn(s, 'in-progress');
  const bad = await s.call('update_track', { track: second.number, base: second.base, outcome: 'failure' });
  assert.equal(bad.isError, false, bad.text);
  const t2 = await s.call('get_track', { track: second.number });
  assert.equal(t2.env.data.track.markers.Lane, 'in-progress');
  assert.equal(t2.env.data.track.markers['Lane Status'], 'failure');
});

test('TC-7: outcome can ride along with other markers and the summary in the same commit', async () => {
  const { s } = await open();
  const { number, base } = await trackIn(s, 'review');
  const r = await s.call('update_track', { track: number, base, outcome: 'success', markers: { Progress: '90%' }, summary: 'reviewed' });
  assert.equal(r.isError, false, r.text);
  const t = await s.call('get_track', { track: number });
  assert.equal(t.env.data.track.markers.Lane, 'quality-gate');
  assert.equal(t.env.data.track.markers['Lane Status'], 'queue');
  assert.equal(t.env.data.track.markers.Progress, '90%');
});

test('TC-8: outcome with Lane or Lane Status markers (or files.index) is VALIDATION_FAILED with a hint; nothing is written', async () => {
  const { s, dir } = await open();
  const { number, base } = await trackIn(s, 'in-progress');
  const head = git(dir, 'rev-parse', 'HEAD');
  for (const markers of [{ Lane: 'review' }, { 'Lane Status': 'queue' }]) {
    const r = await s.call('update_track', { track: number, base, outcome: 'success', markers });
    assert.equal(r.isError, true);
    assert.equal(r.env.error.code, 'VALIDATION_FAILED');
    assert.match(r.env.error.hint, /outcome/i);
    assert.match(r.env.error.hint, /Lane/);
  }
  const both = await s.call('update_track', { track: number, base, outcome: 'success', files: { index: '# x\n' } });
  assert.equal(both.isError, true);
  assert.equal(both.env.error.code, 'VALIDATION_FAILED');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head);
});

test('TC-8: an outcome that resolves to no automatic move (backlog, done) is refused with the reason', async () => {
  const { s, dir } = await open();
  for (const lane of ['done', 'backlog']) {
    const { number, base } = await trackIn(s, lane, 'queue');
    const head = git(dir, 'rev-parse', 'HEAD');
    const r = await s.call('update_track', { track: number, base, outcome: 'success' });
    assert.equal(r.isError, true, lane);
    assert.equal(r.env.error.code, 'VALIDATION_FAILED');
    assert.match(r.env.error.message, new RegExp(`${lane}.*no automatic move|no automatic move.*${lane}`, 'i'));
    assert.match(r.env.error.hint, /markers/);
    assert.equal(git(dir, 'rev-parse', 'HEAD'), head, 'nothing written');
  }
});

test('TC-8: a stale base still gives CONFLICT and nothing is written (the lane the outcome resolves from is the one the caller saw)', async () => {
  const { s, dir } = await open();
  const { number, base } = await trackIn(s, 'in-progress');
  // Someone else moves the track first.
  const other = await s.call('update_track', { track: number, base, markers: { Lane: 'review', 'Lane Status': 'queue' } });
  assert.equal(other.isError, false, other.text);
  const head = git(dir, 'rev-parse', 'HEAD');
  const stale = await s.call('update_track', { track: number, base, outcome: 'success' });
  assert.equal(stale.isError, true);
  assert.equal(stale.env.error.code, 'CONFLICT');
  assert.ok(stale.env.error.details.some((d) => d.marker === 'Lane'));
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head);
  // The stale-base CONFLICT wins over the refusal as well: a null transition behind a stale base is still a CONFLICT.
  const done = await s.call('update_track', { track: number, base: other.env.data.base, markers: { Lane: 'done', 'Lane Status': 'queue' } });
  assert.equal(done.isError, false, done.text);
  const staleToDone = await s.call('update_track', { track: number, base: other.env.data.base, outcome: 'success' });
  assert.equal(staleToDone.env.error.code, 'CONFLICT');
});

test('TC-9: over stdio against fixture A: create, move to in-progress with the project\'s own name, outcome success, read back review / queue; wrong names keep the 10128 suggestion', async () => {
  const { s } = await open();
  const made = await s.call('create_track', { title: 'Round trip', problem: 'p' });
  const number = made.env.data.track.number;
  assert.equal(made.env.data.base.markers.Lane, 'planning');
  const t = await s.call('get_track', { track: number });
  // The planning lane's own transition: success lands in backlog (otralingo's file), as valid.next says.
  assert.deepEqual(t.env.data.valid.next, { success: 'backlog:queue', failure: 'backlog:queue' });
  const wrong = await s.call('update_track', { track: number, base: t.env.data.base, markers: { Lane: 'implement' } });
  assert.equal(wrong.isError, true);
  assert.match(wrong.env.error.message, /did you mean "in-progress"\?/);
  const wrong2 = await s.call('update_track', { track: number, base: t.env.data.base, markers: { Lane: 'in_progress' } });
  assert.match(wrong2.env.error.message, /did you mean "in-progress"\?/);
  const moved = await s.call('update_track', { track: number, base: t.env.data.base, markers: { Lane: 'in-progress', 'Lane Status': 'running' } });
  assert.equal(moved.isError, false, moved.text);
  const fin = await s.call('update_track', { track: number, base: moved.env.data.base, outcome: 'success' });
  assert.equal(fin.isError, false, fin.text);
  const back = await s.call('get_track', { track: number });
  assert.equal(back.env.data.track.markers.Lane, 'review');
  assert.equal(back.env.data.track.markers['Lane Status'], 'queue');
  assert.deepEqual(back.env.data.valid.next, { success: 'quality-gate:queue', failure: 'in-progress:queue' });
});

test('update_track input schema: outcome is an optional enum success | failure; an unknown outcome is refused', async () => {
  const { s } = await open();
  const { number, base } = await trackIn(s, 'review');
  const tools = await s.client.listTools();
  const ut = tools.tools.find((x) => x.name === 'update_track');
  assert.deepEqual(ut.inputSchema.properties.outcome.enum, ['success', 'failure']);
  assert.ok(!(ut.inputSchema.required ?? []).includes('outcome'));
  assert.match(ut.description, /outcome/);
  const r = await s.call('update_track', { track: number, base, outcome: 'maybe' });
  assert.equal(r.isError, true);
});

// ---- Track AM-10137: Verdict, parking markers, defaults ----

const markersOf = async (s, number) => (await s.call('get_track', { track: number })).env.data.track.markers;

test('AM-10137 TC-4: outcome in review and quality-gate writes Verdict (pass on success, fail on failure); other lanes leave it alone', async () => {
  const { s } = await open();
  const r = await trackIn(s, 'review');
  const pass = await s.call('update_track', { track: r.number, base: r.base, outcome: 'success' });
  assert.equal(pass.isError, false, pass.text);
  assert.equal(pass.env.data.transition.verdict, 'pass');
  let m = await markersOf(s, r.number);
  assert.equal(m['Verdict'], 'pass');
  assert.equal(m['Lane'], 'quality-gate');
  const q = await trackIn(s, 'quality-gate');
  const fail = await s.call('update_track', { track: q.number, base: q.base, outcome: 'failure' });
  assert.equal(fail.isError, false, fail.text);
  m = await markersOf(s, q.number);
  assert.equal(m['Verdict'], 'fail');
  const w = await trackIn(s, 'in-progress');
  const done = await s.call('update_track', { track: w.number, base: w.base, outcome: 'success' });
  assert.equal(done.isError, false, done.text);
  assert.ok(!('Verdict' in (await markersOf(s, w.number))), 'implement produces no verdict');
});

test('AM-10137 TC-4: an explicit Verdict with an outcome wins over the derived one', async () => {
  const { s } = await open();
  const r = await trackIn(s, 'review');
  const res = await s.call('update_track', { track: r.number, base: r.base, outcome: 'success', markers: { Verdict: 'FAIL' } });
  assert.equal(res.isError, false, res.text);
  assert.equal((await markersOf(s, r.number))['Verdict'], 'fail', 'normalised to lower case');
});

test('AM-10137 TC-5: Verdict other than pass or fail is refused; null clears it', async () => {
  const { s } = await open();
  const r = await trackIn(s, 'review');
  const bad = await s.call('update_track', { track: r.number, base: r.base, markers: { Verdict: 'maybe' } });
  assert.equal(bad.isError, true);
  assert.equal(bad.env.error.code, 'VALIDATION_FAILED');
  assert.match(bad.env.error.message, /pass or fail/);
  const set = await s.call('update_track', { track: r.number, base: r.base, markers: { Verdict: 'pass' } });
  assert.equal(set.isError, false, set.text);
  const clear = await s.call('update_track', { track: r.number, base: set.env.data.base, markers: { Verdict: null } });
  assert.equal(clear.isError, false, clear.text);
  assert.ok(!('Verdict' in (await markersOf(s, r.number))));
});

test('AM-10137 TC-6: outcome clears Waiting Reason and Waiting On Tracks; a base that never saw them is not a conflict', async () => {
  const { s } = await open();
  const r = await trackIn(s, 'in-progress', 'waiting');
  const parked = await s.call('update_track', { track: r.number, base: r.base, markers: { 'Waiting Reason': 'AM-1 not merged', 'Waiting On Tracks': '1' } });
  assert.equal(parked.isError, false, parked.text);
  const res = await s.call('update_track', { track: r.number, base: r.base, outcome: 'success' });
  assert.equal(res.isError, false, res.text);
  assert.deepEqual(res.env.data.transition.cleared.sort(), ['Waiting On Tracks', 'Waiting Reason']);
  const m = await markersOf(s, r.number);
  assert.ok(!('Waiting Reason' in m) && !('Waiting On Tracks' in m));
  assert.equal(m['Lane'], 'review');
});

test('AM-10137 TC-7: the bundled review and quality-gate guides carry the clear-at-claim line and say the outcome writes Verdict', () => {
  for (const g of ['review', 'quality-gate']) {
    const text = fs.readFileSync(path.join(HERE, '..', 'guides', `${g}.md`), 'utf8');
    assert.match(text, /clear any `Verdict` marker/, `${g}: clear at claim`);
    assert.match(text, /outcome also writes `Verdict`/, `${g}: the outcome writes it`);
  }
});
