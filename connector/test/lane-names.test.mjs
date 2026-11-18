// Track AM-10128 (TC-7, TC-8): the otralingo finding. A project whose workflow.json names its lanes `planning` and `in-progress`
// (the skill says `plan` and `implement`) gets a suggestion of the valid name when a write is refused, and the valid lanes and
// statuses in get_track and get_context so the first write succeeds. The connector also logs why it exits or hits an unexpected
// error, and keeps serving after a tool-level error.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import { connect, BIN } from './helpers/mcp.mjs';
import { spawnRaw } from './helpers/rawstdio.mjs';
import { makeRepo, rm } from './helpers/repo.mjs';
import { installProcessGuards } from '../src/process-guards.mjs';
import { nearestLane, nearestStatus, guideLaneMap } from '../src/vocabulary.mjs';

const OTRALINGO = JSON.stringify({
  lanes: {
    planning: { on_success: 'in-progress:queue' },
    backlog: {},
    'in-progress': { on_success: 'review:queue' },
    review: { on_success: 'quality-gate:queue' },
    'quality-gate': { on_success: 'done:queue' },
    done: {},
  },
}, null, 2);
const LANES = ['planning', 'backlog', 'in-progress', 'review', 'quality-gate', 'done'];

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});
async function open(workflow = OTRALINGO) {
  const dir = makeRepo({ files: { 'conductor/workflow.json': workflow } });
  cleanup.push(dir);
  const s = await connect(dir);
  sessions.push(s);
  return s;
}

test('nearest: the same word, a synonym group, a prefix, a typo; null when nothing is near', () => {
  assert.equal(nearestLane('implement', LANES), 'in-progress');
  assert.equal(nearestLane('in_progress', LANES), 'in-progress');
  assert.equal(nearestLane('In Progress', LANES), 'in-progress');
  assert.equal(nearestLane('plan', LANES), 'planning');
  assert.equal(nearestLane('reveiw', LANES), 'review');
  assert.equal(nearestLane('finished', LANES), 'done');
  assert.equal(nearestLane('qa', LANES), 'quality-gate');
  assert.equal(nearestLane('zebra', LANES), null);
  assert.equal(nearestLane('plan', ['plan', 'implement']), 'plan');
  assert.equal(nearestStatus('in_progress'), 'running');
  assert.equal(nearestStatus('in-progress'), 'running');
  assert.equal(nearestStatus('done'), 'success');
  assert.equal(nearestStatus('failed'), 'failure');
  assert.equal(nearestStatus('queued'), 'queue');
  assert.equal(nearestStatus('blocked'), 'waiting');
  assert.equal(nearestStatus('zebra'), null);
  assert.deepEqual(guideLaneMap(['plan', 'implement', 'merge'], LANES), { plan: 'planning', implement: 'in-progress', merge: null });
});

test('TC-7: update_track with `implement` or `in_progress` fails with the valid name, and nothing is written', async () => {
  const s = await open();
  const made = await s.call('create_track', { title: 'Probe', problem: 'checks the lane names' });
  assert.equal(made.isError, false, made.text);
  assert.equal(made.env.data.base.markers.Lane, 'planning', 'a track starts in the project\'s own planning lane');
  const track = made.env.data.track.number;
  const before = await s.call('get_track', { track });

  const lane = await s.call('update_track', { track, base: before.env.data.base, markers: { Lane: 'implement', 'Lane Status': 'queue' } });
  assert.equal(lane.isError, true);
  assert.equal(lane.env.error.code, 'VALIDATION_FAILED');
  assert.match(lane.env.error.message, /did you mean "in-progress"\?/);
  assert.match(lane.env.error.hint, /planning, backlog, in-progress, review, quality-gate, done/);
  assert.deepEqual(lane.env.error.details.suggestions, { Lane: 'in-progress' });
  assert.deepEqual(lane.env.error.details.valid_statuses, ['queue', 'running', 'success', 'failure', 'waiting']);
  assert.ok(lane.env.error.details.valid_lanes.includes('in-progress'));

  const status = await s.call('update_track', { track, base: before.env.data.base, markers: { Lane: 'in-progress', 'Lane Status': 'in_progress' } });
  assert.equal(status.isError, true);
  assert.match(status.env.error.message, /Lane Status: did you mean "running"\?/);
  assert.deepEqual(status.env.error.details.suggestions, { 'Lane Status': 'running' });

  const after1 = await s.call('get_track', { track });
  assert.equal(after1.env.data.track.markers.Lane, 'planning', 'a refused write changed nothing');

  // The suggested names work, on the first try after the error.
  const ok = await s.call('update_track', { track, base: before.env.data.base, markers: { Lane: 'in-progress', 'Lane Status': 'running' } });
  assert.equal(ok.isError, false, ok.text);
  assert.equal(ok.env.data.base.markers.Lane, 'in-progress');
});

test('TC-7: get_track and get_context list the valid lanes and statuses, and which lane each guide stands for', async () => {
  const s = await open();
  const made = await s.call('create_track', { title: 'Probe two', problem: 'p' });
  const t = await s.call('get_track', { track: made.env.data.track.number });
  assert.deepEqual(t.env.data.valid.lanes, LANES);
  assert.deepEqual(t.env.data.valid.statuses, ['queue', 'running', 'success', 'failure', 'waiting']);
  assert.equal(t.env.data.valid.guide_lanes.implement, 'in-progress');
  assert.equal(t.env.data.valid.guide_lanes.plan, 'planning');
  for (const args of [{}, { lane: 'implement' }]) {
    const c = await s.call('get_context', args);
    assert.deepEqual(c.env.data.valid.lanes, LANES, JSON.stringify(args));
    assert.equal(c.env.data.valid.guide_lanes.implement, 'in-progress');
  }
  // Additive: the fields that were there are still there.
  const c = await s.call('get_context');
  assert.ok(c.env.data.manifest && c.env.data.workflow_transitions && c.env.data.lane_guides);
  assert.ok(t.env.data.track && t.env.data.files && t.env.data.base && 'conversation' in t.env.data);
});

test('a project with the default lanes: the lane stays `plan` and the first write with the skill\'s names works', async () => {
  const dir = makeRepo();
  cleanup.push(dir);
  const s = await connect(dir);
  sessions.push(s);
  const made = await s.call('create_track', { title: 'Default', problem: 'p' });
  assert.equal(made.env.data.base.markers.Lane, 'plan');
  const t = await s.call('get_track', { track: made.env.data.track.number });
  const moved = await s.call('update_track', { track: made.env.data.track.number, base: t.env.data.base, markers: { Lane: 'implement' } });
  assert.equal(moved.isError, false, moved.text);
  const bad = await s.call('update_track', { track: made.env.data.track.number, base: moved.env.data.base, markers: { Lane: 'xylophone' } });
  assert.equal(bad.isError, true);
  assert.doesNotMatch(bad.env.error.message, /did you mean/, 'nothing near, nothing suggested');
});

test('TC-8: guards log an uncaught exception and an unhandled rejection and do not exit; every exit leaves one reason line', () => {
  const fake = new EventEmitter();
  fake.stderr = { write() { throw new Error('unused'); } };
  const lines = [];
  const g = installProcessGuards({ log: (m) => lines.push(m), proc: fake });
  fake.emit('uncaughtException', new Error('boom in a timer'));
  fake.emit('unhandledRejection', new Error('rejected later'));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^uncaught exception, still serving: Error: boom in a timer/);
  assert.match(lines[1], /^unhandled rejection, still serving: Error: rejected later/);
  g.exitBecause('signal SIGTERM');
  g.exitBecause('second reason is ignored');
  fake.emit('exit', 0);
  assert.equal(lines.at(-1), 'exiting: signal SIGTERM (code 0)');
  const g2 = installProcessGuards({ log: (m) => lines.push(m), proc: new EventEmitter() });
  assert.ok(g2.exitBecause);
});

test('TC-8: over stdio, a tool-level error does not end the server; SIGTERM and a closed stdin each log their reason on stderr', async () => {
  const dir = makeRepo();
  cleanup.push(dir);
  const start = async () => {
    const raw = spawnRaw(process.execPath, [BIN, '--repo', dir], { cwd: os.tmpdir() });
    await raw.initialize();
    return raw;
  };
  const a = await start();
  try {
    const miss = await a.request('tools/call', { name: 'get_track', arguments: { track: '99999' } });
    assert.equal(miss.result.isError, true);
    const bad = await a.request('tools/call', { name: 'update_track', arguments: { track: '1', base: { commit: 'x', files: {}, markers: {} } } });
    assert.equal(bad.result.isError, true);
    const fine = await a.request('tools/call', { name: 'list_tracks', arguments: {} });
    assert.ok(!fine.result.isError, 'the server kept serving after two refused calls');
    assert.equal(a.child.exitCode, null);
    const exited = new Promise((r) => a.child.once('exit', r));
    a.child.kill('SIGTERM');
    await exited;
    assert.match(a.stderr(), /exiting: signal SIGTERM \(code 0\)/);
  } finally { await a.kill(); }

  const b = await start();
  try {
    const exited = new Promise((r) => b.child.once('exit', r));
    b.child.stdin.end();
    await exited;
    assert.match(b.stderr(), /exiting: the client closed stdin \(the connection ended\) \(code 0\)/);
    assert.ok(b.stdoutLines.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), 'stdout stayed MCP-only');
  } finally { await b.kill(); }
});
