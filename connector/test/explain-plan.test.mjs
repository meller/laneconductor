// Track AM-10155 Phase 9 (D19, D20, D23): the short plan that explain.md opens with, and the recommend-facts block it ends with. Synthetic results only.
//   TC-27 the short plan table rows match the lane run numbers, the expensive step is marked, at most three fix lines, an approximation note,
//         and the existing sections and numbers are unchanged
//   TC-28 the recommend-facts block holds only rule ids and numbers; no content reaches it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderExplain, renderStatistics, parseExplain, recommend, shortPlan, recommendFacts, parseRecommendFacts, RULE_IDS, FIX_LINES_MAX } from '../src/explain.mjs';
import { scanText } from '../src/scan.mjs';

const MIN = 60000;
const NOW = '2026-11-22T08:00:00.000Z';
const OPUS = 'claude-opus-5';
const SONNET = 'claude-sonnet-5-5';

const run = (over = {}) => ({
  lane: 'implement', start: '2026-11-20T10:00:00.000Z', end: '2026-11-20T11:00:00.000Z', claimed: true, open: false, endState: 'success',
  wallMs: 60 * MIN, humanMs: 0, agentMs: 60 * MIN, responses: 20, tokens: { output: 2000, fresh: 20, cacheCreated: 4000, cacheRead: 600000 },
  tools: { Read: 4, Bash: 3 }, sub: { responses: 0, output: 0 }, firstContext: 100000, subStarts: [], repeatedReads: 0,
  slowest: [{ tool: 'Read', ms: 40000, at: '2026-11-20T10:10:00.000Z' }], gapsOver30: 0, asks: { count: 0, ms: 0 },
  models: { [SONNET]: 20 }, efforts: { medium: 20 }, thinking: { tokens: 0, recorded: 20, output: 2000 }, path: 'Read x4, Bash x3', ...over,
});
const phase = (over = {}) => ({
  label: 'Phase 1: First', key: 'Phase 1', tasks: 2, wallMs: 30 * MIN, humanMs: 0, agentMs: 30 * MIN, responses: 10, tokens: { output: 1000, fresh: 10, cacheCreated: 2000, cacheRead: 30000 },
  tools: { Read: 4, Bash: 3 }, sub: { responses: 0, output: 0 }, firstContext: 40000, models: { [SONNET]: 10 }, efforts: { medium: 10 }, thinking: { tokens: 0, recorded: 10, output: 1000 }, path: 'Read x4, Bash x3', ...over,
});
const result = (runs, phases = []) => ({ track: { number: 777, folder: 'AM-777-demo-track' }, generatedAt: NOW, runs, phases, none: { responses: 0, output: 0 }, skipped: { otherTrack: 0, outsideRepo: 0 }, sources: { mainFiles: 1, subFiles: 1, sessions: ['11111111'] } });
const planOf = (text) => /^## Short plan\n([\s\S]*?)(?=^## )/m.exec(text)?.[1] ?? null;
const rowsOf = (section) => section.split('\n').filter((l) => l.startsWith('|') && !/^\|[\s|-]+$/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
const fixesOf = (section) => section.split('\n').filter((l) => /^- /.test(l));

// ---- TC-27 ----
test('TC-27: explain.md opens with the short plan, then Details, then the Insight; the title comes first', () => {
  const text = renderExplain(result([run()]), { now: NOW });
  const heads = text.split('\n').filter((l) => l.startsWith('## ')).slice(0, 5);
  assert.deepEqual(heads, ['## Short plan', '## Details', '## Insight', '## Recommendations', '## Lane runs']);
  assert.equal(text.split('\n')[0], '# Agent run: AM-777-demo-track');
  assert.equal(text.split('\n')[2], '## Short plan');
});

test('TC-27: the table has Step, Where, Time (human in brackets), Written, Context at start and an expensive marker; rows match the lane runs', () => {
  const runs = [
    run({ lane: 'plan', wallMs: 30 * MIN, humanMs: 5 * MIN, agentMs: 25 * MIN, firstContext: 50000, tokens: { output: 1000, fresh: 1, cacheCreated: 1, cacheRead: 1 } }),
    run({ lane: 'implement', wallMs: 120 * MIN, humanMs: 40 * MIN, agentMs: 80 * MIN, firstContext: 500000, sub: { responses: 15, output: 100 }, tokens: { output: 2000, fresh: 1, cacheCreated: 1, cacheRead: 1 } }),
    run({ lane: 'review', wallMs: 10 * MIN, firstContext: 0, responses: 0, tokens: { output: 0, fresh: 0, cacheCreated: 0, cacheRead: 0 }, tools: {}, models: {}, efforts: {}, thinking: { tokens: 0, recorded: 0, output: 0 } }),
  ];
  const sec = planOf(renderExplain(result(runs), { now: NOW }));
  const rows = rowsOf(sec);
  assert.deepEqual(rows[0], ['Step', 'Where', 'Time', 'Written', 'Context at start', 'Expensive']);
  assert.deepEqual(rows[1], ['plan', 'main session', '30m (5m human)', '1,000', '50,000', '']);
  assert.deepEqual(rows[2], ['implement', 'sub-agent', '2h 00m (40m human)', '2,000', '500,000', 'expensive']);
  assert.deepEqual(rows[3], ['review', '-', '10m', '0', '-', '']);
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((r) => r[5] === 'expensive').length, 1, 'exactly one expensive step');
});

test('TC-27: the expensive step is the largest context at start; ties go to the longer time', () => {
  const tie = [run({ lane: 'plan', firstContext: 100000, wallMs: 10 * MIN }), run({ lane: 'implement', firstContext: 100000, wallMs: 90 * MIN })];
  assert.deepEqual(rowsOf(planOf(renderExplain(result(tie), { now: NOW }))).map((r) => r[5]), ['Expensive', '', 'expensive']);
  const big = [run({ lane: 'plan', firstContext: 300000, wallMs: 10 * MIN }), run({ lane: 'implement', firstContext: 100000, wallMs: 90 * MIN })];
  assert.deepEqual(rowsOf(planOf(renderExplain(result(big), { now: NOW }))).map((r) => r[5]), ['Expensive', 'expensive', '']);
});

test('TC-27: one lane run only: the rows are its phases; a single row with no phases is not marked', () => {
  const sec = planOf(renderExplain(result([run()], [phase(), phase({ label: 'Phase 2: Second', key: 'Phase 2', firstContext: 90000, wallMs: 50 * MIN, humanMs: 10 * MIN, responses: 6, sub: { responses: 6, output: 10 } })]), { now: NOW }));
  const rows = rowsOf(sec);
  assert.deepEqual(rows.map((r) => r[0]), ['Step', 'Phase 1: First', 'Phase 2: Second']);
  assert.deepEqual(rows[2], ['Phase 2: Second', 'sub-agent', '50m (10m human)', '1,000', '90,000', 'expensive']);
  const single = rowsOf(planOf(renderExplain(result([run()]), { now: NOW })));
  assert.equal(single.length, 2);
  assert.equal(single[1][5], '', 'one row: nothing to compare, nothing marked');
});

test('TC-27: no lane run says so in one line instead of an empty table', () => {
  const sec = planOf(renderExplain(result([]), { now: NOW }));
  assert.match(sec, /No lane run found/);
  assert.equal(rowsOf(sec).length, 0);
});

test('TC-27: at most three fix lines, each with its number and where to change it; a quiet run says so', () => {
  const noisy = result([
    run({ lane: 'implement', firstContext: 646000, claimed: false, models: { [OPUS]: 20 }, efforts: { high: 20 }, tools: { Bash: 9, Read: 1 }, slowest: [{ tool: 'Bash', ms: 6 * MIN, at: '2026-11-20T10:10:00.000Z' }], thinking: { tokens: 800, recorded: 20, output: 2000 } }),
    run({ lane: 'plan', claimed: false }),
  ]);
  const fired = new Set(recommend(noisy).items.map((i) => i.rule));
  assert.ok(fired.size >= 4, `several rules fire (${[...fired]})`);
  const fixes = fixesOf(planOf(renderExplain(noisy, { now: NOW })));
  assert.equal(fixes.length, FIX_LINES_MAX);
  assert.equal(FIX_LINES_MAX, 3);
  for (const f of fixes) {
    assert.match(f, /\d/, 'each fix line carries a number');
    assert.match(f, /change: /i, 'and says where to change it');
    assert.ok(f.length < 260, 'short');
  }
  assert.match(fixes[0], /646,000/, 'the heaviest fix first (the long main session)');
  const quiet = planOf(renderExplain(result([run()]), { now: NOW }));
  assert.equal(fixesOf(quiet).length, 1);
  assert.match(fixesOf(quiet)[0], /No change suggested/);
});

test('TC-27: one fix line per rule even when a rule fires on several phases', () => {
  const phases = [1, 2, 3, 4].map((k) => phase({ label: `Phase ${k}: P`, key: `Phase ${k}`, efforts: { high: 10 }, tools: { Bash: 9, Read: 1 } }));
  const fixes = fixesOf(planOf(renderExplain(result([run()], phases), { now: NOW })));
  assert.equal(fixes.length, 1);
  assert.match(fixes[0], /lower effort/i);
  assert.match(fixes[0], /4 /, 'the count of phases it applies to');
});

test('TC-27: the approximation note sits under the table and the short plan stays short', () => {
  const sec = planOf(renderExplain(result([run(), run({ lane: 'review' })]), { now: NOW }));
  assert.match(sec, /^> Approximate/m);
  assert.match(sec, /overlap/);
  assert.ok(sec.split('\n').length < 20, 'a small section');
  assert.equal(sec.indexOf('| Step') < sec.indexOf('> Approximate'), true);
});

test('TC-27: everything below Details is what explain.md held before: the sections and the tables read back the same numbers', () => {
  const r = result([run({ lane: 'plan' }), run({ lane: 'implement', wallMs: 120 * MIN, humanMs: 30 * MIN })], [phase()]);
  const text = renderExplain(r, { now: NOW });
  const rest = text.slice(text.indexOf('## Insight'));
  for (const head of ['## Insight', '## Recommendations', '## Lane runs', '## Phases of the implement lane', '## Detail: implement run starting', '## Model use', '## Outside every lane run']) assert.ok(rest.includes(head), head);
  assert.match(text, /^> Generated by lc-explain\.mjs/m);
  assert.match(text, /^Recommendation rules fired: \d+$/m);
  const parsed = parseExplain(text);
  assert.deepEqual(parsed.runs.map((x) => [x.lane, x.wallMs, x.humanMs, x.output]), [['plan', 60 * MIN, 0, 2000], ['implement', 120 * MIN, 30 * MIN, 2000]]);
  assert.deepEqual(parsed.phases.map((x) => [x.key, x.output]), [['Phase 1', 1000]]);
  assert.match(renderStatistics([{ folder: 'AM-777-demo-track', text }], { now: NOW }), /\| AM-777 \| 2 \|/);
});

test('TC-27: shortPlan is pure and repeatable', () => {
  const r = result([run(), run({ lane: 'review' })]);
  assert.deepEqual(shortPlan(r), shortPlan(r));
  assert.equal(shortPlan(r)[0], '## Short plan');
});

// ---- TC-28 ----
const factsOf = (text) => /^```json recommend-facts\n([\s\S]*?)\n```$/m.exec(text)?.[1] ?? null;

test('TC-28: explain.md ends with a recommend-facts block: version, and one entry per rule that fired with ids and numbers only', () => {
  const r = result([run({ firstContext: 646000, claimed: false, slowest: [{ tool: 'Bash', ms: 6 * MIN, at: '2026-11-20T10:10:00.000Z' }] })]);
  const text = renderExplain(r, { now: NOW });
  const raw = factsOf(text);
  assert.ok(raw, 'the block is there');
  assert.ok(text.trimEnd().endsWith('```'), 'the last thing in the file');
  const facts = JSON.parse(raw);
  assert.deepEqual(Object.keys(facts).sort(), ['rules', 'v']);
  assert.equal(facts.v, 1);
  assert.deepEqual(facts.rules.map((x) => x.id).sort(), ['allow-command', 'claim', 'where']);
  for (const x of facts.rules) {
    assert.ok(RULE_IDS.includes(x.id));
    assert.ok(Object.keys(x).every((k) => ['id', 'lane', 'n', 'tokens', 'count'].includes(k)), `only allowed keys: ${Object.keys(x)}`);
    for (const k of ['n', 'tokens', 'count']) assert.ok(Number.isInteger(x[k]) && x[k] >= 0, `${x.id}.${k} is a whole number`);
    assert.ok(x.lane === null || /^[a-z0-9-]{1,30}$/.test(x.lane));
  }
  const where = facts.rules.find((x) => x.id === 'where');
  assert.equal(where.n, 646000);
  assert.equal(where.lane, 'implement');
  assert.equal(where.count, 1);
  assert.equal(where.tokens, 2000 + 20 + 4000 + 600000, 'the tokens of the run it concerns');
});

test('TC-28: a quiet track has a block with no rules (measured, nothing fired)', () => {
  const facts = JSON.parse(factsOf(renderExplain(result([run()]), { now: NOW })));
  assert.deepEqual(facts, { v: 1, rules: [] });
});

test('TC-28: no prompt, token, email, phase name or odd lane name reaches the block; the whole file passes the privacy scan', () => {
  const token = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123';
  const email = 'jane.private@corp-secret.example';
  const bad = run({ lane: `Weird Lane ${email}`, firstContext: 700000, claimed: false });
  const r = result([bad], [phase({ label: `Phase 1: ${token} ${email} do the secret thing`, key: 'Phase 1', efforts: { high: 10 }, tools: { Bash: 9, Read: 1 } })]);
  const raw = factsOf(renderExplain(r, { now: NOW }));
  for (const s of [token, 'sk-ant', email, 'corp-secret', 'jane', 'secret thing', 'Weird', 'Phase', 'claude-']) assert.ok(!raw.includes(s), `the block must not contain ${s}`);
  assert.ok(JSON.parse(raw).rules.every((x) => x.lane === null || /^[a-z0-9-]+$/.test(x.lane)));
  const clean = renderExplain(result([run({ firstContext: 700000, claimed: false }), run({ lane: 'plan' })], [phase({ efforts: { high: 10 }, tools: { Bash: 9, Read: 1 } })]), { now: NOW });
  assert.deepEqual(scanText(clean), [], 'nothing in a generated file may make the board withhold it');
});

test('TC-28: recommendFacts and parseRecommendFacts round-trip; a file without a block, or a broken one, is "not measured" (null)', () => {
  const r = result([run({ firstContext: 646000, claimed: false })]);
  const text = renderExplain(r, { now: NOW });
  assert.deepEqual(parseRecommendFacts(text), recommendFacts(r));
  assert.equal(parseRecommendFacts('# Agent run: x\n\n## Insight\n'), null);
  assert.equal(parseRecommendFacts('```json recommend-facts\n{not json\n```'), null);
  assert.equal(parseRecommendFacts('```json recommend-facts\n{"v":2,"rules":[]}\n```'), null, 'an unknown version is not read');
  const odd = parseRecommendFacts('```json recommend-facts\n{"v":1,"rules":[{"id":"bogus","lane":null,"n":1,"tokens":1,"count":1},{"id":"claim","lane":"x y","n":"7","tokens":-1,"count":1.5},{"id":"claim","lane":null,"n":3,"tokens":9,"count":1}]}\n```');
  assert.deepEqual(odd.rules, [{ id: 'claim', lane: null, n: 3, tokens: 9, count: 1 }], 'unknown ids and malformed entries are dropped');
});
