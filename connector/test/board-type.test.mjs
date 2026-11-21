// The track type on the board: `**Type**` (dev, marketing, sales, support, other; absent means dev) is published in board.json as `y`
// only when it is not dev, and the page shows a label on the card and in the drawer header and a type filter. Fake DOM, no browser
// (the page was also looked at in a real browser; see the track's notes). The page itself carries no data: it is the same file for every project.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBoard, boardPageData, publishedType } from '../src/board.mjs';
import { makeRepo, writeFile, commitAll, rm } from './helpers/repo.mjs';
import { PAGE, runPage, restorePage, stubGlobal, unstub, all, cls } from './helpers/page-dom.mjs';

const BIN = new URL('../bin/lc-board.mjs', import.meta.url).pathname;
const cleanup = [];
after(() => { rm(...cleanup); restorePage(); unstub(); });

const idx = (n, title, { lane = 'plan', status = 'queue', type } = {}) =>
  `# Track AM-${n}: ${title}\n\n**Lane**: ${lane}\n**Lane Status**: ${status}\n**Progress**: 0%\n**Phase**: New\n${type === undefined ? '' : `**Type**: ${type}\n`}**Summary**: ${title} summary\n`;
const NOW = '2026-11-18T10:00:00.000Z';
const entry = (n, title, o) => ({ folder: `AM-${n}-t${n}`, index: { content: idx(n, title, o) } });
const dataOf = (entries) => boardPageData(buildBoard(entries, { generatedAt: NOW, project: 'Types' }));
const serve = (data) => async () => ({ ok: true, status: 200, json: async () => data });

const MIXED = [
  entry(401, 'Dev one', { lane: 'implement', status: 'running', type: 'dev' }),
  entry(402, 'Dev two, no marker', { lane: 'plan' }),
  entry(403, 'Launch post', { lane: 'plan', type: 'marketing' }),
  entry(404, 'Pitch deck', { lane: 'review', type: 'Sales' }),
  entry(405, 'Answer macros', { lane: 'backlog', type: 'support' }),
  entry(406, 'Parked marketing idea', { lane: 'backlog', type: 'marketing' }),
  entry(407, 'Old note', { lane: 'done', status: 'success', type: 'other' }),
];

const typeChips = (ids) => ids['type-chips'].children;
const chipNames = (ids) => typeChips(ids).map((c) => c.dataset.type);
const pressed = (ids) => typeChips(ids).filter((c) => c.attrs['aria-pressed'] === 'true').map((c) => c.dataset.type);
const idText = (card) => all(card, cls('id'))[0].textContent;
const cardIds = (ids) => all(ids.lanes, cls('card')).map(idText);
const backlogIds = (ids) => all(ids['backlog-cards'], cls('card')).map(idText);
const click = (ids, type) => typeChips(ids).find((c) => c.dataset.type === type).onclick();
const typeInput = (ids, v) => { ids.q.value = v; ids.q.handlers.input({ target: ids.q }); };
const store = (init = {}) => {
  const s = { ...init };
  stubGlobal('localStorage', { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); } });
  return s;
};
const hostile = () => stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });

// ---- data ----------------------------------------------------------------------------------------------------------------

test('publishedType: the four non-dev words in any case, nothing for dev, empty, absent or unknown values', () => {
  assert.equal(publishedType('marketing'), 'marketing');
  assert.equal(publishedType(' Sales '), 'sales');
  assert.equal(publishedType('SUPPORT'), 'support');
  assert.equal(publishedType('other'), 'other');
  for (const v of ['dev', 'DEV', '', 'manager', 'bug', 'marketing, sales', undefined, null]) assert.equal(publishedType(v), null, String(v));
});

test('board.json writes the type only for non-dev tracks, ignores unknown values, and reads the first Type marker', () => {
  const entries = [
    ...MIXED,
    entry(408, 'Manager pseudo', { type: 'manager' }),
    { folder: 'AM-410-t410', index: { content: '# Track AM-410: Dup\n\n**Lane**: plan\n**Lane Status**: queue\n**Type**: dev\n**Type**: marketing\n' } },
    { folder: 'AM-411-t411', index: { content: '# Track AM-411: Dup2\n\n**Lane**: plan\n**Lane Status**: queue\n**Type**: sales\n**Type**: dev\n' } },
  ];
  const board = buildBoard(entries, { generatedAt: NOW });
  const byN = Object.fromEntries(board.tracks.map((t) => [t.number, t]));
  assert.deepEqual(Object.keys(byN).filter((n) => byN[n].type).sort(), ['403', '404', '405', '406', '407', '411']);
  assert.equal(byN[404].type, 'sales', 'the value is read case-insensitively');
  assert.equal(byN[401].type, undefined);
  assert.equal(byN[408].type, undefined, 'an unknown value reads as dev');
  assert.equal(byN[410].type, undefined, 'the first Type marker wins');
  assert.equal(byN[411].type, 'sales', 'the first Type marker wins');
  const page = boardPageData(board);
  const y = page.tracks.filter((t) => t.y).map((t) => `${t.n}:${t.y}`).sort();
  assert.deepEqual(y, ['403:marketing', '404:sales', '405:support', '406:marketing', '407:other', '411:sales']);
  assert.ok(page.tracks.filter((t) => t.n === 401 || t.n === 402).every((t) => !('y' in t)), 'dev tracks carry no key at all');
});

test('a project with only dev tracks writes no type anywhere in board.json', () => {
  const data = dataOf([entry(411, 'A', { type: 'dev' }), entry(412, 'B')]);
  assert.ok(!JSON.stringify(data).includes('"y"'));
});

test('lc-board --site writes the type into board.json and the page file stays the same for every project', () => {
  const real = fs.realpathSync(os.tmpdir());
  const dir = makeRepo();
  cleanup.push(dir);
  writeFile(dir, '.laneconductor.json', JSON.stringify({ project: { name: 'Type Fixture' } }));
  for (const e of MIXED) writeFile(dir, `conductor/tracks/${e.folder}/index.md`, e.index.content);
  commitAll(dir);
  const siteA = fs.mkdtempSync(path.join(real, 'lc-type-a-'));
  const siteB = fs.mkdtempSync(path.join(real, 'lc-type-b-'));
  cleanup.push(siteA, siteB);
  assert.equal(spawnSync('node', [BIN, '--repo', dir, '--now', NOW, '--site', siteA], { encoding: 'utf8' }).status, 0);
  const plain = makeRepo();
  cleanup.push(plain);
  writeFile(plain, 'conductor/tracks/AM-1-x/index.md', idx(1, 'Only dev'));
  commitAll(plain);
  assert.equal(spawnSync('node', [BIN, '--repo', plain, '--now', NOW, '--site', siteB], { encoding: 'utf8' }).status, 0);
  const a = JSON.parse(fs.readFileSync(path.join(siteA, 'board.json'), 'utf8'));
  assert.deepEqual(a.tracks.filter((t) => t.y).map((t) => `${t.n}:${t.y}`).sort(), ['403:marketing', '404:sales', '405:support', '406:marketing', '407:other']);
  assert.ok(!fs.readFileSync(path.join(siteB, 'board.json'), 'utf8').includes('"y"'));
  const noTitle = (t) => t.replace(/<title>[^<]*<\/title>/, '<title>X</title>');
  assert.equal(noTitle(fs.readFileSync(path.join(siteA, 'board.html'), 'utf8')), noTitle(fs.readFileSync(path.join(siteB, 'board.html'), 'utf8')));
  assert.equal(noTitle(fs.readFileSync(path.join(siteA, 'board.html'), 'utf8')), noTitle(fs.readFileSync(PAGE, 'utf8')));
  const html = fs.readFileSync(PAGE, 'utf8');
  for (const e of MIXED) assert.ok(!html.includes(e.index.content.split('\n')[0].replace(/^# Track AM-\d+: /, '')), 'no track data in the page file');
});

// ---- page ----------------------------------------------------------------------------------------------------------------

test('page: an old board.json without the field renders as all dev, with no type filter and no label', async () => {
  store();
  const data = dataOf([entry(421, 'One'), entry(422, 'Two', { lane: 'implement', status: 'running' })]);
  const ids = await runPage(serve(data));
  assert.equal(ids['type-chips'].hidden, true);
  assert.equal(typeChips(ids).length, 0);
  assert.equal(all(ids.lanes, cls('typetag')).length, 0);
  assert.deepEqual(cardIds(ids).sort(), ['AM-421', 'AM-422']);
  assert.equal(ids.nomatch.hidden, true);
  unstub();
});

test('page: an unknown or hostile value in the field reads as dev', async () => {
  store();
  const data = dataOf(MIXED);
  data.tracks.find((t) => t.n === 401).y = '<img src=x onerror=alert(1)>';
  data.tracks.find((t) => t.n === 402).y = 'dev';
  const ids = await runPage(serve(data));
  assert.ok(!ids.lanes.textContent.includes('onerror'));
  assert.equal(typeChips(ids).find((c) => c.dataset.type === 'dev').children[0]._text, '2');
  unstub();
});

test('page: the type chips show only the types in the data, All first, with counts, and aria-pressed', async () => {
  store();
  let ids = await runPage(serve(dataOf(MIXED)));
  assert.equal(ids['type-chips'].hidden, false);
  assert.deepEqual(chipNames(ids), ['all', 'dev', 'marketing', 'sales', 'support', 'other']);
  assert.deepEqual(typeChips(ids).map((c) => c._text + c.children[0]._text), ['All7', 'Dev2', 'Marketing2', 'Sales1', 'Support1', 'Other1']);
  assert.deepEqual(typeChips(ids).map((c) => c.tag), Array(6).fill('button'), 'real buttons: focusable and operable by keyboard');
  assert.deepEqual(pressed(ids), ['all']);
  // Only marketing and dev present: no sales, support or other chip.
  ids = await runPage(serve(dataOf([entry(431, 'Dev'), entry(432, 'Post', { type: 'marketing' })])));
  assert.deepEqual(chipNames(ids), ['all', 'dev', 'marketing']);
  // No dev track at all: no Dev chip.
  ids = await runPage(serve(dataOf([entry(433, 'Post', { type: 'marketing' }), entry(434, 'Deck', { type: 'sales' })])));
  assert.deepEqual(chipNames(ids), ['all', 'marketing', 'sales']);
  unstub();
});

test('page: a non-dev card and the drawer header carry a text label; a dev card carries none', async () => {
  store();
  const ids = await runPage(serve(dataOf(MIXED)));
  const cards = all(ids.lanes, cls('card'));
  const tagOf = (card) => all(card, cls('typetag')).map((x) => x.textContent);
  const byId = (id) => cards.find((c) => idText(c) === id);
  assert.deepEqual(tagOf(byId('AM-403')), ['marketing']);
  assert.deepEqual(tagOf(byId('AM-404')), ['sales']);
  assert.deepEqual(tagOf(byId('AM-401')), []);
  assert.deepEqual(tagOf(byId('AM-402')), []);
  byId('AM-403').handlers.click();
  assert.equal(ids['d-type'].hidden, false);
  assert.equal(ids['d-type'].textContent, 'marketing');
  byId('AM-401').handlers.click();
  assert.equal(ids['d-type'].hidden, true, 'a dev track shows no type in the drawer');
  assert.equal(ids['d-type'].textContent, '');
  unstub();
});

test('page: the filter hides and shows the right cards, combines with search and status, and opens the backlog like a search', async () => {
  store();
  const ids = await runPage(serve(dataOf(MIXED)));
  assert.deepEqual(cardIds(ids).sort(), ['AM-401', 'AM-402', 'AM-403', 'AM-404']);
  assert.equal(ids['backlog-cards'].hidden, true, 'the backlog starts collapsed');
  assert.equal(ids['backlog-n'].textContent, '2');

  click(ids, 'marketing');
  assert.deepEqual(pressed(ids), ['marketing']);
  assert.deepEqual(cardIds(ids), ['AM-403']);
  assert.equal(ids['backlog-cards'].hidden, false, 'a matching type filter opens the backlog');
  assert.deepEqual(backlogIds(ids), ['AM-406']);
  assert.equal(ids['backlog-n'].textContent, '1 of 2');
  assert.equal(ids['done-rows'].children.length, 0);

  // Dev means the tracks with no marker too.
  click(ids, 'dev');
  assert.deepEqual(cardIds(ids).sort(), ['AM-401', 'AM-402']);
  assert.equal(ids['backlog-cards'].hidden, true, 'no backlog track is dev: nothing to open');

  click(ids, 'other');
  assert.deepEqual(cardIds(ids), []);
  assert.equal(ids['done-rows'].children.length, 1, 'the Done list is filtered too');
  assert.equal(ids.nomatch.hidden, true, 'one Done row matches');

  // Combined with search: marketing and a title that only the dev track has.
  click(ids, 'marketing');
  typeInput(ids, 'dev one');
  assert.deepEqual(cardIds(ids), []);
  assert.equal(ids['backlog-cards'].hidden, true);
  assert.equal(ids.nomatch.hidden, false);
  assert.match(ids.nomatch.textContent, /No tracks match search "dev one" and type marketing\./);
  typeInput(ids, 'launch');
  assert.deepEqual(cardIds(ids), ['AM-403']);
  assert.equal(ids.nomatch.hidden, true);

  typeInput(ids, '');
  click(ids, 'all');
  assert.deepEqual(cardIds(ids).sort(), ['AM-401', 'AM-402', 'AM-403', 'AM-404']);
  assert.equal(ids['backlog-cards'].hidden, true, 'back to collapsed');
  unstub();
});

test('page: nothing matches says so, names the filters, and Clear filters brings everything back', async () => {
  const s = store();
  const ids = await runPage(serve(dataOf(MIXED)));
  click(ids, 'support');
  ids.chips.children.find((c) => c._text === 'running').onclick();
  assert.equal(ids.nomatch.hidden, false);
  assert.match(ids.nomatch.textContent, /No tracks match status running and type support\./);
  const clear = all(ids.nomatch, (x) => x.tag === 'button')[0];
  assert.equal(clear.textContent, 'Clear filters');
  assert.match(fs.readFileSync(PAGE, 'utf8'), /id="nomatch" role="status" aria-live="polite" hidden/, 'announced to screen readers');
  clear.onclick();
  assert.equal(ids.nomatch.hidden, true);
  assert.deepEqual(pressed(ids), ['all']);
  assert.equal(cardIds(ids).length, 4);
  assert.equal(s['lc-board-type'], 'all');
  unstub();
});

test('page: the chosen chip is remembered per viewer and restored; a type no longer in the data falls back to All', async () => {
  let s = store();
  let ids = await runPage(serve(dataOf(MIXED)));
  click(ids, 'sales');
  assert.equal(s['lc-board-type'], 'sales');
  unstub();
  s = store({ 'lc-board-type': 'sales' });
  ids = await runPage(serve(dataOf(MIXED)));
  assert.deepEqual(pressed(ids), ['sales']);
  assert.deepEqual(cardIds(ids), ['AM-404']);
  unstub();
  store({ 'lc-board-type': 'marketing' });
  ids = await runPage(serve(dataOf([entry(441, 'Deck', { type: 'sales' }), entry(442, 'Dev')])));
  assert.deepEqual(pressed(ids), ['all'], 'marketing is not in this data');
  assert.equal(cardIds(ids).length, 2);
  unstub();
  store({ 'lc-board-type': 'sales' });
  ids = await runPage(serve(dataOf([entry(443, 'Dev')])));
  assert.equal(ids['type-chips'].hidden, true, 'no non-dev track: no filter, and the stored choice does not hide anything');
  assert.equal(cardIds(ids).length, 1);
  unstub();
  store({ 'lc-board-type': '<b>' });
  ids = await runPage(serve(dataOf(MIXED)));
  assert.deepEqual(pressed(ids), ['all']);
  unstub();
});

test('page: with localStorage throwing, the board renders and the filter still works for the session', async () => {
  hostile();
  const ids = await runPage(serve(dataOf(MIXED)));
  assert.deepEqual(pressed(ids), ['all']);
  assert.equal(cardIds(ids).length, 4);
  click(ids, 'sales');
  assert.deepEqual(cardIds(ids), ['AM-404']);
  assert.deepEqual(pressed(ids), ['sales']);
  unstub();
});

test('page: the filter is a labelled group of buttons with a visible focus state, and the new styles add no colour literals', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  assert.match(html, /id="type-chips"[^>]*role="group"[^>]*aria-label="Filter by track type"/);
  assert.match(html, /button:focus-visible[^{]*\{ outline: 2px solid var\(--accent\)/, 'the shared focus rule covers the chips');
  assert.match(html, /\.chips \{ display: flex; flex-wrap: wrap/);
  const css = html.match(/^\.(typetag|nomatch|idg)[^{]*\{[^}]*\}/gm).join('\n');
  assert.ok(css.length > 100);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css), 'the new rules use the existing tokens only');
});
