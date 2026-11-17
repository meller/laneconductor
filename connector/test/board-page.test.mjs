// Phase 5d Tasks 2-3: the static board page (connector/src/board-page.html), its data file and
// `lc-board.mjs --site`. The page never embeds data; it fetches board.json. The page script is run
// here against a tiny fake DOM with `fetch` stubbed (no browser).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, writeFile, commitAll, rm, INDEX } from './helpers/repo.mjs';
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

test('--site writes exactly board.html and board.json, prints their absolute paths and nothing else', () => {
  const repo = fixture();
  const site = path.join(tmp('lc-site-'), 'nested', 'out'); // does not exist yet
  const r = run(repo, '--site', site);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${path.join(site, 'board.html')}\n${path.join(site, 'board.json')}\n`);
  assert.deepEqual(fs.readdirSync(site).sort(), ['board.html', 'board.json']);
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
  assert.ok(pageA.equals(fs.readFileSync(PAGE)), 'the page is the shipped static file, byte for byte');
  const html = pageA.toString('utf8');
  assert.ok(!html.includes(TITLE_SENTINEL) && !html.includes('Page Fixture') && !html.includes(NOW), 'no data in the page');
  assert.ok(!html.includes('__DATA__') && !html.includes('id="data"'), 'no data placeholder or embedded data block');
  assert.ok(/fetch\(\s*'board\.json'/.test(html), 'the page fetches board.json by a relative URL');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\balert\(|\bconfirm\(|\bprompt\(/.test(html), 'DOM is built with createElement and textContent only');

  const raw = fs.readFileSync(path.join(a, 'board.json'), 'utf8');
  assert.ok(raw.endsWith('}\n') && !raw.slice(0, -1).includes('\n'), 'compact JSON, one line');
  const j = JSON.parse(raw);
  assert.ok(raw.includes(TITLE_SENTINEL), 'the title is in board.json');
  assert.deepEqual(Object.keys(j), ['project', 'generated_at', 'tracks', 'attn']);
  assert.equal(j.project, 'Page Fixture');
  assert.equal(j.generated_at, NOW);
  for (const t of j.tracks) assert.deepEqual(Object.keys(t), ['n', 'p', 't', 'l', 's', 'g', 'h', 'a']);
  for (const a2 of j.attn) assert.deepEqual(Object.keys(a2), ['n', 'p', 't', 'r']);
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

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this.dataset = {}; this.style = {}; this.attrs = {}; this._text = ''; this.hidden = false; this.handlers = {}; }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(e, f) { this.handlers[e] = f; }
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
  globalThis.document = { getElementById: (id) => (ids[id] ??= new El(`#${id}`)), createElement: (t) => new El(t) };
  globalThis.fetch = fetchStub;
  new Function(code)();
  await flush();
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
  assert.equal(ids.lanes.children.length, 5);
  assert.deepEqual(ids.lanes.children.map((c) => c.children[0]._text), ['backlog', 'plan', 'implement', 'review', 'quality-gate']);
  assert.deepEqual(ids.lanes.children.map((c) => c.children[1].children.length), [1, 1, 1, 1, 1]);
  assert.equal(ids['done-rows'].children.length, 2);
  assert.equal(ids['done-n'].textContent, '2');
  assert.equal(ids['attn-rows'].children.length, 2);
  assert.equal(ids['attn-n'].textContent, '2');
  assert.equal(ids.proj.textContent, 'Page Fixture / 8 tracks');
  assert.ok(ids.lanes.textContent.includes(TITLE_SENTINEL));
  assert.ok(ids['attn-rows'].textContent.includes('waiting for a human reply'));
  // The search box filters; clearing it restores every card.
  ids.q.handlers.input({ target: { value: 'quokka' } });
  assert.deepEqual(ids.lanes.children.map((c) => c.children[1].children.length), [0, 1, 0, 0, 0]);
  ids.q.handlers.input({ target: { value: '' } });
  assert.deepEqual(ids.lanes.children.map((c) => c.children[1].children.length), [1, 1, 1, 1, 1]);
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
  writeFile(dir, '.laneconductor.json', JSON.stringify({ project: { name: 'Done Failures' } }));
  const t = (n, title, lane, status) => writeFile(dir, `conductor/tracks/AM-${n}-t${n}/index.md`, INDEX(n, title, { lane, status }));
  for (let n = 301; n <= 315; n++) t(n, `Finished with failure ${n}`, 'done', 'failure'); // 15: more than the usual 12 rows
  t(320, 'Fine one', 'done', 'success');
  t(321, 'Building', 'implement', 'running');
  commitAll(dir);
  const site = tmp('lc-site-donefail-');
  assert.equal(run(dir, '--site', site).status, 0);
  const data = JSON.parse(fs.readFileSync(path.join(site, 'board.json'), 'utf8'));
  assert.equal(data.attn.length, 0, 'a failure in the done lane is not an attention item');

  const ids = await runPage(async () => ({ ok: true, status: 200, json: async () => data }));
  const html = fs.readFileSync(PAGE, 'utf8');

  // No filter: no banner, Done shows its usual 12 rows, with a Status column.
  assert.equal(ids['filter-banner'].hidden, true);
  assert.equal(ids['done-rows'].children.length, 12);
  assert.match(html, /<th>Status<\/th><th>Progress<\/th>/);
  assert.match(html, /<th>Status<\/th><th>Why<\/th>/);

  const chip = ids.chips.children.find((c) => c._text === 'failure');
  assert.ok(chip, 'a failure chip exists');
  chip.onclick();
  const banner = ids['filter-banner'];
  assert.equal(banner.hidden, false);
  assert.equal(banner.textContent, '15 tracks have status failure: 15 in Done');
  const links = banner.children.filter((c) => c.tag === 'a');
  assert.deepEqual(links.map((a) => a.attrs.href), ['#done-block']);
  assert.ok(!/in lanes|Needs attention/.test(banner.textContent), 'only the places that hold matches are named');
  // Done opens to all 15 matches (not 12), each row with a status cell.
  assert.equal(ids['done-rows'].children.length, 15);
  const first = ids['done-rows'].children[0].children;
  assert.equal(first.length, 4, 'track, title, status, progress');
  assert.equal(first[2].children[0]._text, 'failure');
  assert.equal(first[2].children[0].className, 'pill failure');
  // Lane columns say "None here" and the banner explains where the matches are.
  const cols = ids.lanes.children;
  assert.equal(cols.length, 5);
  // Only the implement column holds a track (it does not match): it says "None here"; the others are plainly empty.
  assert.deepEqual(cols.map((c) => c.children[2]?._text), ['Empty.', 'Empty.', 'None here', 'Empty.', 'Empty.']);
  assert.ok(!ids.lanes.textContent.includes('Nothing matches the filter'));

  // A lane match is counted separately: "running" matches one card in a lane and no Done row.
  ids.chips.children.find((c) => c._text === 'running').onclick();
  assert.equal(ids['filter-banner'].textContent, '1 track has status running: 1 in lanes');
  assert.equal(ids['done-rows'].children.length, 0);
  // Back to all: the banner goes away.
  ids.chips.children.find((c) => c._text === 'all').onclick();
  assert.equal(ids['filter-banner'].hidden, true);
});
