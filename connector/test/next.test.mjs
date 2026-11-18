// Track AM-10144: `next`, the state-aware front door. The behaviour is Markdown an agent follows (ops/next.md), so these tests pin its contract:
// the state table (ids and commands) against a reference classifier run over fixture projects, the ranking rule, the catalog entry, the
// generated texts and the text rules of the base. The classifier is the oracle; no shipped code uses it.
// HUMAN, not covered here: an agent following ops/next.md in a real session (the walk-through of test.md, TC-31 to TC-42).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, RELS, NAMES, buildPlugin, diffAgainstDisk, setupRecommendBlock, RECOMMEND_MARKER, ADDONS, NEXT_JOURNEY } from '../../scripts/build-plugin.mjs';
import { COMMANDS, GROUPS, helpText, helpLines, fillProcedure } from '../src/commands.mjs';
import { buildInstructions } from '../src/instructions.mjs';
import { buildFixture, FIXTURES, RANKING } from './helpers/next-fixtures.mjs';
import { classify, resolveLevel, SHAPES, STATE_IDS } from './helpers/next-reference.mjs';
import { noLcHits } from './helpers/no-lc.mjs';

const built = [];
after(() => { for (const d of built) fs.rmSync(d, { recursive: true, force: true }); });
const fixture = (desc) => { const d = buildFixture(desc); built.push(d); return d; };

const SRC = path.join(REPO, '.claude/skills/laneconductor');
const BASE = path.join(REPO, RELS.base);
const read = (p) => fs.readFileSync(p, 'utf8');
const NEXT_MD = read(path.join(SRC, 'ops/next.md'));
const next = COMMANDS.find((c) => c.name === 'next');

// ---- Phase 6: the state table, through the reference classifier over fixture projects ----

test('TC-24: every fixture gives the expected state, track and command', () => {
  for (const [id, f] of Object.entries(FIXTURES)) {
    const dir = fixture(f.desc);
    const got = classify(dir, { installed: f.installed ?? [] });
    const e = f.expect;
    assert.equal(got.state, e.state, `${id}: state`);
    if (e.track !== undefined) assert.equal(got.track, e.track, `${id}: track`);
    assert.equal(got.command, e.command, `${id}: command`);
    if (e.default) assert.equal(got.default, e.default, `${id}: default path`);
    if (e.level) assert.equal(got.level, e.level, `${id}: level`);
    if (e.offers) assert.deepEqual(got.offers, e.offers, `${id}: add-on offers`);
    if (e.skipped) assert.deepEqual(got.skipped, e.skipped, `${id}: skipped`);
    if (e.blocked) assert.deepEqual(got.blocked, e.blocked, `${id}: blocked`);
    if (e.damaged) assert.deepEqual([...new Set(got.damaged)], e.damaged, `${id}: damaged`);
  }
});

test('TC-24: every state S01 to S21 is produced by at least one fixture, so a state cannot be added to the table without a test', () => {
  const produced = new Set([...Object.values(FIXTURES).map((f) => f.expect.state), 'S08', 'S10']); // S08 and S10 appear as skipped and blocked
  assert.deepEqual(STATE_IDS.filter((s) => !produced.has(s)), [], 'a state with no fixture');
});

test('TC-25: the ranking of REQ-19, one removal at a time (human reply, failure, priority, latest lane, lower number)', () => {
  const order = (without, noPriority) => classify(fixture({ ...RANKING(without, noPriority) })).ranked.map((r) => r.track);
  assert.deepEqual(order([], false), [10007, 10006, 10005, 10004, 10003, 10002, 10001]);
  assert.equal(order([10007], false)[0], 10006);
  assert.equal(order([10007, 10006], false)[0], 10005);
  assert.equal(order([10007, 10006], true)[0], 10004);
  assert.equal(order([10007, 10006, 10004], true)[0], 10003);
  const dir = fixture(RANKING());
  assert.deepEqual(classify(dir).blocked, [10008], 'the track that waits on an unshipped one is blocked, not ranked');
  // Two tracks in the same state and lane: the lower number first.
  const tie = fixture({ tracks: [{ n: 10009, lane: 'plan', status: 'queue' }, { n: 10003, lane: 'plan', status: 'queue' }] });
  assert.deepEqual(classify(tie).ranked.map((r) => r.track), [10003, 10009]);
});

test('TC-26: a done:queue track is gated, not shipped: a dependent stays blocked until done:success', () => {
  const blocked = classify(fixture(FIXTURES.F10.desc));
  assert.deepEqual(blocked.blocked, [10002]);
  assert.equal(classify(fixture(FIXTURES.F09.desc)).state, 'S09');
});

test('TC-17, TC-18, TC-19: levels. auto is explain for a young project and short for a mature one; a bad or missing file means auto; arguments win', () => {
  const young = fixture(FIXTURES.F18.desc);
  assert.equal(classify(young).level, 'explain');
  assert.equal(classify(young, { arg: 'short' }).level, 'short');
  const mature = fixture(FIXTURES.F25.desc);
  assert.equal(classify(mature).level, 'short');
  assert.equal(classify(mature, { arg: 'explain' }).level, 'explain');
  assert.equal(classify(fixture(FIXTURES.F24.desc), { arg: 'explain' }).level, 'explain', 'next explain beats the saved setting');
  for (const bad of ['', '{', '{"next":{"level":"loud"}}', '{"next":"short"}', '[]', '{"other":1}']) {
    const dir = fixture({ ...FIXTURES.F18.desc, settings: bad });
    assert.equal(classify(dir).level, 'explain', `settings ${JSON.stringify(bad)} means auto (young project: explain)`);
  }
  assert.equal(resolveLevel(young, { state: 'S04', tracks: [] }), 'explain');
});

test('TC-21: running next in every fixture changes no tracked or untracked file', () => {
  for (const [id, f] of Object.entries(FIXTURES)) {
    const dir = fixture(f.desc);
    if (f.desc.git === false) continue;
    const status = () => execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' });
    const before = status();
    const files = fs.readdirSync(dir).sort().join();
    classify(dir, { installed: f.installed ?? [] });
    assert.equal(status(), before, `${id}: git status changed`);
    assert.equal(fs.readdirSync(dir).sort().join(), files, `${id}: files changed`);
  }
});

// ---- Phase 1 and 6: ops/next.md against the oracle ----

const tableRows = () => Object.fromEntries([...NEXT_MD.matchAll(/^\| (S\d\d) \| (.*) \|$/gm)].map((m) => [m[1], m[2]]));

test('TC-1: ops/next.md has a table whose ids are exactly S01 to S21, once each', () => {
  const ids = [...NEXT_MD.matchAll(/^\| (S\d\d) \|/gm)].map((m) => m[1]);
  assert.deepEqual(ids, STATE_IDS);
  assert.equal(STATE_IDS.length, 21);
});

test('TC-1/TC-24 parity: the command cell of every row holds the command shapes the reference uses, and the fixtures use only those shapes', () => {
  const rows = tableRows();
  for (const id of STATE_IDS) {
    const cells = rows[id].split(' | ');
    const command = cells[cells.length - 1];
    if (!SHAPES[id].length) assert.match(command, /^none/, `${id}: no command`);
    for (const shape of SHAPES[id]) assert.ok(command.includes(`\`${shape}\``), `${id}: the command cell names ${shape}`);
  }
  const shapesOf = (c, n) => { const a = c.replace(` ${n}`, ' N'); return [a, a.replace(/ [a-z-]+:queue$/, ' <lane>:queue')]; };
  for (const [id, f] of Object.entries(FIXTURES)) {
    const e = f.expect;
    if (!e.command || e.track === undefined) continue;
    const shapes = shapesOf(e.command, e.track);
    assert.ok(shapes.some((x) => SHAPES[e.state].includes(x)), `${id}: ${e.command} is not a shape of ${e.state} (${shapes})`);
  }
});

test('TC-2: the ranking section has six steps in the order of the rule', () => {
  const section = NEXT_MD.slice(NEXT_MD.indexOf('\n## Rank'), NEXT_MD.indexOf('\n## The card'));
  const steps = [...section.matchAll(/^\d\. \*\*([^*]+)\*\*/gm)].map((m) => m[1].replace(/\.$/, ''));
  assert.deepEqual(steps, ['Human reply', 'Failed or stuck', 'Ready to resume', 'Priority', 'Lane order, latest lane first', 'Number']);
  assert.match(section, /`done:queue` \(merge\), then quality-gate, review, implement, plan/);
});

test('TC-3, TC-4: SKILL.md has the next row and the Priority marker; settings.md has the next.level row', () => {
  const skill = read(path.join(SRC, 'SKILL.md'));
  assert.match(skill, /^\| `next` \| \[ops\/next\.md\]/m);
  assert.match(skill, /^\| `\*\*Priority\*\*: high\\\|normal\\\|low` \|/m);
  const settings = read(path.join(SRC, 'ops/settings.md'));
  assert.match(settings, /^\| `next\.level` \| `auto`, `explain`, `short` \| `auto` \|/m);
  assert.match(settings, /unknown `next\.level` means `auto`/);
});

test('TC-5: setup and new-project end by pointing at next, and still carry the generated recommendation marker and the starter-set hook', () => {
  for (const f of ['setup/setup.md', 'ops/new-project.md']) {
    const t = read(path.join(SRC, f));
    assert.match(t, /Next: run `\/laneconductor:next`/, f);
    assert.ok(t.includes(RECOMMEND_MARKER), f);
    assert.match(t, /Starter set: reserved for the skill advisor/, f);
  }
});

// ---- Phase 2 and 3: the catalog and the generated texts ----

test('TC-6, TC-7: next is in the catalog once, in the first group with help, optional argument, example phrase; help lists it first', () => {
  assert.equal(COMMANDS.filter((c) => c.name === 'next').length, 1);
  assert.equal(GROUPS[0], 'start here');
  assert.equal(next.group, 'start here');
  assert.equal(COMMANDS.find((c) => c.name === 'help').group, 'start here');
  assert.deepEqual(next.args.map((a) => [a.name, a.required, a.hint]), [['option', false, 'explain | short | track number']]);
  assert.equal(next.example, "what's next");
  assert.equal(next.readOnly, true);
  const lines = helpText().split('\n');
  const at = lines.findIndex((l) => l.startsWith('- next '));
  assert.ok(at > 0 && at < lines.findIndex((l) => l === 'Plan and deliver'), 'next is listed before the plan and deliver group');
  assert.match(lines[at], /Example: "what's next"/);
  const cmd = read(path.join(BASE, 'commands/help.md'));
  assert.ok(cmd.includes(lines[at]), 'the generated help command lists the same line');
});

test('TC-13: help opens with the not-sure line, in the help text, the base command and the plain list', () => {
  const line = 'Not sure where to go? Use `next`: it reads this project and names the one step.';
  assert.ok(helpText().includes(line));
  assert.ok(read(path.join(BASE, 'commands/help.md')).includes(line));
  assert.equal(helpLines()[1], line);
});

test('TC-8, TC-29: the generated next command is read only: it carries the argument hint, names ops/next.md and no write tool', () => {
  const t = read(path.join(BASE, 'commands/next.md'));
  assert.match(t, /^argument-hint: "\[explain \| short \| track number\]"$/m);
  assert.match(t, /ops\/next\.md/);
  for (const w of ['update_track', 'create_track', 'append_conversation']) assert.ok(!t.includes(w), `names ${w}`);
  const tools = [...t.matchAll(/mcp__plugin_laneconductor-parallel_lc__(\w+)/g)].map((m) => m[1]);
  assert.ok(tools.length > 0 && tools.every((x) => ['list_tracks', 'get_track', 'get_context'].includes(x)), `tools: ${tools}`);
  assert.match(t, /use them to read: they report how fresh the state is\. This command writes nothing\./);
  assert.doesNotMatch(next.procedure, /update_track|create_track|append_conversation/);
});

test('TC-9, TC-10: the parallel add-on offers next as a prompt, and the plugin map lists it for the base and the add-on; the build is current', () => {
  const map = read(path.join(REPO, 'docs/plugin-map.md'));
  assert.match(map, /`next`, `help`, `plan`/, 'MCP prompts');
  assert.match(map, /\(`board`, `brainstorm`, `bug`, `comment`, `deploy`, `feature`, `help`, `implement`, `merge`, `move`, `new`, `new-project`, `next`/);
  assert.deepEqual(diffAgainstDisk(REPO), []);
});

test('TC-11, TC-12: the recommendation block in ops/next.md is the setup block, from the one catalog, with four install commands each in its own bash block', () => {
  const block = setupRecommendBlock();
  for (const profile of ['base']) {
    const files = buildPlugin(REPO, profile);
    const text = String(files.get('skills/laneconductor/ops/next.md').content);
    assert.ok(text.includes(block), 'next.md carries the setup block verbatim');
    assert.ok(String(files.get('skills/laneconductor/setup/setup.md').content).includes(block));
    assert.ok(!text.includes(RECOMMEND_MARKER), 'the marker is replaced');
  }
  assert.ok(NEXT_MD.includes(RECOMMEND_MARKER), 'the source holds the marker, not the text');
  for (const e of ADDONS) assert.ok(!NEXT_MD.includes(e.name), `the source ops/next.md names no add-on by hand (${e.name})`);
  const fences = [...block.matchAll(/```bash\n([^\n]+)\n```/g)].map((m) => m[1]);
  assert.equal(fences.length, 4);
  assert.ok(ADDONS.every((e) => fences.some((f) => f.includes(`install ${e.name}@`))));
});

test('TC-14, TC-15: the habits carry the two edits; the server instructions point to next and stay under the limit', () => {
  const skill = read(path.join(BASE, 'skills/laneconductor/SKILL.md'));
  assert.match(skill, /say `next` for the one step/);
  assert.match(skill, /give the one-line card `next` would give for this track/);
  assert.match(buildInstructions(['help']), /Run the `next` prompt/);
});

test('TC-16: the new, bug and feature procedures and create_track are untouched by this feature', () => {
  for (const n of ['new', 'bug', 'feature']) assert.match(COMMANDS.find((c) => c.name === n).procedure, /^(Create a track|File a (bug|feature) track) for:/);
  assert.ok(!fs.readFileSync(path.join(REPO, 'connector/src/tools/create-track.mjs'), 'utf8').includes('ops/next.md'));
});

test('TC-3.4: status ends by pointing at next, in the catalog and in the base command', () => {
  assert.match(COMMANDS.find((c) => c.name === 'status').procedure, /`next` names the one step/);
  assert.match(read(path.join(BASE, 'commands/status.md')), /`next` names the one step/);
});

test('TC-22, TC-23: the journey block is generated into the base README, once, and says nothing about unshipped work (a hand edit fails the drift check of plugin-build.test.mjs)', () => {
  const readme = read(path.join(BASE, 'README.md'));
  assert.equal(readme.split(NEXT_JOURNEY).length - 1, 1);
  assert.match(NEXT_JOURNEY, /\/laneconductor:next/);
  for (const e of ADDONS) assert.ok(NEXT_JOURNEY.includes(e.name));
  assert.deepEqual(textRuleHits(NEXT_JOURNEY), []);
});

// ---- the text rules of REQ-32 ----

const FUTURE = /coming soon|will be added|in a future|later version|roadmap|planned|backlog item/i;
const BAD_BASE = /make install|laneconductorrc|\bworkers?\b|collection|daemon/i;
function textRuleHits(text, { allowBacklog = false } = {}) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    const l = allowBacklog ? line.replace(/`?backlog`?|S19/g, '') : line;
    if (BAD_BASE.test(l)) hits.push(`${i + 1}: forbidden word: ${line.trim().slice(0, 80)}`);
    if (/\blegacy\b/i.test(l)) hits.push(`${i + 1}: legacy: ${line.trim().slice(0, 80)}`);
    if (/\b10\d\d\d\b/.test(l)) hits.push(`${i + 1}: track number: ${line.trim().slice(0, 80)}`);
    if (FUTURE.test(l)) hits.push(`${i + 1}: unshipped work: ${line.trim().slice(0, 80)}`);
  });
  return [...hits, ...noLcHits(text).map((h) => `lc: ${h}`)];
}

test('TC-27, TC-30: ops/next.md, the next command, the help line and the journey block pass the text rules', () => {
  assert.deepEqual(textRuleHits(NEXT_MD, { allowBacklog: true }), []);
  assert.deepEqual(textRuleHits(read(path.join(BASE, 'commands/next.md'))), []);
  assert.deepEqual(textRuleHits(read(path.join(BASE, 'skills/laneconductor/ops/next.md')), { allowBacklog: true }), []);
  assert.deepEqual(textRuleHits(helpLines().slice(0, 2).join('\n')), []);
  assert.deepEqual(textRuleHits(fillProcedure(next, {})), []);
});

test('TC-28: the base stays Markdown, JSON and one image: this feature adds only Markdown files', () => {
  const files = [...buildPlugin(REPO, 'base').keys()];
  const odd = files.filter((f) => f !== 'LICENSE' && !/\.(md|json|png)$/.test(f));
  assert.deepEqual(odd, []);
  assert.ok(files.includes('commands/next.md') && files.includes('skills/laneconductor/ops/next.md'));
});

test('the NAMES used by the journey are the base plugin name', () => {
  assert.match(NEXT_JOURNEY, new RegExp(`/${NAMES.base}:next`));
});
