// Track AM-10143 (owner rule): search first, the default is update, not create. create_track returns `similar_tracks` and a warning on a
// strong match (it never blocks); the `new`, `bug` and `feature` procedures, the skill file and the lane guides carry the flow.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, writeFile, commitAll, rm, INDEX } from './helpers/repo.mjs';
import { COMMANDS, fillProcedure } from '../src/commands.mjs';
import { BASE_PROCEDURES } from '../../scripts/plugin-texts.mjs';
import { similarTracks, wordsOf } from '../src/tracks.mjs';

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});
const project = (tracks) => {
  const dir = makeRepo();
  cleanup.push(dir);
  for (const [n, slug, title, opts] of tracks) writeFile(dir, `conductor/tracks/AM-${n}-${slug}/index.md`, INDEX(n, title, opts));
  commitAll(dir, 'fixture: tracks');
  return dir;
};
const create = async (dir, args) => {
  const s = await connect(dir);
  sessions.push(s);
  return s.call('create_track', args);
};
const REPO = path.resolve(import.meta.dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

test('create_track: a track that matches the new work is listed in similar_tracks with number, title, lane and lane status, plus a warning; the create still happens', async () => {
  const dir = project([[7, 'csv-export', 'Export the report as CSV', { lane: 'implement', status: 'running' }], [8, 'login', 'Fix the login redirect']]);
  const c = await create(dir, { title: 'CSV export of the monthly report', problem: 'Users want to export the report as a CSV file.' });
  assert.equal(c.isError, false, c.text);
  assert.deepEqual(c.env.data.similar_tracks, [{ number: 7, id: 'AM-7', title: 'Export the report as CSV', lane: 'implement', lane_status: 'running' }]);
  assert.ok(c.env.warnings.some((w) => /AM-7 \(implement\)/.test(w) && /Update track N\? \[default: yes\]/.test(w)), c.env.warnings.join('|'));
  assert.equal(c.env.data.track.number, 9, 'never blocks: the track was created');
});

test('create_track: nothing matches, similar_tracks is empty and there is no similar-track warning', async () => {
  const dir = project([[7, 'csv-export', 'Export the report as CSV'], [8, 'login', 'Fix the login redirect']]);
  const c = await create(dir, { title: 'Dark mode for the dashboard', problem: 'The dashboard hurts at night.' });
  assert.equal(c.isError, false, c.text);
  assert.deepEqual(c.env.data.similar_tracks, []);
  assert.ok(!c.env.warnings.some((w) => /Similar track/.test(w)));
});

test('create_track: only a done track matches, it is listed and marked with lane done', async () => {
  const dir = project([[7, 'csv-export', 'Export the report as CSV', { lane: 'done', status: 'success' }], [8, 'login', 'Fix the login redirect']]);
  const c = await create(dir, { title: 'Export the report as CSV with a header row', problem: 'Add a header row to the CSV export.' });
  assert.equal(c.isError, false, c.text);
  assert.equal(c.env.data.similar_tracks.length, 1);
  assert.equal(c.env.data.similar_tracks[0].number, 7);
  assert.equal(c.env.data.similar_tracks[0].lane, 'done');
  assert.ok(c.env.warnings.some((w) => /Similar track/.test(w)));
});

test('similarTracks: at most 5, best first, the backlog is searched, tracks without a lane are skipped', () => {
  const rows = [];
  for (let i = 1; i <= 8; i++) rows.push({ number: i, id: `AM-${i}`, title: `Export report to CSV ${i}`, lane: i === 3 ? 'backlog' : 'plan', lane_status: 'queue', summary: '', source: 'x' });
  rows.push({ number: 9, id: 'AM-9', title: 'Export report', lane: null, lane_status: null, summary: '', source: 'x' });
  rows.push({ number: 10, id: 'AM-10', title: 'Export', lane: 'plan', lane_status: 'queue', summary: 'report csv', source: 'x' });
  const r = similarTracks(rows, { title: 'Export report to CSV', problem: '' });
  assert.equal(r.similar.length, 5);
  assert.ok(!r.similar.some((x) => x.number === 9));
  assert.ok(r.strong);
  assert.ok(similarTracks(rows, { title: 'Export report to CSV', problem: '' }, 20).similar.some((x) => x.lane === 'backlog'));
  assert.deepEqual(similarTracks(rows, { title: 'the and for', problem: '' }), { similar: [], strong: false });
  assert.ok(wordsOf('Exports reports').has('report'));
});

const FLOW = [
  [/Search first/, 'the search-first step'],
  [/`include_done`/, 'done tracks are searched'],
  [/backlog/, 'the backlog lane is named'],
  [/Update track N \(title, lane\) with this\? \[default: yes\]/, 'the default-yes question'],
  [/do NOT create a track/, 'update, do not create'],
  [/done track is reopened only on my explicit yes/, 'a done track reopens only on a yes'],
  [/create is the fallback/, 'create is the fallback'],
  [/say which tracks you looked at/, 'say which tracks were looked at'],
  [/not one track each/, 'several small gaps go into one track'],
];
for (const name of ['new', 'bug', 'feature']) {
  const cmd = COMMANDS.find((c) => c.name === name);
  const values = { title: 'x y', description: 'x y' };
  test(`the connector's \`${name}\` procedure has the search-first flow`, () => {
    const text = fillProcedure(cmd, values);
    for (const [re, what] of FLOW) assert.match(text, re, `${name}: ${what}`);
    assert.ok(text.indexOf('Search first') < text.indexOf('call `create_track`'), 'search comes before create');
  });
  test(`the base's \`${name}\` procedure has the same flow and lists tracks without the connector`, () => {
    const text = BASE_PROCEDURES[name].replace(/\{\{\w+\}\}/g, 'x');
    for (const [re, what] of FLOW.filter(([, w]) => w !== 'done tracks are searched')) assert.match(text, re, `base ${name}: ${what}`);
    assert.match(text, /conductor\/tracks-summary\.md/);
    assert.match(text, /conductor\/tracks\/\*\/index\.md/);
    assert.doesNotMatch(text, /list_tracks|create_track/, 'the base names no connector tool');
  });
}

test('the skill file and the lane guides carry the rule', () => {
  const tracks = read('.claude/skills/laneconductor/ops/tracks.md');
  assert.match(tracks, /## Search first: the default is update, not create/);
  assert.match(tracks, /Update track N \(title, lane\) with this\? \[default: yes\]/);
  assert.match(tracks, /conductor\/tracks-summary\.md/, 'it lists tracks without the connector');
  assert.match(tracks, /backlog/);
  assert.match(tracks, /only on the person's explicit yes/);
  assert.match(tracks, /similar_tracks/);
  for (const f of ['lanes/plan.md', 'lanes/brainstorm.md', 'ops/working-a-track.md']) assert.match(read(`.claude/skills/laneconductor/${f}`), /Search first|search first/, f);
  for (const f of ['plan', 'brainstorm']) assert.match(read(`connector/guides/${f}.md`), /default is update, not create|search first/i, f);
  assert.match(read('connector/guides/plan.md'), /\[default: yes\]/);
});
