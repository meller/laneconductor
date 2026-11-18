// Track AM-10147 (owner steps), Phase 3: the two `next` states. S22 "do the owner action" (a waiting track with an Owner Action, read before S05) and
// S23 "measure the KPI" (a waiting track whose run window ended). TC-8 to TC-11 of test.md. The clock is fixed: 2026-11-18 12:00 UTC.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from '../../scripts/build-plugin.mjs';
import { buildFixture, RANKING } from './helpers/next-fixtures.mjs';
import { classifyFacts, gatherFacts, nextCard, commandFor, SHAPES, STATE_IDS } from '../src/next.mjs';
import { COMMANDS, fillProcedure } from '../src/commands.mjs';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const built = [];
after(() => { for (const d of built) fs.rmSync(d, { recursive: true, force: true }); });

const T = (n, lane, status, extra = {}, more = {}) => ({ n, lane, status, extra, ...more });
const owner = (n, due, more = {}, lane = 'implement', status = 'waiting') => T(n, lane, status, { 'Waiting for reply': 'yes', 'Owner Action': `Post the video for ${n}`, ...(due === undefined ? {} : { 'Owner Action Due': due }), ...more });
async function run(tracks, { now = NOW, arg } = {}, desc = {}) {
  const dir = buildFixture({ tracks, ...desc });
  built.push(dir);
  const facts = await gatherFacts(dir, { now });
  const result = classifyFacts(facts, { arg });
  return { result, facts, card: nextCard(result, facts), order: result.ranked.map((r) => [r.track, r.state]) };
}
const ids = (r) => r.order.map(([n]) => n);

test('TC-8: the state table has 23 states; S22 and S23 have shapes and a command', () => {
  assert.equal(STATE_IDS.length, 23);
  assert.deepEqual(STATE_IDS.slice(-2), ['S22', 'S23']);
  assert.deepEqual(SHAPES.S22, ['/laneconductor:comment N <what you did>']);
  assert.deepEqual(SHAPES.S23, ['/laneconductor:quality-gate N']);
  assert.equal(commandFor('S22', 10001), '/laneconductor:comment 10001 <what you did>');
  assert.equal(commandFor('S23', 10001), '/laneconductor:quality-gate 10001');
});

test('TC-8: a waiting track with an owner action is its own state, ahead of S05; the card names the action, the due day and the Draft pointer, never the S05 text', async () => {
  const r = await run([owner(10001, '2026-11-25')]);
  assert.equal(r.result.state, 'S22');
  assert.equal(r.result.track, 10001);
  assert.equal(r.result.command, '/laneconductor:comment 10001 <what you did>');
  const text = [r.card.head, r.card.what, r.card.why].join(' ');
  assert.match(r.card.head, /Do the owner action on track AM-10001/);
  assert.ok(text.includes('Post the video for 10001'), 'the action');
  assert.ok(text.includes('due 2026-11-25'), 'the due day');
  assert.match(text, /## Draft section of the track's spec\.md/);
  assert.doesNotMatch(text, /adds your answer|answer a reply|waiting for a human reply/i);
  assert.equal(r.card.cmd, '/laneconductor:comment 10001 <what you did>');
  // The same track without an Owner Action is still S05 with the old text.
  const old = await run([T(10001, 'implement', 'waiting', { 'Waiting for reply': 'yes' })]);
  assert.equal(old.result.state, 'S05');
  assert.match(old.card.what, /Adds your answer/);
});

test('TC-8: S22 comes before a genuine reply (S05), then failures; overdue first, then oldest due; a missing or malformed due day last, with the reason', async () => {
  const r = await run([
    owner(10001, '2026-11-25'),
    owner(10002, '2026-11-10'),
    owner(10003, '2026-11-12'),
    owner(10004, undefined),
    owner(10005, '2026-02-30'),
    owner(10006, '2026-11-18'),
    T(10007, 'plan', 'waiting', { 'Waiting for reply': 'yes' }),
    T(10008, 'implement', 'failure'),
    T(10009, 'plan', 'queue'),
  ]);
  assert.deepEqual(r.order, [[10002, 'S22'], [10003, 'S22'], [10006, 'S22'], [10001, 'S22'], [10004, 'S22'], [10005, 'S22'], [10007, 'S05'], [10008, 'S06'], [10009, 'S18']]);
  assert.equal(r.result.track, 10002);
  assert.match(r.card.why, /^overdue since 2026-11-10\./);
  const reason = async (n) => (await run([owner(n, n === 10004 ? undefined : '2026-02-30')])).card.why;
  assert.match(await reason(10004), /^no due date\./);
  assert.match(await reason(10005), /not a real YYYY-MM-DD date, so it is listed last/);
  assert.match((await run([owner(10001, '2026-11-18')])).card.why, /^due today\./, 'due today is not overdue');
  assert.match((await run([owner(10001, '2026-11-18')], { now: Date.parse('2026-11-19T00:00:00Z') })).card.why, /^overdue since 2026-11-18\./, 'the next UTC day');
});

test('TC-8: the owner action state is also shown as a short row in the "also" list', async () => {
  const r = await run([owner(10001, '2026-11-25'), owner(10002, '2026-12-01')]);
  assert.deepEqual(r.card.others, [{ n: 10002, cmd: '/laneconductor:comment 10002 <what you did>', w: 'do the owner action' }]);
});

test('TC-9: a waiting track past KPI Check After is offered as a measurement with /laneconductor:quality-gate N', async () => {
  const win = (n, after, more = {}) => T(n, 'quality-gate', 'waiting', { 'Waiting Reason': 'run window', 'KPI Check After': after, ...more });
  const r = await run([win(10001, '2026-11-18')]);
  assert.equal(r.result.state, 'S23');
  assert.equal(r.result.command, '/laneconductor:quality-gate 10001');
  assert.match(r.card.head, /Measure the KPI of track AM-10001/);
  assert.match(r.card.why, /KPI Check After 2026-11-18/);
  assert.match(r.card.what, /never invents a number/);
  assert.equal((await run([win(10001, '2026-11-17')])).result.state, 'S23');
  assert.equal((await run([win(10001, '2026-11-18T11:00:00Z')])).result.state, 'S23', 'a timestamp that has passed (what the quality gate has written)');
  // Not yet: today's later hours, tomorrow, malformed -> the track is the park it was (S05), as before this track.
  for (const later of ['2026-11-18T12:00:01Z', '2026-11-19', '25/11/2026', '']) assert.equal((await run([win(10001, later)])).result.state, 'S05', later);
  // Not waiting: no measurement.
  assert.equal((await run([T(10001, 'quality-gate', 'queue', { 'KPI Check After': '2026-11-01' })])).result.state, 'S14');
  // A reply asked for, or an unanswered human comment, is read first; an unmet dependency blocks it; the done lane is not a window.
  assert.equal((await run([win(10001, '2026-11-01', { 'Waiting for reply': 'yes' })])).result.state, 'S05');
  assert.equal((await run([T(10001, 'quality-gate', 'waiting', { 'Waiting Reason': 'w', 'KPI Check After': '2026-11-01' }, { comment: 'human' })])).result.state, 'S05');
  const blocked = await run([T(10002, 'plan', 'queue'), win(10001, '2026-11-01', { 'Depends On': '10002' })]);
  assert.deepEqual(blocked.order, [[10002, 'S18']]);
  assert.deepEqual(blocked.result.blocked, [10001]);
  // With an owner action still open the action comes first (S22).
  assert.equal((await run([win(10001, '2026-11-01', { 'Owner Action': 'Post it' })])).result.state, 'S22');
  // Ranking: after replies and failures, in the group of "resume".
  const mix = await run([T(10001, 'plan', 'queue'), win(10002, '2026-11-01'), T(10003, 'implement', 'failure'), T(10004, 'done', 'success'), T(10005, 'plan', 'waiting', { 'Waiting On Tracks': '10004', 'Waiting Reason': 'on 10004' })]);
  assert.deepEqual(mix.order, [[10003, 'S06'], [10002, 'S23'], [10005, 'S09'], [10001, 'S18']]);
});

test('TC-10: more than two open owner actions add one line of advice; two or fewer add nothing; the advice never changes the order', async () => {
  const three = [owner(10003, '2026-11-30'), owner(10001, '2026-11-20'), owner(10002, '2026-11-25')];
  const r = await run(three);
  assert.equal(r.result.advice, 'You have 3 open owner actions: finish one before starting another.');
  assert.equal(r.card.advice, r.result.advice);
  assert.deepEqual(ids(r), [10001, 10002, 10003], 'the order is the due order, as it is without the advice');
  const two = await run(three.slice(0, 2));
  assert.ok(!('advice' in two.result) && !('advice' in two.card));
  assert.deepEqual(ids(two), [10001, 10003]);
  const four = await run([...three, owner(10004, '2026-11-19')]);
  assert.match(four.result.advice, /^You have 4 open owner actions/);
  assert.deepEqual(ids(four), [10004, 10001, 10002, 10003]);
  // Only the open ones count: a queue track with a left-over marker, an epic, and a waiting track with no action do not.
  const noise = await run([owner(10001, '2026-11-20'), owner(10002, '2026-11-21'), T(10003, 'plan', 'queue', { 'Owner Action': 'left over' }), T(10004, 'plan', 'waiting', { 'Waiting Reason': 'x' })]);
  assert.ok(!('advice' in noise.result));
  assert.equal(noise.result.ranked.find((x) => x.track === 10003).state, 'S18', 'an owner action on a track that is not waiting is not an owner step');
});

test('TC-10: Priority, a met and an unmet Depends On, S09 (resume), done:waiting and an epic', async () => {
  // Due day beats Priority; Priority breaks a tie of the same day; then the lane, then the number.
  const p = await run([owner(10001, '2026-11-25', { Priority: 'high' }), owner(10002, '2026-11-20', { Priority: 'low' }), owner(10003, '2026-11-20', { Priority: 'high' }), owner(10004, '2026-11-20', {}, 'plan')]);
  assert.deepEqual(ids(p), [10003, 10004, 10002, 10001]);
  // A met Depends On with an owner action is the action (never "resume"); without one it is S09.
  const met = await run([T(10001, 'done', 'success'), owner(10002, '2026-11-25', { 'Depends On': '10001', 'Waiting Reason': 'x' }), T(10003, 'plan', 'waiting', { 'Depends On': '10001' })]);
  assert.deepEqual(met.order, [[10002, 'S22'], [10003, 'S09']]);
  // An unmet Depends On does not hide the action (the owner can do it now, as with a reply); without an action the track is blocked.
  const unmet = await run([T(10001, 'plan', 'queue'), owner(10002, '2026-11-25', { 'Depends On': '10001' }), T(10003, 'plan', 'waiting', { 'Depends On': '10001' })]);
  assert.deepEqual(unmet.order, [[10002, 'S22'], [10001, 'S18']]);
  assert.deepEqual(unmet.result.blocked, [10003]);
  // done:waiting (a pull request is open) with an owner action is the action; without one it is S13.
  const dw = await run([owner(10001, '2026-11-25', {}, 'done', 'waiting'), T(10002, 'done', 'waiting', { 'PR URL': 'https://example.invalid/pr/2' })]);
  assert.deepEqual(dw.order, [[10001, 'S22'], [10002, 'S13']]);
  // An epic is not a candidate, its children are: a child's action is ranked, the epic's own is not.
  const epic = await run([owner(10100, '2026-11-01', {}, 'plan'), owner(10101, '2026-11-25', { 'Part Of': '10100' }), T(10102, 'plan', 'queue', { 'Part Of': '10100' })]);
  assert.deepEqual(epic.order, [[10101, 'S22'], [10102, 'S18']]);
  assert.deepEqual(epic.result.epics, [{ epic: 10100, done: 0, total: 2 }]);
});

test('TC-1: a project with none of the markers is ranked exactly as before, and carries no advice', async () => {
  const r = await run(RANKING().tracks);
  assert.deepEqual(r.order.map(([n]) => n), [10007, 10006, 10005, 10004, 10003, 10002, 10001]);
  assert.ok(!r.order.some(([, s]) => s === 'S22' || s === 'S23'));
  assert.ok(!('advice' in r.result) && !('owner' in r.result) && !('window' in r.result));
  assert.ok(!('advice' in r.card));
});

// ---- TC-11: ops/next.md and the code agree ----

const SRC = path.join(REPO, '.claude/skills/laneconductor');
const NEXT_MD = fs.readFileSync(path.join(SRC, 'ops/next.md'), 'utf8');
const rowOf = (id) => NEXT_MD.split('\n').find((l) => l.startsWith(`| ${id} |`));

test('TC-11: ops/next.md has the S22 and S23 rows with the commands of the code, and the rank section names them and the advice line', () => {
  for (const id of ['S22', 'S23']) {
    const line = rowOf(id);
    assert.ok(line, `${id} row`);
    for (const shape of SHAPES[id]) assert.ok(line.endsWith(`\`${shape}\` |`), `${id}: the command cell`);
  }
  assert.match(rowOf('S22'), /Read before S05/);
  assert.match(rowOf('S22'), /`## Draft` section of `spec\.md`/);
  assert.match(rowOf('S22'), /posts, sends and spends nothing/);
  assert.match(rowOf('S22'), /`overdue since <day>`, `due today`, or `no due date`/);
  assert.match(rowOf('S23'), /`KPI Check After` is today or earlier/);
  assert.match(rowOf('S05'), /with no `Owner Action`, see S22/);
  const rank = NEXT_MD.slice(NEXT_MD.indexOf('\n## Rank'), NEXT_MD.indexOf('\n## The card'));
  assert.match(rank, /S05 to S19 and S22 and S23/);
  assert.match(rank, /owner action \(S22\) comes first: oldest due first/);
  assert.match(rank, /run window ended \(S23\)/);
  assert.match(rank, /With more than two tracks in S22, add one line after the card: "You have N open owner actions: finish one before starting another\."/);
});

test('TC-11: an agent without the connector is told to compare dates with today\'s date, in UTC, and to ask when it does not know it', () => {
  const step = NEXT_MD.slice(NEXT_MD.indexOf("4b. **Today's date.**"), NEXT_MD.indexOf('5. **Where a finished lane goes next**'));
  assert.ok(step.length > 100);
  assert.match(step, /compare days as|compare the days yourself/);
  assert.match(step, /UTC/);
  assert.match(step, /If you do not know it, ask the person for it; never guess/);
  assert.match(step, /Due today is not overdue/);
  assert.match(NEXT_MD, /`Owner Action`, `Owner Action Due`, `KPI Check After`\. Match lane names/, 'the markers to read');
});

test('TC-11: the generated base carries the same table and the same step, and the next command is still read only', () => {
  const gen = fs.readFileSync(path.join(REPO, 'plugins/laneconductor/skills/laneconductor/ops/next.md'), 'utf8');
  for (const id of ['S22', 'S23']) assert.ok(gen.includes(rowOf(id)), id);
  assert.ok(gen.includes("4b. **Today's date.**"));
  const cmd = COMMANDS.find((c) => c.name === 'next');
  assert.doesNotMatch(fillProcedure(cmd, {}), /update_track|create_track|append_conversation/);
});
