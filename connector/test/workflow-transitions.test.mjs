// Track AM-10131 (TC-1 to TC-5, TC-16, TC-18): the ONE transition resolver, conductor/services/workflow-transitions.mjs, shared by the
// connector and the sync daemon. Grammar: track 1020 (on_success / on_failure targets, `lane:status`, bare-target defaults).
// Fixtures: A = otralingo's real legacy workflow.json (bare targets, old lane names), B = this repository's current default,
// C = a custom workflow with an extra lane and mixed formats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTCOMES, describeNext, resolveNext, resolveTarget } from '../../conductor/services/workflow-transitions.mjs';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { nearestLane } from '../src/vocabulary.mjs';
import { makeRepo, rm } from './helpers/repo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'workflow', n), 'utf8'));
const A = fixture('a-otralingo-legacy.json');
const B = fixture('b-current-default.json');
const C = fixture('c-custom.json');
const lanesOf = (wf) => [...new Set([...Object.keys(wf.lanes), 'backlog'])];
const mapLane = (wf) => (name) => nearestLane(name, lanesOf(wf));

/** 'lane:status' or null (no automatic move); throws on an error so a table row cannot hide one. */
function go(wf, lane, outcome, opts = { mapLane: mapLane(wf) }) {
  const r = resolveNext(wf, lane, outcome, opts);
  assert.equal(r.ok, true, `${lane} ${outcome}: ${r.message}`);
  return r.next ? `${r.next.lane}:${r.next.status}` : null;
}
const table = (wf, rows) => {
  for (const [lane, success, failure] of rows) {
    assert.equal(go(wf, lane, 'success'), success, `${lane} success`);
    assert.equal(go(wf, lane, 'failure'), failure, `${lane} failure`);
  }
};

test('the fixtures are what the brief says they are', () => {
  assert.equal(A.lanes['in-progress'].on_success, 'review', 'A is otralingo\'s legacy file: bare targets');
  assert.equal(A.lanes.planning.auto_action, 'plan', 'A keeps its daemon fields');
  assert.equal(B.lanes.implement.on_success, 'review:queue');
  assert.deepEqual(Object.keys(C.lanes).includes('triage'), true);
});

test('TC-1 (A, legacy): bare targets resolve through the 1020 defaults; backlog and done have no automatic move', () => {
  table(A, [
    ['planning', 'backlog:queue', 'backlog:queue'],
    ['in-progress', 'review:queue', 'in-progress:failure'], // failure: bare target equals the current lane
    ['review', 'quality-gate:queue', 'in-progress:queue'], // a different lane
    ['quality-gate', 'done:queue', 'in-progress:queue'], // a bare `done` from another lane is done:queue
    ['backlog', null, null],
    ['done', null, null],
  ]);
});

test('TC-2 (B, current): lane:status targets are used as written', () => {
  table(B, [
    ['plan', 'plan:success', 'backlog:queue'],
    ['implement', 'review:queue', 'implement:failure'],
    ['review', 'quality-gate:queue', 'implement:queue'],
    ['quality-gate', 'done:queue', 'plan:queue'],
    ['done', null, 'done:failure'],
  ]);
});

test('TC-3 (grammar): bare different lane -> queue; bare same lane -> success / failure; explicit as written; bare done is done:queue; null or absent is no move', () => {
  assert.deepEqual(resolveTarget('review', 'implement', 'success'), { lane: 'review', status: 'queue' });
  assert.deepEqual(resolveTarget('review', 'implement', 'failure'), { lane: 'review', status: 'queue' });
  assert.deepEqual(resolveTarget('implement', 'implement', 'success'), { lane: 'implement', status: 'success' });
  assert.deepEqual(resolveTarget('implement', 'implement', 'failure'), { lane: 'implement', status: 'failure' });
  assert.deepEqual(resolveTarget('review:running', 'implement', 'success'), { lane: 'review', status: 'running' });
  assert.deepEqual(resolveTarget('implement:waiting', 'implement', 'failure'), { lane: 'implement', status: 'waiting' });
  assert.deepEqual(resolveTarget('done', 'quality-gate', 'success'), { lane: 'done', status: 'queue' }, 'never done:success');
  assert.deepEqual(resolveTarget('done', 'done', 'success'), { lane: 'done', status: 'success' });
  assert.deepEqual(resolveTarget('done:success', 'quality-gate', 'success'), { lane: 'done', status: 'success' }, 'explicit is explicit');
  for (const v of [null, undefined, '']) assert.equal(resolveTarget(v, 'implement', 'success'), null);
  assert.equal(resolveTarget(null, 'implement', 'failure'), null);
  // Whitespace and case do not make a lane a different lane.
  assert.deepEqual(resolveTarget(' Implement ', 'implement', 'failure'), { lane: 'Implement', status: 'failure' }, 'the name is kept as written, the status is the same-lane default');
  assert.throws(() => resolveTarget('review', 'implement', 'maybe'), /outcome/);
  assert.deepEqual(OUTCOMES, ['success', 'failure']);
});

test('TC-4 (C, custom): a custom lane resolves through the workflow\'s own keys; mixed formats; an unknown lane is an explicit error', () => {
  table(C, [
    ['triage', 'design:queue', null], // on_failure absent
    ['design', 'build:queue', 'triage:queue'],
    ['build', 'verify:queue', 'build:failure'],
    ['verify', 'done:queue', 'build:failure'],
    ['parked', 'parked:success', 'parked:waiting'],
    ['done', null, null],
  ]);
  const r = resolveNext(C, 'review', 'success', { mapLane: mapLane(C) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UNKNOWN_LANE');
  assert.match(r.message, /review/);
  assert.deepEqual(r.lanes, Object.keys(C.lanes));
  assert.equal(resolveNext(C, '', 'success').ok, false, 'no lane is an error too');
  assert.equal(resolveNext({}, 'plan', 'success').ok, false, 'a workflow without lanes is an error, never a guess');
  assert.equal(resolveNext(null, 'plan', 'success').ok, false);
});

test('TC-4: backlog is a known place with no automatic move, even when the workflow leaves it out', () => {
  assert.equal(go(B, 'backlog', 'success'), null);
  assert.equal(go(B, 'backlog', 'failure'), null);
});

test('TC-4: the `defaults` block of the daemon era is not a transition source (the grammar reads only the lane)', () => {
  const wf = { defaults: { on_success: 'review' }, lanes: { build: {} } };
  assert.equal(go(wf, 'build', 'success'), null);
});

test('TC-5 (names): a project on the guide names and one on the old names resolve the same logical transitions', () => {
  // Same lane, asked by either name.
  assert.equal(go(A, 'implement', 'success'), 'review:queue', 'guide name against the legacy file');
  assert.equal(go(A, 'in-progress', 'success'), 'review:queue');
  assert.equal(go(A, 'plan', 'success'), 'backlog:queue');
  assert.equal(go(B, 'in-progress', 'failure'), 'implement:failure', 'old name against the current file; the target keeps the file\'s name');
  assert.equal(go(B, 'planning', 'failure'), 'backlog:queue');
  // Without a mapping function the file's own names are all that resolve.
  assert.equal(resolveNext(A, 'implement', 'success', {}).ok, false);
  assert.equal(resolveNext(A, 'implement', 'success').code, 'UNKNOWN_LANE');
  // The resolved lane is reported, so the caller knows which key of the file it was.
  const r = resolveNext(A, 'implement', 'success', { mapLane: mapLane(A) });
  assert.equal(r.lane, 'in-progress');
});

test('describeNext: both directions at once, for valid.next', () => {
  assert.deepEqual(describeNext(A, 'in-progress', { mapLane: mapLane(A) }), { ok: true, lane: 'in-progress', next: { success: 'review:queue', failure: 'in-progress:failure' } });
  assert.deepEqual(describeNext(B, 'done', { mapLane: mapLane(B) }), { ok: true, lane: 'done', next: { success: null, failure: 'done:failure' } });
  const bad = describeNext(B, 'nowhere', {});
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'UNKNOWN_LANE');
});

test('the lane of a transition is the same list the table above was built from: every lane of every fixture resolves both ways', () => {
  for (const wf of [A, B, C]) {
    for (const lane of Object.keys(wf.lanes)) {
      for (const outcome of OUTCOMES) assert.equal(resolveNext(wf, lane, outcome, { mapLane: mapLane(wf) }).ok, true, `${lane} ${outcome}`);
    }
  }
});

test('TC-16: ONE logic, two callers: no second copy of the transition grammar outside conductor/services/workflow-transitions.mjs', () => {
  const SHARED = 'conductor/services/workflow-transitions.mjs';
  assert.ok(fs.existsSync(path.join(REPO, SHARED)));
  const sources = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (!['node_modules', 'tests', 'test', 'fixtures', 'plugins'].includes(e.name)) walk(rel); } else if (e.name.endsWith('.mjs')) sources.push(rel);
    }
  };
  walk('connector/src');
  walk('conductor');
  const offenders = [];
  for (const rel of sources) {
    if (rel === SHARED) continue;
    const text = fs.readFileSync(path.join(REPO, rel), 'utf8');
    // The bare-target defaulting (movingToNewLane / 'queue' for a different lane) and the target split are the grammar.
    if (/movingToNewLane/.test(text)) offenders.push(`${rel}: bare-target defaulting`);
    if (/\.on_(success|failure)[^\n]{0,80}\.split\(\s*['"]:['"]\s*\)/.test(text)) offenders.push(`${rel}: splits a transition target`);
    if (/split\(\s*['"]:['"]\s*\)[\s\S]{0,200}on_(success|failure)/.test(text) && !/workflow-transitions/.test(text)) offenders.push(`${rel}: parses lane:status near on_success`);
  }
  assert.deepEqual(offenders, [], 'transition parsing belongs to the shared module only');
});

test('TC-16: the connector and the daemon sites import the shared module', () => {
  const importers = [
    'connector/src/tools/common.mjs', // get_track, get_context and update_track go through it
    'conductor/services/daemon-transition.mjs', // the daemon's helpers (lane results, verdicts, spawnCli)
    'conductor/services/orphaned-dispatch.mjs',
    'conductor/services/resting-state.mjs',
  ];
  for (const rel of importers) assert.match(fs.readFileSync(path.join(REPO, rel), 'utf8'), /workflow-transitions\.mjs/, `${rel} imports the shared module`);
  for (const rel of ['conductor/laneconductor.sync.mjs', 'conductor/agent-runtime.mjs']) assert.match(fs.readFileSync(path.join(REPO, rel), 'utf8'), /services\/daemon-transition\.mjs/, `${rel} uses the daemon helpers`);
  assert.match(fs.readFileSync(path.join(REPO, 'connector/src/tools/update-track.mjs'), 'utf8'), /resolveOutcome/, 'update_track resolves through the shared module');
});

// TC-18: the generator ships the shared module inside the add-on at the same relative path, byte for byte, and the installed layout
// (a copy of the add-on laid out like the plugin cache, with only the npm dependencies beside it) resolves the import.
test('TC-18: the add-on ships conductor/services/workflow-transitions.mjs, byte-identical to the source', () => {
  const rel = 'conductor/services/workflow-transitions.mjs';
  const shipped = path.join(REPO, 'plugins/laneconductor-parallel', rel);
  assert.ok(fs.existsSync(shipped), 'shipped in the add-on');
  assert.ok(fs.readFileSync(shipped).equals(fs.readFileSync(path.join(REPO, rel))), 'byte-identical');
  for (const base of ['plugins/laneconductor', 'plugins/laneconductor-board']) assert.ok(!fs.existsSync(path.join(REPO, base, rel)), `${base} does not carry it (the base stays Markdown only)`);
});

test('TC-18: installed layout: a copy of the add-on (a plain directory with the npm dependencies beside it) serves valid.next and outcome through stdio', async () => {
  const installed = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-installed-'));
  const repo = makeRepo({ files: { 'conductor/workflow.json': fs.readFileSync(path.join(HERE, 'fixtures', 'workflow', 'a-otralingo-legacy.json'), 'utf8') } });
  let client;
  try {
    fs.cpSync(path.join(REPO, 'plugins/laneconductor-parallel'), installed, { recursive: true });
    fs.symlinkSync(path.join(REPO, 'connector', 'node_modules'), path.join(installed, 'node_modules'));
    assert.ok(fs.existsSync(path.join(installed, 'conductor/services/workflow-transitions.mjs')));
    assert.ok(!fs.existsSync(path.join(installed, 'connector')), 'nothing of the source repo is beside it');
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(installed, 'server/bin/lc-connector.mjs'), '--repo', repo], stderr: 'pipe' });
    client = new Client({ name: 'installed-layout', version: '0.0.0' });
    await client.connect(transport);
    const call = async (name, a) => (await client.callTool({ name, arguments: a })).structuredContent;
    const made = await call('create_track', { title: 'Installed', problem: 'p' });
    assert.equal(made.ok, true, JSON.stringify(made.error));
    const n = made.data.track.number;
    let t = await call('get_track', { track: n });
    const moved = await call('update_track', { track: n, base: t.data.base, markers: { Lane: 'in-progress', 'Lane Status': 'running' } });
    assert.equal(moved.ok, true, JSON.stringify(moved.error));
    t = await call('get_track', { track: n });
    assert.deepEqual(t.data.valid.next, { success: 'review:queue', failure: 'in-progress:failure' });
    const fin = await call('update_track', { track: n, base: t.data.base, outcome: 'success' });
    assert.equal(fin.ok, true, JSON.stringify(fin.error));
    assert.equal(fin.data.transition.to, 'review:queue');
  } finally {
    await client?.close().catch(() => {});
    rm(installed, repo);
  }
});
