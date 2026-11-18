// Track AM-10147 (owner steps), Phase 5: the lane guides. The base plugin is Markdown, so the behaviour is in the words it ships. TC-15 to TC-18 of test.md.
// The guides are the source (.claude/skills/laneconductor); the commands are generated from them (the build check keeps the two in step).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from '../../scripts/build-plugin.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const guide = (n) => read(`.claude/skills/laneconductor/lanes/${n}.md`);
const command = (n) => read(`plugins/laneconductor/commands/${n}.md`);
const SKILL = read('.claude/skills/laneconductor/SKILL.md');
const flat = (t) => t.replace(/\s+/g, ' ');
const count = (t, re) => (t.match(re) ?? []).length;
const headings = (t) => {
  let fenced = false;
  return t.split('\n').filter((l) => { if (/^\s*```/.test(l)) { fenced = !fenced; return false; } return !fenced && /^#+ /.test(l); });
};

/** The supervised-implement step: from its number to the next numbered step. */
const step4 = (t) => t.slice(t.indexOf('4. **Non-dev tracks'), t.indexOf('4b. **Fundamentals conflict'));

test('TC-15: supervised implement writes Owner Action and Owner Action Due before Waiting for reply, and says nothing is done for the owner', () => {
  const s = flat(step4(guide('implement')));
  assert.ok(s.length > 500, 'found the step');
  const action = s.indexOf('`**Owner Action**`');
  const due = s.indexOf('`**Owner Action Due**`');
  const wait = s.indexOf('set `**Waiting for reply**: yes`');
  assert.ok(action > 0 && due > action && wait > due, 'Owner Action, then its due date, then Waiting for reply');
  assert.match(s, /one line, up to 200 characters/);
  assert.match(s, /YYYY-MM-DD/);
  assert.match(s, /ask the owner for one, never invent it/);
  assert.match(s, /Nothing is posted, sent or spent for the owner/);
});

test('TC-15: the owner\'s reply is handled without a daemon: clear both markers and the reply flag, set KPI Check After, park in the quality gate with a Waiting Reason', () => {
  const s = flat(step4(guide('implement')));
  assert.match(s, /\*\*The owner's reply\*\* \("posted", "done", or a move\): nothing moves the track by itself, so you do it/);
  assert.match(s, /Clear `Owner Action`, `Owner Action Due` and `Waiting for reply`/);
  assert.match(s, /set `\*\*KPI Check After\*\*` to now plus the KPI `Window`/);
  assert.match(s, /park the track in the quality-gate lane as `waiting`, with a `\*\*Waiting Reason\*\*` naming that date/);
  assert.match(s, /With the connector, one `update_track`/);
  assert.match(s, /conductor\/workflow\.json/);
  assert.doesNotMatch(s, /reply moves the track on to the quality/, 'the old "the reply moves the track" wording is gone');
  // The date it writes is one the date module reads: a UTC timestamp.
  assert.match(s, /`YYYY-MM-DDTHH:MM:SSZ`/);
});

test('TC-15: the reply text is written once in the base source; only implement, run and comment carry it', () => {
  assert.equal(count(guide('implement'), /nothing moves the track by itself/g), 1);
  const names = fs.readdirSync(path.join(REPO, 'plugins/laneconductor/commands')).map((f) => f.replace(/\.md$/, ''));
  const carry = names.filter((n) => /nothing moves the track by itself, so you do it/.test(command(n))).sort();
  assert.deepEqual(carry, ['comment', 'implement', 'run'], 'the reply paragraph is in these commands and no other');
  for (const n of carry) assert.equal(count(command(n), /nothing moves the track by itself, so you do it/g), 1, `${n}: once`);
  // the skill source holds it once; no other skill file repeats it (the commands take it from the implement guide)
  const files = (d) => fs.readdirSync(path.join(REPO, d), { recursive: true }).filter((f) => /\.md$/.test(f)).map((f) => path.join(d, f));
  const holders = files('.claude/skills/laneconductor').filter((f) => /nothing moves the track by itself/.test(read(f)));
  assert.deepEqual(holders, ['.claude/skills/laneconductor/lanes/implement.md']);
});

test('TC-15: the comment command applies the reply handling when the track has an Owner Action, and behaves as before when it has none', () => {
  const c = flat(command('comment'));
  const body = c.slice(0, c.indexOf('## Reference'));
  assert.match(body, /If the track has an `\*\*Owner Action\*\*` and my comment says it is done, also do what "The owner's reply" says in the skill file `lanes\/implement\.md` \(under "Reference"\)/);
  // no Owner Action: the old sentence is intact, and the append step is unchanged
  assert.match(body, /Otherwise do not answer it or change the track unless I ask\./);
  assert.match(body, /append my words to its `conversation\.md` as `> \*\*human\*\*: <my words>`/);
  // the Reference carries the paragraph under the file it comes from
  assert.match(c, /### `lanes\/implement\.md` \(the owner's reply, step 4\) \*\*The owner's reply\*\* \("posted", "done", or a move\)/);
  assert.match(c, /Clear `Owner Action`, `Owner Action Due` and `Waiting for reply`; set `\*\*KPI Check After\*\*` to now plus the KPI `Window`/);
  assert.match(c, /park the track in the quality-gate lane as `waiting`, with a `\*\*Waiting Reason\*\*` naming that date/);
  assert.match(c, /With no KPI block there is no window: ask the owner where the track goes next/);
  // the connector's prompt says the same, with one update_track, and names a skill file that ships
  const prompt = read('connector/src/commands.mjs');
  assert.match(prompt, /says in the skill file `lanes\/implement\.md` \(`get_context` returns it\), in one `update_track`\. Otherwise do not answer it/);
});

test('TC-15: move says in one short line that leaving waiting clears the owner markers', () => {
  const line = 'A move out of `waiting` also clears `Owner Action`, `Owner Action Due` and `Waiting for reply`.';
  assert.equal(command('move').split(line).length - 1, 1);
  assert.ok(Buffer.byteLength(line) < 150, `${Buffer.byteLength(line)} bytes`);
  assert.ok(read('connector/src/commands.mjs').includes('A move out of `waiting` also clears `Owner Action`, `Owner Action Due` and `Waiting for reply` (null)'));
});

test('TC-16: the quality gate writes Result and a history line after its KPI step, applies the kill rule, never invents a number', () => {
  const g = flat(guide('quality-gate'));
  const kpi = g.indexOf('1. **KPI measurement');
  const result = g.indexOf('**Non-dev result:**');
  const checks = g.indexOf('2. **Execute the checks.**');
  assert.ok(kpi > 0 && result > kpi && result < checks, 'the Result step sits inside the KPI step');
  const s = g.slice(result, checks);
  assert.match(s, /write `\*\*Result\*\*` to `index\.md` \(one line, up to 200 characters: what you read and what it taught\)/);
  assert.match(s, /one dated `history\.md` line/);
  assert.match(s, /Never invent a number/);
  assert.match(s, /A miss with the run window used up/);
  assert.match(s, /`done:success` with `killed:` and the reason in `Result`/);
  assert.match(s, /`done:failure` means the merge failed/);
  assert.match(s, /A miss with window left follows the KPI MISS replanning/);
  // the existing behaviour stays: ask the person when the source cannot be read
  assert.match(g, /when it cannot be read from here, ask the person for the number/);
  assert.match(g, /## ❌ KPI MISS/);
});

test('TC-16: the plan guide has one optional Kill rule line in the KPI block, and nothing else new there', () => {
  const p = guide('plan');
  assert.equal(count(p, /\*\*Kill rule\*\*/g), 1);
  const block = p.slice(p.indexOf('## KPI\n'), p.indexOf('**Maps To**'));
  assert.match(block, /\*\*Window\*\*: .*\n\s*\*\*Kill rule\*\*: <optional: /);
});

test('TC-17: no new heading in the three guides, no new skill file, no campaign template, channel kit or readout format in the base', () => {
  assert.deepEqual(headings(guide('implement')), ['# implement lane: `/laneconductor implement N`', '## Offer a missing skill', '## Skills that help here']);
  assert.deepEqual(headings(guide('quality-gate')), ['# quality-gate lane: `/laneconductor quality-gate N`', '## Offer a missing skill', '## Skills that help here']);
  assert.deepEqual(headings(guide('plan')).filter((h) => /KPI|Kill|Owner|Result/.test(h)), [], 'the plan guide gets no heading: the Kill rule is one line inside the KPI template');
  assert.deepEqual(fs.readdirSync(path.join(REPO, '.claude/skills/laneconductor/lanes')).sort(), ['brainstorm.md', 'implement.md', 'merge.md', 'plan.md', 'quality-gate.md', 'review.md']);
  assert.deepEqual(fs.readdirSync(path.join(REPO, '.claude/skills/laneconductor/ops')).sort(), ['board.md', 'lanes-and-statuses.md', 'new-project.md', 'next.md', 'settings.md', 'suggest-skills.md', 'tracks.md', 'working-a-track.md']);
  const all = ['plan', 'implement', 'quality-gate'].map(guide).join('\n') + SKILL;
  assert.doesNotMatch(all, /campaign template|channel kit|readout format|## Campaign|## Readout|## Channel/i);
});

test('TC-17: the added text is merged into the existing steps; the affected commands grew by a small, recorded amount and stay inside the limits', () => {
  // Bytes before (the commit this phase started from, 8cc4b16a plus the Phase 2 and 3 merge) and the ceilings the phase set itself (next: 167 bytes added in 1.9.1 so detecting plugins never chains commands).
  const BEFORE = { plan: 27268, implement: 26745, 'quality-gate': 20791, run: 65654, next: 32808, 'new-project': 35430, comment: 5553, move: 6741 };
  const GROWTH = { plan: 200, implement: 1500, 'quality-gate': 1500, run: 3000, next: 200, 'new-project': 0, comment: 1000, move: 150 };
  for (const [n, before] of Object.entries(BEFORE)) {
    const size = Buffer.byteLength(command(n));
    assert.ok(size <= before + GROWTH[n], `${n}: ${size} bytes, ${size - before} more than before (allowed ${GROWTH[n]})`);
  }
  assert.ok(Buffer.byteLength(command('run')) < 68 * 1000, 'run.md stays under 68 KB');
  // The Result and reply text is in the guides, so run carries each once (it carries every guide once).
  assert.equal(count(command('run'), /\*\*Non-dev result:\*\*/g), 1);
  assert.equal(count(command('quality-gate'), /\*\*Non-dev result:\*\*/g), 1);
  assert.equal(count(command('implement'), /\*\*Owner Action Due\*\*/g), 1);
  // The 256 KiB file limit and the README word limit are asserted for every file by directory-base.test.mjs and plugin-build.test.mjs.
});

test('TC-18: the base says once that the lint, the computed flags and the board need the connector or the board add-on, and that without them the markers are by hand', () => {
  const s = flat(SKILL);
  assert.equal(count(s, /need the connector or the board add-on/g), 1);
  assert.match(s, /The lint, the overdue and ready-to-measure flags and the board need the connector or the board add-on; without them you read and write these markers by hand and compare their dates with today's date/);
  for (const n of ['plan', 'implement', 'quality-gate', 'next']) assert.doesNotMatch(flat(guide('plan') + command(n)), /need the connector or the board add-on/);
});
