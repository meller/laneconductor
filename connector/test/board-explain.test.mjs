// Track AM-10155 Phase 3: the board shows a track's explain.md as an "Agent run" tab and the project statistics as a "Statistics" tab.
//   TC-5 the tab exists when the file does; a file with a secret match is withheld with the standard placeholder
//   TC-10 the Statistics tab lists every track that has an explain.md, finished tracks included
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, writeFile, rm, INDEX } from './helpers/repo.mjs';
import { runPage, flush, restorePage } from './helpers/page-dom.mjs';
import { buildDoc } from '../src/board-docs.mjs';
import { renderStatistics } from '../src/explain.mjs';

const BOARD = new URL('../bin/lc-board.mjs', import.meta.url).pathname;
const EXPLAIN = new URL('../bin/lc-explain.mjs', import.meta.url).pathname;
const NOW = '2026-11-21T10:00:00.000Z';
const cleanup = [];
after(() => { restorePage(); rm(...cleanup); });
const real = fs.realpathSync(os.tmpdir());
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };

const EXPLAIN_MD = (folder, extra = '') => [
  `# Agent run: ${folder}`, '', 'Generated: 2026-11-21T09:00:00.000Z', '', '## Lane runs', '',
  '| Lane | Start (UTC) | End (UTC) | Wall | Agent | Human | Responses | Output | Fresh input | Cache created | Cache read | Tool calls | Sub-agent share |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  '| plan | 2026-11-20 09:00 | 2026-11-20 09:30 | 30m | 25m | 5m | 10 | 1,000 | 10 | 2,000 | 30,000 | 7 | 0% |',
  '| implement | 2026-11-20 10:00 | 2026-11-20 12:00 | 2h 00m | 1h 20m | 40m | 20 | 2,000 | 20 | 4,000 | 60,000 | 9 | 50% of responses, 40% of output |', '',
  '## Phases of the implement lane', '',
  '| Phase | Wall | Agent | Human | Responses | Output | Fresh input | Cache created | Cache read | Tool calls | Sub-agent share |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  '| Phase 1: First | 1h 00m | 20m | 40m | 12 | 1,200 | 12 | 2,400 | 36,000 | 5 | 0% |', '', extra,
].join('\n');

function fixture(explainFor = { 801: true, 802: true, 803: true }, extra = {}) {
  const repo = makeRepo({ prefix: 'lc-board-explain-' });
  cleanup.push(repo);
  writeFile(repo, '.laneconductor.json', JSON.stringify({ project: { name: 'Explain Fixture' } }));
  const t = (n, title, lane, status) => writeFile(repo, `conductor/tracks/AM-${n}-t${n}/index.md`, INDEX(n, title, { lane, status }));
  t(801, 'Live one', 'implement', 'running'); t(802, 'Plain one', 'plan', 'queue'); t(803, 'Shipped one', 'done', 'success');
  for (const n of [801, 802, 803]) writeFile(repo, `conductor/tracks/AM-${n}-t${n}/plan.md`, `# Plan ${n}\n`);
  for (const n of Object.keys(explainFor)) if (explainFor[n]) writeFile(repo, `conductor/tracks/AM-${n}-t${n}/explain.md`, EXPLAIN_MD(`AM-${n}-t${n}`, extra[n] ?? ''));
  return repo;
}
const site = (repo) => {
  const dir = tmp('lc-explain-site-');
  const r = spawnSync('node', [BOARD, '--repo', repo, '--now', NOW, '--site', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { dir, stderr: r.stderr };
};
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

test('buildDoc: explain is an optional field like conversation: absent file, no key', () => {
  const a = buildDoc({ number: 7, folder: 'AM-7-x', texts: { index: 'i', plan: 'p', spec: 's', test: 't', explain: null } });
  assert.deepEqual(a.doc, { n: 7, folder: 'AM-7-x', index: 'i', plan: 'p', spec: 's', test: 't' });
  const b = buildDoc({ number: 7, folder: 'AM-7-x', texts: { index: 'i', plan: 'p', spec: 's', test: 't', explain: '# Agent run\n' } });
  assert.equal(b.doc.explain, '# Agent run\n');
});

test('TC-5: docs/<n>.json carries explain only for a live track that has the file', () => {
  const { dir } = site(fixture({ 801: true, 803: true }));
  assert.ok(readJson(path.join(dir, 'docs/801.json')).explain.includes('Agent run'));
  assert.equal(readJson(path.join(dir, 'docs/802.json')).explain, undefined);
  assert.ok(!fs.existsSync(path.join(dir, 'docs/803.json')), 'a finished track carries no documents on the board (its numbers are in the Statistics tab)');
});

test('TC-5: the drawer shows an "Agent run" tab when the document has one, and the table renders', async () => {
  const { dir } = site(fixture({ 801: true, 803: true }));
  const data = readJson(path.join(dir, 'board.json'));
  const fetchStub = async (u) => {
    if (u === 'board.json') return { ok: true, status: 200, json: async () => data };
    const f = path.join(dir, u);
    return fs.existsSync(f) ? { ok: true, status: 200, json: async () => readJson(f) } : { ok: false, status: 404, json: async () => ({}) };
  };
  const ids = await runPage(fetchStub);
  const cards = ids.lanes.children.flatMap((l) => l.children[1]?.children ?? []);
  const card = cards.find((c) => c.textContent.includes('Live one'));
  card.handlers.click();
  await flush();
  const names = () => ids['d-tabs'].children.map((b) => b._text);
  assert.deepEqual(names(), ['Overview', 'Plan', 'Spec', 'Tests', 'Agent run']);
  ids['d-tabs'].children.find((b) => b._text === 'Agent run').onclick();
  await flush();
  assert.ok(ids['d-body'].textContent.includes('Lane runs'));
  assert.ok(ids['d-body'].textContent.includes('2h 00m'));
  ids['d-close'].onclick();
  cards.find((c) => c.textContent.includes('Plain one')).handlers.click();
  await flush();
  assert.ok(names().includes('Overview'));
  assert.ok(!names().includes('Agent run'), 'a track without the file has no tab once its documents are loaded');
});

test('TC-5: an explain.md with a secret match is withheld with the standard placeholder and never copied', () => {
  const { dir, stderr } = site(fixture({ 801: true }, { 801: 'contact jane.private@corp-secret.org\n' }));
  const doc = readJson(path.join(dir, 'docs/801.json'));
  assert.equal(doc.explain, undefined);
  assert.match(doc.withheld.explain, /^possible secret or personal data \(1 match\)$/);
  assert.ok(!JSON.stringify(doc).includes('corp-secret'));
  assert.match(stderr, /withheld track 801 explain\.md/);
});

test('TC-10: the Statistics tab lists every track that has an explain.md, finished tracks included', () => {
  const repo = fixture();
  const r = spawnSync('node', [EXPLAIN, '--repo', repo, '--statistics', '--now', NOW], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const stats = fs.readFileSync(path.join(repo, 'conductor/statistics.md'), 'utf8');
  for (const n of [801, 802, 803]) assert.ok(new RegExp(`^\\| AM-${n} \\|`, 'm').test(stats), `a row for track ${n}`);
  assert.match(stats, /^\| plan \| 3 \| 1h 30m \|/m, 'lane totals: three tracks of 30m');
  assert.match(stats, /^\| implement \| 3 \| 6h 00m \|/m);
  assert.match(stats, /^\| Phase 1 \| 3 \| 3h 00m \|/m);
  const { dir } = site(repo);
  const board = readJson(path.join(dir, 'board.json'));
  const tab = board.project_docs?.find?.((t) => t.k === 'statistics') ?? JSON.stringify(board).match(/"k":"statistics"[^}]*/);
  assert.ok(tab, 'the Project drawer has a Statistics tab');
  const ctx = readJson(path.join(dir, 'ctx/statistics.json'));
  assert.equal(ctx.t, 'Statistics');
  assert.ok(ctx.md.includes('AM-803'), 'the finished track is in it');
});

test('renderStatistics: no explain.md yet says how to make one', () => {
  assert.match(renderStatistics([], { now: NOW }), /No track has an explain\.md yet/);
});
