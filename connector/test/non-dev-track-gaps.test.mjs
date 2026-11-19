// Track AM-10144 Phase 14 (release 1.9.8): three gaps found by running the whole owner-step cycle of a marketing track through the real client.
//   14.1 supervised implement ends in `Lane Status: waiting` (not `running`), so `next` shows S22 "do the owner action";
//   14.2 a non-dev track is worked in this session: no sub-agent or worktree recommendation, no "dispatch or do it here" question;
//   14.3 a non-dev track that passes the quality gate closes as `done:success` (nothing to merge), code tracks stay `done:queue` then merge.
// The base plugin is Markdown, so the behaviour is in the words it ships; these tests pin the words. HUMAN, not covered here: what a real model does
// (the headless cycle on a scratch marketing track is recorded in the track's conversation).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from '../../scripts/build-plugin.mjs';
import { COMMANDS } from '../src/commands.mjs';
import { buildFixture } from './helpers/next-fixtures.mjs';
import { classifyFacts, gatherFacts } from '../src/next.mjs';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, rm } from './helpers/repo.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const guide = (n) => read(`.claude/skills/laneconductor/lanes/${n}.md`);
const command = (n) => read(`plugins/laneconductor/commands/${n}.md`);
const flat = (t) => t.replace(/\s+/g, ' ');
const body = (t) => t.slice(0, t.indexOf('## Reference'));
const count = (t, re) => (t.match(re) ?? []).length;
const step4 = (t) => flat(t.slice(t.indexOf('4. **Non-dev tracks'), t.indexOf('4b. **Fundamentals conflict')));

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
  for (const d of built) fs.rmSync(d, { recursive: true, force: true });
});
const built = [];

// ---- 14.1: supervised implement ends waiting ----

test('14.1: supervised implement sets Lane Status waiting with Waiting for reply, after Owner Action and its due date; the Owner Action is the reason, the lane stays implement', () => {
  const s = step4(guide('implement'));
  const action = s.indexOf('`**Owner Action**`');
  const due = s.indexOf('`**Owner Action Due**`');
  const wait = s.indexOf('set `**Waiting for reply**: yes` and `**Lane Status**: waiting`');
  assert.ok(action > 0 && due > action && wait > due, 'Owner Action, its due date, then Waiting for reply and Lane Status waiting');
  assert.match(s, /the Owner Action is the reason: no Waiting Reason; `\*\*Lane\*\*` stays `implement`/);
  assert.match(s, /with the connector one `update_track` writes all four/);
  assert.match(s, /Stop\. Do not move the lane yourself\./);
  assert.doesNotMatch(s, /Lane Status\*\*: running/, 'the step never leaves the claim in place');
});

test('14.1: the owner\'s reply still clears all three markers and parks the track in the quality gate, so the whole cycle is implement:waiting, then quality-gate:waiting', () => {
  const s = step4(guide('implement'));
  assert.match(s, /Clear `Owner Action`, `Owner Action Due` and `Waiting for reply`/);
  assert.match(s, /park the track in the quality-gate lane as `waiting`, with a `\*\*Waiting Reason\*\*` naming that date/);
});

test('14.1: implement, run and comment carry the waiting step once; the reply text stays in exactly the same three commands', () => {
  for (const n of ['implement', 'run']) assert.equal(count(command(n), /`\*\*Lane Status\*\*: waiting`\n?\s*\(the Owner Action is the reason/g), 1, `${n}: once`);
  assert.equal(count(command('comment'), /`\*\*Lane Status\*\*: waiting`/g), 0, 'comment carries the reply paragraph only');
});

test('14.1: the shape supervised implement writes is S22 "do the owner action" for next, and a track left running is not', async () => {
  const waiting = { 'Waiting for reply': 'yes', 'Owner Action': 'Post the launch post', 'Owner Action Due': '2026-11-21' };
  const classify = async (status, extra) => {
    const dir = buildFixture({ tracks: [{ n: 1, lane: 'implement', status, extra: { Type: 'marketing', ...extra } }] });
    built.push(dir);
    const facts = await gatherFacts(dir, { now: Date.parse('2026-11-19T12:00:00Z') });
    return classifyFacts(facts, {});
  };
  const done = await classify('waiting', waiting);
  assert.equal(done.state, 'S22');
  assert.equal(done.command, '/laneconductor:comment 1 <what you did>');
  const running = await classify('running', waiting);
  assert.notEqual(running.state, 'S22', 'the gap this fixes: Owner Action with Lane Status running is not the owner-action state');
});

test('14.1: with the connector, one update_track that writes Owner Action and Lane Status waiting gets no Waiting Reason warning', async () => {
  const index = '# Track AM-1: Post\n\n**Lane**: implement\n**Lane Status**: running\n**Type**: marketing\n\n## Problem\n\nx\n';
  const dir = makeRepo({ files: { 'conductor/tracks/AM-1-post/index.md': index }, workflow: false });
  cleanup.push(dir);
  const s = await connect(dir);
  sessions.push(s);
  const base = (await s.call('get_track', { track: 1 })).env.data.base;
  const r = await s.call('update_track', { track: 1, base, markers: { 'Owner Action': 'Post it', 'Owner Action Due': '2026-11-21', 'Lane Status': 'waiting', 'Waiting for reply': 'yes' } });
  assert.equal(r.isError, false, r.text);
  assert.ok(!r.env.warnings.some((w) => /Waiting Reason/.test(w)), JSON.stringify(r.env.warnings));
  const l = await s.call('list_tracks', {});
  assert.ok(!l.env.warnings.some((w) => /Waiting Reason/.test(w)), 'the lint agrees');
});

test('14.1: the bundled connector guide says the same in one line', () => {
  const g = flat(read('connector/guides/implement.md'));
  assert.match(g, /A non-dev track .* is supervised: no code, no worktree, no sub-agent\. .* `Owner Action`, `Owner Action Due`, `Lane Status: waiting` and `Waiting for reply: yes` \(the Owner Action is the reason; no Waiting Reason\)/);
});

// ---- 14.2: the sub-agent and worktree recommendation is for code tracks ----

const NON_DEV = /If `\*\*Type\*\*` is not `dev` \(marketing, sales, support, other\) the track has no code: recommend no sub-agent and no worktree, ask no question about one, and do the lane in this session/;

test('14.2: implement, review and run say first that a non-dev track gets no sub-agent, no worktree and no question, then recommend for code tracks only', () => {
  for (const n of ['implement', 'review', 'run']) {
    const b = flat(body(command(n)));
    const gate = b.search(NON_DEV);
    const recommend = b.indexOf('RECOMMEND, do not start');
    assert.ok(gate > 0 && recommend > gate, `${n}: the non-dev clause comes before the recommendation`);
    assert.match(b.slice(gate, recommend), /A code track: if the sub-agent `laneconductor-parallel:track-runner` is listed/, `${n}: the recommendation is for a code track`);
    assert.equal(count(b, /RECOMMEND, do not start/g), 1, `${n}: one recommendation`);
  }
});

test('14.2: the code-track recommendation itself is unchanged: the dispatch prompt, start nothing until yes, do the lane yourself on a no', () => {
  const b = flat(body(command('implement')));
  assert.match(b, /Show the exact dispatch, with this prompt: "Work track N through its implement lane: read the lane guide, follow plan\.md, commit in your worktree, report commits and test results; do not merge or push\." Start nothing until I say yes; if I decline, do the lane yourself\./);
  assert.match(b, /If it is not listed: do the lane in this session following the guide\./);
  assert.match(flat(body(command('review'))), /Show the exact dispatch, with this prompt: "Review track N in the review lane: read the lane guide, evaluate the work, do not fix it, report a verdict with evidence; do not merge or push\."/);
});

test('14.2: the connector catalog (MCP prompts) gates the same way for implement, review and run, and skips the dispatch steps for a non-dev track', () => {
  for (const n of ['implement', 'review', 'run']) {
    const p = COMMANDS.find((c) => c.name === n).procedure;
    assert.match(p, NON_DEV, n);
    assert.match(p, /\(skip steps 3 and 4\)\. A code track: RECOMMEND, do not start/, n);
    assert.ok(p.search(NON_DEV) < p.indexOf('RECOMMEND, do not start'), n);
  }
});

test('14.2: the descriptions say the recommendation is for code tracks', () => {
  for (const n of ['implement', 'review', 'run']) {
    const d = COMMANDS.find((c) => c.name === n).description;
    assert.match(d, /\(code tracks: one sub-agent /, d);
    assert.doesNotMatch(d, /recommends/, d);
    assert.ok(command(n).startsWith(`---\ndescription: "${d}"\n`), `${n}: the generated frontmatter carries it`);
  }
});

test('14.2: the working-a-track guide limits the sub-agent section to code tracks, and the lane guide needs no worktree for a non-dev track', () => {
  const w = flat(read('.claude/skills/laneconductor/ops/working-a-track.md'));
  assert.match(w, /## Plugin users: one subagent per track in a worktree \(code tracks\) Only for a code track \(`\*\*Type\*\*` `dev`\)\. A non-dev track \(marketing, sales, support, other\) writes no code: no sub-agent, no worktree, no question about one; work its lane in this session\./);
  assert.match(flat(guide('implement')), /2\. \*\*Workspace \(dev tracks; a non-dev track needs no worktree\)\./);
  for (const n of ['implement', 'review', 'run']) assert.match(flat(command(n)), /Only for a code track \(`\*\*Type\*\*` `dev`\)/, `${n} carries the guide section`);
});

test('14.2: next recommends the sub-agent for a code track only, and a non-dev track is implemented in this session', () => {
  const t = flat(read('.claude/skills/laneconductor/ops/next.md'));
  assert.match(t, /A code track with the parallel add-on: recommend one sub-agent in its own worktree \|/);
  assert.match(t, /A code track with the parallel add-on: recommend one sub-agent in its own worktree; otherwise, and for a non-dev track, in this session \|/);
});

// ---- 14.3: a non-dev track that passes the gate closes done:success ----

test('14.3: the quality gate closes a passing non-dev track as done:success (nothing to merge) and keeps done:queue for code tracks', () => {
  const g = flat(guide('quality-gate'));
  assert.match(g, /Passing here queues a code track for merge \(`done:queue`\); it is not shipped until the merge action sets `done:success` once the code is on `main`\. A non-dev track has no branch, so a pass closes it as `done:success`: nothing to merge\./);
  assert.match(g, /\*\*PASS:\*\* a code track takes the success move \(this project: `done:queue`, passed and not yet shipped\)\. A non-dev track \(`\*\*Type\*\*` not `dev`\) sets `\*\*Lane\*\*: done` and `\*\*Lane Status\*\*: success` instead \(with the connector, as markers, not `outcome`\) and says in one clause that there is nothing to merge\./);
  assert.match(g, /write `\*\*Verdict\*\*: pass`/);
  assert.match(g, /A non-dev track closed at `done:success` names `\/laneconductor:next`, not merge\./);
  // the Result and KPI Actual the lint wants are written by step 1, before the transition
  assert.ok(g.indexOf('write `**Result**` to `index.md`') < g.indexOf('**PASS:** a code track'));
  assert.equal(count(command('quality-gate'), /A non-dev track \(`\*\*Type\*\*` not `dev`\) sets `\*\*Lane\*\*: done`/g), 1);
  assert.equal(count(command('run'), /A non-dev track \(`\*\*Type\*\*` not `dev`\) sets `\*\*Lane\*\*: done`/g), 1);
  assert.equal(count(command('merge'), /sets `\*\*Lane\*\*: done`/g), 0);
});

test('14.3: the merge guide says a non-dev track has nothing to merge (an older done:queue is recorded done:success), and `next` says the same in S11', () => {
  assert.match(flat(guide('merge')), /A non-dev track \(`\*\*Type\*\*` not `dev`\) has no branch and nothing to merge: if one sits at `done:queue`, set `done:success`, say so and stop\./);
  assert.match(flat(command('merge')), /has no branch and nothing to merge: if one sits at `done:queue`, set `done:success`/);
  assert.match(flat(read('.claude/skills/laneconductor/ops/next.md')), /a non-dev track has no branch, there it records `done:success` \|/);
});

test('14.3: the bundled connector guide says a non-dev pass closes done:success with markers', () => {
  assert.match(flat(read('connector/guides/quality-gate.md')), /A non-dev track \(`Type` not `dev`\) has no branch and nothing to merge: set `Lane` done, `Lane Status` success and `Verdict` pass with markers \(not `outcome`\), and write its `Result`\./);
});

test('14.3: a non-dev track at done:success with a Result is finished for next and is not flagged outcome_missing; without Result or KPI Actual it is, as before', async () => {
  const spec = '# Spec\n\n## KPI\n\n**Target**: 50\n**Metric**: sign-ups\n**Source**: manual\n';
  const mk = (extra) => `# Track AM-1: Launch post\n\n**Lane**: done\n**Lane Status**: success\n**Type**: marketing\n${extra}\n## Problem\n\nx\n`;
  const dir = makeRepo({ files: {
    'conductor/tracks/AM-1-launch-post/index.md': mk('**KPI Actual**: 12\n**Verdict**: pass\n**Result**: 12 sign-ups from the post, under target\n'),
    'conductor/tracks/AM-1-launch-post/spec.md': spec,
    'conductor/tracks/AM-2-other-post/index.md': mk('**Verdict**: pass\n').replace('AM-1', 'AM-2'),
    'conductor/tracks/AM-2-other-post/spec.md': spec,
  }, workflow: false });
  cleanup.push(dir);
  const s = await connect(dir);
  sessions.push(s);
  const l = await s.call('list_tracks', { include_done: true });
  const flagged = l.env.warnings.filter((w) => w.startsWith('outcome_missing'));
  assert.equal(flagged.length, 1, JSON.stringify(l.env.warnings));
  assert.ok(flagged[0].includes('AM-2') && !flagged[0].includes('AM-1'), flagged[0]);
  // next: a track at done:success is never a candidate
  const nd = buildFixture({ tracks: [{ n: 1, lane: 'done', status: 'success', extra: { Type: 'marketing', 'KPI Actual': '12', Result: 'x' } }] });
  built.push(nd);
  const r = classifyFacts(await gatherFacts(nd, { now: Date.parse('2026-11-19T12:00:00Z') }), {});
  assert.ok(!['S11', 'S12', 'S22', 'S23'].includes(r.state), r.state);
  assert.ok(!(r.ranked ?? []).some((x) => x.track === 1), 'not a candidate');
});

// ---- the size budget: no generated command grows against 1.9.7 ----

test('no generated command is larger than in 1.9.7; run stays under 68 KB', () => {
  const BEFORE = { plan: 27314, implement: 27558, review: 21015, 'quality-gate': 21349, merge: 17609, run: 66561, next: 32551, setup: 25927, 'new-project': 31220, comment: 6319, move: 6355 };
  for (const [n, before] of Object.entries(BEFORE)) {
    const size = Buffer.byteLength(command(n));
    assert.ok(size <= before, `${n}: ${size} bytes, ${size - before} more than 1.9.7 (${before})`);
  }
  assert.ok(Buffer.byteLength(command('run')) < 68 * 1000);
});
