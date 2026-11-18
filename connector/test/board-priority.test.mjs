// Priority on the board: `**Priority**: high|normal|low` (absent means normal) is published in board.json as `pr` only for high and low,
// each lane and the backlog list high first (stable inside a priority), and a text label shows next to the type label.
// Fake DOM, no browser. Done and Needs attention keep their order (newest first): see the last test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBoard, boardPageData } from '../src/board.mjs';
import { PAGE, runPage, restorePage, stubGlobal, unstub, all, cls } from './helpers/page-dom.mjs';

after(() => { restorePage(); unstub(); });

const idx = (n, title, { lane = 'plan', status = 'queue', type, priority, raw } = {}) =>
  `# Track AM-${n}: ${title}\n\n**Lane**: ${lane}\n**Lane Status**: ${status}\n**Progress**: 0%\n**Phase**: New\n${type === undefined ? '' : `**Type**: ${type}\n`}${raw ?? (priority === undefined ? '' : `**Priority**: ${priority}\n`)}**Summary**: ${title} summary\n`;
const NOW = '2026-11-18T10:00:00.000Z';
const entry = (n, title, o) => ({ folder: `AM-${n}-t${n}`, index: { content: idx(n, title, o) } });
const dataOf = (entries) => boardPageData(buildBoard(entries, { generatedAt: NOW, project: 'Prio' }));
const serve = (data) => async () => ({ ok: true, status: 200, json: async () => data });
const store = () => stubGlobal('localStorage', { getItem: () => null, setItem() {} });
const idText = (card) => all(card, cls('id'))[0].textContent;
const laneIds = (ids, i) => all(ids.lanes.children[i], cls('card')).map(idText);

const LANE = [
  entry(501, 'a', { priority: 'low' }),
  entry(502, 'b'),
  entry(503, 'c', { priority: 'high' }),
  entry(504, 'd', { priority: 'normal' }),
  entry(505, 'e', { priority: 'high', type: 'marketing' }),
  entry(506, 'f', { priority: 'low' }),
  entry(510, 'in the build lane, low', { lane: 'implement', status: 'running', priority: 'low' }),
  entry(511, 'in the build lane, plain', { lane: 'implement', status: 'running' }),
  entry(520, 'parked low', { lane: 'backlog', priority: 'low' }),
  entry(521, 'parked plain', { lane: 'backlog' }),
  entry(522, 'parked high', { lane: 'backlog', priority: 'high' }),
  entry(530, 'shipped low', { lane: 'done', status: 'success', priority: 'low' }),
  entry(531, 'shipped high', { lane: 'done', status: 'success', priority: 'high' }),
];

test('board.json writes the priority only for high and low, ignores other values, and the first marker wins', () => {
  const extra = [
    entry(601, 'odd', { priority: 'urgent' }),
    entry(602, 'empty', { priority: '' }),
    entry(603, 'cased', { priority: ' HIGH ' }),
    { folder: 'AM-604-t604', index: { content: idx(604, 'twice', { raw: '**Priority**: low\n**Priority**: high\n' }) } },
    { folder: 'AM-605-t605', index: { content: idx(605, 'multi', { raw: '**Priority**: high\nand a second line\n' }) } },
  ];
  const board = buildBoard([...LANE, ...extra], { generatedAt: NOW });
  const by = Object.fromEntries(board.tracks.map((t) => [t.number, t.priority]));
  assert.deepEqual(Object.entries(by).filter(([, v]) => v).map(([n, v]) => `${n}:${v}`).sort(),
    ['501:low', '503:high', '505:high', '506:low', '510:low', '520:low', '522:high', '530:low', '531:high', '603:high', '604:low']);
  const page = boardPageData(board);
  assert.equal(page.tracks.find((t) => t.n === 503).pr, 'high');
  assert.equal(page.tracks.find((t) => t.n === 501).pr, 'low');
  for (const n of [502, 504, 601, 602, 605]) assert.ok(!('pr' in page.tracks.find((t) => t.n === n)), `${n} carries no key`);
});

test('a project with no priorities writes no pr key anywhere', () => {
  assert.ok(!JSON.stringify(dataOf([entry(701, 'x'), entry(702, 'y', { priority: 'normal' })])).includes('"pr"'));
});

test('page: old data without the field renders as before (newest first)', async () => {
  store();
  const data = dataOf([entry(801, 'a'), entry(803, 'c'), entry(802, 'b')]);
  const ids = await runPage(serve(data));
  assert.deepEqual(laneIds(ids, 0), ['AM-803', 'AM-802', 'AM-801']);
  assert.equal(all(ids.lanes, cls('pritag')).length, 0);
  unstub();
});

test('page: a lane lists high, then normal, then low, newest first inside a priority; no card changes lane', async () => {
  store();
  const ids = await runPage(serve(dataOf(LANE)));
  assert.deepEqual(laneIds(ids, 0), ['AM-505', 'AM-503', 'AM-504', 'AM-502', 'AM-506', 'AM-501']);
  assert.deepEqual(laneIds(ids, 1), ['AM-511', 'AM-510']);
  unstub();
});

test('page: the backlog is ordered by priority too, and Done keeps newest first', async () => {
  store();
  const ids = await runPage(serve(dataOf(LANE)));
  ids['backlog-toggle'].onclick();
  assert.deepEqual(all(ids['backlog-cards'], cls('card')).map(idText), ['AM-522', 'AM-521', 'AM-520']);
  assert.deepEqual(ids['done-rows'].children.map((tr) => tr.children[0].textContent), ['AM-531', 'AM-530'], 'Done is newest first');
  unstub();
});

test('page: a text label shows only for high and low, next to the type label, and in the drawer header', async () => {
  store();
  const ids = await runPage(serve(dataOf(LANE)));
  const cards = all(ids.lanes, cls('card'));
  const card = (id) => cards.find((c) => idText(c) === id);
  const tags = (c) => all(c, (x) => cls('pritag')(x) || cls('typetag')(x)).map((x) => x.textContent);
  assert.deepEqual(tags(card('AM-505')), ['marketing', 'high'], 'type label first, priority next to it');
  assert.deepEqual(tags(card('AM-503')), ['high']);
  assert.deepEqual(tags(card('AM-501')), ['low']);
  assert.deepEqual(tags(card('AM-502')), []);
  assert.deepEqual(tags(card('AM-504')), [], 'normal shows nothing');
  card('AM-503').handlers.click();
  assert.equal(ids['d-pri'].hidden, false);
  assert.equal(ids['d-pri'].textContent, 'high');
  assert.ok(String(ids['d-pri'].className).includes('high'));
  card('AM-502').handlers.click();
  assert.equal(ids['d-pri'].hidden, true);
  assert.equal(ids['d-pri'].textContent, '');
  unstub();
});

test('page: an unknown value in the field reads as normal and cannot inject markup', async () => {
  store();
  const data = dataOf(LANE);
  data.tracks.find((t) => t.n === 502).pr = '<img src=x onerror=1>';
  const ids = await runPage(serve(data));
  assert.ok(!ids.lanes.textContent.includes('onerror'));
  const order = laneIds(ids, 0);
  assert.deepEqual(order, ['AM-505', 'AM-503', 'AM-504', 'AM-502', 'AM-506', 'AM-501'], '502 sorts as a normal track');
  assert.equal(all(ids.lanes, cls('pritag')).length, 5, 'high 503 505, low 501 506 510');
  unstub();
});

test('page: the type filter and the priority order work together', async () => {
  store();
  const ids = await runPage(serve(dataOf(LANE)));
  const chip = (k) => ids['type-chips'].children.find((c) => c.dataset.type === k);
  chip('dev').onclick();
  assert.deepEqual(laneIds(ids, 0), ['AM-503', 'AM-504', 'AM-502', 'AM-506', 'AM-501']);
  chip('marketing').onclick();
  assert.deepEqual(laneIds(ids, 0), ['AM-505']);
  chip('all').onclick();
  assert.deepEqual(laneIds(ids, 0), ['AM-505', 'AM-503', 'AM-504', 'AM-502', 'AM-506', 'AM-501']);
  unstub();
});

test('page: the "Type" caption is visible text before the type chips, shown with them, and the new styles use tokens only', async () => {
  store();
  const html = fs.readFileSync(PAGE, 'utf8');
  assert.match(html, /id="type-ctl" hidden><span class="cap" id="type-cap">Type<\/span><div class="chips" id="type-chips"/);
  const css = html.match(/^\.(pritag|typectl)[^{]*\{[^}]*\}/gm).join('\n');
  assert.ok(css.length > 150);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css));
  assert.match(css, /\.typectl \.cap \{[^}]*white-space: nowrap/, 'the caption stays on one line');
  let ids = await runPage(serve(dataOf(LANE)));
  assert.equal(ids['type-ctl'].hidden, false);
  ids = await runPage(serve(dataOf([entry(901, 'dev only')])));
  assert.equal(ids['type-ctl'].hidden, true, 'no caption without the filter');
  unstub();
});

test('Needs attention keeps its order (newest first) and is not sorted by priority', () => {
  const board = buildBoard([
    { folder: 'AM-1001-x', index: { content: idx(1001, 'low stuck', { lane: 'nowhere', priority: 'low' }) } },
    { folder: 'AM-1002-x', index: { content: idx(1002, 'high stuck', { lane: 'nowhere', priority: 'high' }) } },
    { folder: 'AM-1003-x', index: { content: idx(1003, 'plain stuck', { lane: 'nowhere' }) } },
  ], { generatedAt: NOW });
  assert.deepEqual(board.needs_attention.map((a) => a.number), [1003, 1002, 1001]);
});
