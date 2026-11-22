// Track AM-10155 Phase 6 (D11): the documents of finished tracks are published in shards, so a project with hundreds of finished tracks
// stays far below the 200-file limit, and a finished track opens in the page with the same tabs as a live one (Agent run included).
//   TC-15 a board of 300 finished tracks: file count, shard pointer on each finished track, the page loads one shard once, the secret scan,
//         the settings, the manifest (partial publish, removed shard)
//   TC-16 the footer says finished tracks are included in what sharing the board shares
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, writeFile, commitAll, git, rm, INDEX } from './helpers/repo.mjs';
import { FAKES } from './helpers/fakes.mjs';
import { runPage, flush, restorePage, all } from './helpers/page-dom.mjs';
import { selectDoneTracks, packShards, buildDoc, MAX_DOCS, DONE_SHARD_TRACKS, DONE_SHARD_BYTES } from '../src/board-docs.mjs';
import { carriesWithheld, parseManifest, buildManifest, planPublish } from '../src/board-manifest.mjs';

const BIN = new URL('../bin/lc-board.mjs', import.meta.url).pathname;
const PAGE_FILE = new URL('../src/board-page.html', import.meta.url).pathname;
const T1 = '2026-11-22T10:00:00.000Z';
const T2 = '2026-11-22T11:00:00.000Z';
const cleanup = [];
after(() => { restorePage(); rm(...cleanup); });
const real = fs.realpathSync(os.tmpdir());
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const folderOf = (n) => `AM-${n}-done-${n}`;
const EXPLAIN = (n) => `# Agent run: AM-${n}\n\n## Lane runs\n\n| Lane | Wall |\n| --- | --- |\n| implement | 1h 00m |\n`;

/** A project with `done` finished tracks (numbers 1..done) and two live ones (9001 plan, 9002 implement). */
function project({ done = 300, board, big = {}, secretIn = null } = {}) {
  const repo = makeRepo({ prefix: 'lc-shards-' });
  cleanup.push(repo);
  writeFile(repo, '.laneconductor.json', JSON.stringify({ project: { name: 'Shard Fixture' }, ...(board ? { board } : {}) }));
  const idx = (n, lane, status) => writeFile(repo, `conductor/tracks/${folderOf(n)}/index.md`, INDEX(n, `Track ${n}`, { lane, status }));
  for (let n = 1; n <= done; n += 1) {
    idx(n, 'done', 'success');
    writeFile(repo, `conductor/tracks/${folderOf(n)}/plan.md`, `# Plan ${n}\n\n${big[n] ? 'x'.repeat(big[n]) : `- [x] Task 1 of ${n}`}\n`);
    writeFile(repo, `conductor/tracks/${folderOf(n)}/spec.md`, `# Spec ${n}\n\nSPEC-${n}${big[n] ? `\n\n${'y'.repeat(big[n])}` : ''}\n`);
    writeFile(repo, `conductor/tracks/${folderOf(n)}/test.md`, `# Tests ${n}\n${big[n] ? `\n${'z'.repeat(big[n])}\n` : ''}`);
    writeFile(repo, `conductor/tracks/${folderOf(n)}/conversation.md`, `> **human**: hello on ${n}\n`);
  }
  writeFile(repo, `conductor/tracks/${folderOf(1)}/explain.md`, EXPLAIN(1));
  if (secretIn) writeFile(repo, `conductor/tracks/${folderOf(secretIn)}/spec.md`, `# Spec ${secretIn}\n\nthe key ${FAKES['Google API key']}\n`);
  idx(9001, 'plan', 'queue'); idx(9002, 'implement', 'running');
  writeFile(repo, `conductor/tracks/${folderOf(9001)}/plan.md`, '# Plan 9001\n');
  commitAll(repo);
  return repo;
}
function board(repo, { now = T1, previous, args = [] } = {}) {
  const site = tmp('lc-shards-site-');
  const a = [BIN, '--repo', repo, '--now', now, '--site', site, '--json', ...args];
  if (previous !== undefined) a.push('--previous', previous);
  const r = spawnSync('node', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  return { site, out: JSON.parse(r.stdout), stderr: r.stderr, stdout: r.stdout, manifest: path.join(site, 'manifest.json') };
}
const saved = (run) => { const dir = tmp('lc-shards-live-'); const p = path.join(dir, 'prev.json'); fs.copyFileSync(run.manifest, p); return p; };
const shardFiles = (run) => run.out.files.filter((f) => f.startsWith('docs-done/'));
const fetchFor = (site) => {
  const calls = [];
  const fetchStub = async (u) => {
    calls.push(u);
    const f = path.join(site, u);
    if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) };
  };
  return { calls, fetchStub };
};
const tabNames = (ids) => ids['d-tabs'].children.map((b) => b._text);
const tabBy = (ids, name) => ids['d-tabs'].children.find((b) => b._text === name);
// The Done list shows the newest 12; "Show all" opens the rest. Returns the row of "Track <n>".
const doneRowOf = (ids, n) => {
  if (ids['done-more'].textContent.startsWith('Show all')) ids['done-more'].onclick();
  return all(ids['done-rows'], (e) => e.tag === 'tr' && new RegExp(`Track ${n}(?!\\d)`).test(e.textContent))[0];
};

test('unit: selectDoneTracks keeps finished, live-folder, unambiguous tracks in number order', () => {
  const tr = (number, folder, lane, archived = false) => ({ number, folder, lane, archived });
  const b = { tracks: [tr(5, 'AM-5-e', 'done'), tr(2, 'AM-2-a', 'done'), tr(3, 'AM-3-p', 'plan'), tr(4, 'AM-4-old', 'done', true), tr(7, 'AM-7-a', 'done'), tr(7, 'AM-7-b', 'done')] };
  assert.deepEqual(selectDoneTracks(b).map((k) => k.number), [2, 5], 'no live, no archived, no number shared by two folders');
});

test('unit: packShards cuts by track count and by size, in number order, and an oversized track gets a shard of its own', () => {
  const mk = (n, chars) => ({ number: n, folder: `AM-${n}-x`, doc: { n, folder: `AM-${n}-x`, plan: 'p'.repeat(chars) } });
  const small = Array.from({ length: 45 }, (_, i) => mk(i + 1, 10));
  const a = packShards(small);
  assert.deepEqual(a.map((s) => Object.keys(s.docs).length), [DONE_SHARD_TRACKS, DONE_SHARD_TRACKS, 5]);
  assert.deepEqual(a.map((s) => s.k), [1, 2, 3]);
  assert.deepEqual(Object.keys(a[0].docs).slice(0, 3), ['1', '2', '3']);
  const bytes = (s) => Buffer.byteLength(JSON.stringify(s));
  const bigs = Array.from({ length: 5 }, (_, i) => mk(i + 1, 400000));
  const b = packShards(bigs);
  assert.ok(b.length >= 3 && b.every((s) => bytes(s) <= DONE_SHARD_BYTES + 1000), 'split by size although there are only five tracks');
  const huge = packShards([mk(1, 10), mk(2, 2 * DONE_SHARD_BYTES), mk(3, 10)]);
  assert.deepEqual(huge.map((s) => Object.keys(s.docs)), [['1'], ['2'], ['3']], 'the oversized one is alone, the neighbours are not merged across it');
  assert.deepEqual(packShards([]), []);
});

test('unit: the manifest knows a shard path, and a shard that holds a withheld placeholder is hashed like any other (an unchanged shard is not resent)', () => {
  const clean = JSON.stringify({ k: 1, docs: { 1: { n: 1, folder: 'a', plan: 'p' } } });
  const dirty = JSON.stringify({ k: 2, docs: { 3: { n: 3, folder: 'b', plan: 'p' }, 4: { n: 4, folder: 'c', withheld: { spec: 'possible secret or personal data (1 match)' } } } });
  assert.equal(carriesWithheld(clean), false);
  assert.equal(carriesWithheld(dirty), false, 'unlike a live docs file: a shard is about 1 MB, resending it on every refresh would defeat the partial publish, and it holds only the placeholder');
  assert.equal(carriesWithheld(JSON.stringify({ n: 4, folder: 'c', withheld: { spec: 'x' } })), true, 'a live docs file still carries it');
  const m = buildManifest({ pageBytes: Buffer.from('x'), files: { 'board.json': '{}', 'docs-done/1.json': clean, 'docs-done/2.json': dirty } });
  assert.deepEqual(Object.keys(m.files), ['board.json', 'docs-done/1.json', 'docs-done/2.json']);
  assert.deepEqual(parseManifest(JSON.stringify(m)), m, 'a manifest with a shard path is accepted, not rejected as foreign');
  const p = planPublish({ current: m, allFiles: ['board.json', 'docs-done/1.json', 'docs-done/2.json'], previous: m });
  assert.equal(p.mode, 'partial');
  assert.deepEqual(p.changed, []);
  const gone = planPublish({ current: m, allFiles: ['board.json'], previous: m });
  assert.deepEqual(gone.removed, ['docs-done/1.json', 'docs-done/2.json']);
  assert.equal(gone.publish['docs-done/1.json'], null);
});

test('TC-15: 300 finished tracks give a board far below the file limit, every finished track names its shard, and the live tracks are as before', () => {
  const run = board(project());
  const shards = shardFiles(run);
  assert.equal(shards.length, Math.ceil(300 / DONE_SHARD_TRACKS), '300 tracks of small documents: 15 shards of 20');
  assert.ok(run.out.files.length <= MAX_DOCS, `${run.out.files.length} files stay under the limit`);
  assert.equal(run.out.files.length, 19, 'board.json, the workflow ctx file, 2 live docs and 15 shards');
  assert.ok(run.out.files.includes('docs/9001.json') && run.out.files.includes('docs/9002.json'));
  assert.ok(!run.out.files.some((f) => /^docs\/\d{1,3}\.json$/.test(f)), 'no one-file-per-finished-track');
  const data = readJson(path.join(run.site, 'board.json'));
  const done = data.tracks.filter((t) => t.l === 'done');
  assert.equal(done.length, 300);
  for (const t of done) { assert.ok(Number.isInteger(t.ds) && shards.includes(`docs-done/${t.ds}.json`), `track ${t.n} names its shard`); assert.equal(t.d, false, 'the flag of a one-file-per-track doc stays for live tracks'); }
  for (const t of data.tracks.filter((x) => x.l !== 'done')) assert.ok(!('ds' in t) && t.d === true, 'live tracks carry no shard pointer');
  const sh = readJson(path.join(run.site, 'docs-done/1.json'));
  assert.equal(sh.k, 1);
  assert.equal(Object.keys(sh.docs).length, DONE_SHARD_TRACKS);
  assert.equal(sh.docs['7'].plan, '# Plan 7\n\n- [x] Task 1 of 7\n');
  assert.equal(sh.docs['7'].n, 7);
  assert.ok(!('conversation' in sh.docs['7']), 'the conversation is off by default');
  assert.equal(sh.docs['1'].explain, EXPLAIN(1), 'the Agent run document is in the shard');
  for (const f of shards) assert.ok(fs.statSync(path.join(run.site, f)).size <= DONE_SHARD_BYTES + 5000, `${f} is about 1 MB at most`);
  const m = readJson(run.manifest);
  for (const f of run.out.files) assert.ok(f in m.files, `${f} is in the manifest`);
});

test('TC-15: the page opens a finished track with the same tabs as a live one, loads its shard once (cached), and shows the placeholder of a withheld document', async () => {
  const repo = project({ secretIn: 3 });
  const run = board(repo);
  assert.ok(!run.stdout.includes(FAKES['Google API key']) && !run.stderr.includes(FAKES['Google API key']), 'the secret is in no output');
  assert.match(run.stderr, /withheld track 3 spec\.md: 1 possible secret/);
  for (const f of run.out.files) assert.ok(!fs.readFileSync(path.join(run.site, f), 'utf8').includes(FAKES['Google API key']), `${f} holds no secret`);
  const { calls, fetchStub } = fetchFor(run.site);
  const board_ = readJson(path.join(run.site, 'board.json'));
  const ids = await runPage(async (u) => (u === 'board.json' ? { ok: true, status: 200, json: async () => board_ } : fetchStub(u)));
  doneRowOf(ids, 1).handlers.click();
  await flush();
  assert.deepEqual(tabNames(ids), ['Overview', 'Plan', 'Spec', 'Tests', 'Agent run'], 'the same tabs as a live track');
  assert.deepEqual(calls.filter((u) => u.startsWith('docs')), ['docs-done/1.json']);
  tabBy(ids, 'Plan').onclick(); await flush();
  assert.ok(ids['d-body'].textContent.includes('Plan 1'));
  tabBy(ids, 'Agent run').onclick(); await flush();
  assert.ok(ids['d-body'].textContent.includes('Agent run: AM-1') || ids['d-body'].textContent.includes('Lane runs'));
  // Another track of the same shard: no second request.
  ids['d-close'].onclick();
  doneRowOf(ids, 2).handlers.click();
  await flush();
  tabBy(ids, 'Spec').onclick(); await flush();
  assert.ok(ids['d-body'].textContent.includes('SPEC-2'));
  assert.deepEqual(calls.filter((u) => u.startsWith('docs')), ['docs-done/1.json'], 'the shard is fetched once');
  // The withheld one.
  doneRowOf(ids, 3).handlers.click();
  await flush();
  tabBy(ids, 'Spec').onclick(); await flush();
  assert.ok(ids['d-body'].textContent.includes('withheld: possible secret or personal data (1 match)'));
  assert.ok(!ids['d-body'].textContent.includes(FAKES['Google API key']));
  // A finished track of the Agent run tab with no explain.md has the same placeholder text as a live one.
  doneRowOf(ids, 2).handlers.click();
  await flush();
  tabBy(ids, 'Agent run').onclick(); await flush();
  assert.match(ids['d-body'].textContent, /No statistics yet/);
  // A track of another shard loads that shard.
  doneRowOf(ids, 45).handlers.click();
  await flush();
  assert.deepEqual(calls.filter((u) => u.startsWith('docs')), ['docs-done/1.json', 'docs-done/3.json']);
});

test('TC-15: a shard that cannot be loaded names its own file in the error', async () => {
  const run = board(project({ done: 25 }));
  const board_ = readJson(path.join(run.site, 'board.json'));
  const ids = await runPage(async (u) => (u === 'board.json' ? { ok: true, status: 200, json: async () => board_ } : { ok: false, status: 404, json: async () => ({}) }));
  doneRowOf(ids, 21).handlers.click();
  await flush();
  assert.match(ids['d-body'].textContent, /Could not load docs-done\/2\.json/);
});

test('TC-15: board.include_docs false: no shard, no pointer, the drawer says the board does not publish documents; include_conversation adds the conversation', () => {
  const off = board(project({ done: 30, board: { include_docs: false } }));
  assert.deepEqual(shardFiles(off), []);
  assert.ok(!fs.existsSync(path.join(off.site, 'docs-done')));
  assert.ok(readJson(path.join(off.site, 'board.json')).tracks.every((t) => !('ds' in t)));
  const conv = board(project({ done: 30, board: { include_conversation: true } }));
  assert.equal(readJson(path.join(conv.site, 'docs-done/1.json')).docs['5'].conversation, '> **human**: hello on 5\n');
  const noConv = board(project({ done: 30 }));
  assert.ok(!('conversation' in readJson(path.join(noConv.site, 'docs-done/1.json')).docs['5']));
});

test('TC-15: a few very large tracks split by size, and the shard files stay under the cap', () => {
  const run = board(project({ done: 6, big: { 1: 70000, 2: 70000, 3: 70000, 4: 70000, 5: 70000, 6: 70000 } }));
  const shards = shardFiles(run);
  assert.ok(shards.length >= 2, 'six large tracks do not fit one shard of about 1 MB');
  for (const f of shards) assert.ok(fs.statSync(path.join(run.site, f)).size <= DONE_SHARD_BYTES + 5000);
});

test('TC-15: partial publish: an unchanged rerun resends no shard; one edited finished track changes only its shard; a shard that goes away is removed', () => {
  const repo = project({ done: 45 });
  const first = board(repo);
  const prev = saved(first);
  const same = board(repo, { now: T2, previous: prev });
  assert.equal(same.out.mode, 'partial');
  assert.deepEqual(same.out.changed, ['board.json'], 'no shard is sent again');
  assert.equal(same.out.publish['docs-done/1.json'], undefined);
  writeFile(repo, `conductor/tracks/${folderOf(25)}/plan.md`, '# Plan 25\n\nedited\n');
  commitAll(repo);
  const one = board(repo, { now: T2, previous: prev });
  assert.deepEqual(one.out.changed, ['board.json', 'docs-done/2.json'], 'only the shard that holds track 25');
  assert.equal(one.out.publish['docs-done/2.json'], 'docs-done/2.json');
  // A withheld document inside a shard: the shard is still unchanged on the next run.
  writeFile(repo, `conductor/tracks/${folderOf(5)}/spec.md`, `# Spec 5\n\nthe key ${FAKES['Google API key']}\n`);
  commitAll(repo);
  const w1 = board(repo, { now: T2, previous: prev });
  assert.deepEqual(w1.out.changed, ['board.json', 'docs-done/1.json', 'docs-done/2.json'], 'track 5 (shard 1) and the edit of track 25 (shard 2) since the first run');
  const wprev = saved(w1);
  const w2 = board(repo, { now: T2, previous: wprev });
  assert.deepEqual(w2.out.changed, [], 'the shard that holds a placeholder is not sent again (same --now: board.json is identical too)');
  // Fewer finished tracks: the last shard is gone and is removed.
  for (let n = 41; n <= 45; n += 1) fs.rmSync(path.join(repo, `conductor/tracks/${folderOf(n)}`), { recursive: true });
  commitAll(repo);
  const gone = board(repo, { now: T2, previous: prev });
  assert.deepEqual(gone.out.removed, ['docs-done/3.json']);
  assert.equal(gone.out.publish['docs-done/3.json'], null);
  assert.ok(!fs.existsSync(path.join(gone.site, 'docs-done/3.json')));
});

test('TC-15: the shards count toward the file limit: live documents get what is left', () => {
  const repo = makeRepo({ prefix: 'lc-shards-cap-' });
  cleanup.push(repo);
  writeFile(repo, '.laneconductor.json', JSON.stringify({ project: { name: 'Cap' } }));
  for (let n = 1; n <= 100; n += 1) writeFile(repo, `conductor/tracks/${folderOf(n)}/index.md`, INDEX(n, `T${n}`, { lane: 'done', status: 'success' }));
  for (let n = 501; n <= 720; n += 1) writeFile(repo, `conductor/tracks/${folderOf(n)}/index.md`, INDEX(n, `L${n}`, { lane: 'plan', status: 'queue' }));
  commitAll(repo);
  const run = board(repo);
  const shards = shardFiles(run).length;
  assert.equal(shards, 5);
  const ctx = run.out.files.filter((f) => f.startsWith('ctx/')).length;
  assert.ok(run.out.files.length <= MAX_DOCS + 1, `${run.out.files.length} files (board.json included)`);
  assert.equal(run.out.files.filter((f) => /^docs\/\d+\.json$/.test(f)).length, MAX_DOCS - shards - ctx);
  assert.equal(readJson(path.join(run.site, 'board.json')).docs_dropped, 220 - (MAX_DOCS - shards - ctx));
});

test('TC-15: buildDoc gives the same document in a shard as in a one-file doc (same placeholders)', () => {
  const texts = { index: 'i', plan: 'p', spec: `key ${FAKES['Google API key']}`, test: 't', explain: null };
  const { doc } = buildDoc({ number: 9, folder: 'AM-9-x', texts });
  const [s] = packShards([{ number: 9, folder: 'AM-9-x', doc }]);
  assert.deepEqual(s.docs['9'], doc);
  assert.equal(s.docs['9'].withheld.spec, 'possible secret or personal data (1 match)');
});

test('TC-16: the footer says that finished tracks are included in what sharing the board shares', () => {
  const html = fs.readFileSync(PAGE_FILE, 'utf8');
  const footer = html.slice(html.indexOf('<footer>'), html.indexOf('</footer>'));
  assert.match(footer, /Sharing the board shares these documents, including the documents of finished tracks and the project definition files\./);
  assert.ok(!/do not carry their documents/.test(html), 'the old statement that finished tracks carry no documents is gone');
});

test('TC-15: a finished track keeps its Open in GitHub link beside the tabs; with documents off it shows the plain note (no GitHub address is published then, as before)', async () => {
  const on = project({ done: 3 });
  git(on, 'remote', 'add', 'origin', 'git@github.com:acme/widgets.git');
  const run = board(on);
  const data = readJson(path.join(run.site, 'board.json'));
  const { fetchStub } = fetchFor(run.site);
  const ids = await runPage(async (u) => (u === 'board.json' ? { ok: true, status: 200, json: async () => data } : fetchStub(u)));
  doneRowOf(ids, 2).handlers.click();
  await flush();
  const links = all(ids['d-lnks'], (e) => e.tag === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].attrs.href, 'https://github.com/acme/widgets/tree/main/conductor/tracks/AM-2-done-2');
  const off = project({ done: 3, board: { include_docs: false } });
  git(off, 'remote', 'add', 'origin', 'git@github.com:acme/widgets.git');
  const run2 = board(off);
  const data2 = readJson(path.join(run2.site, 'board.json'));
  const ids2 = await runPage(async (u) => (u === 'board.json' ? { ok: true, status: 200, json: async () => data2 } : { ok: false, status: 404, json: async () => ({}) }));
  doneRowOf(ids2, 2).handlers.click();
  await flush();
  assert.equal(ids2['d-tabs'].hidden, true);
  assert.match(ids2['d-body'].textContent, /This board does not publish documents for this track\./);
  assert.equal(all(ids2['d-body'], (e) => e.tag === 'a').length, 0, 'gh is only published with the documents, unchanged');
});
