// Track AM-10115, board card actions step 1: each live track gets `action` {c, w} (the exact command and one short reason), worked
// out at generation time from the track's own markers only. Page data carries it as `x`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, boardPageData } from '../src/board.mjs';
import { actionOf } from '../src/board-actions.mjs';
import { INDEX } from './helpers/repo.mjs';

const NOW = '2026-11-18T10:00:00.000Z';
const LANES = ['backlog', 'plan', 'implement', 'review', 'quality-gate', 'done'];
const OTRA = ['planning', 'backlog', 'in-progress', 'review', 'quality-gate', 'done'];

const WF = {
  lanes: {
    plan: { on_success: 'plan:success' },
    implement: { on_success: 'review:queue' },
    review: { on_success: 'quality-gate:queue' },
    'quality-gate': { on_success: 'done:queue' },
    done: {},
  },
};

function board(rows, { lanes = LANES, workflow = WF, now = NOW } = {}) {
  const entries = rows.map(([n, lane, status, extra]) => ({ folder: `AM-${n}-t${n}`, index: { content: INDEX(n, `T${n}`, { lane, status, extra: extra ?? '' }) } }));
  const b = buildBoard(entries, { lanes, generatedAt: now, project: 'p', workflow });
  return Object.fromEntries(b.tracks.map((t) => [t.number, t.action ?? null]));
}

test('the lane commands: queue and success go to the next lane command, with a short reason', () => {
  const a = board([
    [1, 'plan', 'queue'], [2, 'plan', 'success'], [3, 'implement', 'queue'], [4, 'review', 'queue'], [5, 'quality-gate', 'queue'], [6, 'done', 'queue'],
    [7, 'implement', 'success'], [8, 'review', 'success'], [9, 'quality-gate', 'success'],
  ]);
  assert.equal(a[1].c, '/laneconductor:plan 1');
  assert.equal(a[2].c, '/laneconductor:implement 2', 'plan:success: the workflow leaves the plan parked, so the lane order says implement');
  assert.equal(a[3].c, '/laneconductor:implement 3');
  assert.equal(a[4].c, '/laneconductor:review 4');
  assert.equal(a[5].c, '/laneconductor:quality-gate 5');
  assert.equal(a[6].c, '/laneconductor:merge 6');
  assert.equal(a[7].c, '/laneconductor:review 7');
  assert.equal(a[8].c, '/laneconductor:quality-gate 8');
  assert.equal(a[9].c, '/laneconductor:merge 9');
  for (const x of Object.values(a)) { assert.equal(typeof x.w, 'string'); assert.ok(x.w.length > 0 && x.w.length <= 60, x.w); }
});

test('the resolver names the next lane: a workflow that moves plan straight to review makes plan:success a review step', () => {
  const wf = { lanes: { ...WF.lanes, plan: { on_success: 'review:queue' } } };
  assert.equal(board([[1, 'plan', 'success']], { workflow: wf })[1].c, '/laneconductor:review 1');
  assert.equal(board([[1, 'plan', 'success']], { workflow: null })[1].c, '/laneconductor:implement 1', 'without a workflow the lane order is used');
});

test('the project lane names are used: planning and in-progress map to the plan and implement commands', () => {
  const wf = { lanes: { planning: { on_success: 'planning:success' }, 'in-progress': { on_success: 'review:queue' }, review: {}, 'quality-gate': {}, done: {} } };
  const a = board([[1, 'planning', 'queue'], [2, 'planning', 'success'], [3, 'in-progress', 'queue'], [4, 'in-progress', 'success'], [5, 'in-progress', 'running', '**Run Started**: 2026-11-18T09:00:00.000Z\n']], { lanes: OTRA, workflow: wf });
  assert.equal(a[1].c, '/laneconductor:plan 1');
  assert.equal(a[2].c, '/laneconductor:implement 2');
  assert.equal(a[3].c, '/laneconductor:implement 3');
  assert.equal(a[4].c, '/laneconductor:review 4');
  assert.deepEqual(a[5], { c: null, w: 'running; nothing to do' });
});

test('running: nothing to do; a stale claim says how to release it with the project lane name', () => {
  const a = board([
    [1, 'implement', 'running', '**Run Started**: 2026-11-18T09:30:00.000Z\n'],
    [2, 'review', 'running', '**Run Started**: 2026-11-17T01:00:00.000Z\n'],
    [3, 'quality-gate', 'running'],
  ]);
  assert.deepEqual(a[1], { c: null, w: 'running; nothing to do' });
  assert.deepEqual(a[2], { c: '/laneconductor:move 2 review:queue', w: 'stale claim: release it if nothing is running' });
  assert.deepEqual(a[3], { c: null, w: 'running; nothing to do' }, 'an unstamped claim cannot be judged stale');
});

test('a human reply is waiting: any lane, the comment command with a placeholder', () => {
  const a = board([[1, 'review', 'waiting', '**Waiting for reply**: yes\n'], [2, 'plan', 'queue', '**Waiting for reply**: yes\n'], [3, 'implement', 'running', '**Waiting for reply**: yes\n']]);
  for (const n of [1, 2, 3]) assert.deepEqual(a[n], { c: `/laneconductor:comment ${n} <your reply>`, w: 'a human reply is waiting' });
});

test('dependencies: blocked names the numbers and has no command; ready to resume is a move to queue', () => {
  const a = board([
    [10, 'done', 'success'],
    [11, 'plan', 'waiting', '**Depends On**: 10, 99\n'],
    [12, 'implement', 'queue', '**Depends On**: 98\n'],
    [13, 'implement', 'waiting', '**Depends On**: 10\n'],
  ]);
  assert.deepEqual(a[11], { c: null, w: 'blocked by 99' });
  assert.deepEqual(a[12], { c: null, w: 'blocked by 98' });
  assert.deepEqual(a[13], { c: '/laneconductor:move 13 implement:queue', w: 'its dependencies shipped; resume it' });
  assert.equal(a[10], null, 'done:success has no action');
});

test('failure: the build is retried, a failed plan or gate is replanned, a failed merge is merged again', () => {
  const a = board([[1, 'implement', 'failure'], [2, 'plan', 'failure'], [3, 'quality-gate', 'failure'], [4, 'review', 'failure'], [5, 'done', 'failure']]);
  assert.equal(a[1].c, '/laneconductor:implement 1');
  assert.equal(a[2].c, '/laneconductor:plan 2');
  assert.equal(a[3].c, '/laneconductor:plan 3');
  assert.equal(a[4].c, '/laneconductor:implement 4');
  assert.equal(a[5].c, '/laneconductor:merge 5');
  assert.match(a[5].w, /merge failed/);
});

test('backlog is parked with no command; a PR waiting in done is recorded once merged; an unknown lane says nothing', () => {
  const a = board([[1, 'backlog', 'queue'], [2, 'backlog', 'failure'], [3, 'done', 'waiting'], [4, 'nowhere', 'queue'], [5, 'plan', null]]);
  assert.deepEqual(a[1], { c: null, w: 'parked in the backlog' });
  assert.deepEqual(a[2], { c: null, w: 'parked in the backlog' });
  assert.equal(a[3].c, '/laneconductor:move 3 done:success');
  assert.equal(a[4], null);
  assert.equal(a[5], null);
});

test('actionOf is pure and tolerates odd rows', () => {
  assert.equal(actionOf({ row: { number: 1, lane: null, lane_status: null }, lanes: LANES }), null);
  assert.equal(actionOf({ row: { number: 1, lane: 'plan', lane_status: 'sideways' }, lanes: LANES }), null);
  assert.equal(actionOf({ row: { number: 1, lane: 'PLAN', lane_status: 'QUEUE' }, lanes: LANES }).c, '/laneconductor:plan 1');
});

test('buildBoard: the action is on live tracks and their attention rows, never on archived copies; boardPageData carries it as x', () => {
  const entries = [
    { folder: 'AM-1-a', index: { content: INDEX(1, 'A', { lane: 'review', status: 'waiting', extra: '**Waiting for reply**: yes\n' }) } },
    { folder: 'AM-2-b', index: { content: INDEX(2, 'B', { lane: 'plan', status: 'queue' }) } },
    { folder: '_duplicate-2-b', index: { content: INDEX(2, 'B old', { lane: 'plan', status: 'queue' }) } },
  ];
  const b = buildBoard(entries, { lanes: LANES, generatedAt: NOW, project: 'p', workflow: WF });
  assert.ok(b.tracks.filter((t) => t.archived).every((t) => !('action' in t)));
  assert.equal(b.needs_attention[0].action.c, '/laneconductor:comment 1 <your reply>');
  const d = boardPageData(b);
  assert.deepEqual(d.tracks.find((t) => t.n === 2).x, { c: '/laneconductor:plan 2', w: 'ready to plan' });
  assert.deepEqual(d.attn[0].x, { c: '/laneconductor:comment 1 <your reply>', w: 'a human reply is waiting' });
  assert.equal(d.tracks.length, 2);
});

test('the action comes from the track\'s own markers only: no Problem, Summary or title text reaches it', () => {
  const SENT = 'ACTION-SENTINEL-QUOKKA';
  const b = buildBoard([{ folder: 'AM-1-a', index: { content: INDEX(1, `Title ${SENT}`, { lane: 'plan', status: 'queue', extra: `**Problem**: ${SENT}\n` }) } }], { lanes: LANES, generatedAt: NOW, workflow: WF });
  assert.ok(!JSON.stringify(b.tracks[0].action).includes(SENT));
  assert.ok(!JSON.stringify(b.tracks[0].action).includes('Title'));
});

test('running: a track with a Phase says it (cut at a word, 140 characters at most); no Phase, or the placeholder New, keeps the plain wording; a stale claim is unchanged', () => {
  const long = 'Phase 1 running (2026-11-20): settling the four open questions in the spec with the owner (KPI dependencies, several KPIs per track, where the measured value lives, whether the gate checks the mapping). Nothing is built until they are answered.';
  const started = '**Run Started**: 2026-11-18T09:30:00.000Z\n', old = '**Run Started**: 2026-11-17T01:00:00.000Z\n';
  const rows = [[1, 'implement', started, 'Writing the catalog entries'], [2, 'implement', started, 'New'], [3, 'implement', started, long], [4, 'review', old, 'Reviewing']];
  const entries = rows.map(([n, lane, extra, phase]) => ({ folder: `AM-${n}-t${n}`, index: { content: INDEX(n, `T${n}`, { lane, status: 'running', extra }).replace('**Phase**: New', `**Phase**: ${phase}`) } }));
  const b = buildBoard(entries, { lanes: LANES, generatedAt: NOW, project: 'p', workflow: WF });
  const a = Object.fromEntries(b.tracks.map((t) => [t.number, t.action ?? null]));
  assert.deepEqual(a[1], { c: null, w: 'Writing the catalog entries' });
  assert.deepEqual(a[2], { c: null, w: 'running; nothing to do' });
  assert.ok(a[3].w.length <= 141 && a[3].w.endsWith('…') && long.startsWith(a[3].w.slice(0, -1)), a[3].w);
  assert.equal(a[3].c, null);
  assert.deepEqual(a[4], { c: '/laneconductor:move 4 review:queue', w: 'stale claim: release it if nothing is running' });
});
