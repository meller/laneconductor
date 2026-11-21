// Phase 5d Tasks 2-3: the static board page (connector/src/board-page.html), its data file and
// `lc-board.mjs --site`. The page never embeds data; it fetches board.json. The page script is run
// here against a tiny fake DOM with `fetch` stubbed (no browser).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, writeFile, commitAll, git, rm, INDEX } from './helpers/repo.mjs';
import { FAKES } from './helpers/fakes.mjs';
import { buildBoard, boardPageData } from '../src/board.mjs';

const BIN = new URL('../bin/lc-board.mjs', import.meta.url).pathname;
const PAGE = new URL('../src/board-page.html', import.meta.url).pathname;
const NOW = '2026-11-17T10:00:00.000Z';
const TITLE_SENTINEL = 'TITLE-SENTINEL-QUOKKA-5521';
const BODY_SENTINEL = 'BODY-SENTINEL-ZEBRA-7731-DO-NOT-LEAK';
const cleanup = [];
after(() => rm(...cleanup));

const real = fs.realpathSync(os.tmpdir());
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };
const run = (repo, ...args) => spawnSync('node', [BIN, '--repo', repo, '--now', NOW, ...args], { encoding: 'utf8' });

function fixture() {
  const dir = makeRepo();
  cleanup.push(dir);
  writeFile(dir, '.laneconductor.json', JSON.stringify({ project: { name: 'Page Fixture' } }));
  const t = (n, title, lane, status, extra) => writeFile(dir, `conductor/tracks/AM-${n}-t${n}/index.md`, INDEX(n, title, { lane, status, extra }));
  t(201, `Planned ${TITLE_SENTINEL}`, 'plan', 'queue');
  t(202, 'Being built', 'implement', 'running', '**Phase**: Phase 2\n'.replace(/^/, ''));
  t(203, 'Needs a reply', 'review', 'waiting', '**Waiting for reply**: yes\n');
  t(204, 'In the gate', 'quality-gate', 'queue');
  t(205, 'Parked', 'backlog', 'queue');
  t(206, 'Shipped one', 'done', 'success');
  t(207, 'Shipped two', 'done', 'success');
  t(208, 'Odd lane', 'nowhere', 'queue');
  writeFile(dir, 'conductor/tracks/AM-201-t201/conversation.md', `> **human**: ${BODY_SENTINEL}\n`);
  writeFile(dir, 'conductor/tracks/AM-201-t201/spec.md', `# spec\n${BODY_SENTINEL}\n`);
  writeFile(dir, 'conductor/tracks/_duplicate-201-t201/index.md', INDEX(201, 'Archived copy ARCHIVED-SENTINEL', { lane: 'plan', status: 'queue' }));
  commitAll(dir);
  return dir;
}

test('--site writes board.html, board.json and docs/, prints their absolute paths and nothing else', () => {
  const repo = fixture();
  const site = path.join(tmp('lc-site-'), 'nested', 'out'); // does not exist yet
  const r = run(repo, '--site', site);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${path.join(site, 'board.html')}\n${path.join(site, 'board.json')}\n`);
  assert.deepEqual(fs.readdirSync(site).sort(), ['board.html', 'board.json', 'ctx', 'docs', 'manifest.json', 'version.json']);
  assert.ok(!fs.readdirSync(repo).includes('board.json'), 'nothing is written into the repo');
});

test('board.html is byte-identical across runs and carries no data; board.json holds the data', () => {
  const repo = fixture();
  const a = tmp('lc-site-a-');
  const b = tmp('lc-site-b-');
  assert.equal(run(repo, '--site', a).status, 0);
  const later = spawnSync('node', [BIN, '--repo', repo, '--now', '2030-01-01T00:00:00.000Z', '--site', b], { encoding: 'utf8' });
  assert.equal(later.status, 0, later.stderr);
  const pageA = fs.readFileSync(path.join(a, 'board.html'));
  assert.ok(pageA.equals(fs.readFileSync(path.join(b, 'board.html'))), 'the page does not change with the data or the time');
  const masked = (buf) => buf.toString('utf8').replace(/<title>[^<]*<\/title>/, '<title>X</title>');
  assert.equal(masked(pageA), masked(fs.readFileSync(PAGE)), 'the page is the shipped static file, byte for byte, but for its <title> (named after the project)');
  const html = pageA.toString('utf8');
  assert.ok(!html.includes(TITLE_SENTINEL) && !html.includes('Page Fixture') && !html.includes(NOW), 'no data in the page');
  assert.ok(!html.includes('__DATA__') && !html.includes('id="data"'), 'no data placeholder or embedded data block');
  assert.ok(/fetch\(\s*'board\.json'/.test(html), 'the page fetches board.json by a relative URL');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\balert\(|\bconfirm\(|\bprompt\(/.test(html), 'DOM is built with createElement and textContent only');

  const raw = fs.readFileSync(path.join(a, 'board.json'), 'utf8');
  assert.ok(raw.endsWith('}\n') && !raw.slice(0, -1).includes('\n'), 'compact JSON, one line');
  const j = JSON.parse(raw);
  assert.ok(raw.includes(TITLE_SENTINEL), 'the title is in board.json');
  assert.deepEqual(Object.keys(j), ['project', 'generated_at', 'commit', 'commit_short', 'lanes', 'tracks', 'attn', 'project_docs', 'wf', 'next']); // the fixture has a workflow.json, so the Project drawer has its Workflow tab; the What's next card is always computed
  assert.equal(j.project, 'Page Fixture');
  assert.equal(j.generated_at, NOW);
  for (const t of j.tracks) assert.deepEqual(Object.keys(t).filter((k) => k !== 'x'), ['n', 'p', 't', 'l', 's', 'g', 'h', 'a', 'd']);
  for (const a2 of j.attn) assert.deepEqual(Object.keys(a2).filter((k) => k !== 'x'), ['n', 'p', 't', 'r']);
  assert.equal(j.tracks.length, 8, 'live tracks only');
  assert.ok(!raw.includes('ARCHIVED-SENTINEL'), 'archived folders are left out');
  assert.ok(j.tracks.every((t) => t.p === 'AM'));
  assert.ok(!raw.includes(BODY_SENTINEL), 'no conversation or spec text');
  assert.ok(!html.includes(BODY_SENTINEL));
  assert.deepEqual(j.attn.map((x) => x.n), [208, 203]);
});

test('boardPageData: short keys, live tracks only, phase cut at 130 chars, prefix from the folder', () => {
  const long = 'P'.repeat(300);
  const entries = [
    { folder: 'AM-1-a', index: { content: INDEX(1, 'A', { lane: 'plan' }).replace('**Phase**: New', `**Phase**: ${long}`) } },
    { folder: '77-legacy', index: { content: INDEX(77, 'Legacy', { lane: 'done', status: 'success' }) } },
    { folder: '_duplicate-1-a', index: { content: INDEX(1, 'Old', { lane: 'plan' }) } },
  ];
  const d = boardPageData(buildBoard(entries, { generatedAt: NOW, project: 'p' }));
  assert.equal(d.tracks.length, 2);
  const a = d.tracks.find((t) => t.n === 1);
  assert.equal(a.p, 'AM');
  assert.equal(a.h.length, 130);
  assert.equal(d.tracks.find((t) => t.n === 77).p, '');
  assert.deepEqual(d.attn, []);
});

test('--site inside the repo conductor/ folder is refused and writes nothing', () => {
  const repo = fixture();
  for (const bad of [path.join(repo, 'conductor'), path.join(repo, 'conductor', 'board-out')]) {
    const r = run(repo, '--site', bad);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /inside conductor\//);
    assert.equal(r.stdout, '');
  }
  assert.ok(!fs.existsSync(path.join(repo, 'conductor', 'board-out')));
  assert.ok(!fs.existsSync(path.join(repo, 'conductor', 'board.html')));
  assert.equal(run(repo, '--site').status, 2, '--site needs a value');
});

test('existing behaviours are unchanged: stdout JSON, --out, --check', () => {
  const repo = fixture();
  const out = run(repo);
  assert.equal(out.status, 0);
  assert.equal(JSON.parse(out.stdout).project, 'Page Fixture');
  const file = path.join(tmp('lc-out-'), 'b.json');
  assert.equal(run(repo, '--out', file).status, 0);
  assert.equal(run(repo, '--check', file).status, 0);
});

// --- the page, run against a fake DOM -------------------------------------------------------------

let fakeDoc = null;
class TextNode {
  constructor(t) { this.nodeType = 3; this._text = String(t); }
  get textContent() { return this._text; }
}
class El {
  constructor(tag) { this.tag = tag; this.nodeType = 1; this.children = []; this.className = ''; this.dataset = {}; this.style = {}; this.attrs = {}; this._text = ''; this.hidden = false; this.handlers = {}; this.scrollTop = 0; }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(e, f) { this.handlers[e] = f; }
  focus() { if (fakeDoc) fakeDoc.activeElement = this; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
}

const flush = () => new Promise((r) => setTimeout(r, 5));

// The page's handlers run after the first render, so the fake globals stay installed until the next
// runPage (or the end of the file).
let restore = () => {};
after(() => restore());
async function runPage(fetchStub) {
  restore();
  const html = fs.readFileSync(PAGE, 'utf8');
  const code = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
  const ids = {};
  const had = { document: globalThis.document, fetch: globalThis.fetch };
  restore = () => {
    globalThis.document = had.document;
    if (had.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = had.fetch;
    restore = () => {};
  };
  const created = [];
  fakeDoc = { activeElement: null, handlers: {}, created, getElementById: (id) => (ids[id] ??= new El(`#${id}`)), createElement: (t) => { created.push(t); return new El(t); }, createTextNode: (t) => new TextNode(t), addEventListener(e, f) { this.handlers[e] = f; } };
  globalThis.document = fakeDoc;
  globalThis.fetch = fetchStub;
  new Function(code)();
  await flush();
  ids.__doc = fakeDoc;
  return ids;
}

test('page: renders 5 lane columns, the done list and the attention list from a generated board.json', async () => {
  const repo = fixture();
  const site = tmp('lc-site-dom-');
  assert.equal(run(repo, '--site', site).status, 0);
  const data = JSON.parse(fs.readFileSync(path.join(site, 'board.json'), 'utf8'));
  const urls = [];
  const ids = await runPage(async (u) => { urls.push(u); return { ok: true, status: 200, json: async () => data }; });
  assert.equal(urls[0], 'board.json');
  assert.equal(ids.status.hidden, true, 'the loading state is gone');
  assert.equal(ids.board.hidden, false);
  assert.equal(ids.lanes.children.length, 4, 'backlog is not one of the lane columns');
  assert.deepEqual(ids.lanes.children.map((c) => c.children[0]._text), ['plan', 'implement', 'review', 'quality-gate']); // this fixture's workflow.json names plan and implement
  assert.deepEqual(ids.lanes.children.map((c) => c.children[1].children.length), [1, 1, 1, 1]);
  // The backlog is the last section and starts collapsed.
  assert.equal(ids['backlog-block'].hidden, false);
  assert.equal(ids['backlog-n'].textContent, '1');
  assert.equal(ids['backlog-toggle'].textContent, 'Show');
  assert.equal(ids['backlog-toggle'].attrs['aria-expanded'], 'false');
  assert.equal(ids['backlog-cards'].hidden, true);
  assert.equal(ids['backlog-cards'].children.length, 0, 'no backlog cards are built while collapsed');
  assert.equal(ids['done-rows'].children.length, 2);
  assert.equal(ids['done-n'].textContent, '2');
  assert.equal(ids['attn-rows'].children.length, 2);
  assert.equal(ids['attn-n'].textContent, '2');
  assert.equal(ids.proj.textContent, 'Page Fixture / 8 tracks');
  assert.ok(ids.lanes.textContent.includes(TITLE_SENTINEL));
  assert.ok(ids['attn-rows'].textContent.includes('waiting for a human reply'));
  // The search box filters; clearing it restores every card.
  ids.q.handlers.input({ target: { value: 'quokka' } });
  assert.deepEqual(ids.lanes.children.map((c) => c.children[1].children.length), [1, 0, 0, 0]);
  ids.q.handlers.input({ target: { value: '' } });
  assert.deepEqual(ids.lanes.children.map((c) => c.children[1].children.length), [1, 1, 1, 1]);
});

test('page: a failed fetch (network error, HTTP error, bad format) shows the error state and no board', async () => {
  const stubs = {
    network: async () => { throw new Error('offline'); },
    http: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    format: async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) }),
    sync_throw: () => { throw new Error('blocked'); },
  };
  for (const [name, stub] of Object.entries(stubs)) {
    const ids = await runPage(stub);
    assert.equal(ids.status.className, 'status error', name);
    assert.equal(ids.status.attrs.role, 'alert', name);
    assert.equal(ids.status.children[0].textContent, 'Could not load board.json', name);
    assert.ok(!ids.board || ids.board.hidden === true, name); // markup has #board hidden; the page never unhides it
    assert.equal(ids.lanes?.children.length ?? 0, 0, name);
  }
});

test('page: the loading state is in the markup and shown until the data arrives', async () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  assert.match(html, /id="status"[^>]*role="status"/);
  assert.match(html, /Loading the board/);
  assert.match(html, /id="board" hidden/);
  let release;
  const gate = new Promise((r) => { release = r; });
  const ids = await runPage(() => gate.then(() => { throw new Error('late'); }));
  assert.ok(!ids.status || ids.status.hidden === false, 'still loading');
  assert.ok(!ids.board || ids.board.hidden === true);
  release();
});

test('page: a status filter whose matches are all in Done explains where they are and opens the Done list', async () => {
  const dir = makeRepo();
  cleanup.push(dir);
  writeFile(dir, '.laneconductor.json', JSON.stringify({ project: { name: 'Done Shipped' } }));
  const t = (n, title, lane, status) => writeFile(dir, `conductor/tracks/AM-${n}-t${n}/index.md`, INDEX(n, title, { lane, status }));
  for (let n = 301; n <= 315; n++) t(n, `Shipped ${n}`, 'done', 'success'); // 15: more than the usual 12 rows
  t(321, 'Building', 'implement', 'running');
  commitAll(dir);
  const site = tmp('lc-site-donefail-');
  assert.equal(run(dir, '--site', site).status, 0);
  const data = JSON.parse(fs.readFileSync(path.join(site, 'board.json'), 'utf8'));
  assert.equal(data.attn.length, 0, 'shipped work (done:success) is not an attention item');

  const ids = await runPage(async () => ({ ok: true, status: 200, json: async () => data }));
  const html = fs.readFileSync(PAGE, 'utf8');

  // No filter: no banner, Done shows its usual 12 rows, with a Status column.
  assert.equal(ids['filter-banner'].hidden, true);
  assert.equal(ids['done-rows'].children.length, 12);
  assert.match(html, /<th>Status<\/th><th>Progress<\/th>/);
  assert.match(html, /<th>Status<\/th><th>Why<\/th>/);

  const chip = ids.chips.children.find((c) => c._text === 'success');
  assert.ok(chip, 'a success chip exists');
  chip.onclick();
  const banner = ids['filter-banner'];
  assert.equal(banner.hidden, false);
  assert.equal(banner.textContent, '15 tracks have status success: 15 in Done');
  const links = banner.children.filter((c) => c.tag === 'a');
  assert.deepEqual(links.map((a) => a.attrs.href), ['#done-block']);
  assert.ok(!/in lanes|Needs attention/.test(banner.textContent), 'only the places that hold matches are named');
  // Done opens to all 15 matches (not 12), each row with a status cell.
  assert.equal(ids['done-rows'].children.length, 15);
  const first = ids['done-rows'].children[0].children;
  assert.equal(first.length, 4, 'track, title, status, progress');
  assert.equal(first[2].children[0]._text, 'success');
  assert.equal(first[2].children[0].className, 'pill success');
  // Lane columns say "None here" and the banner explains where the matches are.
  const cols = ids.lanes.children;
  assert.equal(cols.length, 4);
  // Only the implement column holds a track (it does not match): it says "None here"; the others are plainly empty.
  assert.deepEqual(cols.map((c) => c.children[2]?._text), ['Empty.', 'None here', 'Empty.', 'Empty.']);
  assert.ok(!ids.lanes.textContent.includes('Nothing matches the filter'));

  // A lane match is counted separately: "running" matches one card in a lane and no Done row.
  ids.chips.children.find((c) => c._text === 'running').onclick();
  assert.equal(ids['filter-banner'].textContent, '1 track has status running: 1 in lanes');
  assert.equal(ids['done-rows'].children.length, 0);
  // Back to all: the banner goes away.
  ids.chips.children.find((c) => c._text === 'all').onclick();
  assert.equal(ids['filter-banner'].hidden, true);
});

// --- track detail (Phase 5d Task 7) -----------------------------------------------------------------

const SPEC_MD = [
  '# Spec heading', '', 'A paragraph with **bold**, *italic*, `inline code` and a [link](https://example.org/a).', 'Second line of the paragraph.', '',
  '- first', '- second', '  - nested', '', '1. one', '2. two', '',
  '- [x] done item', '- [ ] open item', '', '```js', 'const a = "<b>not bold</b>";', '```', '',
  '> quoted text', '', '---', '', '| col a | col b |', '|---|---|', '| 1 | 2 |', '',
].join('\n');
const walk = (e, fn) => { fn(e); for (const c of e.children ?? []) walk(c, fn); };
const all = (e, pred) => { const out = []; walk(e, (x) => { if (pred(x)) out.push(x); }); return out; };
const ev = (key, extra = {}) => ({ key, preventDefault() { this.prevented = true; }, ...extra });

function detailFixture({ board, remote = 'git@github.com:acme/widgets.git' } = {}) {
  const dir = makeRepo();
  cleanup.push(dir);
  writeFile(dir, '.laneconductor.json', JSON.stringify({ project: { name: 'Detail Fixture' }, ...(board ? { board } : {}) }));
  const t = (n, title, lane, status, extra) => writeFile(dir, `conductor/tracks/AM-${n}-t${n}/index.md`, INDEX(n, title, { lane, status, extra }));
  t(201, 'Planned one', 'plan', 'queue');
  t(202, 'Built one', 'implement', 'running', '**Phase**: Phase 2\n'.replace(/^/, ''));
  t(203, 'Shipped one', 'done', 'success');
  t(204, 'Parked one', 'backlog', 'queue');
  t(208, 'Odd lane', 'nowhere', 'queue');
  writeFile(dir, 'conductor/tracks/AM-201-t201/spec.md', SPEC_MD);
  writeFile(dir, 'conductor/tracks/AM-201-t201/plan.md', '# Plan 201\n\n- [ ] Task 1: do it\n');
  writeFile(dir, 'conductor/tracks/AM-201-t201/test.md', '# Tests 201\n');
  writeFile(dir, 'conductor/tracks/AM-201-t201/conversation.md', '> **human**: talk about 201\n');
  writeFile(dir, 'conductor/tracks/AM-202-t202/spec.md', `# Spec 202\n\nthe key is ${FAKES['Google API key']}\n`);
  writeFile(dir, 'conductor/tracks/AM-202-t202/plan.md', '# Plan 202\n');
  writeFile(dir, 'conductor/tracks/AM-203-t203/spec.md', '# Spec 203 DONE-SPEC-SENTINEL\n');
  commitAll(dir);
  if (remote) git(dir, 'remote', 'add', 'origin', remote);
  return dir;
}

/** Generates a site and returns the board.json data plus a fetch stub that serves the site's files and counts requests. */
function siteFor(repo) {
  const site = tmp('lc-site-detail-');
  const r = run(repo, '--site', site);
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(fs.readFileSync(path.join(site, 'board.json'), 'utf8'));
  const calls = [];
  const fetchStub = async (u) => {
    calls.push(u);
    if (u === 'board.json') return { ok: true, status: 200, json: async () => data };
    const f = path.join(site, u);
    if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) };
  };
  return { site, data, calls, fetchStub };
}
const cardOf = (ids, lane, i = 0) => {
  if (lane === 'backlog') {
    if (ids['backlog-cards'].hidden) ids['backlog-toggle'].onclick();
    return ids['backlog-cards'].children[i];
  }
  return ids.lanes.children[{ plan: 0, planning: 0, implement: 1, 'in-progress': 1, review: 2, 'quality-gate': 3 }[lane]].children[1].children[i];
};
const tabNames = (ids) => ids['d-tabs'].children.map((b) => b._text);
const tabBy = (ids, name) => ids['d-tabs'].children.find((b) => b._text === name);

test('detail: clicking a card opens the drawer with the header, Overview from docs/<n>.json, and moves focus into it', async () => {
  const { data, calls, fetchStub } = siteFor(detailFixture());
  const ids = await runPage(fetchStub);
  assert.ok(!ids.detail || ids.detail.hidden === true, 'closed at first (the markup has it hidden)');
  assert.match(fs.readFileSync(PAGE, 'utf8'), /<div class="detail" id="detail" hidden>/);
  const card = cardOf(ids, 'plan');
  assert.equal(card.attrs.role, 'button');
  assert.equal(card.attrs.tabindex, '0');
  card.handlers.click();
  assert.equal(ids.detail.hidden, false);
  assert.equal(ids.wrap.attrs.inert, '', 'the board behind the drawer is inert');
  assert.equal(ids['d-id'].textContent, 'AM-201');
  assert.equal(ids['d-title'].textContent, 'Planned one');
  assert.equal(ids['d-lane'].textContent, 'plan', 'the lane label is the workflow lane name');
  assert.equal(ids['d-pill'].children[0].className, 'pill queue');
  assert.equal(ids['d-pct'].textContent, '0%');
  assert.equal(ids['d-bar'].attrs.role, 'progressbar');
  assert.equal(ids.__doc.activeElement, ids['d-close']);
  assert.match(ids['d-body'].textContent, /Loading the document/);
  await flush();
  assert.deepEqual(tabNames(ids), ['Overview', 'Plan', 'Spec', 'Tests']);
  assert.equal(tabBy(ids, 'Overview').attrs['aria-selected'], 'true');
  assert.ok(ids['d-body'].textContent.includes('Track AM-201: Planned one'));
  assert.deepEqual(calls.filter((u) => u.startsWith('docs/')), ['docs/201.json']);
  assert.equal(data.tracks.find((t) => t.n === 201).d, true);
});

test('detail: Enter and Space on a card open it; done rows and attention rows are buttons too', async () => {
  const { fetchStub } = siteFor(detailFixture());
  const ids = await runPage(fetchStub);
  const card = cardOf(ids, 'implement');
  const e1 = ev('Enter');
  card.handlers.keydown(e1);
  assert.equal(e1.prevented, true);
  assert.equal(ids['d-title'].textContent, 'Built one');
  ids['d-close'].onclick();
  assert.equal(ids.detail.hidden, true);
  const e2 = ev(' ');
  cardOf(ids, 'backlog').handlers.keydown(e2);
  assert.equal(ids['d-title'].textContent, 'Parked one');
  ids['d-close'].onclick();
  const other = ev('a');
  card.handlers.keydown(other);
  assert.equal(ids.detail.hidden, true, 'other keys do nothing');
  assert.equal(other.prevented, undefined);
  // A done row and an attention row.
  const row = ids['done-rows'].children[0];
  assert.equal(row.attrs.role, 'button');
  assert.equal(row.attrs.tabindex, '0');
  row.handlers.click();
  assert.equal(ids['d-title'].textContent, 'Shipped one');
  ids['d-close'].onclick();
  const attn = ids['attn-rows'].children[0];
  assert.equal(attn.attrs.role, 'button');
  attn.handlers.keydown(ev('Enter'));
  assert.equal(ids['d-title'].textContent, 'Odd lane');
  assert.equal(ids['d-lane'].textContent, 'nowhere');
});

test('detail: tabs switch, each shows its document, and docs/<n>.json is fetched once (cached across tabs and reopening)', async () => {
  const { calls, fetchStub } = siteFor(detailFixture());
  const ids = await runPage(fetchStub);
  cardOf(ids, 'plan').handlers.click();
  await flush();
  tabBy(ids, 'Plan').onclick();
  assert.match(ids['d-body'].textContent, /Loading the document/, 'a loading state while the file is pending');
  await flush();
  assert.equal(tabBy(ids, 'Plan').attrs['aria-selected'], 'true');
  assert.equal(tabBy(ids, 'Overview').attrs['aria-selected'], 'false');
  assert.ok(ids['d-body'].textContent.includes('Plan 201'));
  tabBy(ids, 'Spec').onclick();
  await flush();
  assert.ok(ids['d-body'].textContent.includes('Spec heading'));
  tabBy(ids, 'Tests').onclick();
  await flush();
  assert.ok(ids['d-body'].textContent.includes('Tests 201'));
  tabBy(ids, 'Overview').onclick();
  await flush();
  ids['d-close'].onclick();
  cardOf(ids, 'plan').handlers.click();
  await flush();
  tabBy(ids, 'Spec').onclick();
  await flush();
  assert.deepEqual(calls.filter((u) => u.startsWith('docs/')), ['docs/201.json'], 'one fetch for all of that');
  // Arrow keys move between tabs.
  const right = ev('ArrowRight');
  tabBy(ids, 'Spec').handlers.keydown(right);
  await flush();
  assert.equal(tabBy(ids, 'Tests').attrs['aria-selected'], 'true');
  assert.equal(right.prevented, true);
});

test('detail: the Conversation tab exists only when the doc has one (off by default)', async () => {
  const off = siteFor(detailFixture());
  let ids = await runPage(off.fetchStub);
  cardOf(ids, 'plan').handlers.click();
  await flush();
  assert.ok(!tabNames(ids).includes('Conversation'));
  const on = siteFor(detailFixture({ board: { include_conversation: true } }));
  ids = await runPage(on.fetchStub);
  cardOf(ids, 'plan').handlers.click();
  await flush();
  assert.deepEqual(tabNames(ids), ['Overview', 'Plan', 'Spec', 'Tests', 'Conversation']);
  tabBy(ids, 'Conversation').onclick();
  await flush();
  assert.ok(ids['d-body'].textContent.includes('talk about 201'));
  // The track without a conversation file has no tab even with the flag on.
  ids['d-close'].onclick();
  cardOf(ids, 'implement').handlers.click();
  await flush();
  assert.ok(!tabNames(ids).includes('Conversation'));
});

test('detail: a withheld file shows "withheld: <reason>" and never the text; the other tabs still render', async () => {
  const { fetchStub, site } = siteFor(detailFixture());
  const ids = await runPage(fetchStub);
  cardOf(ids, 'implement').handlers.click();
  await flush();
  tabBy(ids, 'Spec').onclick();
  await flush();
  assert.ok(ids['d-body'].textContent.includes('withheld: possible secret or personal data (1 match)'));
  assert.ok(!ids['d-body'].textContent.includes(FAKES['Google API key']));
  assert.ok(!fs.readFileSync(path.join(site, 'docs/202.json'), 'utf8').includes(FAKES['Google API key']));
  tabBy(ids, 'Plan').onclick();
  await flush();
  assert.ok(ids['d-body'].textContent.includes('Plan 202'));
  assert.ok(!ids['d-body'].textContent.includes('withheld'));
  // An absent file says so.
  tabBy(ids, 'Tests').onclick();
  await flush();
  assert.match(ids['d-body'].textContent, /No test\.md in this track/);
});

test('detail: a done track has no tabs and no fetch, a note, and an Open in GitHub link (https, new tab, noopener)', async () => {
  const { calls, fetchStub } = siteFor(detailFixture());
  const ids = await runPage(fetchStub);
  ids['done-rows'].children[0].handlers.click();
  await flush();
  assert.equal(ids['d-tabs'].hidden, true);
  assert.deepEqual(calls.filter((u) => u.startsWith('docs/')), []);
  assert.match(ids['d-body'].textContent, /Finished tracks do not carry their documents/);
  const links = all(ids['d-body'], (e) => e.tag === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].textContent, 'Open in GitHub');
  assert.equal(links[0].attrs.href, 'https://github.com/acme/widgets/tree/main/conductor/tracks/AM-203-t203');
  assert.equal(links[0].attrs.target, '_blank');
  assert.match(links[0].attrs.rel, /\bnoopener\b/);
  assert.ok(!ids['d-body'].textContent.includes('DONE-SPEC-SENTINEL'));
  // Without a github remote there is no link, only the note. A non-https gh value is never linked.
  const nogh = siteFor(detailFixture({ remote: null }));
  const ids2 = await runPage(nogh.fetchStub);
  ids2['done-rows'].children[0].handlers.click();
  assert.equal(all(ids2['d-body'], (e) => e.tag === 'a').length, 0);
  assert.match(ids2['d-body'].textContent, /Finished tracks do not carry/);
  const bad = JSON.parse(JSON.stringify(nogh.data));
  bad.tracks.find((t) => t.n === 203).gh = 'javascript:evil()';
  const ids3 = await runPage(async (u) => ({ ok: true, status: 200, json: async () => bad }));
  ids3['done-rows'].children[0].handlers.click();
  assert.equal(all(ids3['d-body'], (e) => e.tag === 'a').length, 0);
});

test('detail: with board.include_docs false the drawer shows the header only', async () => {
  const { calls, fetchStub } = siteFor(detailFixture({ board: { include_docs: false } }));
  const ids = await runPage(fetchStub);
  cardOf(ids, 'plan').handlers.click();
  await flush();
  assert.equal(ids['d-title'].textContent, 'Planned one');
  assert.equal(ids['d-tabs'].hidden, true);
  assert.deepEqual(calls.filter((u) => u.startsWith('docs/')), []);
  assert.match(ids['d-body'].textContent, /does not publish documents/);
});

test('detail: a failed or malformed docs fetch shows an error with Try again; success afterwards is not blocked by a cached failure', async () => {
  const { data } = siteFor(detailFixture());
  let mode = 'http';
  let docFetches = 0;
  const ids = await runPage(async (u) => {
    if (u === 'board.json') return { ok: true, status: 200, json: async () => data };
    docFetches++;
    if (mode === 'http') return { ok: false, status: 500, json: async () => ({}) };
    if (mode === 'format') return { ok: true, status: 200, json: async () => ({ n: 999 }) };
    if (mode === 'throw') throw new Error('offline');
    return { ok: true, status: 200, json: async () => ({ n: 201, folder: 'x', index: 'recovered text', plan: '', spec: '', test: '' }) };
  });
  const card = cardOf(ids, 'plan');
  for (const m of ['http', 'format', 'throw']) {
    mode = m;
    card.handlers.click();
    await flush();
    assert.equal(ids['d-body'].children[0].className, 'status error', m);
    assert.match(ids['d-body'].textContent, /Could not load docs\/201\.json/, m);
    ids['d-close'].onclick();
  }
  assert.equal(docFetches, 3, 'a failure is not cached');
  mode = 'ok';
  card.handlers.click();
  await flush();
  const retry = all(ids['d-body'], (e) => e.tag === 'button')[0];
  assert.equal(retry, undefined, 'no error state once it loads');
  assert.ok(ids['d-body'].textContent.includes('recovered text'));
  mode = 'http';
  ids['d-close'].onclick();
  const { fetchStub } = siteFor(detailFixture());
  // Try again re-requests.
  let n2 = 0;
  const ids2 = await runPage(async (u) => { if (u === 'board.json') return fetchStub(u); n2++; return n2 === 1 ? { ok: false, status: 503, json: async () => ({}) } : fetchStub(u); });
  cardOf(ids2, 'plan').handlers.click();
  await flush();
  const again = all(ids2['d-body'], (e) => e.tag === 'button')[0];
  assert.equal(again._text, 'Try again');
  again.onclick();
  await flush();
  assert.ok(ids2['d-body'].textContent.includes('Track AM-201'));
});

test('detail: Esc and Close both close it, the board is no longer inert, and focus returns to the clicked element', async () => {
  const { fetchStub } = siteFor(detailFixture());
  const ids = await runPage(fetchStub);
  const card = cardOf(ids, 'plan');
  card.focus();
  card.handlers.click();
  await flush();
  assert.equal(ids.__doc.activeElement, ids['d-close']);
  const esc = ev('Escape');
  ids.__doc.handlers.keydown(esc);
  assert.equal(esc.prevented, true);
  assert.equal(ids.detail.hidden, true);
  assert.ok(!('inert' in ids.wrap.attrs));
  assert.equal(ids.__doc.activeElement, card);
  // Close button and backdrop.
  const row = ids['done-rows'].children[0];
  row.handlers.click();
  ids['d-close'].onclick();
  assert.equal(ids.detail.hidden, true);
  assert.equal(ids.__doc.activeElement, row);
  cardOf(ids, 'backlog').handlers.click();
  ids['detail-back'].handlers.click();
  assert.equal(ids.detail.hidden, true);
  // Esc with nothing open does nothing.
  const idle = ev('Escape');
  ids.__doc.handlers.keydown(idle);
  assert.equal(idle.prevented, undefined);
  // The focus goes back to the redrawn element if the list was redrawn while the drawer was open.
  const before = cardOf(ids, 'plan');
  before.handlers.click();
  ids.q.handlers.input({ target: { value: 'planned' } });
  ids.__doc.handlers.keydown(ev('Escape'));
  assert.equal(ids.__doc.activeElement, cardOf(ids, 'plan'));
});

test('detail: focus is trapped while open (Tab wraps at the ends, Shift+Tab too)', async () => {
  const { fetchStub } = siteFor(detailFixture());
  const ids = await runPage(fetchStub);
  cardOf(ids, 'plan').handlers.click();
  await flush();
  const selected = tabBy(ids, 'Overview');
  // [close, selected tab]: Tab on the last wraps to the first, Shift+Tab on the first wraps to the last.
  ids.__doc.activeElement = selected;
  const fwd = ev('Tab');
  ids.__doc.handlers.keydown(fwd);
  assert.equal(fwd.prevented, true);
  assert.equal(ids.__doc.activeElement, ids['d-close']);
  const back = ev('Tab', { shiftKey: true });
  ids.__doc.handlers.keydown(back);
  assert.equal(back.prevented, true);
  assert.equal(ids.__doc.activeElement, selected);
  // Tab in the middle is left to the browser.
  ids.__doc.activeElement = ids['d-close'];
  const mid = ev('Tab');
  ids.__doc.handlers.keydown(mid);
  assert.equal(mid.prevented, undefined);
  // Focus that escaped the drawer is pulled back in.
  ids.__doc.activeElement = cardOf(ids, 'plan');
  const lost = ev('Tab');
  ids.__doc.handlers.keydown(lost);
  assert.equal(ids.__doc.activeElement, ids['d-close']);
  // Links inside a document join the cycle.
  tabBy(ids, 'Spec').onclick();
  await flush();
  tabBy(ids, 'Spec').focus();
  const link = all(ids['d-body'], (e) => e.tag === 'a')[0];
  assert.ok(link);
  ids.__doc.activeElement = link;
  ids.__doc.handlers.keydown(ev('Tab'));
  assert.equal(ids.__doc.activeElement, ids['d-close'], 'Tab on the last link wraps');
});

test('detail: the markdown renderer builds headings, lists, task items, code, quotes, rules and tables, with no raw html', async () => {
  const { fetchStub } = siteFor(detailFixture());
  const ids = await runPage(fetchStub);
  cardOf(ids, 'plan').handlers.click();
  await flush();
  tabBy(ids, 'Spec').onclick();
  await flush();
  const md = ids['d-body'].children[0];
  assert.equal(md.className, 'md');
  const tags = (e) => all(e, (x) => x.tag).map((x) => x.tag);
  const t = tags(md);
  for (const want of ['h3', 'p', 'strong', 'em', 'code', 'a', 'br', 'ul', 'ol', 'li', 'pre', 'blockquote', 'hr', 'table', 'th', 'td']) assert.ok(t.includes(want), `renders ${want}`);
  assert.equal(all(md, (x) => x.tag === 'h3')[0].textContent, 'Spec heading');
  assert.equal(all(md, (x) => x.tag === 'strong')[0].textContent, 'bold');
  assert.equal(all(md, (x) => x.tag === 'a')[0].attrs.href, 'https://example.org/a');
  const lis = all(md, (x) => x.tag === 'li');
  assert.ok(lis.some((l) => l.className === 'task on' && l.textContent === '[x]done item'));
  assert.ok(lis.some((l) => l.className === 'task' && l.textContent === '[ ]open item'));
  assert.equal(all(md, (x) => x.tag === 'ul').length, 3, 'two lists plus the nested one (the task list is a third)');
  assert.ok(all(md, (x) => x.tag === 'pre')[0].textContent.includes('const a = "<b>not bold</b>";'), 'code text is literal');
  assert.ok(!t.includes('b'), 'the <b> inside the code block is text, not an element');
  assert.deepEqual(all(md, (x) => x.tag === 'th').map((x) => x.textContent), ['col a', 'col b']);
  assert.deepEqual(all(md, (x) => x.tag === 'td').map((x) => x.textContent), ['1', '2']);
  assert.ok(!ids.__doc.created.includes('script'));
  // The page itself never uses an html-string API.
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/.test(fs.readFileSync(PAGE, 'utf8')));
});

test('detail XSS: script tags, img onerror and javascript: links in a document render as inert text; no element is made for them', async () => {
  const hostile = [
    '# Title <script>steal(1)</script>',
    '', '<img src=x onerror=steal(2)>',
    '', '<iframe src="https://evil.example"></iframe> <svg onload=steal(3)>',
    '', '[click me](javascript:steal(4)) and [data](data:text/html,<b>x</b>) and [mixed](JaVaScRiPt:steal(5)) and [rel](spec.md) and [http](http://plain.example)',
    '', '[good](https://example.org/ok "title") and <https://example.org/auto> and https://example.org/bare.',
    '', '![pic](https://evil.example/p.png) ![x](javascript:steal(6))',
    '', '`<b>code</b>`',
    '', '| h1 | h2 |', '|---|---|', '| <i>x</i> | [j](javascript:steal(7)) |',
    '', '> <u onmouseover=steal(8)>q</u>',
    '', '- <a href="javascript:steal(9)">raw anchor</a>',
    '', '[nested [brackets] ](javascript:steal(10))', '[![img](https://e.example/i.png)](javascript:steal(11))',
  ].join('\n');
  const data = { project: 'p', generated_at: NOW, attn: [], tracks: [{ n: 1, p: 'AM', t: 'Hostile', l: 'plan', s: 'queue', g: 0, h: '', a: false, d: true }] };
  const ids = await runPage(async (u) => (u === 'board.json'
    ? { ok: true, status: 200, json: async () => data }
    : { ok: true, status: 200, json: async () => ({ n: 1, folder: 'AM-1-x', index: hostile, plan: '', spec: '', test: '' }) }));
  ids.__doc.created.length = 0;
  cardOf(ids, 'plan').handlers.click();
  await flush();
  const body = ids['d-body'];
  const text = body.textContent;
  assert.ok(text.includes('<script>steal(1)</script>'), 'the tag is shown as text');
  assert.ok(text.includes('<img src=x onerror=steal(2)>'));
  assert.ok(text.includes('<iframe'));
  assert.ok(text.includes('raw anchor'));
  // No element for any tag in the document: only the tags the renderer itself uses.
  const allowed = new Set(['div', 'h3', 'p', 'br', 'a', 'code', 'pre', 'strong', 'em', 'ul', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'button', 'i']);
  for (const tag of ids.__doc.created) assert.ok(allowed.has(tag), `unexpected element <${tag}>`);
  for (const bad of ['script', 'img', 'iframe', 'svg', 'u', 'b', 'object', 'embed', 'style', 'link']) assert.ok(!ids.__doc.created.includes(bad), `no <${bad}> created`);
  // Only the https links became anchors, and nothing carries an event handler or a script URL.
  const anchors = all(body, (e) => e.tag === 'a');
  assert.deepEqual(anchors.map((a) => a.attrs.href).sort(), ['https://example.org/auto', 'https://example.org/bare', 'https://example.org/ok'].sort());
  for (const a of anchors) { assert.equal(a.attrs.target, '_blank'); assert.match(a.attrs.rel, /noopener/); }
  walk(body, (e) => {
    for (const [k, v] of Object.entries(e.attrs ?? {})) {
      assert.ok(!/^on/i.test(k), `no ${k} attribute`);
      assert.ok(!/javascript:|data:/i.test(v), `no script url in ${k}`);
    }
    assert.ok(!('onerror' in e) && !('onload' in e));
  });
  // The link text of a refused link stays as plain text.
  assert.ok(text.includes('click me') && text.includes('mixed') && text.includes('rel') && text.includes('http'));
  assert.ok(!all(body, (e) => e.tag === 'a' && /click me|mixed/.test(e.textContent)).length);
});

test('detail: search matches titles only, never document bodies', async () => {
  const { fetchStub } = siteFor(detailFixture());
  const ids = await runPage(fetchStub);
  ids.q.handlers.input({ target: { value: 'DONE-SPEC-SENTINEL' } });
  assert.equal(ids.lanes.children.reduce((n, c) => n + c.children[1].children.length, 0), 0);
  ids.q.handlers.input({ target: { value: 'Spec heading' } });
  assert.equal(ids.lanes.children.reduce((n, c) => n + c.children[1].children.length, 0), 0);
  ids.q.handlers.input({ target: { value: 'planned' } });
  assert.equal(ids.lanes.children.reduce((n, c) => n + c.children[1].children.length, 0), 1);
});

test('page markup: a dialog with a labelled title, tabs container, the privacy footer line, and the drawer is outside the inert wrapper', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  assert.match(html, /<section class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="d-title">/);
  assert.match(html, /id="d-tabs" role="tablist"/);
  assert.match(html, /id="d-body" role="tabpanel"/);
  assert.match(html, /Sharing the board shares these documents, including the project definition files\./);
  assert.ok(html.indexOf('id="detail"') > html.indexOf('</footer>'), 'the detail is after (outside) the .wrap block that gets inert');
  assert.match(html, /@media \(max-width: 700px\)[\s\S]*?\.drawer \{ width: 100%/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.match(html, /:root\[data-theme="dark"\]/);
  assert.ok(!/https?:\/\/(?!fonts\.g)[^"' )]*\.(?:js|css)\b/.test(html), 'no external script or stylesheet beyond the fonts');
});

test('backlog: last, collapsed by default, Show and Hide work and are remembered; a search or a matching status filter opens it', async () => {
  const { fetchStub } = siteFor(detailFixture());
  const store = {};
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  try {
    const ids = await runPage(fetchStub);
    assert.equal(ids['backlog-cards'].hidden, true);
    assert.equal(ids['backlog-toggle'].textContent, 'Show');
    ids['backlog-toggle'].onclick();
    assert.equal(ids['backlog-cards'].hidden, false);
    assert.equal(ids['backlog-toggle'].textContent, 'Hide');
    assert.equal(ids['backlog-toggle'].attrs['aria-expanded'], 'true');
    assert.equal(ids['backlog-cards'].children.length, 1);
    assert.equal(store['lc-board-backlog'], '1', 'the choice is remembered');
    ids['backlog-toggle'].onclick();
    assert.equal(ids['backlog-cards'].hidden, true);
    assert.equal(store['lc-board-backlog'], '0');
    // A search that matches a backlog track opens it for that view only.
    ids.q.handlers.input({ target: { value: 'Parked' } });
    assert.equal(ids['backlog-cards'].hidden, false);
    assert.equal(ids['backlog-cards'].children.length, 1);
    ids.q.handlers.input({ target: { value: '' } });
    assert.equal(ids['backlog-cards'].hidden, true, 'closed again once the search is cleared');
    // A search with no backlog match leaves it collapsed.
    ids.q.handlers.input({ target: { value: 'zzzz-nothing' } });
    assert.equal(ids['backlog-cards'].hidden, true);
  } finally { delete globalThis.localStorage; }
});

test('backlog: the section is hidden when there are no backlog tracks, and the summary lists backlog last', async () => {
  const { data } = siteFor(detailFixture());
  const noBacklog = { ...data, tracks: data.tracks.filter((t) => t.l !== 'backlog') };
  const ids = await runPage(async () => ({ ok: true, status: 200, json: async () => noBacklog }));
  assert.equal(ids['backlog-block'].hidden, true);
  const labels = (await runPage(async () => ({ ok: true, status: 200, json: async () => data }))).summary.children.map((c) => c.children[1]._text);
  assert.equal(labels[labels.length - 1], 'in backlog');
});

// --- lanes follow the workflow (otralingo: tracks in planning / in-progress were not drawn) ---------------------------------

function laneFixture(rows, wfLanes) {
  const dir = makeRepo({ workflow: false });
  cleanup.push(dir);
  writeFile(dir, '.laneconductor.json', JSON.stringify({ project: { name: 'Lanes' } }));
  if (wfLanes) writeFile(dir, 'conductor/workflow.json', JSON.stringify({ lanes: Object.fromEntries(wfLanes.map((l) => [l, {}])) }));
  for (const [n, lane, status] of rows) writeFile(dir, `conductor/tracks/AM-${n}-t${n}/index.md`, INDEX(n, `Track ${n}`, { lane, status }));
  commitAll(dir);
  const site = tmp('lc-site-lanes-');
  assert.equal(run(dir, '--site', site).status, 0);
  return JSON.parse(fs.readFileSync(path.join(site, 'board.json'), 'utf8'));
}
const statsOf = (ids) => Object.fromEntries(ids.summary.children.map((s) => [s.children[1]._text, Number(s.children[0]._text)]));

test('page: tracks in the workflow lanes planning and in-progress are drawn, counted and in the flow bar; no legacy columns', async () => {
  const data = laneFixture([[1, 'planning', 'queue'], [2, 'planning', 'running'], [3, 'in-progress', 'running'], [4, 'review', 'queue'], [5, 'quality-gate', 'queue'], [6, 'backlog', 'queue'], [7, 'done', 'success']],
    ['planning', 'backlog', 'in-progress', 'review', 'quality-gate', 'done']);
  const ids = await runPage(async () => ({ ok: true, status: 200, json: async () => data }));
  assert.deepEqual(ids.lanes.children.map((c) => c.children[0]._text), ['planning', 'in-progress', 'review', 'quality-gate']);
  assert.deepEqual(ids.lanes.children.map((c) => c.children[1].children.length), [2, 1, 1, 1]);
  const s = statsOf(ids);
  assert.equal(s['in progress'], 3, 'in-progress + review + quality-gate');
  assert.equal(s['being planned'], 2);
  const flowTitles = ids.flow.children.map((i) => i.title);
  assert.deepEqual(flowTitles, ['planning: 2', 'in-progress: 1', 'review: 1', 'quality-gate: 1', 'done: 1', 'backlog: 1']);
});

test('page: legacy plan and implement lanes still display, under planning and in-progress', async () => {
  const data = laneFixture([[1, 'plan', 'queue'], [2, 'implement', 'running'], [3, 'planning', 'queue'], [4, 'in-progress', 'running']]);
  const ids = await runPage(async () => ({ ok: true, status: 200, json: async () => data }));
  const names = ids.lanes.children.map((c) => c.children[0]._text);
  assert.deepEqual(names, ['planning', 'in-progress', 'review', 'quality-gate']);
  assert.ok(!names.includes('plan') && !names.includes('implement'));
  assert.deepEqual(ids.lanes.children.map((c) => c.children[1].children.length), [2, 2, 0, 0]);
  const s = statsOf(ids);
  assert.equal(s['in progress'], 2);
  assert.equal(s['being planned'], 2);
  assert.deepEqual(ids.flow.children.map((i) => i.title), ['planning: 2', 'in-progress: 2']);
});

// --- the columns come from the project's workflow.json (board.json `lanes`) --------------------------------------------------

test('boardPageData: carries the lanes it is given, else the default workflow lanes', () => {
  const b = buildBoard([], { generatedAt: NOW, project: 'p' });
  assert.deepEqual(boardPageData(b).lanes, ['backlog', 'planning', 'in-progress', 'review', 'quality-gate', 'done']);
  assert.deepEqual(boardPageData(b, { lanes: ['x', 'y', 'done'] }).lanes, ['x', 'y', 'done']);
});

test('lc board writes the workflow.json lane order into board.json; a missing workflow gets the default lanes', () => {
  const wf = ['planning', 'backlog', 'in-progress', 'review', 'quality-gate', 'done']; // the Otralingo order
  assert.deepEqual(laneFixture([[1, 'planning', 'queue']], wf).lanes, wf);
  assert.deepEqual(laneFixture([[1, 'planning', 'queue']]).lanes, ['backlog', 'planning', 'in-progress', 'review', 'quality-gate', 'done']);
});

test('page: a project with custom lanes gets exactly those columns; first column is "being planned", the rest are "in progress"', async () => {
  const data = laneFixture([[1, 'ideas', 'queue'], [2, 'build', 'running'], [3, 'build', 'queue'], [4, 'test', 'queue'], [5, 'backlog', 'queue'], [6, 'done', 'success']],
    ['ideas', 'build', 'test', 'done']);
  const ids = await runPage(async () => ({ ok: true, status: 200, json: async () => data }));
  assert.deepEqual(ids.lanes.children.map((c) => c.children[0]._text), ['ideas', 'build', 'test']);
  assert.deepEqual(ids.lanes.children.map((c) => c.children[1].children.length), [1, 2, 1]);
  const s = statsOf(ids);
  assert.equal(s['in progress'], 3);
  assert.equal(s['being planned'], 1);
  assert.deepEqual(ids.flow.children.map((i) => i.title), ['ideas: 1', 'build: 2', 'test: 1', 'done: 1', 'backlog: 1']);
});

test('page: a workflow that itself names the lanes plan and implement keeps them as columns (no mapping)', async () => {
  const data = laneFixture([[1, 'plan', 'queue'], [2, 'implement', 'running']], ['plan', 'implement', 'review', 'done']);
  const ids = await runPage(async () => ({ ok: true, status: 200, json: async () => data }));
  assert.deepEqual(ids.lanes.children.map((c) => c.children[0]._text), ['plan', 'implement', 'review']);
  assert.deepEqual(ids.lanes.children.map((c) => c.children[1].children.length), [1, 1, 0]);
});

test('page: an older board.json without `lanes` still renders with the default workflow lanes', async () => {
  const data = laneFixture([[1, 'plan', 'queue'], [2, 'in-progress', 'running']]);
  delete data.lanes;
  const ids = await runPage(async () => ({ ok: true, status: 200, json: async () => data }));
  assert.deepEqual(ids.lanes.children.map((c) => c.children[0]._text), ['planning', 'in-progress', 'review', 'quality-gate']);
  assert.deepEqual(ids.lanes.children.map((c) => c.children[1].children.length), [1, 1, 0, 0]);
});

test('page: the drawer shows the workflow lane name for a track still carrying a legacy lane', async () => {
  const data = laneFixture([[1, 'implement', 'running']]);
  const ids = await runPage(async (u) => (u === 'board.json' ? { ok: true, status: 200, json: async () => data } : { ok: false, status: 404, json: async () => ({}) }));
  ids.lanes.children[1].children[1].children[0].handlers.click();
  await flush();
  assert.equal(ids['d-lane'].textContent, 'in-progress');
});

// --- card actions (track AM-10115): the next step with a Copy button; a Move menu only where the local connector is reachable ----

const ACT_LANES = ['backlog', 'plan', 'implement', 'review', 'quality-gate', 'done'];
const ACT_WF = { lanes: { plan: { on_success: 'plan:success' }, implement: { on_success: 'review:queue' }, review: { on_success: 'quality-gate:queue' }, 'quality-gate': { on_success: 'done:queue' }, done: {} } };
function actionData(rows) {
  const entries = rows.map(([n, lane, status, extra]) => ({ folder: `AM-${n}-t${n}`, index: { content: INDEX(n, `Title ${n}`, { lane, status, extra: extra ?? '' }) } }));
  return boardPageData(buildBoard(entries, { lanes: ACT_LANES, generatedAt: NOW, project: 'Act', workflow: ACT_WF }), { lanes: ACT_LANES });
}
const stubs = [];
function stubGlobal(name, value) {
  const d = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  stubs.push(() => { if (d) Object.defineProperty(globalThis, name, d); else delete globalThis[name]; });
}
const unstub = () => { while (stubs.length) stubs.pop()(); };
after(unstub);
const fakeEv = (key) => ({ key, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {} });
const cls = (name) => (x) => String(x.className).split(' ').includes(name);
const cardN = (ids, n) => all(ids.lanes, (x) => cls('card')(x) && x.attrs['aria-label']?.startsWith(`AM-${n}:`))[0];
const BASE = { commit: 'c0ffee', files: { index: 'aaa' }, markers: { Lane: 'plan', 'Lane Status': 'queue' } };
const okTrack = { payload: { ok: true, data: { base: BASE } } };
const toolError = (code, message = 'x') => Object.assign(new Error(message), { code: 'tool_error', result: { structuredContent: { ok: false, error: { code, message } } } });

/** A stand-in for the artifact runtime's `claude`: `use('mcp')` resolves the namespace, `listTools` lists `servers`, `callTool` is `handler(tool, input)`. */
function fakeClaude({ servers, handler = async () => okTrack }) {
  const log = { use: [], listTools: [], calls: [] };
  const mcp = {
    listTools: async (s) => { log.listTools.push(s); return { servers }; },
    callTool: async (server, tool, input) => { log.calls.push([server, tool, input]); return handler(tool, input); },
  };
  return { log, claude: { use: async (n) => { log.use.push(n); return mcp; } } };
}
const HOST = 'host:plugin_laneconductor-parallel_lc';
const REACHABLE = [{ server: HOST, authStatus: 'unknown', tools: [{ name: 'get_track' }, { name: 'update_track' }] }];
const moveBtns = (root) => all(root, cls('mvbtn'));
const dataFor = () => actionData([[201, 'plan', 'queue'], [202, 'implement', 'running'], [203, 'done', 'success'], [204, 'review', 'waiting', '**Waiting for reply**: yes\n'], [205, 'backlog', 'queue'], [208, 'nowhere', 'queue']]);
const serve = (data) => async () => ({ ok: true, status: 200, json: async () => data });
/** Opens the Move menu of `card`, picks `lane` and, unless `confirm` is false, confirms. */
async function moveVia(card, lane, { confirm = true } = {}) {
  moveBtns(card)[0].handlers.click(fakeEv('x')); await flush();
  all(card, cls('mvopt')).find((o) => o._text === lane).handlers.click(fakeEv('x'));
  if (confirm) { all(card, cls('mvgo'))[0].handlers.click(fakeEv('x')); await flush(); }
}

test('actions: cards, Needs-attention rows and the drawer header show the reason and the exact command; no Move without the capability', async () => {
  const ids = await runPage(serve(dataFor()));
  const c201 = cardN(ids, 201);
  assert.ok(c201.textContent.includes('/laneconductor:plan 201'));
  assert.ok(c201.textContent.includes('ready to plan'));
  assert.ok(cardN(ids, 202).textContent.includes('running; nothing to do'));
  assert.equal(all(cardN(ids, 202), cls('actc')).length, 0, 'no command, so no command Copy button (only Discuss)');
  assert.ok(ids['attn-rows'].textContent.includes('/laneconductor:comment 204 <your reply>'));
  assert.ok(ids['attn-rows'].children.every((r) => r.children.length === 5), 'the Needs-attention rows have a Next step column');
  ids['backlog-toggle'].onclick();
  assert.ok(ids['backlog-cards'].textContent.includes('parked in the backlog'));
  assert.equal(moveBtns(ids.lanes).length + moveBtns(ids['attn-rows']).length, 0, 'no `claude` runtime: no Move anywhere, and no message about it');
  assert.ok(!/desktop app/.test(ids.board.textContent));
  c201.handlers.click();
  await flush();
  assert.ok(ids['d-act'].textContent.includes('/laneconductor:plan 201'), 'the drawer header shows it too');
  assert.equal(moveBtns(ids['d-act']).length, 0);
});

test('actions: Copy calls navigator.clipboard.writeText inside the click handler, says Copied, and does not open the card', async () => {
  const written = [];
  stubGlobal('navigator', { clipboard: { writeText(t) { written.push(t); return Promise.resolve(); } } });
  try {
    const ids = await runPage(serve(dataFor()));
    const card = cardN(ids, 201);
    const btn = all(card, cls('copy'))[0];
    assert.equal(btn.attrs['aria-label'], 'Copy the command for AM-201: /laneconductor:plan 201');
    assert.equal(btn._text, 'Copy');
    const e = fakeEv('x');
    btn.handlers.click(e);
    assert.deepEqual(written, ['/laneconductor:plan 201'], 'the write is made synchronously, in the click');
    assert.equal(e.stopped, true, 'the click does not open the details');
    await flush();
    const note = all(card, cls('copied'))[0];
    assert.equal(note.textContent, 'Copied');
    assert.equal(note.attrs.role, 'status');
    const k = fakeEv('Enter'); btn.handlers.keydown(k); assert.equal(k.stopped, true, 'Enter on the button does not open the card');
    const esc = fakeEv('Escape'); btn.handlers.keydown(esc); assert.equal(esc.stopped, false, 'Escape still reaches the drawer handler');
  } finally { unstub(); }
});

test('actions: a refused clipboard write falls back to selecting the command text', async () => {
  const sel = {};
  stubGlobal('navigator', { clipboard: { writeText() { return Promise.reject(new Error('NotAllowedError')); } } });
  stubGlobal('window', { getSelection: () => ({ removeAllRanges() { sel.cleared = true; }, addRange(r) { sel.range = r; } }) });
  try {
    const ids = await runPage(serve(dataFor()));
    ids.__doc.createRange = () => ({ selectNodeContents(n) { sel.node = n; } });
    const card = cardN(ids, 201);
    all(card, cls('copy'))[0].handlers.click(fakeEv('x'));
    await flush();
    assert.equal(sel.node, all(card, cls('actc'))[0], 'the command element is selected');
    assert.equal(sel.cleared, true);
    assert.equal(all(card, cls('copied'))[0].textContent, 'Selected; press Ctrl+C to copy');
  } finally { unstub(); }
});

test('actions: no clipboard API and no selection API at all: no error, and the page says what to do', async () => {
  stubGlobal('navigator', {});
  try {
    const ids = await runPage(serve(dataFor()));
    const card = cardN(ids, 201);
    all(card, cls('copy'))[0].handlers.click(fakeEv('x'));
    await flush();
    assert.match(all(card, cls('copied'))[0].textContent, /Ctrl\+C/);
  } finally { unstub(); }
});

test('actions: the drawer header carries the Copy button and it is part of the focus trap', async () => {
  stubGlobal('navigator', { clipboard: { writeText: () => Promise.resolve() } });
  try {
    const ids = await runPage(serve(dataFor()));
    cardN(ids, 201).handlers.click();
    await flush();
    const copy = all(ids['d-act'], cls('copy')).filter((b) => b._text === 'Copy')[0];
    assert.ok(copy);
    // This board has no docs for the track, so the cycle is [Close, Copy, Discuss]: Shift+Tab on Close lands on Discuss, then Copy; Tab on Discuss wraps to Close.
    ids['d-close'].focus();
    const back = ev('Tab', { shiftKey: true }); ids.__doc.handlers.keydown(back);
    assert.equal(back.prevented, true);
    const disc = ids.__doc.activeElement; assert.equal(disc._text, 'Discuss');
    ids.__doc.activeElement = copy;
    const mid = ev('Tab'); ids.__doc.handlers.keydown(mid);
    assert.ok(!mid.prevented, 'the Copy button is inside the trap: Tab from it is left to the browser');
    ids.__doc.activeElement = disc;
    const fwd = ev('Tab'); ids.__doc.handlers.keydown(fwd);
    assert.equal(ids.__doc.activeElement, ids['d-close']);
    copy.handlers.click(fakeEv('x')); await flush();
    assert.equal(all(ids['d-act'], cls('copied'))[0].textContent, 'Copied');
  } finally { unstub(); }
});

test('Move: capability absent (no claude, use() null, use() rejects, no use): nothing is drawn, nothing is said', async () => {
  for (const claude of [undefined, { use: async () => null }, { use: async () => { throw Object.assign(new Error('x'), { code: 'not_granted' }); } }, {}]) {
    if (claude) stubGlobal('claude', claude);
    try {
      const ids = await runPage(serve(dataFor()));
      assert.equal(moveBtns(ids.lanes).length, 0);
      assert.equal(moveBtns(ids['attn-rows']).length, 0);
      cardN(ids, 201).handlers.click(); await flush();
      assert.equal(moveBtns(ids['d-act']).length, 0);
      assert.ok(!/Move|desktop app|error/i.test(all(ids.lanes, cls('act')).map((x) => x.textContent).join(' ')));
    } finally { unstub(); }
  }
});

test('Move: with the capability the menu is drawn on cards, attention rows and in the drawer, but the server is never probed or called on load', async () => {
  const { claude, log } = fakeClaude({ servers: REACHABLE });
  stubGlobal('claude', claude);
  try {
    const ids = await runPage(serve(dataFor()));
    assert.deepEqual(log.use, ['mcp']);
    assert.ok(moveBtns(cardN(ids, 201)).length === 1 && moveBtns(cardN(ids, 202)).length === 1);
    assert.ok(moveBtns(ids['attn-rows']).length >= 1);
    assert.deepEqual(log.listTools, [], 'no probe on load');
    assert.deepEqual(log.calls, [], 'no tool call on load');
    const b = moveBtns(cardN(ids, 201))[0];
    assert.equal(b.attrs['aria-label'], 'Move AM-201 to another lane');
    assert.equal(b.attrs['aria-haspopup'], 'true');
    assert.equal(b.attrs['aria-expanded'], 'false');
    cardN(ids, 201).handlers.click(); await flush();
    assert.equal(moveBtns(ids['d-act']).length, 1, 'and in the drawer');
    assert.deepEqual(log.listTools, []);
  } finally { unstub(); }
});

test('Move: the first click probes once; a menu of the other lanes; a confirm names the exact move; then get_track and update_track; the card moves with a note', async () => {
  const { claude, log } = fakeClaude({ servers: REACHABLE });
  stubGlobal('claude', claude);
  try {
    const ids = await runPage(serve(dataFor()));
    const card = cardN(ids, 201);
    const ke = fakeEv('Enter'); all(card, cls('move'))[0].handlers.keydown(ke); assert.equal(ke.stopped, true, 'Enter inside the control does not open the card');
    moveBtns(card)[0].handlers.click(fakeEv('x')); await flush();
    assert.deepEqual(log.listTools, [HOST]);
    assert.deepEqual(log.calls, [], 'listing is not a write');
    const opts = all(card, cls('mvopt'));
    assert.deepEqual(opts.map((o) => o._text), ['backlog', 'implement', 'review', 'quality-gate', 'done'], 'every lane but the current one');
    assert.equal(moveBtns(card)[0].attrs['aria-expanded'], 'true');
    opts[2].handlers.click(fakeEv('x'));
    assert.match(all(card, cls('mvask'))[0].textContent, /Move AM-201 from plan to review with status queue/);
    assert.deepEqual(log.calls, [], 'nothing is written before the confirm');
    all(card, cls('mvgo'))[0].handlers.click(fakeEv('x')); await flush();
    assert.deepEqual(log.calls, [
      [HOST, 'get_track', { track: 'AM-201', files: ['index'] }],
      [HOST, 'update_track', { track: 'AM-201', base: BASE, markers: { Lane: 'review', 'Lane Status': 'queue' } }],
    ]);
    assert.equal('reopen' in log.calls[1][2], false, 'no reopen for a track that is not done');
    assert.equal(ids.lanes.children[0].children[1].children.length, 0, 'gone from plan');
    const moved = cardN(ids, 201);
    assert.ok(ids.lanes.children[2].children[1].children.includes(moved), 'now in review');
    assert.ok(moved.textContent.includes('Moved to review:queue; the board is a snapshot, ask Claude to refresh it.'));
    assert.ok(!moved.textContent.includes('/laneconductor:plan 201'), 'the old command is not shown for the new lane');
    moveBtns(moved)[0].handlers.click(fakeEv('x')); await flush();
    assert.equal(log.listTools.length, 1, 'a second Move does not probe again');
  } finally { unstub(); }
});

test('Move: cancel at the confirm step writes nothing', async () => {
  const { claude, log } = fakeClaude({ servers: REACHABLE });
  stubGlobal('claude', claude);
  try {
    const ids = await runPage(serve(dataFor()));
    const card = cardN(ids, 201);
    await moveVia(card, 'review', { confirm: false });
    all(card, cls('mvno'))[0].handlers.click(fakeEv('x'));
    assert.equal(all(card, cls('mvpanel')).length, 0);
    assert.deepEqual(log.calls, []);
  } finally { unstub(); }
});

test('Move: a running track gets a warning in the confirm step', async () => {
  const { claude } = fakeClaude({ servers: REACHABLE });
  stubGlobal('claude', claude);
  try {
    const ids = await runPage(serve(dataFor()));
    const card = cardN(ids, 202);
    await moveVia(card, 'review', { confirm: false });
    assert.ok(all(card, cls('mvwarn'))[0].textContent.includes('running'));
  } finally { unstub(); }
});

test('Move: a server that is not reachable (not in the desktop app): the menu goes on the first click, with a quiet note, and nothing is called', async () => {
  const { claude, log } = fakeClaude({ servers: [] });
  stubGlobal('claude', claude);
  try {
    const ids = await runPage(serve(dataFor()));
    assert.equal(moveBtns(cardN(ids, 201)).length, 1, 'drawn until the first click proves otherwise');
    moveBtns(cardN(ids, 201))[0].handlers.click(fakeEv('x')); await flush();
    assert.equal(moveBtns(ids.lanes).length, 0, 'no card keeps a Move button');
    assert.ok(cardN(ids, 201).textContent.includes('Move works only in the Claude desktop app'));
    assert.deepEqual(log.calls, []);
    assert.equal(all(ids.board, (x) => x.attrs?.role === 'alert').length, 0, 'never an error banner');
  } finally { unstub(); }
});

test('Move: a server that lists without update_track is unreachable; so is a listTools rejection', async () => {
  for (const claude of [
    fakeClaude({ servers: [{ server: HOST, tools: [{ name: 'get_track' }] }] }).claude,
    { use: async () => ({ listTools: async () => { throw toolError('server_not_connected'); }, callTool: async () => okTrack }) },
  ]) {
    stubGlobal('claude', claude);
    try {
      const ids = await runPage(serve(dataFor()));
      moveBtns(cardN(ids, 201))[0].handlers.click(fakeEv('x')); await flush();
      assert.equal(moveBtns(ids.lanes).length, 0);
    } finally { unstub(); }
  }
});

test('Move: CONFLICT shows "changed since you looked; refresh the board and try again" and the card stays', async () => {
  const { claude, log } = fakeClaude({ servers: REACHABLE, handler: async (tool) => { if (tool === 'update_track') throw toolError('CONFLICT', '1 item changed since your base'); return okTrack; } });
  stubGlobal('claude', claude);
  try {
    const ids = await runPage(serve(dataFor()));
    const card = cardN(ids, 201);
    await moveVia(card, 'review');
    assert.equal(log.calls.length, 2, 'it did try, once');
    assert.ok(card.textContent.includes('changed since you looked; refresh the board and try again'));
    assert.ok(ids.lanes.children[0].children[1].children.includes(card), 'not moved on screen');
    assert.equal(moveBtns(card).length, 1, 'the menu stays for another try after a refresh');
  } finally { unstub(); }
});

test('Move: other failures are told apart (connector refusal, cancelled, approval, ambiguous outcome); none moves the card or retries', async () => {
  const cases = [
    [toolError('VALIDATION_FAILED', 'Lane "x" is not a lane'), /connector refused the move: Lane "x" is not a lane/],
    [Object.assign(new Error('declined'), { code: 'cancelled' }), /Cancelled; nothing was moved/],
    [Object.assign(new Error('ask'), { code: 'approval_required' }), /needs your approval/],
    [Object.assign(new Error('timeout'), { code: 'server_unavailable', retryable: true }), /may or may not have happened/],
    [Object.assign(new Error('?'), { code: 'upstream_error' }), /may or may not have happened/],
  ];
  for (const [err, re] of cases) {
    const { claude, log } = fakeClaude({ servers: REACHABLE, handler: async (tool) => { if (tool === 'update_track') throw err; return okTrack; } });
    stubGlobal('claude', claude);
    try {
      const ids = await runPage(serve(dataFor()));
      const card = cardN(ids, 201);
      await moveVia(card, 'review');
      assert.match(card.textContent, re);
      assert.equal(log.calls.filter((c) => c[1] === 'update_track').length, 1, 'never retried by the page');
      assert.ok(ids.lanes.children[0].children[1].children.includes(card));
    } finally { unstub(); }
  }
});

test('Move: a get_track without a base writes nothing', async () => {
  const { claude, log } = fakeClaude({ servers: REACHABLE, handler: async () => ({ payload: { ok: true, data: {} } }) });
  stubGlobal('claude', claude);
  try {
    const ids = await runPage(serve(dataFor()));
    const card = cardN(ids, 201);
    await moveVia(card, 'review');
    assert.deepEqual(log.calls.map((c) => c[1]), ['get_track']);
    assert.match(card.textContent, /nothing was moved/);
  } finally { unstub(); }
});

test('Move: leaving the done lane needs an explicit tick in the page and passes reopen: true; never silently', async () => {
  const { claude, log } = fakeClaude({ servers: REACHABLE });
  stubGlobal('claude', claude);
  try {
    const ids = await runPage(serve(dataFor()));
    ids['done-rows'].children[0].handlers.click(); await flush();
    assert.equal(ids['d-id'].textContent, 'AM-203');
    const head = ids['d-act'];
    await moveVia(head, 'implement', { confirm: false });
    assert.ok(all(head, cls('mvwarn'))[0].textContent.includes('reopens a finished track'));
    const go = all(head, cls('mvgo'))[0];
    assert.equal(go._text, 'Reopen and move');
    assert.equal(go.disabled, true, 'disabled until the tick');
    go.handlers.click(fakeEv('x'));
    assert.deepEqual(log.calls, [], 'a click on a disabled confirm does nothing');
    const cb = all(head, (x) => x.tag === 'input')[0];
    cb.checked = true; cb.handlers.change();
    assert.equal(go.disabled, false);
    go.handlers.click(fakeEv('x')); await flush();
    assert.deepEqual(log.calls[1], [HOST, 'update_track', { track: 'AM-203', base: BASE, markers: { Lane: 'implement', 'Lane Status': 'queue' }, reopen: true }]);
    assert.equal(ids['d-lane'].textContent, 'implement', 'the drawer header follows');
    assert.ok(ids['d-act'].textContent.includes('the board is a snapshot, ask Claude to refresh it'));
    assert.equal(ids['done-rows'].children.length, 0, 'gone from the done list');
  } finally { unstub(); }
});

test('Move: moving into done asks the same confirm and names the exact move; the menu options are in the drawer focus trap', async () => {
  const { claude, log } = fakeClaude({ servers: REACHABLE });
  stubGlobal('claude', claude);
  try {
    const ids = await runPage(serve(dataFor()));
    cardN(ids, 201).handlers.click(); await flush();
    const head = ids['d-act'];
    moveBtns(head)[0].handlers.click(fakeEv('x')); await flush();
    const cycle = [...moveBtns(head), ...all(head, cls('mvopt'))];
    for (const o of cycle.slice(0, -1)) {
      o.focus();
      const tab = ev('Tab'); ids.__doc.handlers.keydown(tab);
      assert.equal(tab.prevented, undefined, `${o._text} is inside the focus trap`);
    }
    cycle.at(-1).focus();
    const wrap = ev('Tab'); ids.__doc.handlers.keydown(wrap);
    assert.equal(ids.__doc.activeElement, ids['d-close'], 'the last menu option is the end of the cycle');
    all(head, cls('mvopt')).find((o) => o._text === 'done').handlers.click(fakeEv('x'));
    assert.match(all(head, cls('mvask'))[0].textContent, /to done with status queue/);
    assert.deepEqual(log.calls, []);
  } finally { unstub(); }
});

test('actions: new CSS uses theme variables only, wraps at phone width, and the page keeps its safe-DOM rule', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  const from = html.indexOf('/* Card actions');
  const css = html.slice(from, html.indexOf('@media (max-width: 700px)', from));
  assert.ok(css.length > 500);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css), 'colours come from the variables, so both themes work');
  assert.match(css, /\.act code\.actc \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.act \.actrow \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.act \.mvpanel \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.act \.copy:focus-visible/, 'keyboard focus is visible');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\balert\(|\bconfirm\(|\bprompt\(|\bwindow\.open\(/.test(html));
  assert.ok(!/XMLHttpRequest|sendBeacon/.test(html), 'no network from the actions');
  assert.ok(/globalThis\.claude/.test(html) && /c\.use\('mcp'\)/.test(html));
});

// --- the Project drawer (track AM-10115): the project definition as tabs in the same drawer -------------

const PROJ_DOCS = {
  'product.md': '# Product: Demo\n\nWhat it is: **a demo** with a [link](https://example.org/p).\n',
  'workflow.md': '# Workflow\n\nCommit often.\n',
  'kpis.md': '# KPIs\n\n| Metric | Target |\n|---|---|\n| Stars | 100 |\n',
  'quality-gate.md': '# Quality Gate\n\n- [ ] Tests: `npm test`\n',
};
function projectFixture({ docs = PROJ_DOCS, workflow = true } = {}) {
  const dir = makeRepo({ workflow });
  cleanup.push(dir);
  writeFile(dir, '.laneconductor.json', JSON.stringify({ project: { name: 'Project Fixture' } }));
  writeFile(dir, 'conductor/tracks/AM-801-one/index.md', INDEX(801, 'One', { lane: 'plan', status: 'queue' }));
  for (const [rel, text] of Object.entries(docs)) writeFile(dir, `conductor/${rel}`, text);
  commitAll(dir);
  return dir;
}
const projBtn = (ids) => ids['proj-btn'];
const ctxStub = (data, over = {}) => async (u) => {
  if (u === 'board.json') return { ok: true, status: 200, json: async () => data };
  const k = u.replace(/^ctx\/|\.json$/g, '');
  return { ok: true, status: 200, json: async () => ({ k, t: k, ...(over[u] ?? { md: 'm' }) }) };
};

test('project drawer: with nothing to read the Project button stays hidden and no ctx file is fetched', async () => {
  const { data, calls, fetchStub } = siteFor(projectFixture({ docs: {}, workflow: false }));
  assert.ok(!('project_docs' in data));
  const ids = await runPage(fetchStub);
  assert.equal(projBtn(ids).hidden, true);
  assert.match(fs.readFileSync(PAGE, 'utf8'), /<button type="button" class="projbtn" id="proj-btn"[^>]* hidden>Project<\/button>/, 'hidden in the markup too');
  assert.deepEqual(calls.filter((u) => u.startsWith('ctx/')), []);
  // An entry that is not a safe ctx path is ignored, so a board.json cannot make the page fetch elsewhere.
  const ids2 = await runPage(ctxStub({ ...data, project_docs: [{ k: 'x', t: 'X', f: 'https://evil.example/x.json' }, { k: 'y', t: 'Y', f: '../board.json' }, null] }));
  assert.equal(projBtn(ids2).hidden, true);
});

test('project drawer: the button opens the drawer with one tab per definition, the first loaded, focus inside, snapshot note in the header', async () => {
  const { data, calls, fetchStub } = siteFor(projectFixture());
  const ids = await runPage(fetchStub);
  assert.equal(projBtn(ids).hidden, false);
  projBtn(ids).handlers.click();
  assert.equal(ids.detail.hidden, false);
  assert.equal(ids.wrap.attrs.inert, '');
  assert.equal(ids['d-id'].textContent, 'PROJECT');
  assert.equal(ids['d-title'].textContent, 'Project Fixture');
  assert.equal(ids['d-lane'].hidden, true);
  assert.equal(ids['d-prog'].hidden, true);
  assert.equal(ids['d-pill'].textContent, '');
  assert.equal(ids['d-act'].textContent, '');
  assert.equal(ids['d-note'].hidden, false);
  assert.match(ids['d-note'].textContent, /snapshot of the project definition files, read at the same time as this board/);
  assert.equal(ids['d-tabs'].attrs['aria-label'], 'Project definition');
  assert.equal(ids.__doc.activeElement, ids['d-close']);
  await flush();
  assert.deepEqual(tabNames(ids), data.project_docs.map((x) => x.t));
  assert.deepEqual(tabNames(ids), ['Overview', 'Workflow', 'Quality gate', 'KPIs']);
  assert.equal(tabBy(ids, 'Overview').attrs['aria-selected'], 'true');
  assert.ok(ids['d-body'].textContent.includes('What it is'));
  assert.deepEqual(calls.filter((u) => u.startsWith('ctx/')), ['ctx/overview.json'], 'fetched on first open of the tab only');
  tabBy(ids, 'KPIs').onclick();
  await flush();
  assert.ok(ids['d-body'].textContent.includes('Stars'));
  assert.equal(all(ids['d-body'], (x) => x.tag === 'table').length, 1, 'markdown tables render');
  tabBy(ids, 'Overview').onclick();
  await flush();
  assert.deepEqual(calls.filter((u) => u.startsWith('ctx/')), ['ctx/overview.json', 'ctx/kpis.json'], 'a tab is fetched once');
  // The arrow keys move between the tabs, as in the track drawer.
  const right = ev('ArrowRight');
  tabBy(ids, 'Overview').handlers.keydown(right);
  await flush();
  assert.equal(tabBy(ids, 'Workflow').attrs['aria-selected'], 'true');
  assert.equal(right.prevented, true);
  // Closing returns focus to the Project button and releases the page.
  ids['d-close'].onclick();
  assert.equal(ids.detail.hidden, true);
  assert.equal(ids.wrap.attrs.inert, undefined);
  assert.equal(ids.__doc.activeElement, projBtn(ids));
});

test('project drawer: Escape closes it; Tab and Shift+Tab are trapped; a track opened afterwards gets its own header back', async () => {
  const { fetchStub } = siteFor(projectFixture());
  const ids = await runPage(fetchStub);
  projBtn(ids).handlers.click();
  await flush();
  // The trap: close, the selected tab, then the body's links; the last wraps to the first and the first to the last.
  const links = all(ids['d-body'], (x) => x.tag === 'a');
  assert.equal(links.length, 1);
  links[0].focus();
  const fwd = ev('Tab'); ids.__doc.handlers.keydown(fwd);
  assert.equal(fwd.prevented, true);
  assert.equal(ids.__doc.activeElement, ids['d-close']);
  const back = ev('Tab', { shiftKey: true }); ids.__doc.handlers.keydown(back);
  assert.equal(ids.__doc.activeElement, links[0]);
  const esc = ev('Escape'); ids.__doc.handlers.keydown(esc);
  assert.equal(ids.detail.hidden, true);
  assert.equal(ids.__doc.activeElement, projBtn(ids));
  const noop = ev('Escape'); ids.__doc.handlers.keydown(noop);
  assert.equal(noop.prevented, undefined, 'Escape with nothing open does nothing');
  // A track after the project: the track header is back (lane tag, progress, no snapshot note).
  cardOf(ids, 'plan').handlers.click();
  assert.equal(ids['d-id'].textContent, 'AM-801');
  assert.equal(ids['d-lane'].hidden, false);
  assert.equal(ids['d-prog'].hidden, false);
  assert.equal(ids['d-note'].hidden, true);
  assert.equal(ids['d-tabs'].attrs['aria-label'], 'Track documents');
  await flush();
  assert.deepEqual(tabNames(ids), ['Overview', 'Plan', 'Spec', 'Tests']);
});

test('project drawer: the Workflow tab draws the lanes as boxes with arrows, a text list, the primer, then the workflow.md text', async () => {
  const { data, fetchStub } = siteFor(projectFixture());
  const ids = await runPage(fetchStub);
  projBtn(ids).handlers.click();
  await flush();
  tabBy(ids, 'Workflow').onclick();
  // The drawing is there at once (it comes from board.json); the text follows when its file arrives.
  assert.equal(all(ids['d-body'], cls('wfbox')).length, data.wf.lanes.length);
  assert.match(ids['d-body'].textContent, /Loading the document/);
  await flush();
  const body = ids['d-body'];
  assert.equal(all(body, cls('wfbox')).length, 5);
  assert.deepEqual(all(body, cls('wfname')).map((x) => x.textContent), ['plan', 'implement', 'review', 'quality-gate', 'done']);
  assert.equal(all(body, cls('wfarr')).length, 4, 'an arrow between lanes');
  assert.match(all(body, cls('wfbox'))[1].textContent, /success → review:queue/);
  assert.match(all(body, cls('wfbox'))[4].textContent, /success → no automatic move/);
  assert.equal(all(body, cls('wfrow'))[0].attrs['aria-hidden'], 'true', 'the picture is for the eyes only');
  const list = all(body, cls('sr'))[0];
  assert.equal(list.tag, 'ul');
  assert.deepEqual(list.children.map((li) => li.tag), ['li', 'li', 'li', 'li', 'li']);
  assert.match(list.children[1].textContent, /^implement: success goes to review:queue; failure goes to /);
  assert.match(body.textContent, /Lane = where the track is\. Status = its state within the lane: queue, running, success, failure or waiting\./);
  assert.ok(body.textContent.indexOf('Lane = where') < body.textContent.indexOf('Commit often.'), 'the text of workflow.md comes after the picture');
});

test('project drawer: no workflow.json means no boxes; an unreadable lane shows its note; odd entries are skipped and nothing throws', async () => {
  const { data, fetchStub } = siteFor(projectFixture({ docs: { 'workflow.md': '# W\n\ntext here\n' }, workflow: false }));
  assert.ok(!('wf' in data));
  let ids = await runPage(fetchStub);
  projBtn(ids).handlers.click();
  await flush();
  assert.equal(all(ids['d-body'], cls('wfbox')).length, 0);
  assert.match(ids['d-body'].textContent, /text here/);
  assert.match(ids['d-body'].textContent, /Lane = where the track is/);
  const hand = { ...data, project_docs: [{ k: 'workflow', t: 'Workflow', f: 'ctx/workflow.json' }], wf: { lanes: [{ name: 'x', success: null, failure: null, note: 'the targets of this lane are in a format the board does not read' }, null, { nope: 1 }, { name: 'y', success: 5, failure: 'z:queue', note: '' }] } };
  ids = await runPage(ctxStub(hand));
  projBtn(ids).handlers.click();
  await flush();
  assert.deepEqual(all(ids['d-body'], cls('wfname')).map((n) => n.textContent), ['x', 'y']);
  assert.match(ids['d-body'].textContent, /the targets of this lane are in a format the board does not read/);
});

test('project drawer: markdown from a file is safe (no elements from text, no script links); a withheld tab shows the reason and no text', async () => {
  const hostile = '# H\n\n<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1)) and [ok](https://example.org/ok)\n';
  const { data } = siteFor(projectFixture());
  const ids = await runPage(ctxStub(data, { 'ctx/overview.json': { md: hostile }, 'ctx/kpis.json': { withheld: 'possible secret or personal data (2 matches)' } }));
  projBtn(ids).handlers.click();
  await flush();
  assert.ok(!ids.__doc.created.includes('script') && !ids.__doc.created.includes('img'), 'no script or img element is ever created');
  assert.ok(ids['d-body'].textContent.includes('<script>alert(1)</script>'), 'the markup is shown as text');
  const anchors = all(ids['d-body'], (x) => x.tag === 'a');
  assert.ok(anchors.every((a) => !/^\s*javascript:/i.test(a.attrs.href ?? '')), 'no javascript: link');
  tabBy(ids, 'KPIs').onclick();
  await flush();
  assert.match(ids['d-body'].textContent, /withheld: possible secret or personal data \(2 matches\)/);
  assert.match(ids['d-body'].textContent, /read it in the repository/);
  assert.equal(all(ids['d-body'], cls('md')).length, 0);
});

test('project drawer: a ctx file that fails to load shows an error with Try again (inside the focus trap), and a retry works', async () => {
  const { data } = siteFor(projectFixture());
  let fail = true;
  const ids = await runPage(async (u) => {
    if (u === 'board.json') return { ok: true, status: 200, json: async () => data };
    if (fail) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ k: 'overview', t: 'Overview', md: 'recovered text' }) };
  });
  projBtn(ids).handlers.click();
  await flush();
  assert.match(ids['d-body'].textContent, /Could not load ctx\/overview\.json/);
  assert.match(ids['d-body'].textContent, /HTTP 404/);
  const retry = all(ids['d-body'], (x) => x.tag === 'button')[0];
  assert.equal(retry._text, 'Try again');
  retry.focus();
  const tab = ev('Tab'); ids.__doc.handlers.keydown(tab);
  assert.equal(ids.__doc.activeElement, ids['d-close'], 'the retry button is the last stop of the trap');
  fail = false;
  retry.onclick();
  await flush();
  assert.ok(ids['d-body'].textContent.includes('recovered text'));
  // A file that is for another tab is not accepted.
  const bad = await runPage(async (u) => (u === 'board.json' ? { ok: true, status: 200, json: async () => data } : { ok: true, status: 200, json: async () => ({ k: 'other', md: 'x' }) }));
  projBtn(bad).handlers.click();
  await flush();
  assert.match(bad['d-body'].textContent, /unexpected format/);
});

test('project drawer: markup and CSS: a header button, theme variables only, wraps at phone width, no overflow from the boxes', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  assert.match(html, /<header>[\s\S]*id="proj-btn"[\s\S]*<\/header>/);
  assert.match(html, /id="d-note"/);
  const from = html.indexOf('/* Project drawer');
  const css = html.slice(from, html.indexOf('@media (max-width: 700px)', from));
  assert.ok(css.length > 400);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css), 'colours come from the variables, so both themes work');
  assert.match(css, /\.wfrow \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.wfbox \{[^}]*min-width: 0[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.d-note \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.projbtn:hover/);
  assert.match(html, /button:focus-visible \{ outline/, 'keyboard focus is visible');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html));
  const footer = html.slice(html.indexOf('<footer>'), html.indexOf('</footer>'));
  assert.match(footer, /Sharing the board shares these documents, including the project definition files\./);
  assert.ok(!/coming soon|planned|roadmap|will be/i.test(footer), 'nothing planned is announced');
});

// --- a newer board: the open page polls the tiny index version.json (owner, 2026-11-19) -------------------

/** Stubs the timer, location and sessionStorage the page uses for the newer-board check; returns what the page did with them. */
function pollEnv({ storage = true } = {}) {
  const had = { setInterval: globalThis.setInterval, location: globalThis.location, sessionStorage: globalThis.sessionStorage };
  const timers = []; const store = new Map(); let reloads = 0; let unrefd = false;
  globalThis.setInterval = (fn, ms) => { timers.push({ fn, ms }); return { unref() { unrefd = true; } }; };
  globalThis.location = { reload() { reloads += 1; } };
  if (storage) globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  else delete globalThis.sessionStorage;
  const restoreEnv = () => {
    for (const [k, v] of Object.entries(had)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  };
  return { timers, store, reloads: () => reloads, unrefd: () => unrefd, restoreEnv };
}
const withVersion = (stub, generatedAt, status = 200) => async (u) => {
  if (u !== 'version.json') return stub(u);
  return status === 200 ? { ok: true, status, json: async () => ({ version: 1, generated_at: generatedAt }) } : { ok: false, status, json: async () => ({}) };
};
const later = (iso, ms = 60000) => new Date(Date.parse(iso) + ms).toISOString();

test('newer board: the page asks version.json every 15 seconds on an unref\'d timer, never board.json again, and does nothing while the time is the same', async () => {
  const env = pollEnv();
  try {
    const { data, calls, fetchStub } = siteFor(detailFixture());
    const ids = await runPage(withVersion(fetchStub, data.generated_at));
    assert.equal(env.timers.length, 1);
    assert.equal(env.timers[0].ms, 15000);
    assert.ok(env.unrefd(), 'the timer never keeps a process alive');
    await env.timers[0].fn(); await flush();
    assert.ok(!calls.slice(1).includes('board.json'), 'a check never loads the board itself');
    assert.equal(env.reloads(), 0);
    assert.equal(ids.__doc.created.length > 0, true);
  } finally { env.restoreEnv(); }
});

test('newer board: a later generated time with nothing open reloads the page once; a second newer board within two minutes shows the button instead (reload guard)', async () => {
  const env = pollEnv();
  try {
    const { data, fetchStub } = siteFor(detailFixture());
    const ids = await runPage(withVersion(fetchStub, later(data.generated_at)));
    ids.__doc.getElementById('detail').hidden = true; // the real markup starts with the drawer closed; the fake DOM does not
    await env.timers[0].fn(); await flush();
    assert.equal(env.reloads(), 1);
    assert.ok(env.store.has('lc-board-auto'));
    await env.timers[0].fn(); await flush();
    assert.equal(env.reloads(), 1, 'no second automatic reload inside two minutes');
  } finally { env.restoreEnv(); }
});

test('newer board: with a search typed or a track open the page does not reload; it shows "A newer board is available" and the button reloads', async () => {
  const env = pollEnv();
  try {
    const { data, fetchStub } = siteFor(detailFixture());
    const ids = await runPage(withVersion(fetchStub, later(data.generated_at)));
    ids.q.handlers.input({ target: { value: 'csv' } }); await flush();
    await env.timers[0].fn(); await flush();
    assert.equal(env.reloads(), 0, 'a search is in progress: never reload under the reader');
    const btn = ids.fresh?.children?.find?.((c) => /newer board/.test(c.textContent));
    const found = [];
    const walk = (n) => { if (!n) return; if (n.textContent && /A newer board is available/.test(n._text ?? '')) found.push(n); (n.children || []).forEach(walk); };
    walk(ids.stamp);
    assert.equal(found.length, 1, 'the button is in the freshness area');
    assert.equal(found[0].hidden, false);
    found[0].handlers.click();
    assert.equal(env.reloads(), 1, 'the button reloads');
    void btn;
  } finally { env.restoreEnv(); }
});

test('newer board: an older or unreadable generated time changes nothing; a 404 (a board published before the index existed) stops the asking; a hidden tab asks nothing; no sessionStorage means no automatic reload', async () => {
  const env = pollEnv();
  try {
    const { data, calls, fetchStub } = siteFor(detailFixture());
    let ids = await runPage(withVersion(fetchStub, later(data.generated_at, -60000)));
    await env.timers.at(-1).fn(); await flush();
    assert.equal(env.reloads(), 0, 'an older time is ignored');
    ids = await runPage(withVersion(fetchStub, 'not a date'));
    await env.timers.at(-1).fn(); await flush();
    assert.equal(env.reloads(), 0, 'a bad time is ignored');
    const stub404 = withVersion(fetchStub, '', 404); const c0 = calls.length;
    ids = await runPage(async (u) => { calls.push(`404:${u}`); return stub404(u); });
    await env.timers.at(-1).fn(); await flush();
    const asked = calls.filter((u) => u === '404:version.json').length;
    await env.timers.at(-1).fn(); await flush();
    assert.equal(calls.filter((u) => u === '404:version.json').length, asked, 'after a 404 it never asks again');
    void c0;
    ids = await runPage(withVersion(fetchStub, later(data.generated_at)));
    ids.__doc.hidden = true;
    const before = calls.length;
    await env.timers.at(-1).fn(); await flush();
    assert.equal(calls.length, before, 'a hidden tab makes no request');
    ids.__doc.hidden = false;
  } finally { env.restoreEnv(); }
  const env2 = pollEnv({ storage: false });
  try {
    const { data, fetchStub } = siteFor(detailFixture());
    await runPage(withVersion(fetchStub, later(data.generated_at)));
    await env2.timers[0].fn(); await flush();
    assert.equal(env2.reloads(), 0, 'without sessionStorage the loop guard cannot work, so there is no automatic reload');
  } finally { env2.restoreEnv(); }
});

// ---- Deep links (blocked by, KPI) and the Discuss button.
test('board.json: bb lists Depends On and Waiting On Tracks once each; kp is Serves, or empty with only a KPI Check After; neither: both absent', () => {
  const d = actionData([
    [301, 'plan', 'queue', '**Depends On**: 302, 303\n**Waiting On Tracks**: 303, 301\n**Serves**: Awareness: GitHub stars\n'],
    [302, 'implement', 'queue', '**KPI Check After**: 2026-12-17T09:00:00.000Z\n'],
    [303, 'done', 'success'],
  ]);
  const t = (n) => d.tracks.find((x) => x.n === n);
  assert.deepEqual(t(301).bb, [302, 303], 'each once, never itself');
  assert.equal(t(301).kp, 'Awareness: GitHub stars');
  assert.equal(t(302).kp, '', 'a KPI Check After with no Serves: the track has a KPI, the name is in its spec');
  assert.ok(!('bb' in t(303)) && !('kp' in t(303)), 'a track with neither carries neither key');
});

test('drawer: Blocked by opens the other track; a done one reads Needs (done); KPI opens the KPIs tab of the Project drawer', async () => {
  const d = actionData([
    [301, 'plan', 'queue', '**Depends On**: 302, 303\n**Serves**: KPI-1\n'],
    [302, 'implement', 'queue'],
    [303, 'done', 'success'],
  ]);
  d.project_docs = [{ k: 'overview', t: 'Overview', f: 'ctx/overview.json' }, { k: 'kpis', t: 'KPIs', f: 'ctx/kpis.json' }];
  const ids = await runPage(async (u) => ({ ok: true, status: 200, json: async () => (String(u).includes('ctx/') ? { k: String(u).includes('kpis') ? 'kpis' : 'overview', md: '# KPIs' } : d) }));
  cardN(ids, 301).handlers.click(); await flush();
  const lnks = all(ids['d-lnks'], cls('lnk'));
  assert.equal(ids['d-lnks'].hidden, false);
  assert.equal(lnks.length, 3);
  assert.ok(ids['d-lnks'].textContent.includes('Blocked by:') && ids['d-lnks'].textContent.includes('Needs (done):'));
  assert.ok(lnks[0].textContent.startsWith('AM-302'), 'the open blocker first');
  assert.ok(String(lnks[0].attrs['aria-label']).includes('blocks this track'));
  lnks[0].handlers.click(fakeEv('x')); await flush();
  assert.equal(ids['d-id'].textContent, 'AM-302', 'clicking it opens that track');
  assert.equal(ids['d-lnks'].hidden, true, 'a track with no links draws none');
  cardN(ids, 301).handlers.click(); await flush();
  all(ids['d-lnks'], cls('kpi'))[0].handlers.click(fakeEv('x')); await flush();
  assert.equal(ids['d-id'].textContent, 'PROJECT');
  const sel = all(ids['d-tabs'], (x) => x.attrs && x.attrs['aria-selected'] === 'true')[0];
  assert.equal(sel.dataset.k, 'kpis', 'the KPIs tab is the one shown');
});

test('Discuss: copies a prompt that asks to read and talk first, runs no lane, and sits beside Copy', async () => {
  const written = [];
  stubGlobal('navigator', { clipboard: { writeText(t) { written.push(t); return Promise.resolve(); } } });
  try {
    const ids = await runPage(serve(dataFor()));
    const card = cardN(ids, 201);
    const btns = all(card, cls('copy'));
    assert.deepEqual(btns.map((b) => b._text), ['Copy', 'Discuss']);
    const e = fakeEv('x'); btns[1].handlers.click(e);
    assert.equal(e.stopped, true, 'the click does not open the card');
    assert.equal(written.length, 1);
    assert.ok(written[0].includes('AM-201') && /Do not run any lane command/.test(written[0]) && /do not change any file until I say so/.test(written[0]));
    assert.ok(!/^\//.test(written[0]) && !written[0].includes('/laneconductor:'), 'a plain prompt, no command');
    await flush();
    assert.equal(all(card, cls('copied'))[0].textContent, 'Copied the discuss prompt');
    assert.equal(all(cardN(ids, 202), cls('copy')).map((b) => b._text).join(), 'Discuss', 'a running track has no command, but can be discussed');
  } finally { unstub(); }
});

test('a running card is the first card of its lane, above success cards and above higher priorities; the rest keeps its order', async () => {
  const d = actionData([
    [401, 'implement', 'queue'], [402, 'implement', 'success'], [403, 'implement', 'queue', '**Priority**: high\n'],
    [404, 'implement', 'running', '**Priority**: low\n'], [405, 'implement', 'queue'],
  ]);
  const ids = await runPage(serve(d));
  const order = all(ids.lanes, (x) => cls('card')(x) && x.attrs['aria-label']?.startsWith('AM-4')).map((c) => Number(/^AM-(\d+):/.exec(c.attrs['aria-label'])[1]));
  assert.deepEqual(order, [404, 403, 402, 405, 401], 'running first (even at low priority), then high priority, then success, then newest first');
});

// ---- Track AM-10152: KPI focus on the board
import { parseKpis } from '../src/kpis.mjs';
const KPIS = parseKpis('| ID | Metric | Focus |\n|----|--------|-------|\n| KPI-1 | Stars | active |\n| KPI-2 | Installs | future |\n');
function kpiData(rows) {
  const entries = rows.map(([n, extra]) => ({ folder: `AM-${n}-t${n}`, index: { content: INDEX(n, `Title ${n}`, { lane: 'implement', status: 'queue', extra }) } }));
  return boardPageData(buildBoard(entries, { lanes: ACT_LANES, generatedAt: NOW, project: 'K', workflow: ACT_WF, kpis: KPIS }), { lanes: ACT_LANES });
}
test('board.json: kf is a for a track that serves an active KPI, f when every KPI it serves is not active; absent for no Serves or one that is not listed; no kpis.md: absent', () => {
  const d = kpiData([[501, '**Serves**: KPI-1\n'], [502, '**Serves**: KPI-2\n'], [503, '**Serves**: KPI-2, KPI-1\n'], [504, ''], [505, '**Serves**: KPI-9\n']]);
  const t = (n) => d.tracks.find((x) => x.n === n);
  assert.equal(t(501).kf, 'a'); assert.equal(t(502).kf, 'f'); assert.equal(t(503).kf, 'a', 'one active KPI among several');
  assert.ok(!('kf' in t(504)) && !('kf' in t(505)));
  assert.equal(t(503).kp, 'KPI-2, KPI-1');
  const none = boardPageData(buildBoard([{ folder: 'AM-1-t1', index: { content: INDEX(1, 'T', { extra: '**Serves**: KPI-2\n' }) } }], { lanes: ACT_LANES, generatedAt: NOW, project: 'K', workflow: ACT_WF }), { lanes: ACT_LANES });
  assert.ok(!('kf' in none.tracks[0]));
});

test('page: a track serving only a future KPI carries the future KPI badge on its card and in the drawer; searching a KPI id finds the tracks that serve it; the KPI button counts the tracks', async () => {
  const d = kpiData([[501, '**Serves**: KPI-1\n'], [502, '**Serves**: KPI-2\n'], [503, '**Serves**: KPI-1\n']]);
  d.project_docs = [{ k: 'kpis', t: 'KPIs', f: 'ctx/kpis.json' }];
  const ids = await runPage(serve(d));
  assert.equal(all(cardN(ids, 502), cls('pritag')).filter((x) => x._text === 'future KPI').length, 1);
  assert.equal(all(cardN(ids, 501), cls('pritag')).filter((x) => x._text === 'future KPI').length, 0, 'an active KPI is not badged');
  cardN(ids, 502).handlers.click(); await flush();
  assert.ok(ids['d-lnks'].textContent.includes('KPI-2 (1)') && ids['d-lnks'].textContent.includes('future KPI'));
  ids['d-close'].onclick(); await flush();
  cardN(ids, 501).handlers.click(); await flush();
  assert.ok(ids['d-lnks'].textContent.includes('KPI-1 (2)'), 'two tracks serve KPI-1');
});

// ---- the board is named after its project (the artifact's name in the list comes from the page's <title>)
import { spawnSync as spawnTitle } from 'node:child_process';
test('board.html is titled "<project> Board": the project name from the settings file or the folder, cleaned and clipped; the source page stays generic', () => {
  const run = (cfg, folder) => {
    const repo = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-title-')); const dir = path.join(repo, folder); fs.mkdirSync(path.join(dir, 'conductor/tracks'), { recursive: true });
    if (cfg) fs.writeFileSync(path.join(dir, '.laneconductor.json'), JSON.stringify(cfg));
    const site = fs.mkdtempSync(path.join(repo, 'site-'));
    const r = spawnTitle(process.execPath, [new URL('../bin/lc-board.mjs', import.meta.url).pathname, '--repo', dir, '--site', site], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const html = fs.readFileSync(path.join(site, 'board.html'), 'utf8'); fs.rmSync(repo, { recursive: true, force: true });
    return html.match(/<title>([^<]*)<\/title>/)[1];
  };
  assert.equal(run({ project: { name: 'aitutor' } }, 'coachai'), 'aitutor Board', 'the settings name wins');
  assert.equal(run(null, 'macrodash'), 'macrodash Board', 'else the folder name');
  assert.equal(run({ project: { name: '<b>Evil & "co"</b>' } }, 'x'), 'bEvil  co/b Board'.replace('  ', ' ').replace('co/b', 'co/b'), 'markup characters are dropped');
  assert.equal(run({ project: { name: 'a'.repeat(80) } }, 'x'), `${'a'.repeat(40)} Board`, 'clipped to 40 characters');
  assert.ok(fs.readFileSync(new URL('../src/board-page.html', import.meta.url), 'utf8').includes('<title>LaneConductor Board</title>'), 'the repository page stays generic');
});
