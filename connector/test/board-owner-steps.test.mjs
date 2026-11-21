// Track AM-10147 (owner steps), Phase 4: the board. TC-12 to TC-14 of test.md. The owner-step markers (`Owner Action`, `Owner Action Due`, `Result`, and the
// existing `KPI Check After`) are published in board.json under short keys (oa, od, rs, kc) only for tracks that have them; the page shows the action and its
// due date as text, works out overdue and "ready to measure" when it OPENS (UTC date, said in the page), lists them in Needs attention with the reason in words,
// and escapes the free text everywhere. Fake DOM, no browser (the page was also looked at in a real browser; see the track's notes), with Date stubbed so
// "today" is fixed. The page carries no data.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBoard, boardPageData } from '../src/board.mjs';
import { actionOf } from '../src/board-actions.mjs';
import { ownerFlags, dueText, parseDay } from '../src/owner-steps.mjs';
import { classifyFacts, gatherFacts, nextCard } from '../src/next.mjs';
import { rowOf } from '../src/summary.mjs';
import { buildFixture } from './helpers/next-fixtures.mjs';
import { makeRepo, writeFile, commitAll, rm } from './helpers/repo.mjs';
import { PAGE, runPage, restorePage, stubGlobal, unstub, all, cls } from './helpers/page-dom.mjs';

const BIN = new URL('../bin/lc-board.mjs', import.meta.url).pathname;
const cleanup = [];
after(() => { rm(...cleanup); restorePage(); unstub(); });

const GEN = '2026-11-18T10:00:00.000Z';
/** Fixes "today" for the page: `new Date()` and `Date.now()` answer `iso`; everything else about Date is real. */
const today = (iso) => {
  const RealDate = Date;
  const at = RealDate.parse(iso);
  class FixedDate extends RealDate { constructor(...a) { if (a.length === 0) super(at); else super(...a); } static now() { return at; } }
  stubGlobal('Date', FixedDate);
};
const noStore = () => stubGlobal('localStorage', { getItem: () => null, setItem() {} });

const index = (n, title, { lane = 'implement', status = 'waiting', markers = {}, type } = {}) =>
  `# Track AM-${n}: ${title}\n\n**Lane**: ${lane}\n**Lane Status**: ${status}\n**Progress**: 0%\n**Phase**: New\n${type ? `**Type**: ${type}\n` : ''}${status === 'waiting' && !('Owner Action' in markers) ? '**Waiting Reason**: the run window\n' : ''}${Object.entries(markers).map(([k, v]) => `**${k}**: ${v}\n`).join('')}**Summary**: ${title} summary\n`;
const entry = (n, title, o) => ({ folder: `AM-${n}-t${n}`, index: { content: index(n, title, o) } });
const dataOf = (entries, o = {}) => boardPageData(buildBoard(entries, { generatedAt: GEN, project: 'Owner' }), o);
const serve = (data) => async () => ({ ok: true, status: 200, json: async () => data });
const trackOf = (data, n) => data.tracks.find((t) => t.n === n);
const cardOf = (ids, id) => all(ids.lanes, cls('card')).find((c) => all(c, cls('id'))[0].textContent === id);
const ownText = (card) => all(card, cls('own')).map((x) => x.textContent).join(' | ');
const badges = (node) => all(node, cls('ownb')).map((x) => x.textContent);
const attnRows = (ids) => ids['attn-rows'].children.map((tr) => ({ id: tr.children[0].textContent, why: tr.children[3].children.map((d) => d.textContent) }));
const stat = (ids, label) => ids.summary.children.find((s) => s.children[1].textContent === label).children[0].textContent;
const act = (extra) => ({ 'Owner Action': 'Post the launch video', ...extra });

// ---- data ----------------------------------------------------------------------------------------------------------------

test('TC-12 data: board.json carries oa, od, rs, kc only for the tracks that have them, and an old project has none of the keys', () => {
  const data = dataOf([
    entry(1, 'Plain', { lane: 'plan', status: 'queue' }),
    entry(2, 'Waiting for the owner', { markers: act({ 'Owner Action Due': '2026-11-20' }) }),
    entry(3, 'No due date', { markers: act() }),
    entry(4, 'Window open', { markers: { 'KPI Check After': '2026-11-25' } }),
    entry(5, 'Done with a result', { lane: 'done', status: 'success', markers: { Result: '412 visits, 9 signups', 'KPI Check After': '2026-11-01' } }),
    entry(6, 'Due without an action', { markers: { 'Owner Action Due': '2026-11-20' } }),
  ]);
  assert.deepEqual(Object.keys(trackOf(data, 1)).filter((k) => ['oa', 'od', 'rs', 'kc'].includes(k)), []);
  assert.equal(trackOf(data, 2).oa, 'Post the launch video');
  assert.equal(trackOf(data, 2).od, '2026-11-20');
  assert.equal(trackOf(data, 3).oa, 'Post the launch video');
  assert.ok(!('od' in trackOf(data, 3)), 'no due date: no key');
  assert.deepEqual([trackOf(data, 4).kc, 'oa' in trackOf(data, 4)], ['2026-11-25', false]);
  assert.equal(trackOf(data, 5).rs, '412 visits, 9 signups');
  assert.ok(!('kc' in trackOf(data, 5)), 'the check date matters only while the track waits');
  assert.ok(!('od' in trackOf(data, 6)) && !('oa' in trackOf(data, 6)), 'a due date alone is not published (the lint reports it)');
  const none = JSON.stringify(dataOf([entry(7, 'A', { lane: 'plan', status: 'queue' }), entry(8, 'B', { lane: 'done', status: 'success' })]));
  for (const k of ['"oa"', '"od"', '"rs"', '"kc"']) assert.ok(!none.includes(k), k);
});

test('TC-12 data: the due date is published as written (a stray space stays, so the page can say why it is not a date); the texts are one line and short', () => {
  const data = dataOf([entry(1, 'A', { markers: act({ 'Owner Action Due': '2026-11-20 ' }) }), entry(2, 'B', { markers: { 'Owner Action': `${'x'.repeat(400)}\n\nmore`, 'Owner Action Due': '2026-11-20\nsecond line' } })]);
  assert.equal(trackOf(data, 1).od, '2026-11-20 ', 'edges kept');
  assert.ok(trackOf(data, 2).oa.length <= 201 && !trackOf(data, 2).oa.includes('\n'));
  assert.equal(trackOf(data, 2).od, '2026-11-20');
});

test('TC-13 data: a malformed date is listed in needs attention with the reason in words, whatever the lane status (also stale-running)', () => {
  const data = dataOf([
    entry(1, 'Bad due', { markers: act({ 'Owner Action Due': '2026-02-30' }) }),
    entry(2, 'Stale and bad', { status: 'running', markers: { 'Run Started': '2026-11-10T00:00:00Z', 'Run By': 'x', 'KPI Check After': '18/11/2026' } }),
  ]);
  const rows = Object.fromEntries(data.attn.map((a) => [a.n, a.r]));
  assert.ok(rows[1].some((r) => /^date_malformed: Owner Action Due "2026-02-30" is not a real date \(YYYY-MM-DD\)/.test(r)), rows[1].join('; '));
  assert.ok(rows[2].some((r) => /^date_malformed: KPI Check After "18\/11\/2026" is not a real date/.test(r)));
  assert.ok(rows[2].some((r) => /running for \d+h with no sign of life/.test(r)), 'the other reason is kept beside it');
});

test('TC-13 data: outcome_missing needs spec.md; lc-board reads it only for a done:success marketing or sales track with no outcome', () => {
  const dir = makeRepo();
  cleanup.push(dir);
  writeFile(dir, '.laneconductor.json', JSON.stringify({ project: { name: 'Outcome' } }));
  const done = (n, type, extra = '') => writeFile(dir, `conductor/tracks/AM-${n}-t${n}/index.md`, index(n, `T${n}`, { lane: 'done', status: 'success', type, markers: {} }).replace('**Summary**', `${extra}**Summary**`));
  done(1, 'marketing');                                     // KPI block, no outcome: flagged
  writeFile(dir, 'conductor/tracks/AM-1-t1/spec.md', '# Spec\n\n## KPI\n\n- visits\n');
  done(2, 'marketing');                                     // no KPI block: exempt (an older track)
  writeFile(dir, 'conductor/tracks/AM-2-t2/spec.md', '# Spec\n\nno kpi here\n');
  done(3, 'sales', '**KPI Actual**: 12\n');                 // has an outcome
  writeFile(dir, 'conductor/tracks/AM-3-t3/spec.md', '# Spec\n\n## KPI\n');
  done(4, 'dev');                                           // not marketing or sales
  writeFile(dir, 'conductor/tracks/AM-4-t4/spec.md', '# Spec\n\n## KPI\n');
  done(5, 'sales');                                         // no spec.md at all: no verdict
  commitAll(dir);
  const r = spawnSync('node', [BIN, '--repo', dir, '--now', GEN], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const board = JSON.parse(r.stdout);
  const flagged = board.needs_attention.filter((a) => a.reasons.some((x) => x.startsWith('outcome_missing'))).map((a) => a.number);
  assert.deepEqual(flagged, [1]);
});

test('TC-12 data: a waiting track with an owner action gets an owner-action card step, not the reply one (the board card and the next command agree)', () => {
  const row = (extra) => rowOf('AM-9-t', { content: index(9, 'T', { markers: extra }) });
  const lanes = ['backlog', 'plan', 'implement', 'review', 'quality-gate', 'done'];
  const a = actionOf({ row: row(act({ 'Waiting for reply': 'yes' })), lanes });
  assert.equal(a.c, '/laneconductor:comment 9 <what you did>');
  assert.doesNotMatch(a.w, /reply|answer/i);
  const b = actionOf({ row: row({ 'Waiting for reply': 'yes' }), lanes });
  assert.equal(b.c, '/laneconductor:comment 9 <your reply>', 'without an owner action nothing changed');
  // A waiting track whose run window ended is a measurement (S23), as in `next`; a reply that is waiting still comes first.
  const win = (extra) => row({ 'KPI Check After': '2026-11-10', ...extra });
  const NOW = Date.parse('2026-11-18T10:00:00Z');
  assert.equal(actionOf({ row: win({}), lanes, nowMs: NOW }).c, '/laneconductor:quality-gate 9');
  assert.equal(actionOf({ row: win({ 'Waiting for reply': 'yes' }), lanes, nowMs: NOW }).c, '/laneconductor:comment 9 <your reply>');
  assert.equal(actionOf({ row: row({ 'KPI Check After': '2026-11-19' }), lanes, nowMs: NOW }).c, '/laneconductor:comment 9 <your reply>', 'the window has not ended');
  assert.equal(actionOf({ row: win({}), lanes }).c, '/laneconductor:comment 9 <your reply>', 'no clock: unchanged');
});

// ---- page: card, drawer, overdue at render --------------------------------------------------------------------------------

test('TC-12 page: an old board.json (no owner keys) renders as before: no owner block, no UTC line', async () => {
  noStore();
  const data = dataOf([entry(1, 'Plain', { lane: 'plan', status: 'queue' }), entry(2, 'Waiting', { markers: { 'Waiting for reply': 'yes' } })]);
  const ids = await runPage(serve(data));
  assert.equal(all(ids.lanes, cls('own')).length, 0);
  assert.equal(ids['utc-note'].hidden, true);
  assert.equal(attnRows(ids).length, 1);
  unstub();
});

test('TC-12 page: overdue is worked out at render from the UTC date: due tomorrow, due today (not overdue), then overdue the next UTC day', async () => {
  const data = dataOf([entry(10, 'Video', { markers: act({ 'Owner Action Due': '2026-11-18' }) })]);
  const ready = async (iso) => { noStore(); today(iso); const ids = await runPage(serve(structuredClone(data))); return ids; };

  let ids = await ready('2026-11-17T23:59:59Z');
  assert.deepEqual(badges(cardOf(ids, 'AM-10')), ['due 2026-11-18 UTC']);
  assert.equal(attnRows(ids).length, 0);
  assert.equal(stat(ids, 'need attention'), '0');
  unstub();

  ids = await ready('2026-11-18T23:59:59Z');
  assert.deepEqual(badges(cardOf(ids, 'AM-10')), ['due today (2026-11-18 UTC)'], 'due today is not overdue');
  assert.equal(attnRows(ids).length, 0);
  assert.equal(all(cardOf(ids, 'AM-10'), cls('over')).length, 0);
  unstub();

  ids = await ready('2026-11-19T00:00:00Z');
  const card = cardOf(ids, 'AM-10');
  assert.deepEqual(badges(card), ['overdue 1 day (due 2026-11-18 UTC)'], 'in words, not only a colour');
  assert.equal(all(card, cls('over')).length, 1, 'and in colour');
  assert.ok(card.className.split(' ').includes('flag'));
  assert.ok(ownText(card).includes('Post the launch video') && ownText(card).includes('overdue 1 day'), ownText(card));
  assert.deepEqual(attnRows(ids), [{ id: 'AM-10', why: ['Owner action overdue since 2026-11-18 (UTC): Post the launch video'] }]);
  assert.equal(stat(ids, 'need attention'), '1');
  assert.equal(ids['utc-note'].hidden, false);
  unstub();

  ids = await ready('2026-12-18T05:00:00Z');
  assert.deepEqual(badges(cardOf(ids, 'AM-10')), ['overdue 30 days (due 2026-11-18 UTC)'], 'a snapshot read last month does not call it "due"');
  unstub();
});

test('TC-12 page: no due date, a malformed one and a future one all show, with the reason; none is overdue', async () => {
  noStore();
  today('2026-11-18T12:00:00Z');
  const data = dataOf([
    entry(1, 'No date', { markers: act() }),
    entry(2, 'Impossible date', { markers: act({ 'Owner Action Due': '2026-02-30' }) }),
    entry(3, 'Other format', { markers: act({ 'Owner Action Due': '18/11/2026' }) }),
    entry(4, 'Future', { markers: act({ 'Owner Action Due': '2026-12-01' }) }),
    entry(5, 'Empty', { markers: act({ 'Owner Action Due': '' }) }),
  ]);
  const ids = await runPage(serve(data));
  assert.deepEqual(badges(cardOf(ids, 'AM-1')), ['no due date']);
  assert.deepEqual(badges(cardOf(ids, 'AM-2')), ['due date "2026-02-30" is not a real YYYY-MM-DD date']);
  assert.deepEqual(badges(cardOf(ids, 'AM-3')), ['due date "18/11/2026" is not a real YYYY-MM-DD date']);
  assert.deepEqual(badges(cardOf(ids, 'AM-4')), ['due 2026-12-01 UTC']);
  assert.deepEqual(badges(cardOf(ids, 'AM-5')), ['due date "" is not a real YYYY-MM-DD date']);
  for (const id of ['AM-1', 'AM-2', 'AM-3', 'AM-4', 'AM-5']) assert.equal(all(cardOf(ids, id), cls('over')).length, 0, id);
  // The lint reasons for the malformed ones come with the board, in words.
  const rows = Object.fromEntries(attnRows(ids).map((r) => [r.id, r.why]));
  assert.match(rows['AM-2'][0], /^date_malformed: Owner Action Due "2026-02-30" is not a real date/);
  assert.ok(!rows['AM-1'] && !rows['AM-4']);
  unstub();
});

test('TC-12 page: the page agrees with the shared rule (ownerFlags and dueText of owner-steps.mjs) on a table of dates and clocks', async () => {
  const dues = ['2026-11-17', '2026-11-18', '2026-11-19', '2026-02-30', '2026-13-01', '0000-01-01', '2026-1-5', ' 2026-11-18', '2026-11-18 ', '2024-02-29', '2025-02-29', 'tomorrow', ''];
  for (const now of ['2026-11-17T23:59:59Z', '2026-11-18T00:00:00Z', '2026-11-18T23:59:59Z', '2026-11-19T00:00:00Z']) {
    for (const due of dues) {
      noStore();
      today(now);
      const data = dataOf([entry(1, 'T', { markers: act({ 'Owner Action Due': due }) })]);
      const ids = await runPage(serve(data));
      const row = rowOf('AM-1-t1', { content: index(1, 'T', { markers: act({ 'Owner Action Due': due }) }) });
      const should = Boolean(ownerFlags({ ...row, owner_action_due: data.tracks[0].od }, Date.parse(now)).overdue);
      const card = cardOf(ids, 'AM-1');
      assert.equal(all(card, cls('over')).length > 0, should, `${JSON.stringify(due)} at ${now}`);
      assert.equal(attnRows(ids).some((r) => r.why.some((w) => w.startsWith('Owner action overdue'))), should, `${JSON.stringify(due)} at ${now} (needs attention)`);
      if (parseDay(data.tracks[0].od) && !should) assert.match(badges(card)[0], /^due /);
      if (should) assert.match(badges(card)[0], /^overdue /);
      unstub();
    }
  }
  assert.equal(dueText({ owner_action_due: '2026-11-17' }, '2026-11-18'), 'overdue since 2026-11-17');
});

test('TC-12 page: only a waiting track is overdue (a running one is not), and the drawer header shows the action, its due date and the result', async () => {
  noStore();
  today('2026-12-01T00:00:00Z');
  const data = dataOf([
    entry(1, 'Waiting', { markers: act({ 'Owner Action Due': '2026-11-20', Result: '3 signups' }) }),
    entry(2, 'Running', { status: 'running', markers: act({ 'Owner Action Due': '2026-11-20' }) }),
  ]);
  const ids = await runPage(serve(data));
  assert.equal(all(cardOf(ids, 'AM-1'), cls('over')).length, 1);
  assert.equal(all(cardOf(ids, 'AM-2'), cls('over')).length, 0);
  assert.deepEqual(badges(cardOf(ids, 'AM-2')), ['due 2026-11-20 UTC']);
  cardOf(ids, 'AM-1').handlers.click();
  assert.equal(ids['d-own'].hidden, false);
  assert.match(ids['d-own'].textContent, /Owner action/);
  assert.match(ids['d-own'].textContent, /Post the launch video/);
  assert.match(ids['d-own'].textContent, /overdue 11 days \(due 2026-11-20 UTC\)/);
  assert.match(ids['d-own'].textContent, /Result: 3 signups/);
  cardOf(ids, 'AM-2').handlers.click();
  assert.doesNotMatch(ids['d-own'].textContent, /Result:/);
  unstub();
});

test('TC-12 page: a window ready to measure (KPI Check After today or earlier on a waiting track) shows on the card and in needs attention', async () => {
  const data = dataOf([
    entry(1, 'Ended', { markers: { 'KPI Check After': '2026-11-18' } }),
    entry(2, 'Not yet', { markers: { 'KPI Check After': '2026-11-19' } }),
    entry(3, 'Timestamp passed', { markers: { 'KPI Check After': '2026-11-18T09:00:00.000Z' } }),
    entry(4, 'Timestamp later today', { markers: { 'KPI Check After': '2026-11-18T18:00:00Z' } }),
    entry(5, 'Not waiting', { status: 'queue', markers: { 'KPI Check After': '2026-11-01' } }),
    entry(6, 'Garbled', { markers: { 'KPI Check After': 'soon' } }),
  ]);
  noStore();
  today('2026-11-18T12:00:00Z');
  const ids = await runPage(serve(data));
  const ready = ['AM-1', 'AM-2', 'AM-3', 'AM-4', 'AM-5', 'AM-6'].filter((id) => all(cardOf(ids, id), cls('ready')).length);
  assert.deepEqual(ready, ['AM-1', 'AM-3']);
  assert.match(badges(cardOf(ids, 'AM-1'))[0], /^Ready to measure: the run window ended \(KPI Check After 2026-11-18\)$/);
  const rows = Object.fromEntries(attnRows(ids).map((r) => [r.id, r.why]));
  assert.ok(rows['AM-1'].includes('Ready to measure: the run window ended (KPI Check After 2026-11-18)'));
  assert.ok(rows['AM-3'] && !rows['AM-2'] && !rows['AM-4'] && !rows['AM-5']);
  assert.match(rows['AM-6'][0], /^date_malformed: KPI Check After "soon"/, 'a garbled check date is a lint, not a measurement');
  assert.equal(ids['utc-note'].hidden, false);
  unstub();
  // An hour later the timestamp of track 4 has passed too.
  noStore();
  today('2026-11-18T18:00:00Z');
  const later = await runPage(serve(structuredClone(data)));
  assert.ok(all(cardOf(later, 'AM-4'), cls('ready')).length);
  unstub();
});

test('TC-13 page: an overdue action is listed beside the track\'s other reasons; a stale-running track with a bad date lists both; the cause chips name them', async () => {
  noStore();
  today('2026-11-18T12:00:00Z');
  const data = dataOf([
    entry(1, 'Reply and overdue', { markers: act({ 'Owner Action Due': '2026-11-10', 'Waiting for reply': 'yes' }) }),
    entry(2, 'Stale and bad date', { status: 'running', markers: act({ 'Run Started': '2026-11-10T00:00:00Z', 'Owner Action Due': '2026-02-30' }) }),
    entry(3, 'Ready', { markers: { 'KPI Check After': '2026-11-01' } }),
  ]);
  const ids = await runPage(serve(data));
  const rows = Object.fromEntries(attnRows(ids).map((r) => [r.id, r.why]));
  assert.deepEqual(rows['AM-1'], ['waiting for a human reply', 'Owner action overdue since 2026-11-10 (UTC): Post the launch video']);
  assert.equal(rows['AM-2'].length, 2);
  assert.ok(rows['AM-2'].some((w) => /^date_malformed: Owner Action Due "2026-02-30"/.test(w)));
  assert.ok(rows['AM-2'].some((w) => /running for \d+h with no sign of life/.test(w)));
  assert.deepEqual(rows['AM-3'], ['Ready to measure: the run window ended (KPI Check After 2026-11-01)']);
  assert.equal(stat(ids, 'need attention'), '3');
  const chips = ids['attn-chips'].children.map((c) => c._text);
  for (const c of ['Owner action overdue', 'Ready to measure', 'Date not valid']) assert.ok(chips.includes(c), `${c} in ${chips}`);
  // Newest first, like the rest of the table.
  assert.deepEqual(attnRows(ids).map((r) => r.id), ['AM-3', 'AM-2', 'AM-1']);
  unstub();
});

// ---- page: escaping --------------------------------------------------------------------------------------------------------

test('TC-14 page: the free text of Owner Action and Result is escaped everywhere: a script tag in it is text, never an element', async () => {
  const evil = '<script>window.__x=1</script><img src=x onerror=alert(1)>';
  noStore();
  today('2026-12-01T00:00:00Z');
  const data = dataOf([entry(1, 'Evil', { markers: act({ 'Owner Action': evil, 'Owner Action Due': '2026-11-20', Result: evil, 'KPI Check After': '2026-11-01' }) })]);
  assert.ok(trackOf(data, 1).oa.includes('<script>'), 'the data carries it as text');
  const ids = await runPage(serve(data));
  const card = cardOf(ids, 'AM-1');
  assert.ok(ownText(card).includes(evil), 'shown as text on the card');
  card.handlers.click();
  assert.ok(ids['d-own'].textContent.includes(evil), 'shown as text in the drawer');
  assert.ok(attnRows(ids)[0].why.join(' ').includes('<script>'), 'and in needs attention');
  const doc = ids.__doc;
  assert.ok(!doc.created.includes('script') && !doc.created.includes('img'), `no element was made from the text (${[...new Set(doc.created)]})`);
  const src = fs.readFileSync(PAGE, 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'the page never builds markup from strings');
  assert.ok(!src.includes('window.__x'), 'the page file carries no data');
  unstub();
});

// ---- page: What's next -----------------------------------------------------------------------------------------------------

const NOW_MS = Date.parse('2026-11-18T12:00:00Z');
async function nextFixture(owners) {
  const tracks = owners.map(([n, due, extra = {}]) => ({ n, lane: 'implement', status: 'waiting', extra: { 'Waiting for reply': 'yes', 'Owner Action': `Post the video for ${n}`, ...(due === undefined ? {} : { 'Owner Action Due': due }), ...extra } }));
  const dir = buildFixture({ tracks });
  cleanup.push(dir);
  const facts = await gatherFacts(dir, { now: NOW_MS });
  const card = nextCard(classifyFacts(facts), facts);
  const entries = fs.readdirSync(path.join(dir, 'conductor/tracks'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).map((folder) => ({ folder, index: { content: fs.readFileSync(path.join(dir, 'conductor/tracks', folder, 'index.md'), 'utf8') } }));
  return { card, data: dataOf(entries, { next: card }) };
}
const openNext = (ids) => { ids['next-btn'].handlers.click(); return ids['d-body']; };

test('TC-12 page: What\'s next shows the owner-action card with the due date worked out now, and never says it adds an answer', async () => {
  const { card, data } = await nextFixture([[10001, '2026-11-25']]);
  assert.equal(card.s, 'S22');
  noStore();
  // The board was read on 2026-11-18; the page is opened on 2026-12-01, when that date has long passed.
  today('2026-12-01T00:00:00Z');
  const ids = await runPage(serve(data));
  const body = openNext(ids);
  const text = body.textContent;
  assert.match(ids['d-title'].textContent, /Do the owner action on track AM-10001/);
  assert.match(text, /Post the video for 10001/);
  assert.match(text, /Due \(UTC, worked out when you opened this page\)/);
  assert.match(text, /overdue 6 days \(due 2026-11-25 UTC\)/);
  assert.match(text, /\/laneconductor:comment 10001 <what you did>/);
  assert.match(text, /Draft section of the track's spec\.md/);
  assert.doesNotMatch(text, /adds your answer|answer a reply|due 2026-11-25\. The track waits/i);
  assert.match(text, /The track waits for you and nothing else moves it\./);
  unstub();
  // Opened on the day it is due: not overdue.
  noStore();
  today('2026-11-25T08:00:00Z');
  const same = openNext(await runPage(serve(structuredClone(data)))).textContent;
  assert.match(same, /due today \(2026-11-25 UTC\)/);
  unstub();
});

test('TC-12 page: more than two open owner actions add the one line of advice, and the "also waiting" rows show their due dates', async () => {
  const { card, data } = await nextFixture([[10001, '2026-11-10'], [10002, '2026-11-25'], [10003, undefined]]);
  assert.match(card.advice, /You have 3 open owner actions: finish one before starting another\./);
  noStore();
  today('2026-11-18T12:00:00Z');
  const ids = await runPage(serve(data));
  const body = openNext(ids);
  assert.match(body.textContent, /You have 3 open owner actions: finish one before starting another\./);
  assert.match(ids['d-title'].textContent, /track AM-10001/, 'the overdue one first');
  const rows = all(body, cls('nxrow')).map((r) => r.textContent);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].includes('do the owner action') && rows[0].includes('due 2026-11-25 UTC'), rows[0]);
  assert.ok(rows[1].includes('no due date'), rows[1]);
  unstub();
  // Two open actions: no advice.
  const two = await nextFixture([[10001, '2026-11-10'], [10002, '2026-11-25']]);
  noStore();
  const ids2 = await runPage(serve(two.data));
  assert.doesNotMatch(openNext(ids2).textContent, /open owner actions/);
  unstub();
});

test('TC-12 page: the "ready to measure" card (S23) reads as a measurement with its command', async () => {
  const dir = buildFixture({ tracks: [{ n: 10001, lane: 'quality-gate', status: 'waiting', extra: { 'KPI Check After': '2026-11-01' } }] });
  cleanup.push(dir);
  const facts = await gatherFacts(dir, { now: NOW_MS });
  const card = nextCard(classifyFacts(facts), facts);
  assert.equal(card.s, 'S23');
  const entries = fs.readdirSync(path.join(dir, 'conductor/tracks'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).map((folder) => ({ folder, index: { content: fs.readFileSync(path.join(dir, 'conductor/tracks', folder, 'index.md'), 'utf8') } }));
  noStore();
  today('2026-11-18T12:00:00Z');
  const ids = await runPage(serve(dataOf(entries, { next: card })));
  const text = openNext(ids).textContent;
  assert.match(ids['d-title'].textContent, /Measure the KPI of track AM-10001/);
  assert.match(text, /\/laneconductor:quality-gate 10001/);
  assert.match(text, /KPI Check After 2026-11-01/);
  assert.doesNotMatch(text, /adds your answer|Due \(UTC/);
  unstub();
});

// ---- intact: priority order, type chips, the page file ---------------------------------------------------------------------

test('TC-12 page: the priority order of the lanes and the type chips still work with owner steps on the cards', async () => {
  noStore();
  today('2026-11-18T12:00:00Z');
  const mk = (n, title, o, pr) => ({ folder: `AM-${n}-t${n}`, index: { content: index(n, title, o).replace('**Phase**', `${pr ? `**Priority**: ${pr}\n` : ''}**Phase**`) } });
  const data = dataOf([
    mk(1, 'Normal one', { markers: act({ 'Owner Action Due': '2026-11-20' }), type: 'marketing' }),
    mk(2, 'Low one', { markers: act({ 'Owner Action Due': '2026-11-01' }), type: 'marketing' }, 'low'),
    mk(3, 'High one', { markers: act({ 'Owner Action Due': '2026-11-25' }) }, 'high'),
    mk(4, 'Normal dev', { markers: {} }),
  ]);
  const ids = await runPage(serve(data));
  const order = () => all(ids.lanes, cls('card')).map((c) => all(c, cls('id'))[0].textContent);
  assert.deepEqual(order(), ['AM-3', 'AM-4', 'AM-1', 'AM-2'], 'high, then normal newest first, then low');
  const chip = (k) => ids['type-chips'].children.find((c) => c.dataset.type === k);
  chip('marketing').onclick();
  assert.deepEqual(order(), ['AM-1', 'AM-2']);
  assert.ok(all(cardOf(ids, 'AM-1'), cls('typetag')).length === 1 && badges(cardOf(ids, 'AM-1')).length === 1);
  chip('dev').onclick();
  assert.deepEqual(order(), ['AM-3', 'AM-4']);
  unstub();
});

test('TC-14: the new styles use the existing colour tokens only, the page file carries no project data, and the UTC line says it in one sentence', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  const css = html.match(/^(\.own|\.card \.own|\.ownb|\.utcnote|td \.why\.ready)[^{]*\{[^}]*\}/gm).join('\n');
  assert.ok(css.length > 400);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css), 'tokens only, so both themes work');
  assert.match(css, /var\(--bad\)/);
  assert.match(html, /id="utc-note" hidden>Owner-action dates are UTC days; overdue is worked out when this page opens\.</);
  assert.match(css, /overflow-wrap: anywhere/, 'long text wraps, so nothing scrolls sideways at 400 px');
});

test('lc-board --site writes the owner-step keys into board.json and the page file stays byte-identical for every project', () => {
  const real = fs.realpathSync(os.tmpdir());
  const dir = makeRepo();
  cleanup.push(dir);
  writeFile(dir, '.laneconductor.json', JSON.stringify({ project: { name: 'Site' } }));
  writeFile(dir, 'conductor/tracks/AM-1-t1/index.md', index(1, 'Video', { markers: act({ 'Owner Action Due': '2026-11-20' }) }));
  commitAll(dir);
  const site = fs.mkdtempSync(path.join(real, 'lc-own-site-'));
  cleanup.push(site);
  const r = spawnSync('node', [BIN, '--repo', dir, '--now', GEN, '--site', site], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const board = JSON.parse(fs.readFileSync(path.join(site, 'board.json'), 'utf8'));
  assert.deepEqual([board.tracks[0].oa, board.tracks[0].od], ['Post the launch video', '2026-11-20']);
  const noTitle = (t) => t.replace(/<title>[^<]*<\/title>/, '<title>X</title>');
  assert.equal(noTitle(fs.readFileSync(path.join(site, 'board.html'), 'utf8')), noTitle(fs.readFileSync(PAGE, 'utf8')), 'the shipped page but for its <title>, which names the project');
  assert.ok(!fs.readFileSync(path.join(site, 'board.html'), 'utf8').includes('Post the launch video'));
});
