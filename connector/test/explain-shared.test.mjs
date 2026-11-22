// Track AM-10155 Phase 10 (D26): a lane window that several tracks share is not credited to each of them. Synthetic repositories and transcripts.
//   TC-31 an unclaimed (or waiting-only) window that overlaps another track's window in the same lane is "not measured (shared window)": the run keeps
//         its time, its tokens are left out of the track's numbers, the statistics and the token rules; a single track's window, a claimed running
//         window and a window overlapping only another lane are unchanged
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo, writeFile, rm, INDEX } from './helpers/repo.mjs';
import { analyzeTrack, renderExplain, renderStatistics, parseExplain, recommend, renderInsight } from '../src/explain.mjs';

const real = fs.realpathSync(os.tmpdir());
const cleanup = [];
after(() => rm(...cleanup));
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };
const at = (hhmm) => `2026-11-20T${hhmm}:00.000Z`;
const MIN = 60000;
const NOW = '2026-11-21T08:00:00.000Z';

function commitAt(dir, iso, msg) {
  const env = { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso, GIT_TERMINAL_PROMPT: '0' };
  execFileSync('git', ['-C', dir, 'add', '-A'], { env });
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', msg], { env });
}
const folderOf = (n) => `AM-${n}-t${n}`;

/** A repository where each track has a list of [hhmm, lane, status] states (the index.md history). */
function repoWith(tracks) {
  const repo = makeRepo({ prefix: 'lc-explain-shared-' });
  cleanup.push(repo);
  const events = [];
  for (const [n, states] of Object.entries(tracks)) for (const [hhmm, lane, status] of states) events.push({ n, hhmm, lane, status });
  events.sort((a, b) => a.hhmm.localeCompare(b.hhmm));
  for (const e of events) {
    writeFile(repo, `conductor/tracks/${folderOf(e.n)}/index.md`, INDEX(Number(e.n), `Track ${e.n}`, { lane: e.lane, status: e.status }));
    writeFile(repo, `conductor/tracks/${folderOf(e.n)}/plan.md`, `# Plan ${e.n}\n`);
    commitAt(repo, at(e.hhmm), `docs(track-${e.n}): ${e.lane} ${e.status}`);
  }
  return repo;
}

let seq = 0;
const reply = (session, ts, repo, usage) => {
  seq += 1;
  return { type: 'assistant', sessionId: session, timestamp: ts, cwd: repo, gitBranch: 'main', requestId: `req_${seq}`, isSidechain: false, message: { id: `msg_${seq}`, role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: usage[0], output_tokens: usage[1], cache_creation_input_tokens: usage[2], cache_read_input_tokens: usage[3] }, stop_reason: 'end_turn' } };
};
/** One main session in the main checkout with replies at the given times, each 10 output and 1,000 cache read. */
function projectsWith(repo, times) {
  const projects = tmp('lc-explain-shared-projects-');
  const folder = path.join(projects, repo.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(folder, { recursive: true });
  const session = '33333333-aaaa-bbbb-cccc-000000000003';
  fs.writeFileSync(path.join(folder, `${session}.jsonl`), `${times.map((t) => JSON.stringify(reply(session, at(t), repo, [1, 10, 100, 1000]))).join('\n')}\n`);
  return projects;
}
const analyze = (repo, projects, n) => analyzeTrack({ repo, track: n, projectsDir: projects, now: NOW });
const planRun = (r) => r.runs.find((x) => x.lane === 'plan');

// Track 801: plan is next in line at 09:00 and implement is claimed at 11:00 (an unclaimed plan window 09:00-11:00).
// Track 802: the same plan lane from 09:30 to 11:30 (overlapping 09:30-11:00).
const T801 = [['09:00', 'plan', 'queue'], ['11:00', 'implement', 'running']];
const T802 = [['09:30', 'plan', 'queue'], ['11:30', 'implement', 'running']];
const REPLIES = ['09:10', '10:00', '10:45', '10:50'];

test('TC-31: two tracks with one overlapping unclaimed window in the same lane are both "not measured (shared window)"; the time is kept', async () => {
  const repo = repoWith({ 801: T801, 802: T802 });
  const projects = projectsWith(repo, REPLIES);
  for (const [n, wall] of [[801, 120 * MIN], [802, 120 * MIN]]) {
    const run = planRun(await analyze(repo, projects, n));
    assert.equal(run.shared, true, `${n}`);
    assert.equal(run.claimed, false);
    assert.equal(run.wallMs, wall, 'the lane run keeps its time');
    assert.equal(run.responses, 0);
    assert.deepEqual(run.tokens, { output: 0, fresh: 0, cacheCreated: 0, cacheRead: 0 }, 'no tokens are credited');
  }
});

test('TC-31: a single track\'s unclaimed window is unchanged: it keeps its replies', async () => {
  const repo = repoWith({ 801: T801 });
  const run = planRun(await analyze(repo, projectsWith(repo, REPLIES), 801));
  assert.equal(run.shared, false);
  assert.equal(run.responses, 4);
  assert.equal(run.tokens.output, 40);
});

test('TC-31: windows that do not overlap in time are unchanged', async () => {
  const repo = repoWith({ 801: T801, 802: [['12:00', 'plan', 'queue'], ['13:00', 'implement', 'running']] });
  const run = planRun(await analyze(repo, projectsWith(repo, REPLIES), 801));
  assert.equal(run.shared, false);
  assert.equal(run.responses, 4);
});

test('TC-31: another track\'s window in a different lane is not an overlap', async () => {
  const repo = repoWith({ 801: T801, 802: [['09:00', 'implement', 'running'], ['12:00', 'review', 'queue']] });
  const run = planRun(await analyze(repo, projectsWith(repo, REPLIES), 801));
  assert.equal(run.shared, false);
  assert.equal(run.responses, 4);
});

test('TC-31: a claimed running window is measured even when another track overlaps it; the unclaimed one beside it is shared', async () => {
  const claimed802 = [['09:30', 'plan', 'running'], ['11:30', 'plan', 'success'], ['11:30', 'implement', 'running']];
  const repo = repoWith({ 801: T801, 802: claimed802 });
  const projects = projectsWith(repo, REPLIES);
  const a = planRun(await analyze(repo, projects, 801));
  const b = planRun(await analyze(repo, projects, 802));
  assert.equal(b.claimed, true);
  assert.equal(b.shared, false, 'the claimed running window keeps its replies');
  assert.equal(b.responses, 3, '09:30 to 11:30 holds three replies');
  assert.equal(a.shared, true, 'the unclaimed window that overlaps it is not credited');
  assert.equal(a.responses, 0);
});

test('TC-31: a window that is only a waiting status (never running) and overlaps another track in the same lane is shared, with its human wait kept (the quality-gate case)', async () => {
  const qg = (from) => [[from, 'quality-gate', 'waiting'], ['13:00', 'done', 'success']];
  const repo = repoWith({ 801: qg('09:00'), 802: qg('09:30') });
  const projects = projectsWith(repo, REPLIES);
  const r = await analyze(repo, projects, 801);
  const run = r.runs.find((x) => x.lane === 'quality-gate');
  assert.equal(run.shared, true);
  assert.equal(run.claimed, true);
  assert.equal(run.humanMs, 240 * MIN, 'the wait is still shown');
  assert.equal(run.responses, 0);
  const alone = repoWith({ 801: qg('09:00') });
  const solo = (await analyze(alone, projectsWith(alone, REPLIES), 801)).runs.find((x) => x.lane === 'quality-gate');
  assert.equal(solo.shared, false);
  assert.equal(solo.responses, 4);
});

test('TC-31: the table says "not measured (shared window)" in the lane and the Responses cells; the totals, the statistics and the token rules leave it out', async () => {
  const repo = repoWith({ 801: T801, 802: T802 });
  const projects = projectsWith(repo, REPLIES);
  const r = await analyze(repo, projects, 801);
  const text = renderExplain(r, { now: NOW });
  const row = text.split('\n').find((l) => /^\| plan \(no claim/.test(l));
  assert.match(row, /\(shared window\)/);
  assert.match(row, /not measured \(shared window\)/);
  assert.ok(row.split('|').length > 10, 'the table keeps its columns');
  const parsed = parseExplain(text);
  assert.equal(parsed.runs[0].responses, 0);
  assert.equal(parsed.runs[0].output, 0);
  assert.equal(parsed.runs[0].cacheRead, 0);
  assert.match(text, /not measured/);
  // insight: says so, counts no replies from the shared window
  const insight = renderInsight(r).join('\n');
  assert.match(insight, /share their window|shares its window/i);
  // token rules never fire on a shared window (long context, models, effort), but the claim rule stays: claiming the lane is the fix
  const rules = recommend({ ...r, runs: r.runs.map((x) => (x.shared ? { ...x, firstContext: 900000, responses: 5, sub: { responses: 0, output: 0 } } : x)) }).items.map((i) => i.rule);
  assert.ok(!rules.includes('where'), 'no token rule on a shared window');
  assert.ok(rules.includes('claim'));
  // statistics: the tracks' rows add 0 tokens for it
  const stats = renderStatistics([{ folder: folderOf(801), text }], { now: NOW });
  const total = stats.split('\n').find((l) => /^\| AM-801 \|/.test(l));
  assert.match(total, /\| 0 \| 0 \| 0 \| 0 \| 0 \| 0 \|/);
});

test('TC-31: the short plan shows the shared step with no token numbers and never marks it expensive', async () => {
  const repo = repoWith({ 801: [...T801, ['12:00', 'review', 'queue']], 802: T802 });
  const projects = projectsWith(repo, REPLIES);
  const text = renderExplain(await analyze(repo, projects, 801), { now: NOW });
  const plan = /^## Short plan\n([\s\S]*?)(?=^## )/m.exec(text)[1];
  const rows = plan.split('\n').filter((l) => l.startsWith('|') && !/^\|[\s|-]+$/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  const shared = rows.find((x) => x[0].startsWith('plan'));
  assert.equal(shared[3], 'not measured');
  assert.equal(shared[5], '');
});

test('TC-31: an unclaimed window beside another track\'s waiting-only window (a human wait) keeps its replies; the waiting-only one is the shared one, so the replies are credited once', async () => {
  const repo = repoWith({ 801: T801, 802: [['08:00', 'plan', 'waiting'], ['12:00', 'implement', 'running']] });
  const projects = projectsWith(repo, REPLIES);
  const a = planRun(await analyze(repo, projects, 801));
  const b = planRun(await analyze(repo, projects, 802));
  assert.equal(a.shared, false, 'inferred agent time is not displaced by a human wait');
  assert.equal(a.responses, 4);
  assert.equal(b.shared, true, 'a human wait has no agent work of its own');
  assert.equal(b.responses, 0);
  assert.equal(b.humanMs, 240 * MIN);
});
