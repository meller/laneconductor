// Track AM-10115, the What's next panel (owner decision 2026-11-18, items 4 and 5): the board shows the same answer as `/laneconductor:next`
// because both come from one shipped ranking (connector/src/next.mjs). This file covers the data side (board.json `next` equals the
// classifier output for fixture repos, size caps, privacy, include_docs, the text rules) and the page side (the button, the panel, Copy,
// the other tracks, the primer, the focus trap), with the fake DOM. The ranking itself is pinned by next.test.mjs (fixtures F01 to F34).
// HUMAN, not covered here: looking at the panel in a real browser, in both themes and at 375 px.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, ADDONS } from '../../scripts/build-plugin.mjs';
import { buildBoard, boardPageData } from '../src/board.mjs';
import { classifyRepo, gatherFacts, classifyFacts, nextCard, PRIMER, ADDONS_OFFERED, MAX_OTHERS } from '../src/next.mjs';
import { buildFixture, FIXTURES, RANKING } from './helpers/next-fixtures.mjs';
import { INDEX, rm, makeRepo, writeFile, commitAll } from './helpers/repo.mjs';
import { noLcHits } from './helpers/no-lc.mjs';
import { PAGE, runPage, restorePage, flush, all, cls, ev, stubGlobal, unstub } from './helpers/page-dom.mjs';

const BIN = new URL('../bin/lc-board.mjs', import.meta.url).pathname;
const BOARD_ADDON_BIN = path.join(REPO, 'plugins/laneconductor-board/server/bin/lc-board.mjs');
const cleanup = [];
after(() => { rm(...cleanup); restorePage(); unstub(); });
const real = fs.realpathSync(os.tmpdir());
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };
const fixture = (desc) => { const d = buildFixture(desc); cleanup.push(d); return d; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/** Runs a board script on a repo with --site and returns { board, dir, files, r }. No --now: the fixtures' ages are relative to the real clock. */
function site(repo, { bin = BIN } = {}) {
  const dir = tmp('lc-next-site-');
  const r = spawnSync('node', [bin, '--repo', repo, '--site', dir, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { dir, r, files: JSON.parse(r.stdout).files, board: readJson(path.join(dir, 'board.json')) };
}

// ---- data: board.json `next` is the classifier's answer -------------------------------------------------------------------

test('next.mjs is one implementation: it imports nothing from the test folder, writes nothing, and the old test-only classifier is gone', () => {
  const src = fs.readFileSync(path.join(REPO, 'connector/src/next.mjs'), 'utf8');
  assert.ok(!/from '[^']*test\//.test(src) && !/helpers\//.test(src), 'no import from the test folder');
  assert.ok(!/writeFile|appendFile|\.rm\(|\.unlink|rename\(|commitFiles|transaction\(|pushState|appendLog/.test(src.replace(/\/\/.*$/gm, '')), 'read only: no write call');
  assert.ok(!fs.existsSync(path.join(REPO, 'connector/test/helpers/next-reference.mjs')), 'no second implementation');
});

test('the add-ons offered by the front door are the ones of the plugin catalog', () => {
  assert.deepEqual(ADDONS_OFFERED, ADDONS.map((a) => a.name));
});

test('the primer is the six bullets of the explain primer of ops/next.md, word for word', () => {
  const md = fs.readFileSync(path.join(REPO, '.claude/skills/laneconductor/ops/next.md'), 'utf8').replace(/`/g, '');
  const flat = md.replace(/\n\s+/g, ' ');
  assert.equal(PRIMER.length, 6);
  for (const bullet of PRIMER) assert.ok(flat.includes(`- ${bullet}`), `ops/next.md holds: ${bullet}`);
});

const SHOWN = {
  'empty folder, no conductor': FIXTURES.F02b,
  'a folder that is not a repository': FIXTURES.F01,
  'a repository with history and no conductor': FIXTURES.F02a,
  'set up, no tracks': FIXTURES.F04,
  'a plan waits': FIXTURES.F18,
  'implement with a real plan': FIXTURES.F16a,
  'implement with a stub plan': FIXTURES.F17,
  'a human reply comes first': FIXTURES.F05c,
  'a track is blocked, the other is next': FIXTURES.F34,
  'done:queue with an unmerged branch (merge)': FIXTURES.F11,
  'done:queue already merged (record it)': FIXTURES.F12,
  'a stale running claim': FIXTURES.F07,
  'a recent running claim is skipped': FIXTURES.F08,
  'everything shipped': FIXTURES.F20,
  'an unreadable track': FIXTURES.F21b,
};

for (const [name, f] of Object.entries(SHOWN)) {
  test(`board.json next equals the classifier output: ${name}`, async () => {
    const repo = fixture(f.desc);
    const cls0 = await classifyRepo(repo);
    const { board } = site(repo);
    const n = board.next;
    assert.ok(n, 'the card is there');
    assert.equal(n.s, f.expect.state);
    assert.equal(n.s, cls0.state);
    assert.equal(n.cmd, cls0.state === 'S21' ? null : cls0.command, 'the command is the classifier\'s');
    if (cls0.state !== 'S21') assert.equal(n.n, cls0.track ?? null);
    assert.deepEqual(n.others.map((o) => ({ n: o.n, cmd: o.cmd })), cls0.ranked.slice(1, 1 + MAX_OTHERS).map((r) => ({ n: r.track, cmd: r.command })));
    assert.deepEqual(n.primer, PRIMER);
    assert.deepEqual(Object.keys(n).filter((k) => k !== 'more'), ['s', 'head', 'cmd', 'what', 'why', 'n', 'others', 'primer']);
  });
}

test('every fixture of next.test.mjs gives a board.json card with the fixture\'s state and command', async () => {
  for (const [id, f] of Object.entries(FIXTURES)) {
    const repo = fixture(f.desc);
    const { board } = site(repo);
    assert.equal(board.next.s, f.expect.state, `${id}: state`);
    if (f.expect.state !== 'S21') assert.equal(board.next.cmd, f.expect.command, `${id}: command`);
    if (f.expect.track !== undefined) assert.equal(board.next.n, f.expect.track, `${id}: track`);
  }
});

test('the card of the ranking fixture: the human reply first, then the rest in order, at most five, the count of the rest', async () => {
  const repo = fixture(RANKING());
  const { board } = site(repo);
  assert.equal(board.next.s, 'S05');
  assert.equal(board.next.n, 10007);
  assert.deepEqual(board.next.others.map((o) => o.n), [10006, 10005, 10004, 10003, 10002]);
  assert.equal(board.next.more, 1);
  assert.equal(board.next.others.length <= MAX_OTHERS, true);
});

test('a project with no tracks and no conductor folder still gets a card (the first run)', async () => {
  const repo = fixture(FIXTURES.F02b.desc);
  const { board } = site(repo);
  assert.equal(board.next.s, 'S02');
  assert.equal(board.next.cmd, '/laneconductor:new-project');
  assert.equal(board.tracks.length, 0);
});

// ---- data: caps, privacy, include_docs ---------------------------------------------------------------------------------

test('size caps: a project with many tracks gives at most five others and strings inside their caps', async () => {
  const tracks = Array.from({ length: 40 }, (_, i) => ({ n: 10001 + i, lane: 'plan', status: 'queue' }));
  const { board } = site(fixture({ tracks }));
  const n = board.next;
  assert.equal(n.others.length, 5);
  assert.equal(n.more, 34);
  assert.ok(n.head.length <= 120 && n.what.length <= 300 && n.why.length <= 300 && n.cmd.length <= 200);
  assert.ok(n.others.every((o) => o.cmd.length <= 200 && o.w.length <= 40));
  assert.ok(n.primer.length === 6 && n.primer.every((p) => p.length <= 300));
  assert.ok(JSON.stringify(n).length < 3000, 'the card stays small');
});

const SENTINEL = 'DOC-SENTINEL-OKAPI-4417-DO-NOT-LEAK';
function privateRepo(settings) {
  const dir = makeRepo();
  cleanup.push(dir);
  if (settings) writeFile(dir, '.laneconductor.json', JSON.stringify(settings));
  const t = (n, lane, status, extra = '') => writeFile(dir, `conductor/tracks/AM-${n}-t${n}/index.md`, INDEX(n, `Title ${SENTINEL}`, { lane, status, extra }).replace('summary', `summary ${SENTINEL}`));
  t(901, 'plan', 'queue');
  t(902, 'implement', 'queue', `**Problem**: ${SENTINEL}\n`);
  t(903, 'plan', 'waiting', `**Waiting Reason**: ${SENTINEL}\n`);
  for (const n of [901, 902, 903]) {
    writeFile(dir, `conductor/tracks/AM-${n}-t${n}/plan.md`, `# Plan\n\n- [ ] Task: ${SENTINEL}\n`);
    writeFile(dir, `conductor/tracks/AM-${n}-t${n}/test.md`, `# Tests\n\n- [ ] TC-1: ${SENTINEL}\n`);
    writeFile(dir, `conductor/tracks/AM-${n}-t${n}/spec.md`, `# Spec\n\n${SENTINEL}\n`);
    writeFile(dir, `conductor/tracks/AM-${n}-t${n}/conversation.md`, `> **human**: ${SENTINEL}\n`);
  }
  commitAll(dir);
  return dir;
}

test('the card holds commands and ids, never track titles, markers or document text', () => {
  const { board } = site(privateRepo());
  const text = JSON.stringify(board.next);
  assert.ok(!text.includes(SENTINEL), 'no title, summary, problem, reason, plan, test, spec or conversation text');
  assert.ok(!text.includes('Title'));
  assert.equal(board.next.s, 'S05', 'the human\'s last comment is read as a yes or no only');
});

test('board.include_docs false: no documents, and the card stays', () => {
  const s = site(privateRepo({ board: { include_docs: false } }));
  assert.ok(s.board.next && s.board.next.s === 'S05');
  assert.ok(!('project_docs' in s.board));
  assert.ok(s.files.every((f) => f === 'board.json'), 'no docs or ctx files');
  assert.ok(!JSON.stringify(s.board.next).includes(SENTINEL));
});

test('a failure to work out the next step leaves the panel out and never stops the board', () => {
  // A path that is not a directory at all: the board script still writes its files (the tracks list is empty) and says nothing fatal.
  const repo = tmp('lc-next-plain-');
  const s = site(repo);
  assert.deepEqual(s.board.tracks, []);
  assert.equal(s.board.next.s, 'S01', 'not a repository: setup comes first');
});

// ---- data: the text rules ----------------------------------------------------------------------------------------------

const FUTURE = /coming soon|will be added|in a future|later version|roadmap|planned|backlog item/i;
const BAD = /make install|laneconductorrc|\bworkers?\b|collection|daemon|\blegacy\b/i;

test('the card text: no daemon or lc command words, no unshipped work, no track number but the one the card is about', async () => {
  for (const [id, f] of Object.entries(FIXTURES)) {
    const repo = fixture(f.desc);
    const facts = await gatherFacts(repo);
    const card = nextCard(classifyFacts(facts), facts);
    const idText = (card.head + ' ' + card.what + ' ' + card.why).replace(/\bAM-\d+\b/g, '').replace(/\b\d{4}-\d{2}-\d{2}\b/g, ''); // a due day (owner steps) is data, not a track number
    for (const [k, text] of [['head', card.head], ['what', card.what], ['why', card.why], ...card.primer.map((p) => ['primer', p])]) {
      assert.ok(!BAD.test(text), `${id} ${k}: forbidden word in "${text}"`);
      assert.ok(!FUTURE.test(text), `${id} ${k}: unshipped work in "${text}"`);
      assert.deepEqual(noLcHits(text), [], `${id} ${k}: lc text`);
    }
    assert.ok(!/\b\d{3,}\b/.test(idText), `${id}: a track number in prose: ${idText}`);
    for (const o of card.others) assert.ok(!/\b\d{3,}\b/.test(o.w), `${id}: a number in "${o.w}"`);
    assert.ok(card.head && card.what && card.why, `${id}: every part is said`);
  }
});

// ---- the board add-on ships it ------------------------------------------------------------------------------------------

test('the board add-on carries the ranking and runs: its own lc-board.mjs produces the same card as the source script', () => {
  assert.ok(fs.existsSync(path.join(REPO, 'plugins/laneconductor-board/server/src/next.mjs')), 'next.mjs is traced into the board add-on');
  const repo = fixture(FIXTURES.F11.desc);
  const a = site(repo).board.next;
  const b = site(repo, { bin: BOARD_ADDON_BIN }).board.next;
  assert.deepEqual(b, a);
  assert.equal(b.s, 'S11');
});

// ---- the page, with the fake DOM ---------------------------------------------------------------------------------------

const NEXT = {
  s: 'S16', head: 'Implement track AM-2', cmd: '/laneconductor:implement 2', what: 'Builds the track from its plan.', why: 'The plan is written.', n: 2,
  others: [{ n: 3, cmd: '/laneconductor:review 3', w: 'review' }, { n: 4, cmd: '/laneconductor:plan 4', w: 'plan' }],
  primer: PRIMER,
};
function boardData(next, titles = {}) {
  const entries = [
    { folder: 'AM-2-two', index: { content: INDEX(2, titles[2] ?? 'Two', { lane: 'implement', status: 'queue' }) } },
    { folder: 'AM-3-three', index: { content: INDEX(3, titles[3] ?? 'Three', { lane: 'review', status: 'queue' }) } },
    { folder: 'AM-4-four', index: { content: INDEX(4, titles[4] ?? 'Four', { lane: 'plan', status: 'queue' }) } },
  ];
  const data = boardPageData(buildBoard(entries, { lanes: ['plan', 'implement', 'review', 'quality-gate', 'done'], generatedAt: '2026-11-18T10:00:00.000Z', project: 'Next Fixture' }), { next });
  if (next === null) delete data.next;
  return data;
}
const serve = (data) => async (u) => (u === 'board.json' ? { ok: true, status: 200, json: async () => data } : { ok: false, status: 404, json: async () => ({}) });
const nextBtn = (ids) => ids['next-btn'];
const copyBtns = (host) => all(host, cls('copy'));

test('page: the What\'s next button is hidden in the markup and with no next in board.json; shown with one, before the Project button', async () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  assert.match(html, /<header>[\s\S]*id="next-btn"[^>]* hidden>What's next<\/button>[\s\S]*id="proj-btn"[\s\S]*<\/header>/);
  const ids = await runPage(serve(boardData(null)));
  assert.equal(nextBtn(ids).hidden, true);
  nextBtn(ids).handlers.click();
  assert.ok(!ids.detail, 'nothing opens without a card: the drawer is never touched');
  const ids2 = await runPage(serve({ ...boardData(NEXT), next: { s: 'S16', head: '' } }));
  assert.equal(nextBtn(ids2).hidden, true, 'a card without a headline is not shown');
  const ids3 = await runPage(serve(boardData(NEXT)));
  assert.equal(nextBtn(ids3).hidden, false);
});

test('page: the panel shows the headline, the exact command with Copy, what, why, the other tracks and the closed primer, and says the page cannot run work', async () => {
  const ids = await runPage(serve(boardData(NEXT)));
  nextBtn(ids).handlers.click();
  assert.equal(ids.detail.hidden, false);
  assert.equal(ids.wrap.attrs.inert, '');
  assert.equal(ids['d-id'].textContent, 'WHAT\'S NEXT');
  assert.equal(ids['d-title'].textContent, 'Implement track AM-2');
  assert.equal(ids['d-lane'].hidden, true);
  assert.equal(ids['d-prog'].hidden, true);
  assert.equal(ids['d-tabs'].hidden, true);
  assert.equal(ids['d-act'].textContent, '');
  assert.match(ids['d-note'].textContent, /Worked out when this board was read \(.+\), not a live view/);
  assert.equal(ids.__doc.activeElement, ids['d-close']);
  const body = ids['d-body'];
  const code = all(body, cls('actc'));
  assert.equal(code[0].textContent, '/laneconductor:implement 2');
  assert.equal(code[0].tag, 'code', 'the command is monospace');
  assert.match(body.textContent, /This page cannot run work\. Copy the command into your Claude session, then ask Claude to refresh the board\./);
  assert.match(body.textContent, /What it does.*Builds the track from its plan\./);
  assert.match(body.textContent, /Why it comes next.*The plan is written\./);
  assert.match(body.textContent, /Also waiting/);
  const rows = all(body, cls('nxrow'));
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /AM-3 Three/);
  assert.match(rows[0].textContent, /review/);
  assert.equal(all(rows[0], cls('actc'))[0].textContent, '/laneconductor:review 3');
  // The primer is closed until asked for.
  const tg = all(body, cls('toggle'))[0];
  assert.equal(tg.textContent, 'How lanes and statuses work');
  assert.equal(tg.attrs['aria-expanded'], 'false');
  const pl = all(body, (x) => x.tag === 'ul' && cls('nxprimer')(x))[0];
  assert.equal(pl.hidden, true);
  assert.equal(pl.children.length, 6);
  assert.deepEqual(pl.children.map((c) => c.textContent), PRIMER);
});

test('page: Copy writes the command in the click, says Copied; a refused write falls back to selecting the text; no clipboard API names the keys', async () => {
  const written = [];
  stubGlobal('navigator', { clipboard: { writeText(t) { written.push(t); return Promise.resolve(); } } });
  try {
    const ids = await runPage(serve(boardData(NEXT)));
    nextBtn(ids).handlers.click();
    const [main, ...rest] = copyBtns(ids['d-body']);
    assert.equal(main.attrs['aria-label'], 'Copy the command: /laneconductor:implement 2');
    main.handlers.click(ev('x'));
    assert.deepEqual(written, ['/laneconductor:implement 2'], 'written synchronously, inside the click');
    await flush();
    assert.equal(all(ids['d-body'], cls('copied'))[0].textContent, 'Copied');
    rest[0].handlers.click(ev('x'));
    assert.deepEqual(written, ['/laneconductor:implement 2', '/laneconductor:review 3'], 'each row copies its own command');
    assert.equal(rest[0].attrs['aria-label'], 'Copy the command for AM-3: /laneconductor:review 3');
  } finally { unstub(); }
  const sel = {};
  stubGlobal('navigator', { clipboard: { writeText() { return Promise.reject(new Error('NotAllowedError')); } } });
  stubGlobal('window', { getSelection: () => ({ removeAllRanges() { sel.cleared = true; }, addRange() {} }) });
  try {
    const ids = await runPage(serve(boardData(NEXT)));
    ids.__doc.createRange = () => ({ selectNodeContents(n) { sel.node = n; } });
    nextBtn(ids).handlers.click();
    copyBtns(ids['d-body'])[0].handlers.click(ev('x'));
    await flush();
    assert.equal(sel.node, all(ids['d-body'], cls('actc'))[0]);
    assert.equal(all(ids['d-body'], cls('copied'))[0].textContent, 'Selected; press Ctrl+C to copy');
  } finally { unstub(); }
  stubGlobal('navigator', {});
  try {
    const ids = await runPage(serve(boardData(NEXT)));
    nextBtn(ids).handlers.click();
    copyBtns(ids['d-body'])[0].handlers.click(ev('x'));
    assert.match(all(ids['d-body'], cls('copied'))[0].textContent, /Ctrl\+C/);
  } finally { unstub(); }
});

test('page: a row of Also waiting opens that track\'s detail drawer, and closing it returns focus to the What\'s next button', async () => {
  const ids = await runPage(serve(boardData(NEXT)));
  nextBtn(ids).handlers.click();
  const open = all(ids['d-body'], cls('nxopen'))[1];
  assert.equal(open.attrs['aria-label'], 'Open AM-4: Four');
  open.handlers.click();
  assert.equal(ids['d-id'].textContent, 'AM-4');
  assert.equal(ids['d-title'].textContent, 'Four');
  assert.equal(ids['d-lane'].hidden, false);
  assert.equal(ids['d-prog'].hidden, false);
  assert.equal(ids['d-note'].hidden, true, 'the snapshot note of the panel is gone');
  assert.equal(ids.detail.hidden, false);
  ids['d-close'].onclick();
  assert.equal(ids.detail.hidden, true);
  assert.equal(ids.wrap.attrs.inert, undefined);
  assert.equal(ids.__doc.activeElement, nextBtn(ids));
});

test('page: a row for a track the board does not list shows a plain id, still with its Copy', async () => {
  const data = boardData({ ...NEXT, others: [{ n: 99, cmd: '/laneconductor:plan 99', w: 'plan' }] });
  const ids = await runPage(serve(data));
  nextBtn(ids).handlers.click();
  assert.equal(all(ids['d-body'], cls('nxopen')).length, 1);
  assert.equal(all(ids['d-body'], cls('nxopen'))[0].tag, 'span', 'not a button: nothing to open');
  assert.equal(copyBtns(ids['d-body']).length, 2);
});

test('page: with no command (nothing to do or blocked) the reason is shown instead, no command and no Copy for it, and the page still says it cannot run work', async () => {
  const none = { s: 'S20', head: 'Nothing is ready to start', cmd: null, what: 'The remaining tracks wait on tracks that are not shipped yet.', why: 'Nothing is ready to be planned, built, reviewed or merged.', n: null, others: [], primer: PRIMER };
  const ids = await runPage(serve(boardData(none)));
  nextBtn(ids).handlers.click();
  const body = ids['d-body'];
  assert.equal(ids['d-title'].textContent, 'Nothing is ready to start');
  assert.equal(all(body, cls('actc')).length, 0);
  assert.equal(copyBtns(body).length, 0);
  assert.match(body.textContent, /Nothing to run right now\./);
  assert.match(body.textContent, /The remaining tracks wait on tracks that are not shipped yet\./);
  assert.match(body.textContent, /This page cannot run work\./);
  assert.ok(!/Also waiting/.test(body.textContent));
  assert.ok(!/What it does/.test(body.textContent));
});

test('page: the primer toggle opens and closes it and keeps aria-expanded true to what is shown', async () => {
  const ids = await runPage(serve(boardData(NEXT)));
  nextBtn(ids).handlers.click();
  const tg = all(ids['d-body'], cls('toggle'))[0];
  const pl = all(ids['d-body'], (x) => cls('nxprimer')(x))[0];
  tg.handlers.click();
  assert.equal(pl.hidden, false);
  assert.equal(tg.attrs['aria-expanded'], 'true');
  assert.equal(tg.attrs['aria-controls'], 'nx-primer');
  assert.equal(pl.id, 'nx-primer');
  tg.handlers.click();
  assert.equal(pl.hidden, true);
  assert.equal(tg.attrs['aria-expanded'], 'false');
});

test('page: Escape closes the panel and returns focus; Tab and Shift+Tab stay inside, in reading order', async () => {
  const ids = await runPage(serve(boardData(NEXT)));
  nextBtn(ids).handlers.click();
  const body = ids['d-body'];
  const order = [ids['d-close'], copyBtns(body)[0], all(body, cls('nxopen'))[0], copyBtns(body)[1], all(body, cls('nxopen'))[1], copyBtns(body)[2], all(body, cls('toggle'))[0]];
  for (let i = 0; i < order.length - 1; i++) {
    order[i].focus();
    const tab = ev('Tab'); ids.__doc.handlers.keydown(tab);
    assert.equal(tab.prevented, undefined, `Tab from item ${i} moves on by itself`);
  }
  order.at(-1).focus();
  const wrap = ev('Tab'); ids.__doc.handlers.keydown(wrap);
  assert.equal(wrap.prevented, true);
  assert.equal(ids.__doc.activeElement, ids['d-close'], 'the last item wraps to Close');
  const back = ev('Tab', { shiftKey: true }); ids.__doc.handlers.keydown(back);
  assert.equal(ids.__doc.activeElement, order.at(-1), 'Shift+Tab on Close wraps to the last item');
  const esc = ev('Escape'); ids.__doc.handlers.keydown(esc);
  assert.equal(ids.detail.hidden, true);
  assert.equal(ids.wrap.attrs.inert, undefined);
  assert.equal(ids.__doc.activeElement, nextBtn(ids));
  const noop = ev('Escape'); ids.__doc.handlers.keydown(noop);
  assert.equal(noop.prevented, undefined);
});

test('page: hostile text in the card and in titles stays text: no element but plain ones is made, nothing is parsed', async () => {
  const evil = '<img src=x onerror=alert(1)><script>boom()</script>';
  const data = boardData({ ...NEXT, head: evil, what: evil, why: evil, cmd: evil, others: [{ n: 3, cmd: evil, w: evil }], primer: [evil] }, { 3: evil });
  const ids = await runPage(serve(data));
  nextBtn(ids).handlers.click();
  assert.equal(ids['d-title'].textContent, evil);
  assert.ok(ids['d-body'].textContent.includes(evil));
  const tags = new Set(ids.__doc.created);
  for (const bad of ['img', 'script', 'iframe', 'a', 'svg', 'style']) assert.ok(!tags.has(bad), `no <${bad}> element is created`);
  all(ids['d-body'], () => true).forEach((x) => assert.ok(!x.attrs?.href && !x.attrs?.src && !x.attrs?.onerror, 'no link or source attribute'));
  // A card with the wrong types is read as far as it is safe, never thrown on.
  const odd = boardData({ s: 'S16', head: 'Odd', cmd: 7, what: null, why: {}, n: 'x', others: [null, { n: 'a' }, { n: 3, cmd: 4 }, ...Array.from({ length: 9 }, () => ({ n: 3, cmd: '/laneconductor:plan 3', w: 'plan' }))], primer: [1, 'ok', ...Array.from({ length: 9 }, () => 'p')] });
  const ids2 = await runPage(serve(odd));
  nextBtn(ids2).handlers.click();
  assert.equal(all(ids2['d-body'], cls('nxrow')).length, 5, 'at most five rows, whatever the file says');
  assert.equal(all(ids2['d-body'], (x) => cls('nxprimer')(x))[0].children.length, 6);
  assert.match(ids2['d-body'].textContent, /Nothing to run right now\./, 'a command that is not text is no command');
});

test('page: the panel CSS uses theme variables only, wraps at phone width and keeps keyboard focus visible; the page keeps its safe-DOM rule', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  const from = html.indexOf("/* What's next");
  const css = html.slice(from, html.indexOf('@media (max-width: 700px)', from));
  assert.ok(css.length > 600);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css), 'colours come from the variables, so both themes work');
  assert.match(css, /\.nx \{[^}]*min-width: 0/);
  assert.match(css, /\.nx li\.nxrow \{[^}]*min-width: 0/);
  assert.match(css, /\.nx \.nxopen \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.nx p \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.nx \.nxopen:focus-visible/);
  assert.ok(!/white-space: nowrap|width: \d{3,}px/.test(css), 'nothing forces a width: no sideways scrolling at 375 px');
  assert.match(html, /@media \(max-width: 700px\) \{\s*\.detail \{ justify-content: stretch; \}\s*\.drawer \{ width: 100%/, 'a full-screen sheet at phone width');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\balert\(|\bconfirm\(|\bprompt\(/.test(html));
  assert.ok(!/\blegacy\b/i.test(html.slice(html.indexOf('// ---- What\'s next'), html.indexOf("$('proj-btn').hidden"))), 'the word legacy is not used in the panel');
});

// ---- Track AM-10152: a track serving an active KPI comes first, then one naming none, then one serving only non-active KPIs; no KPI file: the old order.
const KPI_FILE = '| ID | Metric | Focus |\n|----|--------|-------|\n| KPI-1 | Stars | active |\n| KPI-2 | Installs | future |\n';
const kpiTracks = [
  { n: 10001, lane: 'plan', status: 'queue', extra: { Serves: 'KPI-2' } },
  { n: 10002, lane: 'plan', status: 'queue' },
  { n: 10003, lane: 'plan', status: 'queue', extra: { Serves: 'KPI-2, KPI-1' } },
  { n: 10004, lane: 'plan', status: 'queue', extra: { Serves: 'KPI-9' } },
];
test('next ranking: an active-KPI track first, then tracks naming no KPI (or none listed), then tracks serving only non-active KPIs; without kpis.md the order is the old one', () => {
  const withKpis = site(fixture({ tracks: kpiTracks, files: { 'conductor/kpis.md': KPI_FILE } })).board.next;
  assert.equal(withKpis.n, 10003, 'serves an active KPI among others');
  assert.deepEqual(withKpis.others.map((o) => o.n), [10002, 10004, 10001], 'no KPI and unlisted KPI keep their order; the future-only one is last');
  const without = site(fixture({ tracks: kpiTracks })).board.next;
  assert.equal(without.n, 10001, 'no kpis.md: lowest number first, as before');
  assert.deepEqual(without.others.map((o) => o.n), [10002, 10003, 10004]);
});
