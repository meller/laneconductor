// Track AM-10141: claim stamp (Run Started, Run By), stale-running warnings, and the human-comment-mid-run warning.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, writeFile, readFile, commitAll, rm, INDEX } from './helpers/repo.mjs';
import { claimStamps, staleRunning, humanCommentSince } from '../src/claims.mjs';
import { buildBoard } from '../src/board.mjs';

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});
const T = (n, f = 'index.md') => `conductor/tracks/AM-${n}-t${n}/${f}`;

async function open(setup) {
  const dir = makeRepo();
  cleanup.push(dir);
  setup(dir);
  commitAll(dir, 'fixture');
  const s = await connect(dir);
  sessions.push(s);
  return { dir, s };
}

test('claimStamps: stamps on a claim, none on a re-claim, removes on release, respects explicit values', () => {
  const o = { now: Date.parse('2026-01-02T03:04:05.000Z'), who: 'agent c_1' };
  const queued = { Lane: 'plan', 'Lane Status': 'queue' };
  assert.deepEqual(claimStamps(queued, { 'Lane Status': 'running' }, o), { 'Run Started': '2026-01-02T03:04:05.000Z', 'Run By': 'agent c_1' });
  assert.equal(claimStamps({ ...queued, 'Lane Status': 'running' }, { 'Lane Status': 'running', Progress: '5%' }, o), null, 'still the same claim');
  assert.ok(claimStamps({ ...queued, 'Lane Status': 'running' }, { Lane: 'review', 'Lane Status': 'running' }, o), 'a new lane is a new claim');
  assert.deepEqual(claimStamps({ ...queued, 'Lane Status': 'running', 'Run Started': 'x', 'Run By': 'y' }, { 'Lane Status': 'queue' }, o), { 'Run Started': null, 'Run By': null });
  assert.equal(claimStamps(queued, { 'Lane Status': 'success' }, o), null, 'nothing to remove');
  assert.equal(claimStamps(queued, { Progress: '1%' }, o), null);
  assert.ok(claimStamps({ ...queued, 'Lane Status': 'running', 'Run Started': 'x', 'Run By': 'y' }, { Lane: 'review' }, o), 'a Lane-only move while running is a new claim');
  assert.equal(claimStamps({ ...queued, 'Lane Status': 'running' }, { Lane: 'plan' }, o), null, 'the same lane is not a move');
  assert.equal(claimStamps(queued, { Lane: 'review' }, o), null, 'a Lane-only move while not running stamps nothing');
  assert.deepEqual(claimStamps(queued, { 'Lane Status': 'running', 'Run By': 'me' }, o), { 'Run Started': '2026-01-02T03:04:05.000Z' });
});

test('staleRunning: only a stamped running claim older than the limit', () => {
  const idx = (extra, st = 'running') => `# T\n\n**Lane**: implement\n**Lane Status**: ${st}\n${extra}`;
  const now = Date.parse('2026-01-02T12:00:00.000Z');
  assert.equal(staleRunning(idx('**Run Started**: 2026-01-02T11:00:00.000Z\n'), now), null, 'one hour is fine');
  const s = staleRunning(idx('**Run Started**: 2026-01-02T01:00:00.000Z\n**Run By**: x c_9\n'), now);
  assert.deepEqual(s, { since: '2026-01-02T01:00:00.000Z', hours: 11, by: 'x c_9' });
  assert.equal(staleRunning(idx(''), now), null, 'an unstamped claim cannot be judged');
  assert.equal(staleRunning(idx('**Run Started**: 2026-01-01T01:00:00.000Z\n', 'queue'), now), null, 'not running');
});

test('humanCommentSince: a changed conversation whose newest turn is the human\'s', () => {
  assert.equal(humanCommentSince('a', 'a', [{ author: 'human' }]), false, 'unchanged');
  assert.equal(humanCommentSince(undefined, 'b', [{ author: 'human' }]), false, 'never read');
  assert.equal(humanCommentSince('a', 'b', [{ author: 'claude' }, { author: 'human' }]), true);
  assert.equal(humanCommentSince('a', 'b', [{ author: 'human' }, { author: 'claude' }]), false);
});

test('update_track: claiming stamps Run Started and Run By (not part of the base), releasing removes them', async () => {
  const { dir, s } = await open((d) => writeFile(d, T(1), INDEX(1, 'One', { lane: 'implement', status: 'queue' })));
  const g = (await s.call('get_track', { track: '1' })).env.data.base;
  const claim = await s.call('update_track', { track: '1', base: g, markers: { 'Lane Status': 'running' } });
  assert.equal(claim.isError, false, claim.text);
  const idx = readFile(dir, T(1));
  const started = idx.match(/^\*\*Run Started\*\*: (.+)$/m)[1];
  assert.ok(Math.abs(Date.now() - Date.parse(started)) < 60_000, started);
  assert.match(idx, /^\*\*Run By\*\*: connector-test c_[0-9a-f]+$/m);
  assert.equal(claim.env.data.base.markers['Run Started'], started, 'the returned base knows the stamp');
  const more = await s.call('update_track', { track: '1', base: claim.env.data.base, markers: { Progress: '30%' } });
  assert.equal(more.isError, false, more.text);
  assert.equal(readFile(dir, T(1)).match(/^\*\*Run Started\*\*: (.+)$/m)[1], started, 'a progress edit keeps the claim');
  const release = await s.call('update_track', { track: '1', base: more.env.data.base, markers: { 'Lane Status': 'queue' } });
  assert.equal(release.isError, false, release.text);
  assert.doesNotMatch(readFile(dir, T(1)), /Run Started|Run By/);
  assert.equal('Run Started' in release.env.data.base.markers, false);
});

test('a stale claim is reported by get_track, list_tracks and the board; a fresh one is not', async () => {
  const { s } = await open((d) => {
    writeFile(d, T(2), INDEX(2, 'Two', { lane: 'implement', status: 'running', extra: '**Run Started**: 2020-01-01T00:00:00.000Z\n**Run By**: ghost c_0\n' }));
    writeFile(d, T(3), INDEX(3, 'Three', { lane: 'implement', status: 'running', extra: `**Run Started**: ${new Date().toISOString()}\n` }));
  });
  const g = await s.call('get_track', { track: '2' });
  const w = g.env.warnings.find((x) => x.startsWith('stale_running'));
  assert.match(w, /running since 2020-01-01T00:00:00.000Z.*by ghost c_0.*queue/);
  assert.equal((await s.call('get_track', { track: '3' })).env.warnings.some((x) => x.startsWith('stale_running')), false);
  const l = await s.call('list_tracks', {});
  const lw = l.env.warnings.find((x) => x.startsWith('stale_running'));
  assert.ok(lw.includes('AM-2') && !lw.includes('AM-3'), lw);
  const b = buildBoard([{ folder: 'AM-2-t2', index: { content: INDEX(2, 'Two', { lane: 'implement', status: 'running', extra: '**Run Started**: 2020-01-01T00:00:00.000Z\n' }) } }], { generatedAt: '2026-01-01T00:00:00.000Z' });
  assert.ok(b.needs_attention[0].reasons.some((r) => /running for \d+h/.test(r)));
});

test('a human comment that arrived after the caller read conversation.md warns when the lane status changes, once the read is current it does not', async () => {
  const { dir, s } = await open((d) => {
    writeFile(d, T(4), INDEX(4, 'Four', { lane: 'implement', status: 'queue' }));
    writeFile(d, T(4, 'conversation.md'), '# Conversation: Track AM-4\n\n> **claude**: started\n');
  });
  const old = (await s.call('get_track', { track: '4' })).env.data.base;
  await s.call('append_conversation', { track: '4', author: 'human', body: 'stop, change of plan' });
  const w = await s.call('update_track', { track: '4', base: old, markers: { 'Lane Status': 'running' } });
  assert.equal(w.isError, false, w.text);
  assert.ok(w.env.warnings.some((x) => x.startsWith('human_comment_mid_run')), JSON.stringify(w.env.warnings));
  // a non-lane edit does not warn; a current read does not warn
  const cur = (await s.call('get_track', { track: '4' })).env.data.base;
  const quiet = await s.call('update_track', { track: '4', base: cur, markers: { 'Lane Status': 'success' } });
  assert.equal(quiet.env.warnings.some((x) => x.startsWith('human_comment_mid_run')), false);
  const progress = await s.call('update_track', { track: '4', base: old, markers: { Progress: '9%' } });
  assert.equal(progress.env.warnings?.some((x) => x.startsWith('human_comment_mid_run')) ?? false, false);
  assert.match(readFile(dir, T(4, 'conversation.md')), /stop, change of plan/);
});

test('a 44-character client name is capped in Run By, and the stale warning still fits 200 characters with its final period', async () => {
  const dir = makeRepo();
  cleanup.push(dir);
  writeFile(dir, T(5), INDEX(5, 'Five', { lane: 'implement', status: 'queue' }));
  commitAll(dir, 'fixture');
  const s = await connect(dir, { clientName: 'a-very-long-client-name-of-forty-four-charss' });
  sessions.push(s);
  assert.equal('a-very-long-client-name-of-forty-four-charss'.length, 44);
  const g = (await s.call('get_track', { track: '5' })).env.data.base;
  const claim = await s.call('update_track', { track: '5', base: g, markers: { 'Lane Status': 'running' } });
  assert.equal(claim.isError, false, claim.text);
  const by = readFile(dir, T(5)).match(/^\*\*Run By\*\*: (.+)$/m)[1];
  assert.match(by, /^.{23}… c_[0-9a-f]+$/, by);
  // age the claim far past the limit (5 digits of hours), keep the stamped Run By
  writeFile(dir, T(5), readFile(dir, T(5)).replace(/^\*\*Run Started\*\*: .+$/m, '**Run Started**: 1990-01-01T00:00:00.000Z'));
  commitAll(dir, 'aged');
  const w = (await s.call('get_track', { track: '5' })).env.warnings.find((x) => x.startsWith('stale_running'));
  assert.ok(w.length <= 200 && w.endsWith('.'), `${w.length}: ${w}`);
  assert.match(w, /by a-very-long-client-name… c_/);
  // a hand-written, much longer Run By is bounded in the warning too
  writeFile(dir, T(5), readFile(dir, T(5)).replace(/^\*\*Run By\*\*: .+$/m, `**Run By**: ${'x'.repeat(300)}`));
  commitAll(dir, 'long by');
  const w2 = (await s.call('get_track', { track: '5' })).env.warnings.find((x) => x.startsWith('stale_running'));
  assert.ok(w2.length <= 200 && w2.endsWith('.'), `${w2.length}: ${w2}`);
});

test('a Lane-only move while running re-stamps the claim; replacing index.md with a non-running status drops the stamps', async () => {
  const { dir, s } = await open((d) => writeFile(d, T(6), INDEX(6, 'Six', { lane: 'implement', status: 'running', extra: '**Run Started**: 2020-01-01T00:00:00.000Z\n**Run By**: ghost c_0\n' })));
  const g = await s.call('get_track', { track: '6' });
  const mv = await s.call('update_track', { track: '6', base: g.env.data.base, markers: { Lane: 'review' } });
  assert.equal(mv.isError, false, mv.text);
  const idx = readFile(dir, T(6));
  assert.doesNotMatch(idx, /2020-01-01/, 'the old claim time is replaced');
  assert.match(idx, /^\*\*Run By\*\*: connector-test c_/m);
  assert.equal(mv.env.warnings.some((x) => x.startsWith('stale_running')), false);
  // whole-file replacement that leaves the claim behind a non-running status
  const g2 = await s.call('get_track', { track: '6' });
  const text = readFile(dir, T(6)).replace('**Lane Status**: running', '**Lane Status**: queue');
  assert.match(text, /Run Started/);
  const rep = await s.call('update_track', { track: '6', base: g2.env.data.base, files: { index: text } });
  assert.equal(rep.isError, false, rep.text);
  assert.doesNotMatch(readFile(dir, T(6)), /Run Started|Run By/);
  assert.equal('Run Started' in rep.env.data.base.markers, false);
});
