// Track AM-10155 Phase 9 (D21, D22, D23): the recommendations across the last tracks that the board's Agent recommendations drawer shows. Pure ranking, synthetic facts.
//   TC-29 (D28 levels): every action that fired on one track or more, High / Medium / Low by the share of measured tracks, at most five, each with its count; fewer than 3 measured tracks; nothing fired
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankRecommendations, rankFromExplains, levelOf, RECOMMEND_WINDOW, MIN_TRACKS, MAX_ACTIONS, HIGH_SHARE, MEDIUM_SHARE } from '../src/explain-rank.mjs';
import { renderExplain, LONG_CONTEXT } from '../src/explain.mjs';

/** facts of a track in which the named rules fired (each with 1,000 tokens unless given as [id, tokens]). */
const facts = (...ids) => ({ v: 1, rules: ids.map((x) => { const [id, tokens] = Array.isArray(x) ? x : [x, 1000]; return { id, lane: id === 'claim' || id === 'allow-command' ? null : 'implement', n: 5, tokens, count: 1 }; }) });
const track = (number, ...ids) => ({ number, facts: facts(...ids) });
const unmeasured = (number) => ({ number, facts: null });

test('TC-29 (D28): the constants are the window of 10, a floor of 3 measured tracks for the whole list, at most 5 actions, and the level limits 60 and 30 percent', () => {
  assert.deepEqual([RECOMMEND_WINDOW, MIN_TRACKS, MAX_ACTIONS, HIGH_SHARE, MEDIUM_SHARE], [10, 3, 5, 60, 30]);
});

test('TC-29 (D28): the level is by the share of measured tracks an action fired on: 60 percent and over High, 30 up to 60 Medium, 1 track up to 30 Low', () => {
  assert.equal(levelOf(6, 10), 'High');
  assert.equal(levelOf(10, 10), 'High');
  assert.equal(levelOf(5, 10), 'Medium');
  assert.equal(levelOf(3, 10), 'Medium', '30 percent is Medium');
  assert.equal(levelOf(2, 10), 'Low');
  assert.equal(levelOf(1, 10), 'Low');
  assert.equal(levelOf(1, 3), 'Medium', '1 of 3 is 33 percent');
  assert.equal(levelOf(2, 3), 'High', '2 of 3 is 67 percent');
  assert.equal(levelOf(3, 5), 'High', '3 of 5 is exactly 60 percent');
  assert.equal(levelOf(29, 100), 'Low');
  assert.equal(levelOf(59, 100), 'Medium');
});

test('TC-29 (D28): ten tracks list every action that fired, High then Medium then Low, each with its level and its count, at most five', () => {
  const tracks = [];
  for (let k = 1; k <= 10; k += 1) {
    const ids = [];
    if (k <= 7) ids.push('where');
    if (k <= 5) ids.push('claim');
    if (k <= 4) ids.push('lower-effort');
    if (k <= 2) ids.push('lighter-model');
    if (k === 1) ids.push('allow-command');
    if (k <= 1) ids.push('larger-model');
    tracks.push(track(100 + k, ...ids));
  }
  const r = rankRecommendations(tracks);
  assert.equal(r.state, 'ok');
  assert.equal(r.measured, 10);
  assert.deepEqual(r.actions.map((a) => [a.id, a.count, a.level]), [['where', 7, 'High'], ['claim', 5, 'Medium'], ['lower-effort', 4, 'Medium'], ['lighter-model', 2, 'Low'], ['larger-model', 1, 'Low']]);
  assert.equal(r.actions.length, MAX_ACTIONS, 'five of the six that fired; allow-command (1 track, the same level, fewer tokens by the order of the rules) is cut');
  assert.match(r.actions[0].text, /^7 of 10 tracks/);
  assert.match(r.actions[0].text, new RegExp(LONG_CONTEXT.toLocaleString('en-US')), 'the threshold of the rule is the number in the line');
  for (const a of r.actions) {
    assert.ok(a.copy.length > 20 && a.copy.length < 220, 'one plain sentence to copy');
    assert.ok(a.copy.endsWith('.') && !a.copy.includes('\n'));
    assert.ok(typeof a.title === 'string' && a.title.length > 0);
    assert.ok(['High', 'Medium', 'Low'].includes(a.level));
  }
});

test('TC-29 (D28): an action that fired on one track of ten is listed as Low (the owner found "where" missing at 2 of 10)', () => {
  const one = rankRecommendations([track(1, 'claim'), track(2, 'where'), track(3), track(4), track(5), track(6), track(7), track(8), track(9), track(10, 'where')]);
  assert.equal(one.state, 'ok');
  assert.deepEqual(one.actions.map((a) => [a.id, a.count, a.level]), [['where', 2, 'Low'], ['claim', 1, 'Low']]);
  assert.match(one.actions[0].text, /^2 of 10 tracks/);
});

test('TC-29 (D28): within a level the larger count goes first, then the tokens, then the order of the rules', () => {
  const r = rankRecommendations([
    track(1, ['claim', 500], ['where', 9000]), track(2, ['claim', 500], ['where', 9000]), track(3, ['claim', 500], ['where', 9000]),
    track(4, ['lower-effort', 100]), track(5, ['lower-effort', 100]), track(6, ['lower-effort', 100]),
    track(7), track(8), track(9), track(10),
  ]);
  assert.deepEqual(r.actions.map((a) => [a.id, a.level]), [['where', 'Medium'], ['claim', 'Medium'], ['lower-effort', 'Medium']]);
  assert.equal(r.actions[0].tokens, 27000);
  const tie = rankRecommendations([track(1, 'claim', 'where'), track(2, 'claim', 'where'), track(3, 'claim', 'where')]);
  assert.deepEqual(tie.actions.map((a) => [a.id, a.level]), [['where', 'High'], ['claim', 'High']], 'equal count and tokens: the order of the rules');
  const mixed = rankRecommendations([track(1, ['where', 99999], 'claim'), track(2, 'claim'), track(3, 'claim'), track(4, 'claim'), track(5)]);
  assert.deepEqual(mixed.actions.map((a) => [a.id, a.count, a.level]), [['claim', 4, 'High'], ['where', 1, 'Low']], 'the level decides before the tokens');
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

test('TC-29 (D28): ten tracks where nothing fired say "No change suggested across the last N tracks."', () => {
  const tracks = [];
  for (let k = 1; k <= 10; k += 1) tracks.push(track(k));
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
