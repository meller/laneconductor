// Track AM-10145: the optional marker `**Part Of**: <epic number>` and the derived children table. The epic's status is never stored:
// it is computed from the children's own index.md in list_tracks, get_track and the board, and a child finishing never edits the epic.
// HUMAN, not covered here: the board page drawn in a browser (the drawEpics block of board-page.html).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, rm, git } from './helpers/repo.mjs';
import { rowOf } from '../src/summary.mjs';
import { childrenOf, epicTable, epicsOf } from '../src/epics.mjs';
import { buildBoard, boardPageData } from '../src/board.mjs';

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});

const index = (n, markers) => `# Track AM-${n}: Track ${n}\n\n${Object.entries({ Lane: 'plan', 'Lane Status': 'queue', ...markers }).map(([k, v]) => `**${k}**: ${v}`).join('\n')}\n\n## Problem\n\nx\n`;
const files = (list) => Object.fromEntries(list.map(([n, m]) => [`conductor/tracks/AM-${n}-track-${n}/index.md`, index(n, m)]));
const LIST = [[100, { Lane: 'plan', 'Lane Status': 'running' }], [101, { 'Part Of': '100', Lane: 'done', 'Lane Status': 'success' }], [102, { 'Part Of': '100', Priority: 'High' }], [103, { 'Part Of': 'AM-100', Lane: 'implement', 'Lane Status': 'waiting', 'Waiting Reason': 'x', 'Depends On': '102' }], [104, {}]];
const idx = (n, m) => ({ folder: `AM-${n}-track-${n}`, index: { content: index(n, m) } });

test('TC-1: Part Of and Priority are parsed into the row only when set and valid; a track that names itself or a bad value is unchanged', () => {
  const r = (m) => rowOf('AM-5-x', { content: index(5, m) });
  assert.equal(r({ 'Part Of': '100' }).part_of, 100);
  assert.equal(r({ 'Part Of': 'AM-100' }).part_of, 100, 'the id form works');
  assert.ok(!('part_of' in r({})) && !('priority' in r({})), 'nothing added when unset');
  assert.ok(!('part_of' in r({ 'Part Of': '5' })), 'a track cannot be part of itself');
  assert.ok(!('part_of' in r({ 'Part Of': 'soon' })));
  assert.equal(r({ Priority: 'High' }).priority, 'high');
  assert.ok(!('priority' in r({ Priority: 'urgent' })));
});

test('TC-2: the derived table lists the children by number with lane, status, progress, a done count; nothing for a track with no children', () => {
  const rows = LIST.map(([n, m]) => rowOf(`AM-${n}-track-${n}`, { content: index(n, m) }));
  const t = epicTable(rows, 100);
  assert.deepEqual(t.children.map((c) => c.id), ['AM-101', 'AM-102', 'AM-103']);
  assert.equal(t.done, 1);
  assert.equal(t.line, '1 of 3 children done:success');
  assert.deepEqual(t.children[2].blocked_by, [102], 'a child that waits on an unshipped track says so');
  assert.equal(epicTable(rows, 104), null);
  assert.deepEqual(childrenOf(rows, 999), []);
  assert.deepEqual(epicsOf(rows).map((e) => e.row.number), [100]);
});

test('TC-3: list_tracks and get_track show the epic its children table; a child shows part_of; the epic file is never written', async () => {
  const dir = makeRepo({ files: files(LIST), workflow: false });
  cleanup.push(dir);
  const s = await connect(dir);
  sessions.push(s);
  const epicFile = path.join(dir, 'conductor/tracks/AM-100-track-100/index.md');
  const before = fs.readFileSync(epicFile, 'utf8');
  const head = git(dir, 'rev-parse', 'HEAD');
  const list = (await s.call('list_tracks', { include_done: true })).env.data.tracks;
  const epic = list.find((t) => t.number === 100);
  assert.equal(epic.children_line, '1 of 3 children done:success');
  assert.equal(epic.children.length, 3);
  assert.equal(list.find((t) => t.number === 102).part_of, 100);
  assert.equal(list.find((t) => t.number === 102).priority, 'high');
  assert.ok(!('children' in list.find((t) => t.number === 104)));
  const got = (await s.call('get_track', { track: 100 })).env.data;
  assert.equal(got.children.total, 3);
  assert.equal((await s.call('get_track', { track: 104 })).env.data.children, undefined);
  assert.equal(fs.readFileSync(epicFile, 'utf8'), before, 'reading never edits the epic');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head);
});

test('TC-4: a child finishing edits only the child: the epic file is byte-identical, and its derived table follows', async () => {
  const dir = makeRepo({ files: files(LIST), workflow: false });
  cleanup.push(dir);
  const s = await connect(dir);
  sessions.push(s);
  const epicFile = path.join(dir, 'conductor/tracks/AM-100-track-100/index.md');
  const before = fs.readFileSync(epicFile, 'utf8');
  const base = (await s.call('get_track', { track: 102 })).env.data.base;
  const r = await s.call('update_track', { track: 102, base, markers: { Lane: 'done', 'Lane Status': 'success' } });
  assert.equal(r.env.ok, true, JSON.stringify(r.env));
  assert.equal(fs.readFileSync(epicFile, 'utf8'), before, 'the epic holds no child status');
  assert.equal((await s.call('get_track', { track: 100 })).env.data.children.done, 2);
});

test('TC-5: the board data carries the derived epics and the page data the compact form; no epics, no key', () => {
  const entries = LIST.map(([n, m]) => idx(n, m));
  const b = buildBoard(entries, { generatedAt: 'T', project: 'p' });
  assert.deepEqual(b.epics.map((e) => [e.number, e.done, e.total]), [[100, 1, 3]]);
  const page = boardPageData(b);
  assert.deepEqual(page.epics.map((e) => [e.n, e.d, e.c.length]), [[100, 1, 3]]);
  assert.deepEqual(page.epics[0].c[0], { i: 'AM-101', t: 'Track 101', l: 'done', s: 'success', g: 0 });
  const plain = buildBoard([idx(1, {}), idx(2, {})], { generatedAt: 'T' });
  assert.ok(!('epics' in plain) && !('epics' in boardPageData(plain)));
});

test('a very large epic: epicTable lists the first children and says how many more; done and total still count every child', () => {
  const rows = [rowOf('AM-1-e', { content: index(1, {}) }), ...Array.from({ length: 120 }, (_, i) => rowOf(`AM-${i + 2}-c`, { content: index(i + 2, { 'Part Of': '1', ...(i < 5 ? { Lane: 'done', 'Lane Status': 'success' } : {}) }) }))];
  const t = epicTable(rows, 1, undefined, { max: 15 });
  assert.equal(t.children.length, 15);
  assert.equal(t.more, 105);
  assert.equal(t.total, 120);
  assert.equal(t.done, 5);
  assert.match(t.line, /^5 of 120 children done:success; 105 more not listed$/);
  assert.equal(epicTable(rows, 1).children.length, 120, 'no cap by default (the board)');
  assert.equal('more' in epicTable(rows, 1, undefined, { max: 120 }), false);
});

test('a very large epic keeps list_tracks and get_track under the envelope cap, with an N more note', async () => {
  const kids = Array.from({ length: 400 }, (_, i) => [i + 2, { 'Part Of': '1000', Summary: 'child '.repeat(20) }]);
  const dir = makeRepo({ files: files([[1000, {}], ...kids]), workflow: false });
  cleanup.push(dir);
  const s = await connect(dir);
  sessions.push(s);
  const list = await s.call('list_tracks', { limit: 200 });
  assert.equal(list.isError, false, list.text);
  assert.ok(list.text.length < 40_000, `${list.text.length}`);
  const epic = list.env.data.tracks.find((t) => t.number === 1000);
  assert.ok(epic, 'the epic is among the listed tracks');
  assert.equal(epic.children.length, 15);
  assert.equal(epic.children_more, 385);
  assert.match(epic.children_line, /385 more not listed/);
  const got = await s.call('get_track', { track: 1000 });
  assert.equal(got.isError, false, got.text);
  assert.ok(got.text.length < 40_000, `${got.text.length}`);
  assert.equal(got.env.data.children.children.length, 50);
  assert.equal(got.env.data.children.more, 350);
  assert.equal(got.env.data.children.total, 400);
  assert.ok(!('truncated' in got.env.data), 'the data was not dropped');
});

test('get_track and create_track read the rows without asking git which indexes are tracked', async () => {
  const { readEntries } = await import('../src/tools/common.mjs');
  let asked = 0;
  const store = {
    listDir: async () => [{ name: 'AM-1-a', type: 'dir' }],
    readFiles: async (ps) => new Map(ps.map((p) => [p, { content: index(1, {}), sha: 'x' }])),
    trackedFiles: async () => { asked++; return new Set(); },
  };
  assert.equal((await readEntries(store, { tracked: false }))[0].tracked, true);
  assert.equal(asked, 0);
  assert.equal((await readEntries(store))[0].tracked, false, 'the default still asks (list_tracks, the summary)');
  assert.equal(asked, 1);
});
