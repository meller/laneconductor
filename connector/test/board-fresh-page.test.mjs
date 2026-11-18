// Board freshness and refresh, the page side (track AM-10115): the chip next to the read time, Check now, the automatic check on the
// first interaction, and the Refresh board button. Fake DOM, no browser. The generation side (board.json `commit`) is in board-fresh.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { INDEX } from './helpers/repo.mjs';
import { boardPageData, buildBoard } from '../src/board.mjs';
import { runPage, restorePage, stubGlobal, unstub, flush, all, cls, ev } from './helpers/page-dom.mjs';

const HOST = 'host:plugin_laneconductor-parallel_lc';
const SHA1 = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const REACHABLE = [{ server: HOST, authStatus: 'unknown', tools: [{ name: 'get_track' }, { name: 'update_track' }, { name: 'list_tracks' }] }];
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
function dataAt(ageMin, { commit = SHA1 } = {}) {
  const entries = [{ folder: 'AM-901-one', index: { content: INDEX(901, 'One', { lane: 'plan', status: 'queue' }) } }];
  return boardPageData(buildBoard(entries, { generatedAt: minutesAgo(ageMin), project: 'Fresh' }), { commit });
}
const serve = (data) => async () => ({ ok: true, status: 200, json: async () => data });
const prov = (commit, extra = {}) => ({ payload: { ok: true, data: {}, provenance: { commit, branch: 'main', checkout_branch: 'main', ...extra } } });
/** A stand-in for the artifact runtime's `claude`. */
function fakeClaude({ servers = REACHABLE, handler = async () => prov(SHA1), listError = null } = {}) {
  const log = { use: [], listTools: [], calls: [] };
  const mcp = {
    listTools: async (s) => { log.listTools.push(s); if (listError) throw listError; return { servers }; },
    callTool: async (server, tool, input) => { log.calls.push([server, tool, input]); return handler(tool, input); },
  };
  return { log, claude: { use: async (n) => { log.use.push(n); return mcp; } } };
}
const chip = (ids) => all(ids.stamp, cls('fchip'))[0];
const checkBtn = (ids) => all(ids.stamp, (x) => x.tag === 'button' && (x._text === 'Check now' || x._text === 'Checking'))[0];
const headRefresh = (ids) => all(ids.stamp, (x) => x.tag === 'button' && x._text === 'Refresh board')[0];
const footRefresh = (ids) => all(ids['foot-refresh'], (x) => x.tag === 'button' && x._text === 'Refresh board')[0];
const click = (b) => b.handlers.click({ stopPropagation() {}, preventDefault() {} });

after(() => { unstub(); restorePage(); });

test('chip, no connector: the age in words, never a claim of exactness, "may be out of date" only after an hour', async () => {
  let ids = await runPage(serve(dataAt(5)));
  assert.equal(chip(ids).textContent, 'Read 5 min ago');
  assert.ok(!/out of date|up to date/i.test(chip(ids).textContent));
  ids = await runPage(serve(dataAt(59)));
  assert.ok(!/may be out of date/.test(chip(ids).textContent), 'under an hour: no warning');
  ids = await runPage(serve(dataAt(65)));
  assert.equal(chip(ids).textContent, 'Read 65 min ago, may be out of date');
  ids = await runPage(serve(dataAt(180)));
  assert.equal(chip(ids).textContent, 'Read 3 h ago, may be out of date');
  ids = await runPage(serve(dataAt(60 * 24 * 4)));
  assert.equal(chip(ids).textContent, 'Read 4 days ago, may be out of date');
  assert.ok(checkBtn(ids).hidden, 'no Check now without a connector');
  assert.ok(!/desktop app|error|connector/i.test(ids.stamp.textContent), 'nothing is said about a missing connector');
});

test('chip, connector present but the board has no commit (an older board.json): no Check now, age only, nothing read', async () => {
  const { claude, log } = fakeClaude();
  stubGlobal('claude', claude);
  try {
    const d = dataAt(5); delete d.commit; delete d.commit_short;
    const ids = await runPage(serve(d));
    assert.ok(checkBtn(ids).hidden);
    ids.__doc.handlers.pointerdown({});
    await flush();
    assert.deepEqual(log.calls, []);
    assert.equal(chip(ids).textContent, 'Read 5 min ago');
  } finally { unstub(); }
});

test('connector, same commit: Check now reads list_tracks with limit 1 and the chip says Up to date', async () => {
  const { claude, log } = fakeClaude({ handler: async () => prov(SHA1) });
  stubGlobal('claude', claude);
  try {
    const ids = await runPage(serve(dataAt(200)));
    assert.deepEqual(log.listTools, [], 'no probe on load');
    assert.deepEqual(log.calls, [], 'no call on load');
    const b = checkBtn(ids);
    assert.equal(b.hidden, false, 'the capability is there, so the button is drawn');
    assert.match(chip(ids).textContent, /may be out of date/);
    click(b);
    await flush();
    assert.deepEqual(log.calls, [[HOST, 'list_tracks', { limit: 1 }]]);
    assert.equal(chip(ids).textContent, 'Up to date');
    assert.ok(cls('ok')(chip(ids)), 'a class for the theme colour; the words say it too');
  } finally { unstub(); }
});

test('connector, different commit: Out of date, the repository has moved on, and Press Refresh board; no commit count is invented', async () => {
  const { claude } = fakeClaude({ handler: async () => prov(SHA2) });
  stubGlobal('claude', claude);
  try {
    const ids = await runPage(serve(dataAt(5)));
    click(checkBtn(ids));
    await flush();
    assert.equal(chip(ids).textContent, 'Out of date: the repository has moved on. Press Refresh board.');
    assert.ok(cls('late')(chip(ids)));
    assert.ok(!/\d+ commit/.test(chip(ids).textContent));
  } finally { unstub(); }
});

test('a short or prefixed commit still compares; a later check that finds the same commit flips the chip back', async () => {
  let head = SHA2;
  const { claude } = fakeClaude({ handler: async () => prov(head) });
  stubGlobal('claude', claude);
  try {
    const ids = await runPage(serve(dataAt(5)));
    click(checkBtn(ids)); await flush();
    assert.match(chip(ids).textContent, /^Out of date/);
    head = SHA1;
    click(checkBtn(ids)); await flush();
    assert.equal(chip(ids).textContent, 'Up to date');
    head = SHA1.slice(0, 7);
    click(checkBtn(ids)); await flush();
    assert.equal(chip(ids).textContent, 'Up to date', 'a 7-character provenance commit is a prefix of the full one');
  } finally { unstub(); }
});

test('the first interaction checks once, automatically, and never again by itself; Check now only ever calls list_tracks', async () => {
  const { claude, log } = fakeClaude({ handler: async () => prov(SHA2) });
  stubGlobal('claude', claude);
  try {
    const ids = await runPage(serve(dataAt(5)));
    assert.deepEqual(log.calls, []);
    ids.__doc.handlers.pointerdown({});
    await flush();
    assert.deepEqual(log.calls, [[HOST, 'list_tracks', { limit: 1 }]]);
    assert.match(chip(ids).textContent, /^Out of date/);
    ids.__doc.handlers.keydown(ev('a')); ids.__doc.handlers.pointerdown({});
    await flush();
    assert.equal(log.calls.length, 1, 'one automatic check');
    click(checkBtn(ids)); await flush();
    assert.equal(log.calls.length, 2, 'Check now checks again');
    assert.ok(log.calls.every((c) => c[1] === 'list_tracks'), 'only the read-only list is called: Check now never writes');
  } finally { unstub(); }
});

test('the keyboard is an interaction too', async () => {
  const { claude, log } = fakeClaude();
  stubGlobal('claude', claude);
  try {
    const ids = await runPage(serve(dataAt(5)));
    ids.__doc.handlers.keydown(ev('Tab'));
    await flush();
    assert.equal(log.calls.length, 1);
    assert.equal(chip(ids).textContent, 'Up to date');
  } finally { unstub(); }
});

test('probe failure: every way the connector is unreachable falls back to the age only, silently', async () => {
  const cases = [
    fakeClaude({ listError: Object.assign(new Error('x'), { code: 'server_not_connected' }) }),
    fakeClaude({ servers: [] }),
    fakeClaude({ servers: [{ server: HOST, tools: [{ name: 'get_track' }, { name: 'update_track' }] }] }),
    { claude: { use: async () => { throw Object.assign(new Error('x'), { code: 'not_granted' }); } }, log: { calls: [] } },
    { claude: { use: async () => null }, log: { calls: [] } },
  ];
  for (const { claude, log } of cases) {
    stubGlobal('claude', claude);
    try {
      const ids = await runPage(serve(dataAt(125)));
      ids.__doc.handlers.pointerdown({});
      await flush();
      const b = checkBtn(ids);
      if (!b.hidden) { click(b); await flush(); }
      assert.equal(chip(ids).textContent, 'Read 2 h ago, may be out of date');
      assert.ok(b.hidden, 'no Check now left to press');
      assert.deepEqual(log.calls, []);
      assert.ok(!/error|fail|connector|desktop/i.test(ids.stamp.textContent));
    } finally { unstub(); }
  }
});

test('a check that fails after the probe keeps the age and says so in a neutral line; so does a provenance it cannot compare', async () => {
  const handlers = [
    async () => { throw Object.assign(new Error('x'), { code: 'approval_required' }); },
    async () => ({ payload: { ok: false, error: { code: 'X', message: 'no' }, provenance: { commit: SHA2 } } }),
    async () => prov('not a sha'),
    async () => prov(SHA2, { checkout_branch: 'side' }),
  ];
  for (const handler of handlers) {
    const { claude } = fakeClaude({ handler });
    stubGlobal('claude', claude);
    try {
      const ids = await runPage(serve(dataAt(5)));
      ids.__doc.handlers.pointerdown({}); await flush();
      assert.equal(chip(ids).textContent, 'Read 5 min ago', 'the automatic check stays silent');
      click(checkBtn(ids)); await flush();
      assert.match(chip(ids).textContent, /^Read 5 min ago \(could not (check|compare) just now\)$/);
      assert.ok(!/Out of date|Up to date/.test(chip(ids).textContent));
    } finally { unstub(); }
  }
});

test('Refresh board: header and footer buttons copy /laneconductor:board refresh inside the click; the footer says only Claude can rebuild and publish', async () => {
  const written = [];
  stubGlobal('navigator', { clipboard: { writeText(t) { written.push(t); return Promise.resolve(); } } });
  try {
    const ids = await runPage(serve(dataAt(5)));
    assert.ok(headRefresh(ids) && footRefresh(ids), 'a button beside the chip and one in the footer');
    for (const b of [headRefresh(ids), footRefresh(ids)]) {
      const e = { stopped: false, stopPropagation() { this.stopped = true; } };
      b.handlers.click(e);
      assert.equal(written.at(-1), '/laneconductor:board refresh', 'written synchronously, in the click');
      assert.equal(e.stopped, true);
    }
    await flush();
    assert.equal(written.length, 2);
    assert.equal(all(ids['foot-refresh'], cls('fnote'))[0].textContent, 'Copied; paste it into your Claude session');
    assert.match(ids['foot-refresh'].textContent, /Only Claude can rebuild and republish a board; this page cannot/);
    assert.ok(all(ids['foot-refresh'], (x) => x.tag === 'code').some((c) => c.textContent === '/laneconductor:board refresh'));
  } finally { unstub(); }
});

test('Refresh board: a refused clipboard falls back to selecting the command; no clipboard API at all says to press Ctrl+C', async () => {
  const sel = {};
  stubGlobal('navigator', { clipboard: { writeText() { return Promise.reject(new Error('NotAllowedError')); } } });
  stubGlobal('window', { getSelection: () => ({ removeAllRanges() { sel.cleared = true; }, addRange(r) { sel.range = r; } }) });
  try {
    const ids = await runPage(serve(dataAt(5)));
    ids.__doc.createRange = () => ({ selectNodeContents(n) { sel.node = n; } });
    click(footRefresh(ids)); await flush();
    assert.equal(sel.node.textContent, '/laneconductor:board refresh');
    assert.equal(all(ids['foot-refresh'], cls('fnote'))[0].textContent, 'Selected; press Ctrl+C to copy');
  } finally { unstub(); }
  stubGlobal('navigator', {});
  try {
    const ids = await runPage(serve(dataAt(5)));
    click(headRefresh(ids)); await flush();
    assert.match(all(ids.stamp, cls('fnote'))[0].textContent, /Ctrl\+C/);
  } finally { unstub(); }
});

test('the Refresh button never touches the connector', async () => {
  const { claude, log } = fakeClaude();
  stubGlobal('claude', claude);
  stubGlobal('navigator', { clipboard: { writeText: () => Promise.resolve() } });
  try {
    const ids = await runPage(serve(dataAt(5)));
    click(footRefresh(ids)); click(headRefresh(ids)); await flush();
    assert.deepEqual(log.calls, []);
    assert.deepEqual(log.listTools, []);
  } finally { unstub(); }
});

test('hostile strings stay text: a hostile commit, generated_at or provenance never reaches markup or the chip', async () => {
  const hostile = '<img src=x onerror=alert(1)>';
  let ids = await runPage(serve({ ...dataAt(5), commit: hostile, commit_short: hostile }));
  assert.ok(checkBtn(ids).hidden, 'a commit that is not a hash is not compared');
  assert.ok(!ids.stamp.textContent.includes('onerror'));
  ids = await runPage(serve({ ...dataAt(5), generated_at: hostile }));
  assert.equal(chip(ids).textContent, 'Read time unknown; may be out of date');
  assert.ok(!ids.stamp.textContent.includes('onerror'));
  const { claude } = fakeClaude({ handler: async () => ({ payload: { ok: true, provenance: { commit: hostile, line: hostile, branch: hostile } } }) });
  stubGlobal('claude', claude);
  try {
    ids = await runPage(serve(dataAt(5)));
    click(checkBtn(ids)); await flush();
    assert.ok(!chip(ids).textContent.includes('<img'), 'provenance text is never copied into the chip');
    assert.ok(!ids.__doc.created.includes('img') && !ids.__doc.created.includes('script'), 'only known tags are created');
  } finally { unstub(); }
});

test('page source: no innerHTML; the page calls only get_track, update_track (Move) and list_tracks (Check now); the old refresh phrase is gone', () => {
  const html = fs.readFileSync(new URL('../src/board-page.html', import.meta.url), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(html));
  const tools = [...new Set([...html.matchAll(/callTool\([^,]+,\s*'([a-z_]+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(tools, ['get_track', 'list_tracks', 'update_track']);
  assert.ok(html.includes('/laneconductor:board refresh'));
  assert.ok(!/update the board/.test(html));
});
