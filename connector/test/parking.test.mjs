// Track AM-10136: parking and resume without a daemon. Nothing resumes a parked track by itself; the connector says which parked
// tracks are ready (blocked_by, ready_to_resume), refuses a dependency on a track that does not exist, warns about a park with no
// Waiting Reason, and takes the parking markers off when a status other than waiting is set.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './helpers/mcp.mjs';
import { git, makeRepo, rm } from './helpers/repo.mjs';
import { dependencyState, readyToResume } from '../src/dependencies.mjs';
import { generateSummary } from '../src/summary.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LANES = ['plan', 'implement', 'review', 'quality-gate', 'done'];

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});

const index = (n, markers) => `# Track AM-${n}: Track ${n}\n\n${Object.entries(markers).map(([k, v]) => `**${k}**: ${v}`).join('\n')}\n\n## Problem\n\nx\n`;
const trackFiles = (n, markers) => {
  const folder = `conductor/tracks/AM-${n}-track-${n}`;
  return { [`${folder}/index.md`]: index(n, { Lane: 'plan', 'Lane Status': 'queue', ...markers }) };
};
async function open(files) {
  const dir = makeRepo({ files, workflow: false });
  cleanup.push(dir);
  const s = await connect(dir);
  sessions.push(s);
  return { s, dir };
}
const baseOf = async (s, n) => (await s.call('get_track', { track: n })).env.data.base;

const row = (number, lane, lane_status, extra = {}) => ({ number, id: `AM-${number}`, lane, lane_status, depends_on: [], waiting_on: [], waiting_for_reply: false, ...extra });

test('TC-2: dependency state: unmet, unknown, met, Waiting On Tracks, waiting-for-reply, done lane', () => {
  const rows = [
    row(1, 'done', 'success'),
    row(2, 'done', 'queue'),
    row(3, 'implement', 'waiting', { depends_on: ['1'] }),
    row(4, 'implement', 'waiting', { waiting_on: ['2'] }),
    row(5, 'implement', 'waiting', { depends_on: ['99'] }),
    row(6, 'implement', 'waiting', { waiting_on: ['1'], waiting_for_reply: true }),
    row(7, 'implement', 'queue', { depends_on: ['1'] }),
    row(8, 'done', 'success', { depends_on: ['99'] }),
    row(9, 'implement', 'waiting', { depends_on: ['1'], waiting_on: ['1'] }),
    row(10, 'implement', 'waiting'),
    row(11, 'implement', 'waiting', { depends_on: ['1'], waiting_reason: true }),
    row(12, 'implement', 'waiting', { depends_on: ['1'], waiting_on: ['1'], waiting_reason: true }),
    row(13, 'implement', 'waiting', { depends_on: ['2'], waiting_reason: true }),
  ];
  const s = dependencyState(rows);
  assert.deepEqual(s.get(3), { blocked_by: [], ready_to_resume: true });
  assert.deepEqual(s.get(4), { blocked_by: [2], ready_to_resume: false }, 'done:queue is gated, not merged');
  assert.deepEqual(s.get(5), { blocked_by: [99], ready_to_resume: false }, 'an unknown number is unmet');
  assert.deepEqual(s.get(6), { blocked_by: [], ready_to_resume: false }, 'a park for a question is not ready');
  assert.deepEqual(s.get(7), { blocked_by: [], ready_to_resume: false }, 'queued, not parked: nothing to resume');
  assert.equal(s.has(8), false, 'a done track is not blocked');
  assert.deepEqual(s.get(9), { blocked_by: [], ready_to_resume: true }, 'both markers name the same track once');
  assert.equal(s.has(10), false, 'no dependencies, nothing to say');
  assert.deepEqual(s.get(11), { blocked_by: [], ready_to_resume: false }, 'a park with a reason and no Waiting On Tracks is a question or an approval, not a dependency wait');
  assert.deepEqual(s.get(12), { blocked_by: [], ready_to_resume: true }, 'Waiting On Tracks keeps the union meaning');
  assert.deepEqual(s.get(13), { blocked_by: [2], ready_to_resume: false });
  assert.deepEqual(readyToResume(rows), ['AM-12', 'AM-9', 'AM-3']);
});

test('TC-3: list_tracks, get_track and get_context show blocked_by and ready_to_resume', async () => {
  const { s } = await open({
    ...trackFiles(1208, { Lane: 'done', 'Lane Status': 'success' }),
    ...trackFiles(1292, { Lane: 'implement', 'Lane Status': 'waiting', 'Depends On': '1208', 'Waiting On Tracks': '1208', 'Waiting Reason': 'on 1208' }),
    ...trackFiles(1296, { Lane: 'implement', 'Lane Status': 'waiting', 'Depends On': '1208', 'Waiting Reason': 'needs the owner to approve the pricing' }),
    ...trackFiles(1293, { Lane: 'implement', 'Lane Status': 'waiting', 'Waiting On Tracks': '1295', 'Waiting Reason': 'on 1295' }),
    ...trackFiles(1295, { Lane: 'review', 'Lane Status': 'queue' }),
  });
  const l = await s.call('list_tracks', { include_done: true });
  const by = Object.fromEntries(l.env.data.tracks.map((t) => [t.number, t]));
  assert.equal(by[1292].ready_to_resume, true);
  assert.deepEqual(by[1292].blocked_by, []);
  assert.deepEqual(by[1293].blocked_by, [1295]);
  assert.equal(by[1293].ready_to_resume, false);
  assert.ok(!('blocked_by' in by[1208]) && !('ready_to_resume' in by[1295]), 'tracks without dependencies carry neither field');
  assert.ok(!('waiting_on' in by[1292]), 'the helper field is not part of the output');
  assert.deepEqual(l.env.data.ready_to_resume, ['AM-1292'], 'AM-1296 is parked for an approval: its finished Depends On do not make it ready');
  assert.equal(by[1296].ready_to_resume, false);
  assert.deepEqual(by[1296].blocked_by, []);
  assert.ok(!('waiting_reason' in by[1296]), 'the helper field is not part of the output');
  const t = await s.call('get_track', { track: 1292 });
  assert.deepEqual(t.env.data.dependencies, { blocked_by: [], ready_to_resume: true });
  const t2 = await s.call('get_track', { track: 1295 });
  assert.ok(!('dependencies' in t2.env.data));
  const c = await s.call('get_context');
  assert.deepEqual(c.env.data.ready_to_resume, ['AM-1292']);
});

test('TC-3: with nothing to resume the list and the context carry no ready_to_resume field', async () => {
  const { s } = await open({ ...trackFiles(1, {}), ...trackFiles(2, { Lane: 'implement', 'Lane Status': 'waiting', 'Depends On': '1', 'Waiting Reason': 'x' }) });
  const l = await s.call('list_tracks');
  assert.ok(!('ready_to_resume' in l.env.data));
  assert.ok(!('ready_to_resume' in (await s.call('get_context')).env.data));
});

test('TC-4: create_track refuses a dependency on a track that does not exist, and writes nothing', async () => {
  const { s, dir } = await open({ ...trackFiles(5, {}) });
  const before = git(dir, 'rev-parse', 'HEAD');
  const bad = await s.call('create_track', { title: 'Needs a ghost', problem: 'p', depends_on: [5, 'AM-777'] });
  assert.equal(bad.isError, true);
  assert.equal(bad.env.error.code, 'VALIDATION_FAILED');
  assert.match(bad.env.error.message, /777/);
  assert.deepEqual(bad.env.error.details.unknown_dependencies, ['777']);
  assert.equal(git(dir, 'rev-parse', 'HEAD'), before, 'no commit');
  const ok = await s.call('create_track', { title: 'Needs five', problem: 'p', depends_on: ['AM-5'] });
  assert.equal(ok.isError, false, ok.text);
  const made = await s.call('get_track', { track: ok.env.data.track.number });
  assert.equal(made.env.data.track.markers['Depends On'], '5');
});

test('TC-5: setting a status other than waiting takes the parking markers off; waiting keeps them; the caller may set them', async () => {
  const parked = () => trackFiles(20, { Lane: 'implement', 'Lane Status': 'waiting', 'Waiting Reason': 'on 19', 'Waiting On Tracks': '19' });
  const { s } = await open(parked());
  let r = await s.call('update_track', { track: 20, base: await baseOf(s, 20), markers: { 'Lane Status': 'queue' } });
  assert.equal(r.isError, false, r.text);
  let m = (await s.call('get_track', { track: 20 })).env.data.track.markers;
  assert.ok(!('Waiting Reason' in m) && !('Waiting On Tracks' in m));
  assert.equal(m['Lane Status'], 'queue');

  const k = await open(parked());
  r = await k.s.call('update_track', { track: 20, base: await baseOf(k.s, 20), markers: { Progress: '10%' } });
  m = (await k.s.call('get_track', { track: 20 })).env.data.track.markers;
  assert.equal(m['Waiting Reason'], 'on 19', 'a write that does not set the status leaves the park alone');
  r = await k.s.call('update_track', { track: 20, base: await baseOf(k.s, 20), markers: { 'Lane Status': 'waiting', 'Waiting Reason': 'still on 19' } });
  m = (await k.s.call('get_track', { track: 20 })).env.data.track.markers;
  assert.equal(m['Waiting Reason'], 'still on 19');
  assert.equal(m['Waiting On Tracks'], '19');

  const w = await open(parked());
  r = await w.s.call('update_track', { track: 20, base: await baseOf(w.s, 20), markers: { 'Lane Status': 'queue', 'Waiting Reason': 'kept on purpose' } });
  m = (await w.s.call('get_track', { track: 20 })).env.data.track.markers;
  assert.equal(m['Waiting Reason'], 'kept on purpose', 'what the caller sets in the same call wins');
  assert.ok(!('Waiting On Tracks' in m));
});

test('TC-6: a track becoming waiting without a Waiting Reason gets a warning; with one, none', async () => {
  const { s } = await open({ ...trackFiles(30, {}), ...trackFiles(31, {}) });
  const bare = await s.call('update_track', { track: 30, base: await baseOf(s, 30), markers: { 'Lane Status': 'waiting' } });
  assert.equal(bare.isError, false, bare.text);
  assert.ok(bare.env.warnings.some((w) => /no \*\*Waiting Reason\*\*/.test(w)), JSON.stringify(bare.env.warnings));
  const good = await s.call('update_track', { track: 31, base: await baseOf(s, 31), markers: { 'Lane Status': 'waiting', 'Waiting Reason': 'needs the owner to pick a name' } });
  assert.equal(good.isError, false, good.text);
  assert.ok(!good.env.warnings.some((w) => /Waiting Reason/.test(w)));
});

test('TC-6: the summary lists a waiting track with no Waiting Reason under Needs attention (a done:waiting PR is not a park)', () => {
  const entry = (n, markers) => ({ folder: `AM-${n}-t`, index: { content: index(n, markers) } });
  const { attention } = generateSummary([
    entry(1, { Lane: 'implement', 'Lane Status': 'waiting' }),
    entry(2, { Lane: 'implement', 'Lane Status': 'waiting', 'Waiting Reason': 'x' }),
    entry(3, { Lane: 'done', 'Lane Status': 'waiting' }),
  ], { lanes: LANES, generatedAt: '2026-01-01T00:00:00Z' });
  assert.deepEqual(attention.map((a) => a.id), ['AM-1']);
  assert.match(attention[0].problems[0], /Waiting Reason/);
});

test('TC-7: claiming a track whose dependencies are not done:success warns; with them met, no warning', async () => {
  const { s } = await open({
    ...trackFiles(40, { Lane: 'done', 'Lane Status': 'success' }),
    ...trackFiles(41, {}),
    ...trackFiles(42, { 'Depends On': '40, 41' }),
    ...trackFiles(43, { 'Depends On': '40' }),
  });
  const blocked = await s.call('update_track', { track: 42, base: await baseOf(s, 42), markers: { 'Lane Status': 'running' } });
  assert.equal(blocked.isError, false, 'a warning, never a refusal');
  assert.ok(blocked.env.warnings.some((w) => /depends on 41/.test(w)), JSON.stringify(blocked.env.warnings));
  const fine = await s.call('update_track', { track: 43, base: await baseOf(s, 43), markers: { 'Lane Status': 'running' } });
  assert.ok(!fine.env.warnings.some((w) => /depends on/.test(w)));
});

test('TC-1 (regression): the skill no longer says a reconciler resumes a track; it says who does and how', () => {
  const skill = fs.readFileSync(path.join(REPO, '.claude/skills/laneconductor/SKILL.md'), 'utf8');
  assert.ok(!/reconciler/i.test(skill));
  assert.match(skill, /Nothing\s+resumes a parked track by itself/);
  assert.match(skill, /\*\*Waiting Reason\*\*/);
  for (const plugin of ['laneconductor', 'laneconductor-parallel']) {
    const dir = path.join(REPO, 'plugins', plugin);
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') stack.push(p); } else if (/\.md$/.test(e.name)) assert.ok(!/reconciler/i.test(fs.readFileSync(p, 'utf8')), `${p} mentions a reconciler`);
      }
    }
  }
});
