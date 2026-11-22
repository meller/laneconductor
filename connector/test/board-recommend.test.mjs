// Track AM-10155 Phase 9 (D19, D21, D22, D23, D24): the board shows the short plan first with the rest folded under Details, and an
// "Agent recommendations" button at the top that opens a drawer built from the last 10 tracks that have explain statistics.
//   TC-29 (board side) board.json `rec` is worked out when the board is built, from the facts block of each track's explain.md
//   TC-30 the Agent run tab opens on the short plan with Details folded; the top button opens a drawer with Copy buttons
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, writeFile, rm, INDEX } from './helpers/repo.mjs';
import { runPage, flush, restorePage, stubGlobal, unstub, all, cls, PAGE } from './helpers/page-dom.mjs';

const BOARD = new URL('../bin/lc-board.mjs', import.meta.url).pathname;
const NOW = '2026-11-22T10:00:00.000Z';
const cleanup = [];
after(() => { restorePage(); unstub(); rm(...cleanup); });
const real = fs.realpathSync(os.tmpdir());
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const factsOf = (ids) => JSON.stringify({ v: 1, rules: ids.map((id) => ({ id, lane: id === 'claim' ? null : 'implement', n: 5, tokens: 1000, count: 1 })) });
/** An explain.md as the script writes it now: short plan, Details, the old sections, the facts block last. `facts` null leaves the block out (an older file). */
const explainMd = (folder, facts, extra = '') => [
  `# Agent run: ${folder}`, '', '## Short plan', '',
  '| Step | Where | Time | Written | Context at start | Expensive |', '| --- | --- | --- | --- | --- | --- |',
  '| plan | main session | 30m | 1,000 | 50,000 |  |', '| implement | main session | 2h 00m (40m human) | 2,000 | 500,000 | expensive |', '',
  '> Approximate, tokens only: tracks that overlap in time can share messages.', '',
  '- Run the implement run in a sub-agent or a fresh session: it began with 500,000 tokens of context. Change: how the lane is started.', '',
  '## Details', '', 'The sections below hold the numbers behind the short plan.', '',
  '## Insight', '', '- Time: 2h 30m wall, 1h 45m agent, 45m human, over 2 lane runs.', '',
  '## Lane runs', '', '| Lane | Start (UTC) | End (UTC) | Wall | Agent | Human | Responses | Output | Fresh input | Cache created | Cache read | Tool calls | Sub-agent share |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  '| plan | 2026-11-20 09:00 | 2026-11-20 09:30 | 30m | 25m | 5m | 10 | 1,000 | 10 | 2,000 | 30,000 | 7 | 0% |', '',
  extra,
  ...(facts === null ? [] : ['## Recommend facts', '', 'The numbers the board reads.', '', '```json recommend-facts', facts, '```']), '',
].join('\n');

/** A repo with tracks 901 up; `spec` is [[number, lane, status, factsOrNull|undefined (no explain.md)]]. */
function fixture(spec, { cfg = {} } = {}) {
  const repo = makeRepo({ prefix: 'lc-board-rec-' });
  cleanup.push(repo);
  writeFile(repo, '.laneconductor.json', JSON.stringify({ project: { name: 'Rec Fixture' }, ...cfg }));
  for (const [n, lane, status, facts, extra] of spec) {
    writeFile(repo, `conductor/tracks/AM-${n}-t${n}/index.md`, INDEX(n, `Track ${n}`, { lane, status }));
    writeFile(repo, `conductor/tracks/AM-${n}-t${n}/plan.md`, `# Plan ${n}\n`);
    if (facts !== undefined) writeFile(repo, `conductor/tracks/AM-${n}-t${n}/explain.md`, explainMd(`AM-${n}-t${n}`, facts, extra));
  }
  return repo;
}
const site = (repo) => {
  const dir = tmp('lc-rec-site-');
  const r = spawnSync('node', [BOARD, '--repo', repo, '--now', NOW, '--site', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { dir, board: readJson(path.join(dir, 'board.json')), stderr: r.stderr };
};
const claim = factsOf(['claim']);
const quietFacts = factsOf([]);

// ---- TC-29, the data side ----
test('TC-29: board.json `rec` ranks the facts of the last tracks, finished tracks included; the explain.md text is not copied into it', () => {
  const spec = [];
  for (let k = 1; k <= 12; k += 1) spec.push([900 + k, k % 2 ? 'done' : 'implement', k % 2 ? 'success' : 'running', k <= 6 ? claim : factsOf(['claim', 'where'])]);
  const { board } = site(fixture(spec));
  assert.equal(board.rec.state, 'ok');
  assert.equal(board.rec.measured, 10);
  assert.deepEqual(board.rec.tracks, [912, 911, 910, 909, 908, 907, 906, 905, 904, 903], 'the ten newest');
  assert.deepEqual(board.rec.actions.map((a) => [a.id, a.count]), [['claim', 10], ['where', 6]]);
  assert.ok(board.rec.actions.every((a) => a.title && a.text && a.copy));
  assert.ok(!JSON.stringify(board.rec).includes('Agent run:'), 'no explain text');
});

test('TC-29: fewer than 3 measured tracks: the message and no action; with no explain.md at all the drawer still says so (D24)', () => {
  const some = site(fixture([[901, 'implement', 'running', claim], [902, 'plan', 'queue', claim], [903, 'plan', 'queue', undefined]])).board.rec;
  assert.equal(some.state, 'few');
  assert.equal(some.message, 'Not enough tracks with statistics yet (2 of 3)');
  assert.deepEqual(some.actions, []);
  const none = site(fixture([[901, 'implement', 'running', undefined]])).board.rec;
  assert.equal(none.state, 'few');
  assert.equal(none.message, 'Not enough tracks with statistics yet (0 of 3)');
  assert.deepEqual(none.tracks, []);
});

test('TC-29: nothing over the threshold: "No change suggested across the last N tracks."', () => {
  const rec = site(fixture([[901, 'implement', 'running', quietFacts], [902, 'plan', 'queue', quietFacts], [903, 'done', 'success', quietFacts], [904, 'done', 'success', claim]])).board.rec;
  assert.equal(rec.state, 'quiet');
  assert.equal(rec.message, 'No change suggested across the last 4 tracks.');
});

test('TC-29: an explain.md without the block (older) is not measured; one with a secret match is left out of the count and never published', () => {
  const secret = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const { board, stderr } = site(fixture([
    [901, 'implement', 'running', claim], [902, 'plan', 'queue', claim], [903, 'plan', 'queue', claim], [904, 'plan', 'queue', null], [905, 'plan', 'queue', claim, `token ${secret}\n`],
  ]));
  assert.equal(board.rec.measured, 3);
  assert.equal(board.rec.not_measured, 2);
  assert.deepEqual(board.rec.actions.map((a) => [a.id, a.count]), [['claim', 3]]);
  assert.ok(!JSON.stringify(board).includes(secret));
  assert.match(stderr, /withheld track 905/);
});

test('TC-29: board.include_docs false leaves `rec` out (no documents are read at all)', () => {
  const { board } = site(fixture([[901, 'implement', 'running', claim], [902, 'plan', 'queue', claim], [903, 'plan', 'queue', claim]], { cfg: { board: { include_docs: false } } }));
  assert.equal(board.rec, undefined);
});

// ---- TC-30, the page ----
const dataOf = (dir) => readJson(path.join(dir, 'board.json'));
const stub = (dir, data = dataOf(dir)) => async (u) => {
  if (u === 'board.json') return { ok: true, status: 200, json: async () => data };
  const f = path.join(dir, u);
  return fs.existsSync(f) ? { ok: true, status: 200, json: async () => readJson(f) } : { ok: false, status: 404, json: async () => ({}) };
};
const heads = (host) => all(host, (x) => /^h[1-6]$/.test(x.tag)).map((h) => h.textContent);

test('TC-30: the Agent run tab opens on the short plan: the table, the fix line and the note, with Details folded away until asked', async () => {
  const { dir } = site(fixture([[901, 'implement', 'running', claim]]));
  const ids = await runPage(stub(dir));
  const cards = ids.lanes.children.flatMap((l) => l.children[1]?.children ?? []);
  cards.find((c) => c.textContent.includes('Track 901')).handlers.click();
  await flush();
  ids['d-tabs'].children.find((b) => b._text === 'Agent run').onclick();
  await flush();
  const body = ids['d-body'];
  assert.deepEqual(heads(body).slice(0, 2), ['Agent run: AM-901-t901', 'Short plan'], 'the title, then the short plan; the Insight is not among the visible headings');
  const details = all(body, (x) => x.attrs && x.attrs.id === 'ex-details')[0];
  assert.ok(details, 'the folded part');
  assert.equal(details.hidden, true, 'folded when the tab opens');
  assert.ok(heads(details).includes('Insight') && heads(details).includes('Lane runs'), 'the old sections live in the folded part');
  assert.ok(!heads(body).includes('Details'), 'the Details heading is replaced by the button');
  const visible = body.textContent.replace(details.textContent, '');
  assert.ok(visible.includes('expensive') && visible.includes('Context at start'), 'the table is in the visible part');
  assert.ok(visible.includes('Change: how the lane is started'), 'and the fix line');
  const toggle = all(body, (x) => x.tag === 'button' && /details/i.test(x._text))[0];
  assert.ok(toggle, 'a button that unfolds Details');
  assert.equal(toggle.attrs['aria-expanded'], 'false');
  assert.equal(toggle.attrs['aria-controls'], 'ex-details');
  toggle.handlers.click({ stopPropagation() {} });
  assert.equal(details.hidden, false);
  assert.equal(toggle.attrs['aria-expanded'], 'true');
  assert.match(toggle._text, /Hide details/);
  toggle.handlers.click({ stopPropagation() {} });
  assert.equal(details.hidden, true);
  assert.match(toggle._text, /Show details/);
  ids['d-close'].onclick();
});

test('TC-30: the button sits at the top before What\'s next and Project, hidden in the markup and with no rec in board.json', async () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  assert.match(html, /<header>[\s\S]*id="rec-btn"[^>]* hidden>Agent recommendations<\/button>[\s\S]*id="next-btn"[\s\S]*id="proj-btn"[\s\S]*<\/header>/);
  const { dir } = site(fixture([[901, 'implement', 'running', claim]]));
  const data = dataOf(dir);
  delete data.rec;
  const ids = await runPage(stub(dir, data));
  assert.equal(ids['rec-btn'].hidden, true, 'an older board.json has no rec: no button');
  const ids2 = await runPage(stub(dir));
  assert.equal(ids2['rec-btn'].hidden, false);
});

function ten(extra = {}) {
  const spec = [];
  for (let k = 1; k <= 10; k += 1) spec.push([900 + k, k % 2 ? 'done' : 'implement', k % 2 ? 'success' : 'running', k <= 7 ? factsOf(['claim', 'where']) : k <= 9 ? claim : quietFacts]);
  return site(fixture(spec, extra));
}

test('TC-30: the drawer lists at most three actions, each with one number line and a Copy button; the copy is one plain sentence; the tracks looked at are named', async () => {
  const { dir } = ten();
  const written = [];
  stubGlobal('navigator', { clipboard: { writeText(t) { written.push(t); return Promise.resolve(); } } });
  try {
    const ids = await runPage(stub(dir));
    ids['rec-btn'].handlers.click();
    assert.equal(ids.detail.hidden, false);
    assert.equal(ids.wrap.attrs.inert, '');
    assert.equal(ids['d-id'].textContent, 'RECOMMENDATIONS');
    assert.equal(ids['d-title'].textContent, 'Agent recommendations');
    assert.equal(ids['d-tabs'].hidden, true);
    assert.equal(ids.__doc.activeElement, ids['d-close']);
    assert.match(ids['d-note'].textContent, /not a live view/);
    const body = ids['d-body'];
    const rows = all(body, cls('recrow'));
    assert.equal(rows.length, 2, 'claim and where reached 3 tracks; nothing else fired');
    assert.match(rows[0].textContent, /9 of 10 tracks have lane runs with no claim commit/);
    assert.match(rows[1].textContent, /7 of 10 tracks ran a lane with over 400,000 tokens/);
    const copies = all(body, (x) => x.tag === 'button' && x._text === 'Copy');
    assert.equal(copies.length, 2);
    copies[1].handlers.click({ stopPropagation() {} });
    assert.equal(written.length, 1);
    assert.match(written[0], /sub-agent or a fresh session/);
    assert.ok(!written[0].includes('\n') && written[0].endsWith('.'));
    await flush();
    assert.equal(all(rows[1], cls('copied'))[0].textContent, 'Copied');
    assert.match(body.textContent, /Looked at: .*AM-910.*AM-901/, 'the tracks looked at, newest first');
    assert.match(body.textContent, /last 10 tracks/);
    ids['d-close'].onclick();
    assert.equal(ids.detail.hidden, true);
    assert.equal(ids.__doc.activeElement, ids['rec-btn'], 'focus goes back to the button');
  } finally { unstub(); }
});

test('TC-30: the not-enough and no-change states say so and show no Copy button', async () => {
  const few = site(fixture([[901, 'implement', 'running', claim], [902, 'plan', 'queue', claim]]));
  let ids = await runPage(stub(few.dir));
  ids['rec-btn'].handlers.click();
  assert.match(ids['d-body'].textContent, /Not enough tracks with statistics yet \(2 of 3\)/);
  assert.equal(all(ids['d-body'], (x) => x.tag === 'button' && x._text === 'Copy').length, 0);
  ids['d-close'].onclick();
  const none = site(fixture([[901, 'implement', 'running', undefined]]));
  ids = await runPage(stub(none.dir));
  ids['rec-btn'].handlers.click();
  assert.match(ids['d-body'].textContent, /Not enough tracks with statistics yet \(0 of 3\)/);
  assert.match(ids['d-body'].textContent, /lanes and phases/, 'one line that the statistics need tracks worked through lanes and phases');
  ids['d-close'].onclick();
  const quiet = site(fixture([[901, 'implement', 'running', quietFacts], [902, 'plan', 'queue', quietFacts], [903, 'plan', 'queue', quietFacts]]));
  ids = await runPage(stub(quiet.dir));
  ids['rec-btn'].handlers.click();
  assert.match(ids['d-body'].textContent, /No change suggested across the last 3 tracks\./);
  assert.equal(all(ids['d-body'], (x) => x.tag === 'button' && x._text === 'Copy').length, 0);
  ids['d-close'].onclick();
});

test('TC-30: a rec that is malformed in board.json never breaks the page (no button, no drawer)', async () => {
  const { dir } = site(fixture([[901, 'implement', 'running', claim]]));
  for (const bad of [null, 'x', { state: 'nope' }, { state: 'ok', actions: 'x' }]) {
    const ids = await runPage(stub(dir, { ...dataOf(dir), rec: bad }));
    assert.equal(ids['rec-btn'].hidden, true, JSON.stringify(bad));
  }
  const ids = await runPage(stub(dir, { ...dataOf(dir), rec: { state: 'ok', message: '', measured: 3, not_measured: 0, min: 3, tracks: [1, 'x', 2], actions: [{ id: 'claim', title: 5, text: 't', copy: 'c', count: 3 }, { id: 'claim', title: '<b>Title</b>', text: 'x of y', copy: 'Do it.', count: 3 }, null, {}, {}, {}] } }));
  ids['rec-btn'].handlers.click();
  assert.equal(all(ids['d-body'], cls('recrow')).length, 1, 'only the well-formed action');
  assert.ok(ids['d-body'].textContent.includes('<b>Title</b>'), 'text only, never markup');
  ids['d-close'].onclick();
});
