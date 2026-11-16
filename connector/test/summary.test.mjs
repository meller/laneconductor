// Phase 3b: the generated track summary (conductor/tracks-summary.md).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, git, writeFile, readFile, commitAll, rm, INDEX } from './helpers/repo.mjs';
import { blobSha } from '../src/blob.mjs';
import { SUMMARY_PATH, checkSummary, generateSummary, summaryStamp } from '../src/summary.mjs';

const BIN_SUMMARY = new URL('../bin/lc-summary.mjs', import.meta.url).pathname;
const LANES = ['plan', 'implement', 'review', 'quality-gate', 'done'];
const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});
const fixture = () => {
  const dir = makeRepo();
  cleanup.push(dir);
  return dir;
};
const open = async (dir) => {
  const s = await connect(dir);
  sessions.push(s);
  return s;
};
const T = (n, slug) => `conductor/tracks/AM-${n}-${slug}`;
const entry = (n, slug, content) => ({ folder: `AM-${n}-${slug}`, index: content === null ? null : { content, sha: blobSha(content) } });
const filesOf = (dir, rev = 'HEAD') => git(dir, 'show', '--name-only', '--format=', rev).split('\n').sort();

test('generateSummary: sorted rows, blob-sha source, escaped cells, same input and stamp give identical text', () => {
  const a = INDEX(2, 'Two | with pipe', { lane: 'implement', status: 'running', extra: '**Depends On**: AM-1\n' });
  const entries = [entry(2, 'two', a), entry(1, 'one', INDEX(1, 'One'))];
  const g = generateSummary(entries, { lanes: LANES, generatedAt: '2026-11-16T10:00:00Z' });
  const rows = g.text.split('\n').filter((l) => l.startsWith('| AM-'));
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^\| AM-1 \| One \| plan \| queue \| 0% \|/);
  assert.match(rows[1], /Two \\\| with pipe \| implement \| running/);
  assert.ok(rows[1].includes(`| 1 | ${blobSha(a).slice(0, 12)} |`), rows[1]);
  assert.equal(g.attention.length, 0);
  assert.match(g.text, /^<!-- GENERATED/);
  assert.equal(summaryStamp(g.text), '2026-11-16T10:00:00Z');
  assert.equal(generateSummary([...entries].reverse(), { lanes: LANES, generatedAt: '2026-11-16T10:00:00Z' }).text, g.text);
});

test('generateSummary: lint puts invalid lane, bad status, missing markers, missing index.md and duplicate numbers under "needs attention"', () => {
  const entries = [
    entry(1, 'ok', INDEX(1, 'Fine')),
    entry(2, 'badlane', INDEX(2, 'Bad lane', { lane: 'impl' })),
    entry(3, 'badstatus', INDEX(3, 'Bad status', { status: 'done' })),
    entry(4, 'bare', '# Track AM-4: Bare\n\nno markers\n'),
    entry(5, 'noindex', null),
    entry(6, 'dup', INDEX(6, 'Dup A')),
    entry(6, 'dup-b', INDEX(6, 'Dup B')),
  ];
  const { attention, text } = generateSummary(entries, { lanes: LANES, generatedAt: '2026-11-16T10:00:00Z' });
  const byFolder = Object.fromEntries(attention.map((a) => [a.folder, a.problems.join(' ')]));
  assert.deepEqual(Object.keys(byFolder).sort(), ['AM-2-badlane', 'AM-3-badstatus', 'AM-4-bare', 'AM-5-noindex', 'AM-6-dup', 'AM-6-dup-b']);
  assert.match(byFolder['AM-2-badlane'], /Lane/);
  assert.match(byFolder['AM-3-badstatus'], /Lane Status/);
  assert.match(byFolder['AM-4-bare'], /Lane.*missing/);
  assert.match(byFolder['AM-5-noindex'], /no index\.md/);
  assert.match(byFolder['AM-6-dup'], /used by 2 folders/);
  assert.match(text, /## Needs attention\n\n- AM-2-badlane/);
});

test('checkSummary: missing, hand-edited and current files', () => {
  const entries = [entry(1, 'one', INDEX(1, 'One'))];
  const { text } = generateSummary(entries, { lanes: LANES, generatedAt: '2026-11-16T10:00:00Z' });
  assert.equal(checkSummary(null, entries, LANES).status, 'missing');
  assert.equal(checkSummary(text, entries, LANES).status, 'ok');
  assert.equal(checkSummary(text.replace('| plan |', '| done |'), entries, LANES).status, 'stale');
  assert.equal(checkSummary('# hand written\n', entries, LANES).status, 'stale');
  const changed = [entry(1, 'one', INDEX(1, 'One', { status: 'running' }))];
  assert.equal(checkSummary(text, changed, LANES).status, 'stale', 'an index.md edit behind the summary is detected');
});

test('create_track commits the summary in the SAME commit as the track files', async () => {
  const dir = fixture();
  const s = await open(dir);
  const before = Number(git(dir, 'rev-list', '--count', 'HEAD'));
  const r = await s.call('create_track', { title: 'Alpha feature', problem: 'Do alpha.' });
  assert.equal(r.isError, false, r.text);
  assert.equal(Number(git(dir, 'rev-list', '--count', 'HEAD')), before + 1, 'exactly one commit');
  const folder = r.env.data.track.folder;
  assert.deepEqual(filesOf(dir), [SUMMARY_PATH, ...['conversation', 'index', 'plan', 'spec', 'test'].map((n) => `conductor/tracks/${folder}/${n}.md`)].sort());
  const sum = readFile(dir, SUMMARY_PATH);
  assert.match(sum, new RegExp(`\\| ${r.env.data.track.id} \\| Alpha feature \\| plan \\| queue \\| 0% \\|`));
  assert.ok(sum.includes(blobSha(readFile(dir, `conductor/tracks/${folder}/index.md`)).slice(0, 12)));
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('update_track: a marker change regenerates the summary in the same commit; a spec-only change leaves a current summary alone', async () => {
  const dir = fixture();
  const s = await open(dir);
  const c = await s.call('create_track', { title: 'Beta', problem: 'Do beta.' });
  const { base, track } = c.env.data;
  const u = await s.call('update_track', { track: track.id, base, markers: { 'Lane Status': 'running', Progress: '40%' } });
  assert.equal(u.isError, false, u.text);
  assert.equal(u.env.data.summary_regenerated, true);
  assert.ok(filesOf(dir).includes(SUMMARY_PATH));
  assert.match(readFile(dir, SUMMARY_PATH), /\| plan \| running \| 40% \|/);
  const p = await s.call('update_track', { track: track.id, base: u.env.data.base, files: { plan: '# Plan\n\nsteps\n' } });
  assert.equal(p.isError, false, p.text);
  assert.equal(p.env.data.summary_regenerated, undefined);
  assert.deepEqual(filesOf(dir), [`conductor/tracks/${track.folder}/plan.md`]);
});

test('update_track on a repo with no summary yet writes one (writes self-heal the file)', async () => {
  const dir = fixture();
  writeFile(dir, `${T(1, 'one')}/index.md`, INDEX(1, 'One'));
  writeFile(dir, `${T(1, 'one')}/spec.md`, '# s\n');
  commitAll(dir);
  const s = await open(dir);
  const g = await s.call('get_track', { track: '1' });
  const u = await s.call('update_track', { track: '1', base: g.env.data.base, files: { spec: '# s2\n' } });
  assert.equal(u.isError, false, u.text);
  assert.deepEqual(filesOf(dir), [SUMMARY_PATH, `${T(1, 'one')}/spec.md`].sort());
});

test('list_tracks self-heals: a missing or hand-edited summary is reported in stale_reasons and the rows still come from the track files', async () => {
  const dir = fixture();
  writeFile(dir, `${T(1, 'one')}/index.md`, INDEX(1, 'One'));
  writeFile(dir, `${T(2, 'two')}/index.md`, INDEX(2, 'Two', { lane: 'implement', status: 'running' }));
  commitAll(dir);
  const s = await open(dir);
  const missing = await s.call('list_tracks');
  assert.deepEqual(missing.env.data.tracks.map((t) => t.id), ['AM-2', 'AM-1']);
  assert.ok(missing.env.provenance.stale_reasons.includes('track_summary_regenerated'));
  assert.notEqual(missing.env.provenance.freshness, 'fresh');
  assert.ok(missing.env.warnings.some((w) => /regenerated from a scan/.test(w)));
  // any track write creates the file; afterwards the reason is gone
  const g = await s.call('get_track', { track: '1' });
  await s.call('update_track', { track: '1', base: g.env.data.base, markers: { Progress: '10%' } });
  const ok = await s.call('list_tracks');
  assert.ok(!ok.env.provenance.stale_reasons.includes('track_summary_regenerated'), JSON.stringify(ok.env.provenance.stale_reasons));
  // a hand edit of the committed file (lane changed in the summary only) is caught, and the list still shows the truth
  writeFile(dir, SUMMARY_PATH, readFile(dir, SUMMARY_PATH).replace('| AM-2 | Two | implement |', '| AM-2 | Two | done |'));
  const edited = await s.call('list_tracks');
  assert.ok(edited.env.provenance.stale_reasons.includes('track_summary_regenerated'));
  assert.equal(edited.env.data.tracks.find((t) => t.id === 'AM-2').lane, 'implement');
  // an index.md edited by hand behind the summary's back is caught as well
  git(dir, 'checkout', '--', SUMMARY_PATH);
  writeFile(dir, `${T(1, 'one')}/index.md`, readFile(dir, `${T(1, 'one')}/index.md`).replace('**Progress**: 10%', '**Progress**: 90%'));
  const behind = await s.call('list_tracks');
  assert.ok(behind.env.provenance.stale_reasons.includes('track_summary_regenerated'));
  assert.equal(behind.env.data.tracks.find((t) => t.id === 'AM-1').progress, 90);
});

test('lc-summary CLI: --check exits 1 when missing, plain run writes without committing, --check then exits 0', () => {
  const dir = fixture();
  writeFile(dir, `${T(1, 'one')}/index.md`, INDEX(1, 'One'));
  commitAll(dir);
  const run = (...a) => spawnSync(process.execPath, [BIN_SUMMARY, '--repo', dir, ...a], { encoding: 'utf8' });
  assert.equal(run('--check').status, 1);
  const w = run();
  assert.equal(w.status, 0, w.stderr);
  assert.match(readFile(dir, SUMMARY_PATH), /\| AM-1 \| One \|/);
  assert.match(git(dir, 'status', '--porcelain'), /\?\? conductor\/tracks-summary\.md/);
  assert.equal(run('--check').status, 0);
});
