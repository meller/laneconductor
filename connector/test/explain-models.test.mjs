// Track AM-10155 Phase 8 (D16, D17): model mix, thinking tokens, effort levels and the Path, read from synthetic transcripts. Numbers only.
//   TC-21 exact model mix, thinking share and effort levels per lane and phase; every existing total is unchanged
//   TC-23 the Path of a phase: run-length encoded tool kinds in time order, cut to 8 segments, no tool input or output
//   TC-25 (reader half) a model field, an effort field and a tool name that hold a token, an email and a prompt never reach the result
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, writeFile, rm, INDEX } from './helpers/repo.mjs';
import { analyzeTrack, renderExplain, pathOf, tierOf } from '../src/explain.mjs';

const real = fs.realpathSync(os.tmpdir());
const cleanup = [];
after(() => rm(...cleanup));
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };

const FOLDER = 'AM-777-demo-track';
const SECRET_TOKEN = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SECRET_EMAIL = 'jane.private@corp-secret.org';
const SECRET_WORDS = 'PRIVATE PROMPT SENTENCE';
const at = (hhmm) => `2026-11-20T${hhmm}:00.000Z`;
const NOW = '2026-11-21T08:00:00.000Z';

function commitAt(dir, iso, msg) {
  const env = { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso, GIT_TERMINAL_PROMPT: '0' };
  execFileSync('git', ['-C', dir, 'add', '-A'], { env });
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', msg], { env });
}

const PLAN = ['# Plan: AM-777', '', '## Phase 1: First', '- [ ] Task 1: write the thing', '- [ ] Task 2: second', '', '## Phase 2: Second', '- [ ] Task 3: finish it', ''].join('\n');
const ticked = (...ns) => PLAN.split('\n').map((l) => { const m = /^- \[ \] Task (\d+)/.exec(l); return m && ns.includes(Number(m[1])) ? l.replace('[ ]', '[x]') : l; }).join('\n');

/** plan 09:05-09:30, implement claimed 10:00, ticks 10:20 (task 1), 11:00 (task 2), 11:30 (task 3), review queue at 12:00. */
function fixtureRepo() {
  const repo = makeRepo({ prefix: 'lc-models-repo-' });
  cleanup.push(repo);
  const idx = (lane, status) => writeFile(repo, `conductor/tracks/${FOLDER}/index.md`, INDEX(777, 'Demo track', { lane, status }));
  idx('plan', 'queue'); writeFile(repo, `conductor/tracks/${FOLDER}/plan.md`, PLAN); commitAt(repo, at('09:00'), 'docs(track-777): created');
  idx('plan', 'running'); commitAt(repo, at('09:05'), 'docs(track-777): plan claimed');
  idx('plan', 'success'); commitAt(repo, at('09:30'), 'docs(track-777): planned');
  idx('implement', 'running'); commitAt(repo, at('10:00'), 'docs(track-777): implement claimed');
  writeFile(repo, `conductor/tracks/${FOLDER}/plan.md`, ticked(1)); commitAt(repo, at('10:20'), 'feat(track-777): Task 1');
  writeFile(repo, `conductor/tracks/${FOLDER}/plan.md`, ticked(1, 2)); commitAt(repo, at('11:00'), 'feat(track-777): Task 2');
  writeFile(repo, `conductor/tracks/${FOLDER}/plan.md`, ticked(1, 2, 3)); commitAt(repo, at('11:30'), 'feat(track-777): Task 3');
  idx('review', 'queue'); commitAt(repo, at('12:00'), 'docs(track-777): implement complete');
  return repo;
}

const jl = (...objs) => `${objs.map((o) => JSON.stringify(o)).join('\n')}\n`;
let seq = 0;
/**
 * One API response as the transcript writes it: one line per content block. `rich` switches the model, thinking and effort fields on;
 * with it off the same response is written the way the older fixtures write it, so the two give the same totals.
 */
function response({ session, ts, cwd, usage, blocks, side = null, rich = null }) {
  const id = `msg_${++seq}`;
  return blocks.map((content, i) => ({
    type: 'assistant', sessionId: session, timestamp: ts, cwd, gitBranch: 'main', requestId: `req_${seq}`, isSidechain: Boolean(side), ...(side ? { agentId: side } : {}),
    ...(rich?.effort !== undefined ? { effort: rich.effort } : {}), ...(rich?.perTurnEffort !== undefined ? { perTurnEffort: rich.perTurnEffort } : {}),
    message: {
      id, role: 'assistant', model: rich?.model ?? 'm', content: [content],
      usage: { input_tokens: usage[0], output_tokens: usage[1], cache_creation_input_tokens: usage[2], cache_read_input_tokens: usage[3], ...(rich && rich.thinking !== undefined ? { output_tokens_details: { thinking_tokens: rich.thinking } } : {}) },
      stop_reason: i === blocks.length - 1 ? 'end_turn' : null,
    },
  }));
}
const toolUse = (id, name, input = {}) => ({ type: 'tool_use', id, name, input });
const text = (t = 'ok') => ({ type: 'text', text: t });
const OPUS = 'claude-opus-5';
const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-4-5-20251001';

function fixtureProjects(repo, { rich = true } = {}) {
  const projects = tmp('lc-models-projects-');
  const folder = path.join(projects, repo.replace(/[^A-Za-z0-9]/g, '-'));
  const session = '11111111-aaaa-bbbb-cccc-000000000001';
  fs.mkdirSync(path.join(folder, session, 'subagents'), { recursive: true });
  const R = (o) => (rich ? o : null);
  const main = [
    // plan: one reply on the small model
    ...response({ session, ts: at('09:10'), cwd: repo, usage: [1, 10, 100, 1000], blocks: [text()], rich: R({ model: HAIKU, effort: 'low', thinking: 0 }) }),
    // phase 1 (10:00-11:00): two blocks of ONE reply, thinking 8 of 20 tokens, the newer perTurnEffort field
    ...response({ session, ts: at('10:10'), cwd: repo, usage: [2, 20, 200, 2000], blocks: [{ type: 'thinking', thinking: SECRET_WORDS }, toolUse('toolu_a', 'Read', { file_path: '/x/a.txt' })], rich: R({ model: OPUS, perTurnEffort: 'high', thinking: 8 }) }),
    // a streaming duplicate line of the same reply with a smaller thinking number: the larger value wins, the reply counts once
    ...response({ session, ts: at('10:10'), cwd: repo, usage: [2, 20, 200, 2000], blocks: [text()], rich: R({ model: OPUS, perTurnEffort: 'high', thinking: 3 }) }).map((l) => ({ ...l, message: { ...l.message, id: `msg_${seq - 1}` } })),
    ...response({ session, ts: at('10:12'), cwd: repo, usage: [1, 5, 0, 2100], blocks: [toolUse('toolu_b', 'Read', { file_path: '/x/a.txt' })], rich: R({ model: OPUS, effort: 'high' }) }),
    ...response({ session, ts: at('10:30'), cwd: repo, usage: [3, 30, 300, 3000], blocks: [toolUse('toolu_c', 'Bash', { command: 'ls' })], rich: R({ model: OPUS, effort: 'high', perTurnEffort: 'medium', thinking: 15 }) }),
    // phase 2 (11:00-11:30): a synthetic reply (no model answered) and no effort at all
    ...response({ session, ts: at('11:10'), cwd: repo, usage: [4, 40, 400, 4000], blocks: [text()], rich: R({ model: '<synthetic>' }) }),
    // after the last tick (11:30-12:00)
    ...response({ session, ts: at('11:45'), cwd: repo, usage: [5, 50, 500, 5000], blocks: [text()], rich: R({ model: OPUS, effort: 'high', thinking: 10 }) }),
  ];
  fs.writeFileSync(path.join(folder, `${session}.jsonl`), jl(...main));
  // a sub-agent of track 777; its Grep call (10:25) comes BEFORE the main session's Bash (10:30) although its file is read after the main file
  const sub = [
    ...response({ session, ts: at('10:25'), cwd: repo, side: 'aa', usage: [7, 70, 700, 7000], blocks: [toolUse('toolu_s', 'Grep', { pattern: 'x' })], rich: R({ model: SONNET, effort: 'medium', thinking: 0 }) }),
    ...response({ session, ts: at('10:26'), cwd: repo, side: 'aa', usage: [8, 80, 800, 8000], blocks: [text()], rich: R({ model: SONNET, effort: 'medium' }) }),
  ];
  fs.writeFileSync(path.join(folder, session, 'subagents', 'agent-aa.jsonl'), jl(...sub));
  fs.writeFileSync(path.join(folder, session, 'subagents', 'agent-aa.meta.json'), JSON.stringify({ description: 'track-runner: implement track 777' }));
  return projects;
}

const analyze = (repo, projects) => analyzeTrack({ repo, track: 777, projectsDir: projects, now: NOW });
const NEW_FIELDS = ['models', 'thinking', 'efforts', 'path'];
const without = (o) => { const c = { ...o }; for (const k of NEW_FIELDS) delete c[k]; return c; };

test('TC-21: model mix, thinking tokens and effort levels per lane run and phase are exact', async () => {
  const repo = fixtureRepo();
  const r = await analyze(repo, fixtureProjects(repo));
  const plan = r.runs.find((x) => x.lane === 'plan');
  assert.deepEqual(plan.models, { [HAIKU]: 1 });
  assert.deepEqual(plan.efforts, { low: 1 });
  const impl = r.runs.find((x) => x.lane === 'implement');
  assert.deepEqual(impl.models, { [OPUS]: 4, [SONNET]: 2, synthetic: 1 }, 'a reply is counted once, not once per content block; <synthetic> never appears raw');
  // thinking is recorded on 4 replies (8, 0, 15, 10 tokens of 20, 70, 30, 50 output): the larger streaming value wins; absent is unknown, not zero
  assert.deepEqual(impl.thinking, { tokens: 8 + 0 + 15 + 10, recorded: 4, output: 20 + 70 + 30 + 50 });
  assert.deepEqual(impl.efforts, { high: 3, medium: 3, unknown: 1 }, 'perTurnEffort wins over effort; a reply with neither is unknown');
  const p1 = r.phases.find((p) => p.key === 'Phase 1');
  assert.deepEqual(p1.models, { [OPUS]: 3, [SONNET]: 2 });
  assert.deepEqual(p1.thinking, { tokens: 8 + 0 + 15, recorded: 3, output: 20 + 70 + 30 });
  assert.deepEqual(p1.efforts, { high: 2, medium: 3 });
  assert.deepEqual(r.phases.find((p) => p.key === 'Phase 2').models, { synthetic: 1 });
  assert.deepEqual(r.phases.find((p) => p.key === 'Phase 2').thinking, { tokens: 0, recorded: 0, output: 0 });
  assert.deepEqual(r.phases.find((p) => p.key === 'after').models, { [OPUS]: 1 });
  // the phases add up to the lane run
  const sumOf = (k) => r.phases.reduce((s, p) => s + Object.values(p[k]).reduce((a, b) => a + b, 0), 0);
  assert.equal(sumOf('models'), 7);
  assert.equal(sumOf('efforts'), 7);
});

test('TC-21: every existing total is unchanged by the new fields', async () => {
  const repo = fixtureRepo();
  const plain = await analyze(repo, fixtureProjects(repo, { rich: false }));
  const rich = await analyze(repo, fixtureProjects(repo, { rich: true }));
  assert.deepEqual(rich.runs.map(without), plain.runs.map(without));
  assert.deepEqual(rich.phases.map(without), plain.phases.map(without));
  assert.deepEqual(rich.none, plain.none);
  assert.deepEqual(rich.skipped, plain.skipped);
  const impl = rich.runs.find((x) => x.lane === 'implement');
  assert.equal(impl.responses, 7);
  assert.deepEqual(impl.tokens, { output: 20 + 5 + 30 + 40 + 50 + 70 + 80, fresh: 2 + 1 + 3 + 4 + 5 + 7 + 8, cacheCreated: 200 + 0 + 300 + 400 + 500 + 700 + 800, cacheRead: 2000 + 2100 + 3000 + 4000 + 5000 + 7000 + 8000 });
  assert.deepEqual(impl.tools, { Read: 2, Bash: 1, Grep: 1 });
  // without the fields every reply is of unknown model and effort, and no thinking is recorded
  const pi = plain.runs.find((x) => x.lane === 'implement');
  assert.deepEqual(pi.thinking, { tokens: 0, recorded: 0, output: 0 });
  assert.deepEqual(pi.efforts, { unknown: 7 });
});

test('TC-21: the markdown shows models, thinking and effort in the details and the phase notes, and the tables are unchanged', async () => {
  const repo = fixtureRepo();
  const md = renderExplain(await analyze(repo, fixtureProjects(repo)), { now: NOW });
  const detail = /## Detail: implement[^\n]*\n([\s\S]*?)(?=\n## )/.exec(md)[1];
  assert.match(detail, /Replies by model: claude-opus-5 4, claude-sonnet-5-5 2, synthetic 1/);
  assert.match(detail, /Thinking tokens: 33 of 170 output tokens on the 4 of 7 replies that record them \(19%\)/);
  assert.match(detail, /Effort levels seen: high 3, medium 3, unknown 1/);
  const notes = /## Phases of the implement lane[\s\S]*?(?=\n## )/.exec(md)[0];
  assert.match(notes, /- Phase 1: First: replies by model claude-opus-5 3, claude-sonnet-5-5 2; thinking 23 of 120 output tokens \(19%, recorded on 3 of 5 replies\); effort medium 3, high 2; path Read x2, Grep x1, Bash x1/);
  // no table row was added under either table heading
  const rows = notes.split('\n').filter((l) => l.startsWith('|'));
  assert.equal(rows.length, 2 + 3, 'header, separator and the phase rows only');
});

test('TC-23: the Path is the tool kinds in time order (sub-agent calls interleaved), run-length encoded', async () => {
  const repo = fixtureRepo();
  const r = await analyze(repo, fixtureProjects(repo));
  assert.equal(r.phases.find((p) => p.key === 'Phase 1').path, 'Read x2, Grep x1, Bash x1');
  assert.equal(r.runs.find((x) => x.lane === 'implement').path, 'Read x2, Grep x1, Bash x1');
  assert.equal(r.phases.find((p) => p.key === 'Phase 2').path, '', 'no tool call, no path');
  // a second run gives the same text
  assert.equal((await analyze(repo, fixtureProjects(repo))).phases[0].path, r.phases[0].path);
});

test('TC-23: pathOf encodes runs, keeps the first 8 segments and says it was cut', () => {
  assert.equal(pathOf([]), '');
  assert.equal(pathOf(['Read', 'Read', 'Bash', 'Read']), 'Read x2, Bash x1, Read x1');
  const many = ['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B'];
  const p = pathOf(many);
  assert.equal(p.split(', ').filter((s) => /^[A-Za-z]+ x\d+$/.test(s)).length, 8);
  assert.ok(p.endsWith(', ...'), 'a cut path ends with ...');
  assert.equal(pathOf(many.slice(0, 8)).endsWith('...'), false, 'exactly 8 segments is not cut');
  assert.equal(pathOf([...Array(12).fill('Read'), ...Array(26).fill('Bash'), 'Write', 'Write']), 'Read x12, Bash x26, Write x2');
});

test('TC-23: tool input and output never reach the Path: a tool name that is free text becomes "other"', async () => {
  const repo = fixtureRepo();
  const projects = tmp('lc-models-priv-');
  const folder = path.join(projects, repo.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(folder, { recursive: true });
  const session = '22222222-aaaa-bbbb-cccc-000000000002';
  const lines = [
    ...response({ session, ts: at('10:10'), cwd: repo, usage: [1, 10, 1, 1], blocks: [toolUse('t1', SECRET_WORDS, { command: SECRET_TOKEN })], rich: { model: SECRET_TOKEN, effort: SECRET_EMAIL, thinking: 1 } }),
    ...response({ session, ts: at('10:11'), cwd: repo, usage: [1, 10, 1, 1], blocks: [toolUse('t2', 'Bash', { command: `echo ${SECRET_EMAIL}` })], rich: { model: SECRET_EMAIL, effort: SECRET_WORDS } }),
    ...response({ session, ts: at('10:12'), cwd: repo, usage: [1, 10, 1, 1], blocks: [toolUse('t3', 'Bash', { command: 'ls' })], rich: { model: '<synthetic>', perTurnEffort: SECRET_TOKEN } }),
  ];
  fs.writeFileSync(path.join(folder, `${session}.jsonl`), jl(...lines));
  const r = await analyze(repo, projects);
  const md = renderExplain(r, { now: NOW });
  const json = JSON.stringify(r);
  for (const [where, t] of [['markdown', md], ['result', json]]) {
    for (const bad of [SECRET_TOKEN, 'sk-ant', SECRET_EMAIL, 'corp-secret', 'jane.private', 'PRIVATE', 'SENTENCE', '<synthetic>', 'echo ']) assert.ok(!t.includes(bad), `${where} must not contain ${bad}`);
  }
  const impl = r.runs.find((x) => x.lane === 'implement');
  assert.deepEqual(impl.models, { other: 2, synthetic: 1 });
  assert.deepEqual(impl.efforts, { other: 3 });
  assert.equal(impl.path, 'other x1, Bash x2');
});

test('tierOf reads the tier from the id: opus above sonnet above haiku, anything else unknown', () => {
  assert.equal(tierOf('claude-opus-5-5'), 3);
  assert.equal(tierOf('claude-sonnet-5'), 2);
  assert.equal(tierOf('claude-haiku-4-5-20251001'), 1);
  assert.equal(tierOf('claude-fable-5'), 0);
  assert.equal(tierOf('synthetic'), 0);
  assert.equal(tierOf('other'), 0);
});
