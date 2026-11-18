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
