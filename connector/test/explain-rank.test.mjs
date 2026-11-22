// Track AM-10155 Phase 9 (D21, D22, D23): the recommendations across the last tracks that the board's Agent recommendations drawer shows. Pure ranking, synthetic facts.
//   TC-29 at most three ranked actions with their counts; fewer than 3 measured tracks; nothing over the threshold; exactly 3 appears, 2 does not
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankRecommendations, rankFromExplains, RECOMMEND_WINDOW, MIN_TRACKS, MAX_ACTIONS } from '../src/explain-rank.mjs';
import { renderExplain, LONG_CONTEXT } from '../src/explain.mjs';

/** facts of a track in which the named rules fired (each with 1,000 tokens unless given as [id, tokens]). */
const facts = (...ids) => ({ v: 1, rules: ids.map((x) => { const [id, tokens] = Array.isArray(x) ? x : [x, 1000]; return { id, lane: id === 'claim' || id === 'allow-command' ? null : 'implement', n: 5, tokens, count: 1 }; }) });
const track = (number, ...ids) => ({ number, facts: facts(...ids) });
const unmeasured = (number) => ({ number, facts: null });

test('TC-29: the constants are the ones of D21 and D22', () => {
  assert.deepEqual([RECOMMEND_WINDOW, MIN_TRACKS, MAX_ACTIONS], [10, 3, 3]);
});

test('TC-29: ten tracks give at most three ranked actions, most tracks first, each with its count', () => {
  const tracks = [];
  for (let k = 1; k <= 10; k += 1) {
    const ids = [];
    if (k <= 7) ids.push('where');
    if (k <= 5) ids.push('claim');
    if (k <= 4) ids.push('lower-effort');
    if (k <= 3) ids.push('lighter-model');
    if (k === 1) ids.push('allow-command');
    tracks.push(track(100 + k, ...ids));
  }
  const r = rankRecommendations(tracks);
  assert.equal(r.state, 'ok');
  assert.equal(r.measured, 10);
  assert.deepEqual(r.actions.map((a) => [a.id, a.count]), [['where', 7], ['claim', 5], ['lower-effort', 4]]);
  assert.equal(r.actions.length, MAX_ACTIONS, 'never more than three, although four rules reached the threshold');
  assert.match(r.actions[0].text, /^7 of 10 tracks/);
  assert.match(r.actions[0].text, new RegExp(LONG_CONTEXT.toLocaleString('en-US')), 'the threshold of the rule is the number in the line');
  for (const a of r.actions) {
    assert.ok(a.copy.length > 20 && a.copy.length < 220, 'one plain sentence to copy');
    assert.ok(a.copy.endsWith('.') && !a.copy.includes('\n'));
    assert.ok(typeof a.title === 'string' && a.title.length > 0);
  }
});

test('TC-29: an action that fires in exactly 3 tracks appears, in 2 it does not', () => {
  const three = rankRecommendations([track(1, 'claim'), track(2, 'claim'), track(3, 'claim'), track(4), track(5)]);
  assert.deepEqual(three.actions.map((a) => [a.id, a.count]), [['claim', 3]]);
  const two = rankRecommendations([track(1, 'claim'), track(2, 'claim'), track(3), track(4), track(5)]);
  assert.equal(two.state, 'quiet');
  assert.deepEqual(two.actions, []);
});

test('TC-29: the same count is ranked by the tokens involved, then by the order of the rules', () => {
  const r = rankRecommendations([
    track(1, ['claim', 500], ['where', 9000]), track(2, ['claim', 500], ['where', 9000]), track(3, ['claim', 500], ['where', 9000]),
    track(4, ['lower-effort', 100]), track(5, ['lower-effort', 100]), track(6, ['lower-effort', 100]),
  ]);
  assert.deepEqual(r.actions.map((a) => a.id), ['where', 'claim', 'lower-effort']);
  assert.equal(r.actions[0].tokens, 27000);
  const tie = rankRecommendations([track(1, 'claim', 'where'), track(2, 'claim', 'where'), track(3, 'claim', 'where')]);
  assert.deepEqual(tie.actions.map((a) => a.id), ['where', 'claim'], 'equal count and tokens: the order of the rules');
});

test('TC-29: a rule that fires on several phases of one track counts that track once', () => {
  const t = { number: 1, facts: { v: 1, rules: [{ id: 'lower-effort', lane: 'implement', n: 4, tokens: 10, count: 5 }] } };
  const r = rankRecommendations([t, track(2, 'lower-effort'), track(3, 'lower-effort')]);
  assert.deepEqual(r.actions.map((a) => [a.id, a.count]), [['lower-effort', 3]]);
});

test('TC-29: fewer than 3 measured tracks says "Not enough tracks with statistics yet (N of 3)" and gives no action', () => {
  const r = rankRecommendations([track(1, 'claim'), track(2, 'claim')]);
  assert.equal(r.state, 'few');
  assert.equal(r.measured, 2);
  assert.equal(r.message, 'Not enough tracks with statistics yet (2 of 3)');
  assert.deepEqual(r.actions, []);
  const none = rankRecommendations([]);
  assert.equal(none.state, 'few');
  assert.equal(none.message, 'Not enough tracks with statistics yet (0 of 3)');
  assert.deepEqual(none.tracks, []);
});

test('TC-29: ten tracks with nothing over the threshold say "No change suggested across the last N tracks."', () => {
  const tracks = [];
  for (let k = 1; k <= 10; k += 1) tracks.push(track(k, ...(k === 1 ? ['claim'] : k === 2 ? ['where'] : [])));
  const r = rankRecommendations(tracks);
  assert.equal(r.state, 'quiet');
  assert.equal(r.message, 'No change suggested across the last 10 tracks.');
  assert.deepEqual(r.actions, []);
});

test('TC-29: the window is the 10 newest tracks (highest numbers); older ones are not looked at', () => {
  const tracks = [];
  for (let k = 1; k <= 14; k += 1) tracks.push(track(k, 'claim'));
  const r = rankRecommendations(tracks);
  assert.deepEqual(r.tracks, [14, 13, 12, 11, 10, 9, 8, 7, 6, 5], 'newest first, ten of them');
  assert.equal(r.measured, 10);
  assert.equal(r.actions[0].count, 10);
  const small = rankRecommendations(tracks, { window: 4 });
  assert.deepEqual(small.tracks, [14, 13, 12, 11]);
});

test('TC-29: a track whose explain.md has no facts block is not measured: it takes a place in the window but counts toward nothing', () => {
  const tracks = [track(20, 'claim'), track(19, 'claim'), unmeasured(18), unmeasured(17), track(16, 'claim')];
  const r = rankRecommendations(tracks);
  assert.equal(r.state, 'ok');
  assert.equal(r.measured, 3);
  assert.equal(r.notMeasured, 2);
  assert.deepEqual(r.actions.map((a) => [a.id, a.count]), [['claim', 3]]);
  assert.match(r.actions[0].text, /^3 of 3 tracks/, 'the count is out of the measured tracks');
  assert.deepEqual(r.tracks, [20, 19, 18, 17, 16], 'every track looked at is named, measured or not');
  const few = rankRecommendations([track(5, 'claim'), unmeasured(4), unmeasured(3), unmeasured(2)]);
  assert.equal(few.state, 'few');
  assert.equal(few.message, 'Not enough tracks with statistics yet (1 of 3)');
  assert.equal(few.notMeasured, 3);
});

test('TC-29: tracks are read from their explain.md text: the facts block is the only thing read', () => {
  const run = { lane: 'implement', start: '2026-11-20T10:00:00.000Z', end: '2026-11-20T11:00:00.000Z', claimed: false, open: false, endState: 'success', wallMs: 3600000, humanMs: 0, agentMs: 3600000, responses: 2, tokens: { output: 10, fresh: 1, cacheCreated: 1, cacheRead: 100 }, tools: {}, sub: { responses: 0, output: 0 }, firstContext: 10, subStarts: [], repeatedReads: 0, slowest: [], gapsOver30: 0, asks: { count: 0, ms: 0 }, models: {}, efforts: {}, thinking: { tokens: 0, recorded: 0, output: 0 }, path: '' };
  const text = renderExplain({ track: { number: 9, folder: 'AM-9-x' }, generatedAt: '2026-11-22T08:00:00.000Z', runs: [run], phases: [], none: { responses: 0, output: 0 }, skipped: { otherTrack: 0, outsideRepo: 0 }, sources: { mainFiles: 1, subFiles: 0, sessions: [] } });
  const r = rankFromExplains([{ number: 9, text }, { number: 8, text }, { number: 7, text }, { number: 6, text: '# Agent run: old\n\n## Insight\n' }]);
  assert.equal(r.measured, 3);
  assert.equal(r.notMeasured, 1);
  assert.deepEqual(r.actions.map((a) => [a.id, a.count]), [['claim', 3]]);
});
