// Track AM-10155: `lc-explain.mjs`, the EXPLAIN for agent work. Synthetic repositories with dated commits and synthetic
// session transcripts; nothing here reads the real ~/.claude folder.
//   TC-1 lane run and phase boundaries   TC-2 agent versus human time, token split, sub-agent share
//   TC-3 privacy                         TC-4 idempotent and names its sources
//   TC-9 a session spanning two tracks   TC-11 the approximation note
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, writeFile, rm, INDEX } from './helpers/repo.mjs';
import { analyzeTrack, renderExplain, APPROX_NOTE } from '../src/explain.mjs';
import { intervalsOfRun, parsePlan } from '../src/explain-boundaries.mjs';

const BIN = new URL('../bin/lc-explain.mjs', import.meta.url).pathname;
const real = fs.realpathSync(os.tmpdir());
const cleanup = [];
after(() => rm(...cleanup));
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };

const FOLDER = 'AM-777-demo-track';
const SECRET_TOKEN = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SECRET_EMAIL = 'jane.private@corp-secret.org';
const SECRET_WORDS = 'PRIVATE-PROMPT-SENTENCE';
const MIN = 60000;
const at = (hhmm) => `2026-11-20T${hhmm}:00.000Z`;

function commitAt(dir, iso, msg) {
  const env = { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso, GIT_TERMINAL_PROMPT: '0' };
  execFileSync('git', ['-C', dir, 'add', '-A'], { env });
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', msg], { env });
}

const PLAN = [
  '# Plan: AM-777', '',
  '## Phase 1: First', '- [ ] Task 1: write the thing', '- [ ] Task 2 (HUMAN): the owner decides', '',
  '## Phase 2: Second', '- [ ] Task 3: finish it', '',
].join('\n');
const ticked = (...ns) => PLAN.split('\n').map((l) => { const m = /^- \[ \] Task (\d+)/.exec(l); return m && ns.includes(Number(m[1])) ? l.replace('[ ]', '[x]') : l; }).join('\n');

/** The repository: plan 09:05-09:30, implement claimed 10:00, ticks at 10:20 (task 1), 11:00 (task 2, HUMAN), 11:30 (task 3), moved to review at 12:00. */
function fixtureRepo({ waiting = false } = {}) {
  const repo = makeRepo({ prefix: 'lc-explain-repo-' });
  cleanup.push(repo);
  const idx = (lane, status) => writeFile(repo, `conductor/tracks/${FOLDER}/index.md`, INDEX(777, 'Demo track', { lane, status }));
  idx('plan', 'queue'); writeFile(repo, `conductor/tracks/${FOLDER}/plan.md`, PLAN); commitAt(repo, at('09:00'), 'docs(track-777): created');
  idx('plan', 'running'); commitAt(repo, at('09:05'), 'docs(track-777): plan claimed');
  idx('plan', 'success'); commitAt(repo, at('09:30'), 'docs(track-777): planned');
  idx('implement', 'running'); commitAt(repo, at('10:00'), 'docs(track-777): implement claimed');
  writeFile(repo, `conductor/tracks/${FOLDER}/plan.md`, ticked(1)); commitAt(repo, at('10:20'), 'feat(track-777): Task 1');
  if (waiting) { idx('implement', 'waiting'); commitAt(repo, at('10:30'), 'docs(track-777): waiting on a reply'); idx('implement', 'running'); commitAt(repo, at('10:40'), 'docs(track-777): reply arrived'); }
  writeFile(repo, `conductor/tracks/${FOLDER}/plan.md`, ticked(1, 2)); commitAt(repo, at('11:00'), 'feat(track-777): Task 2');
  writeFile(repo, `conductor/tracks/${FOLDER}/plan.md`, ticked(1, 2, 3)); commitAt(repo, at('11:30'), 'feat(track-777): Task 3');
  idx('review', 'queue'); commitAt(repo, at('12:00'), 'docs(track-777): implement complete');
  return repo;
}

const jl = (...objs) => `${objs.map((o) => JSON.stringify(o)).join('\n')}\n`;
let seq = 0;
/** One API response as the transcript writes it: one line per content block, the same message id and usage on each. */
function response({ session, ts, cwd, branch = 'main', usage, blocks, side = null }) {
  const id = `msg_${++seq}`;
  return blocks.map((content, i) => ({
    type: 'assistant', sessionId: session, timestamp: ts, cwd, gitBranch: branch, requestId: `req_${seq}`, isSidechain: Boolean(side), ...(side ? { agentId: side } : {}),
    message: { id, role: 'assistant', model: 'm', content: [content], usage: { input_tokens: usage[0], output_tokens: usage[1], cache_creation_input_tokens: usage[2], cache_read_input_tokens: usage[3] }, stop_reason: i === blocks.length - 1 ? 'end_turn' : null },
  }));
}
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });
const toolResult = ({ session, ts, cwd, id, text = 'RESULT' }) => ({ type: 'user', sessionId: session, timestamp: ts, cwd, gitBranch: 'main', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });

/** The projects folder: one main session (many tracks' time in it) and one sub-agent run. */
function fixtureProjects(repo) {
  const projects = tmp('lc-explain-projects-');
  const folder = path.join(projects, repo.replace(/[^A-Za-z0-9]/g, '-'));
  const session = '11111111-aaaa-bbbb-cccc-000000000001';
  fs.mkdirSync(path.join(folder, session, 'subagents'), { recursive: true });
  const lines = [
    // plan lane (09:05-09:30): 1 response; output 10, fresh 1, cache created 100, cache read 1000
    ...response({ session, ts: at('09:10'), cwd: repo, usage: [1, 10, 100, 1000], blocks: [{ type: 'text', text: `${SECRET_WORDS} ${SECRET_EMAIL}` }] }),
    // implement, task 1 interval (10:00-10:20): two blocks of ONE response (counted once), a tool call with a result 90 s later
    ...response({ session, ts: at('10:10'), cwd: repo, usage: [2, 20, 200, 2000], blocks: [{ type: 'thinking', thinking: SECRET_WORDS }, toolUse('toolu_a', 'Read', { file_path: `/home/someone/secret-${SECRET_EMAIL}.txt` })] }),
    toolResult({ session, ts: '2026-11-20T10:11:30.000Z', cwd: repo, id: 'toolu_a', text: `file body ${SECRET_TOKEN}` }),
    // the same file read again: one repeat
    ...response({ session, ts: at('10:12'), cwd: repo, usage: [1, 5, 0, 2100], blocks: [toolUse('toolu_b', 'Read', { file_path: `/home/someone/secret-${SECRET_EMAIL}.txt` })] }),
    toolResult({ session, ts: '2026-11-20T10:12:05.000Z', cwd: repo, id: 'toolu_b' }),
    // task 2 (HUMAN) interval (10:20-11:00): the agent chats while the owner is expected to decide
    ...response({ session, ts: at('10:30'), cwd: repo, usage: [3, 30, 300, 3000], blocks: [toolUse('toolu_c', 'Bash', { command: `echo ${SECRET_TOKEN}` })] }),
    toolResult({ session, ts: '2026-11-20T10:30:40.000Z', cwd: repo, id: 'toolu_c' }),
    // task 3 interval (11:00-11:30)
    ...response({ session, ts: at('11:10'), cwd: repo, usage: [4, 40, 400, 4000], blocks: [{ type: 'text', text: 'ok' }] }),
    // after the last tick (11:30-12:00)
    ...response({ session, ts: at('11:45'), cwd: repo, usage: [5, 50, 500, 5000], blocks: [{ type: 'text', text: 'ok' }] }),
    // another track's branch, inside the implement window: not ours
    ...response({ session, ts: at('10:15'), cwd: repo, branch: 'track-999', usage: [9, 900, 9000, 90000], blocks: [{ type: 'text', text: 'ok' }] }),
    // outside the repository: ignored
    ...response({ session, ts: at('10:16'), cwd: '/somewhere/else', usage: [9, 900, 9000, 90000], blocks: [{ type: 'text', text: 'ok' }] }),
    // in a window of no lane (13:00): counted under none
    ...response({ session, ts: at('13:00'), cwd: repo, usage: [6, 60, 600, 6000], blocks: [{ type: 'text', text: 'ok' }] }),
  ];
  fs.writeFileSync(path.join(folder, `${session}.jsonl`), jl(...lines));
  // a sub-agent run for track 777 (the meta file names the track; the run is flagged as a side chain)
  const sub = [
    ...response({ session, ts: at('10:25'), cwd: repo, branch: 'worktree-agent-aa', side: 'aa', usage: [7, 70, 700, 7000], blocks: [toolUse('toolu_s', 'Bash', { command: 'ls' })] }),
    toolResult({ session, ts: '2026-11-20T10:25:10.000Z', cwd: repo, id: 'toolu_s' }),
    ...response({ session, ts: at('10:26'), cwd: repo, branch: 'worktree-agent-aa', side: 'aa', usage: [8, 80, 800, 8000], blocks: [{ type: 'text', text: 'ok' }] }),
  ];
  fs.writeFileSync(path.join(folder, session, 'subagents', 'agent-aa.jsonl'), jl(...sub));
  fs.writeFileSync(path.join(folder, session, 'subagents', 'agent-aa.meta.json'), JSON.stringify({ agentType: 'x:track-runner', description: `track-runner: implement track 777 ${SECRET_WORDS}`, worktreePath: '/x/y' }));
  // a sub-agent of ANOTHER track in the same minutes
  fs.writeFileSync(path.join(folder, session, 'subagents', 'agent-bb.jsonl'), jl(...response({ session, ts: at('10:27'), cwd: repo, branch: 'worktree-agent-bb', side: 'bb', usage: [9, 90, 900, 9000], blocks: [{ type: 'text', text: 'ok' }] })));
  fs.writeFileSync(path.join(folder, session, 'subagents', 'agent-bb.meta.json'), JSON.stringify({ description: 'track-runner: implement track 888' }));
  return projects;
}

const NOW = '2026-11-21T08:00:00.000Z';
const analyze = (repo, projects, extra = {}) => analyzeTrack({ repo, track: 777, projectsDir: projects, now: NOW, ...extra });

test('TC-1: a lane claim, three plan ticks and a completion give one implement run with its phases at the right boundaries', async () => {
  const repo = fixtureRepo();
  const r = await analyze(repo, fixtureProjects(repo));
  const lanes = r.runs.map((x) => x.lane);
  assert.deepEqual(lanes, ['plan', 'implement'], 'one run per lane that ran');
  const impl = r.runs.find((x) => x.lane === 'implement');
  assert.equal(impl.start, at('10:00'));
  assert.equal(impl.end, at('12:00'));
  assert.equal(impl.wallMs, 120 * MIN);
  assert.equal(impl.claimed, true);
  const phase = (k) => r.phases.find((p) => p.key === k);
  assert.deepEqual(r.phases.map((p) => p.key), ['Phase 1', 'Phase 2', 'after']);
  assert.equal(phase('Phase 1').wallMs, 60 * MIN, 'claim to the tick of task 2');
  assert.equal(phase('Phase 2').wallMs, 30 * MIN, 'tick of task 2 to tick of task 3');
  assert.equal(phase('after').wallMs, 30 * MIN, 'after the last tick to the completion');
  const plan = r.runs.find((x) => x.lane === 'plan');
  assert.equal(plan.wallMs, 25 * MIN);
});

test('TC-1: a lane that goes queue to success with no running commit starts at the previous state and says it was not claimed', async () => {
  const repo = makeRepo({ prefix: 'lc-explain-noclaim-' }); cleanup.push(repo);
  writeFile(repo, `conductor/tracks/${FOLDER}/index.md`, INDEX(777, 'Demo', { lane: 'plan', status: 'queue' })); commitAt(repo, at('09:00'), 'created');
  writeFile(repo, `conductor/tracks/${FOLDER}/index.md`, INDEX(777, 'Demo', { lane: 'plan', status: 'success' })); commitAt(repo, at('09:20'), 'planned');
  const r = await analyze(repo, tmp('lc-explain-none-'));
  assert.equal(r.runs.length, 1);
  assert.equal(r.runs[0].claimed, false);
  assert.equal(r.runs[0].wallMs, 20 * MIN);
});

test('TC-1: a lane that was never claimed is inferred from the pending lane: plan success then review queue means implement ran in between', async () => {
  const repo = makeRepo({ prefix: 'lc-explain-implicit-' }); cleanup.push(repo);
  const idx = (lane, status) => writeFile(repo, `conductor/tracks/${FOLDER}/index.md`, INDEX(777, 'Demo', { lane, status }));
  idx('plan', 'queue'); commitAt(repo, at('09:00'), 'created');
  idx('plan', 'success'); commitAt(repo, at('09:20'), 'planned');
  idx('review', 'queue'); commitAt(repo, at('09:50'), 'built, in review');
  idx('done', 'queue'); commitAt(repo, at('10:05'), 'passed the gate');
  const r = await analyze(repo, tmp('lc-explain-none-'));
  assert.deepEqual(r.runs.map((x) => [x.lane, x.claimed, x.wallMs / MIN]), [['plan', false, 20], ['implement', false, 30], ['review', false, 15]]);
});

test('TC-2: agent time, human time, token split and sub-agent share are exactly the known numbers', async () => {
  const repo = fixtureRepo();
  const r = await analyze(repo, fixtureProjects(repo));
  const impl = r.runs.find((x) => x.lane === 'implement');
  assert.equal(impl.humanMs, 40 * MIN, 'the (HUMAN) task 2 interval, 10:20 to 11:00');
  assert.equal(impl.agentMs, 80 * MIN);
  // main responses in the window and on this track: 10:10, 10:12, 10:30, 11:10, 11:45; the sub-agent of 777: 10:25, 10:26 (not agent bb, not track 999, not outside the repo)
  assert.equal(impl.responses, 7);
  assert.deepEqual(impl.tokens, { output: 20 + 5 + 30 + 40 + 50 + 70 + 80, fresh: 2 + 1 + 3 + 4 + 5 + 7 + 8, cacheCreated: 200 + 0 + 300 + 400 + 500 + 700 + 800, cacheRead: 2000 + 2100 + 3000 + 4000 + 5000 + 7000 + 8000 });
  assert.equal(impl.sub.responses, 2);
  assert.equal(impl.sub.output, 150);
  assert.equal(impl.firstContext, 2 + 200 + 2000, 'the first response of the run: fresh + created + read');
  assert.deepEqual(impl.tools, { Read: 2, Bash: 2 });
  const p1 = r.phases.find((p) => p.key === 'Phase 1');
  assert.equal(p1.humanMs, 40 * MIN);
  assert.equal(p1.agentMs, 20 * MIN);
  assert.equal(p1.tokens.output, 20 + 5 + 30 + 70 + 80, 'messages at 10:10, 10:12, 10:25, 10:26, 10:30');
  assert.equal(r.phases.find((p) => p.key === 'Phase 2').tokens.output, 40);
  assert.equal(r.phases.find((p) => p.key === 'after').tokens.output, 50);
  assert.equal(impl.repeatedReads, 1, 'one file read twice');
  const slow = impl.slowest[0];
  assert.deepEqual([slow.tool, slow.ms], ['Read', 90000]);
  assert.equal(impl.gapsOver30, 2, "10:30 to 11:10 and 11:10 to 11:45");
});

test('TC-2: a waiting status is human time, kept apart', async () => {
  const repo = fixtureRepo({ waiting: true });
  const r = await analyze(repo, fixtureProjects(repo));
  const impl = r.runs.find((x) => x.lane === 'implement');
  assert.equal(impl.wallMs, 120 * MIN);
  // waiting 10:30-10:40 lies inside the (HUMAN) interval 10:20-11:00: counted once
  assert.equal(impl.humanMs, 40 * MIN);
  const repo2 = fixtureRepo({ waiting: true });
  const r2 = await analyzeTrack({ repo: repo2, track: 777, projectsDir: tmp('lc-explain-empty-'), now: NOW });
  assert.equal(r2.runs.find((x) => x.lane === 'implement').humanMs, 40 * MIN);
});

test('TC-9: a session that spans two tracks is cut at the lane windows; what is outside every window is counted under none', async () => {
  const repo = fixtureRepo();
  const r = await analyze(repo, fixtureProjects(repo));
  assert.equal(r.runs.find((x) => x.lane === 'plan').responses, 1);
  assert.equal(r.none.responses, 1, 'the 13:00 response; the other track branch, the other sub-agent and the outside-repo one are not ours');
  assert.equal(r.none.output, 60);
  assert.equal(r.skipped.otherTrack >= 2, true, 'the track-999 branch message and the agent of track 888');
  assert.equal(r.skipped.outsideRepo, 1);
});

test('TC-11 and TC-4: the text carries the approximation note, names its sources, and a second run is identical apart from the generated line', async () => {
  const repo = fixtureRepo();
  const projects = fixtureProjects(repo);
  const run = () => spawnSync('node', [BIN, '--repo', repo, '--track', '777', '--projects-dir', projects, '--now', NOW], { encoding: 'utf8' });
  const a = run();
  assert.equal(a.status, 0, a.stderr);
  const file = path.join(repo, 'conductor/tracks', FOLDER, 'explain.md');
  const first = fs.readFileSync(file, 'utf8');
  assert.ok(first.includes(APPROX_NOTE), 'the file carries the note');
  assert.ok(a.stdout.includes(APPROX_NOTE), 'the printed table carries the note');
  for (const word of ['overlap', 'other activity', 'machines']) assert.ok(APPROX_NOTE.includes(word), `the note says: ${word}`);
  assert.match(first, /Generated: 2026-11-21T08:00:00\.000Z/);
  assert.match(first, /Sources: 1 session file, 2 sub-agent files/);
  const b = spawnSync('node', [BIN, '--repo', repo, '--track', '777', '--projects-dir', projects, '--now', '2026-11-22T08:00:00.000Z'], { encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr);
  const second = fs.readFileSync(file, 'utf8');
  const strip = (s) => s.replace(/^Generated: .*$/m, 'Generated: X');
  assert.equal(strip(second), strip(first));
  assert.notEqual(second, first, 'the generated line did change');
  assert.equal(strip(b.stdout), strip(a.stdout));
});

test('TC-3: a transcript whose content holds a token, an email and a prompt never reaches the printed table or explain.md', async () => {
  const repo = fixtureRepo();
  const projects = fixtureProjects(repo);
  const r = spawnSync('node', [BIN, '--repo', repo, '--track', '777', '--projects-dir', projects, '--now', NOW], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const file = fs.readFileSync(path.join(repo, 'conductor/tracks', FOLDER, 'explain.md'), 'utf8');
  const stats = fs.readFileSync(path.join(repo, 'conductor/statistics.md'), 'utf8');
  const markdown = renderExplain(await analyze(repo, projects), { now: NOW });
  for (const [where, text] of [['stdout', r.stdout], ['stderr', r.stderr], ['explain.md', file], ['statistics.md', stats], ['rendered', markdown]]) {
    for (const bad of [SECRET_TOKEN, 'sk-ant', SECRET_EMAIL, 'corp-secret', 'jane.private', SECRET_WORDS, 'someone', 'file body', '/somewhere/else', 'secret-']) {
      assert.ok(!text.includes(bad), `${where} must not contain ${bad}`);
    }
  }
  assert.ok(file.includes('Read'), 'tool names are allowed');
  // Phase 7 (D13): the insight is built only from numbers, times and tool names; the transcripts above carry a token, an email and a prompt.
  const insight = /^## Insight\n([\s\S]*?)^> Generated by/m.exec(file)?.[1] ?? '';
  assert.match(insight, /Time: .* wall, .* agent, .* human/, 'the insight is there and was built from the numbers');
  for (const bad of [SECRET_TOKEN, 'sk-ant', SECRET_EMAIL, 'corp-secret', 'jane.private', SECRET_WORDS, 'someone', 'file body', '/somewhere/else', 'secret-', 'echo ']) assert.ok(!insight.includes(bad), `the insight must not contain ${bad}`);
});

test('TC-2: tasks ticked in one commit share their stretch of time equally, so a (HUMAN) task among them gets its share only', () => {
  const tasks = parsePlan(PLAN);
  const run = { lane: 'implement', start: 0, end: 100 * MIN, waiting: [] };
  const { intervals, humanMs } = intervalsOfRun(run, tasks, [{ n: 1, t: 60 * MIN }, { n: 2, t: 60 * MIN }, { n: 3, t: 90 * MIN }]);
  assert.deepEqual(intervals.map((i) => [i.n, i.end - i.start]), [[1, 30 * MIN], [2, 30 * MIN], [3, 30 * MIN], [null, 10 * MIN]]);
  assert.equal(humanMs, 30 * MIN);
});

// ---- TC-14 (D10): "the first response of the run" is the first message of the main session, not a sub-agent that was still replying.
function tinyProjects(repo, { main = [], sub = [] }) {
  const projects = tmp('lc-explain-first-');
  const folder = path.join(projects, repo.replace(/[^A-Za-z0-9]/g, '-'));
  const session = '22222222-aaaa-bbbb-cccc-000000000002';
  fs.mkdirSync(path.join(folder, session, 'subagents'), { recursive: true });
  const line = (o) => response({ session, cwd: repo, blocks: [{ type: 'text', text: 'ok' }], ...o });
  fs.writeFileSync(path.join(folder, `${session}.jsonl`), jl(...main.flatMap((o) => line(o))));
  if (sub.length) {
    fs.writeFileSync(path.join(folder, session, 'subagents', 'agent-aa.jsonl'), jl(...sub.flatMap((o) => line({ branch: 'worktree-agent-aa', side: 'aa', ...o }))));
    fs.writeFileSync(path.join(folder, session, 'subagents', 'agent-aa.meta.json'), JSON.stringify({ description: 'track-runner: implement track 777' }));
  }
  return projects;
}

test('TC-14: a sub-agent message before the first main message gives the main message context; totals do not move', async () => {
  const repo = fixtureRepo();
  const projects = tinyProjects(repo, {
    sub: [{ ts: at('10:01'), usage: [7, 70, 700, 7000] }, { ts: at('10:02'), usage: [8, 80, 800, 8000] }], // still replying from the previous lane
    main: [{ ts: at('10:10'), usage: [2, 20, 200, 2000] }, { ts: at('10:30'), usage: [3, 30, 300, 3000] }],
  });
  const impl = (await analyze(repo, projects)).runs.find((x) => x.lane === 'implement');
  assert.equal(impl.firstContext, 2 + 200 + 2000, 'the first main message, not the earlier sub-agent one (7 + 700 + 7000)');
  assert.equal(impl.responses, 4);
  assert.deepEqual(impl.tokens, { output: 20 + 30 + 70 + 80, fresh: 2 + 3 + 7 + 8, cacheCreated: 200 + 300 + 700 + 800, cacheRead: 2000 + 3000 + 7000 + 8000 });
  assert.deepEqual([impl.sub.responses, impl.sub.output], [2, 150]);
  assert.deepEqual([...impl.subStarts], [7 + 700 + 7000], 'the sub-agent start figure is unchanged');
});

test('TC-14: with no main message in the window the first response falls back to the earliest sub-agent message', async () => {
  const repo = fixtureRepo();
  const projects = tinyProjects(repo, {
    sub: [{ ts: at('10:05'), usage: [7, 70, 700, 7000] }, { ts: at('10:01'), usage: [4, 40, 400, 4000] }],
    main: [{ ts: at('08:00'), usage: [9, 90, 900, 9000] }], // outside every lane window
  });
  const impl = (await analyze(repo, projects)).runs.find((x) => x.lane === 'implement');
  assert.equal(impl.firstContext, 4 + 400 + 4000);
  assert.equal(impl.responses, 2);
});
