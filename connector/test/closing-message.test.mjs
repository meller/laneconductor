// A short closing message when a lane finishes (owner feedback after a real `/laneconductor:plan 1` run on 1.9.5, 2026-11-19; track AM-10144 Phase 13,
// release 1.9.7). The run ended with about 35 lines of chat (four phases, twelve test cases, findings, three decisions, two next steps); the owner wanted a
// short overview and a way to see more: the board, where the card carries the next step with a Copy button. The Markdown an agent follows is the behaviour,
// so these tests pin its text: ONE rule in the skill source ("The closing message of a lane"), carried once by each lane command and by `run`, pointed to
// by the last step of each lane guide; findings go to the track's files; the one-completion-comment rule is untouched; the commands did not grow.
// HUMAN, not covered here: what a real model prints (checked by a headless run of `plan 1` on a scratch project, see the track conversation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, RELS } from '../../scripts/build-plugin.mjs';
import { actionOf } from '../src/board-actions.mjs';
import { resolveNext } from '../../conductor/services/workflow-transitions.mjs';
import { buildTrackFiles, nextNumber } from '../src/tracks.mjs';

const SRC = path.join(REPO, '.claude/skills/laneconductor');
const BASE = path.join(REPO, RELS.base);
const read = (p) => fs.readFileSync(p, 'utf8');
const SKILL = read(path.join(SRC, 'SKILL.md'));
const guide = (n) => read(path.join(SRC, `lanes/${n}.md`));
const cmd = (n) => read(path.join(BASE, `commands/${n}.md`));
const count = (t, re) => (t.match(re) ?? []).length;
const HEADING = '## The closing message of a lane';
/** The rule: from its heading to the next `## ` heading. */
const rule = (text) => { const at = text.indexOf(HEADING); assert.ok(at >= 0, 'has the rule'); const rest = text.slice(at + HEADING.length); const end = rest.search(/\n##? /); return rest.slice(0, end < 0 ? undefined : end); };
const LANES = ['plan', 'implement', 'review', 'quality-gate', 'merge'];
const MORE = 'More: `/laneconductor:board` (the track\'s card shows the next step with a Copy button), or say "show the plan".';

test('the rule has the four parts in order: outcome, what is needed from the person (three lines at most), one next command, one More line; six lines at most', () => {
  const r = rule(SKILL);
  assert.match(r, /six lines at most, with no heading:/);
  const at = ['**Outcome**', '**Needed from the person**', '**Next**', '**More**'].map((k) => r.indexOf(k));
  assert.ok(at.every((i) => i > 0) && at.every((v, i) => i === 0 || v > at[i - 1]), `the four parts, in order: ${at}`);
  assert.match(r, /Outcome\*\*, one line: what was done and where the track sits now, with its title and a gist: `Planned AM-1 "Title" \(6 phases, 12 tests\): <one clause on the approach>; parked at plan:success\.`/);
  assert.match(r, /what blocks the next step, three lines at most, one each/);
  assert.match(r, /Owner Action/, 'a supervised track: its Owner Action is the needed line');
  assert.match(r, /a plan item marked unverified or open that blocks building/, 'an open item that blocks building is a decision');
  assert.match(r.replace(/\s+/g, ' '), /Say nothing of commits or ignored tracks unless unusual\./);
  assert.match(r, /the command alone, for the lane the track now sits in \(`\/laneconductor:implement N`; after a merge, `\/laneconductor:next`\)/);
  assert.ok(r.includes(MORE), 'the exact More line');
  // the parts are at most one line each: the whole rule's numbered list has exactly four items
  assert.equal(count(r, /^\d\. /gm), 4);
});

test('findings, phase and test-case lists and risks go into the track\'s files and its one completion comment, never into the chat', () => {
  const r = rule(SKILL).replace(/\s+/g, ' ');
  assert.match(r, /Findings, phase and test-case lists, risks and caveats go into the track's files and its one completion comment, not the chat/);
  assert.match(r, /give them on "show the plan"/);
});

test('the rule is written once in the skill source; the lane commands and run carry it once, no other command does', () => {
  assert.equal(count(SKILL, new RegExp(HEADING, 'g')), 1);
  const files = fs.readdirSync(SRC, { recursive: true }).filter((f) => /\.md$/.test(f) && !f.startsWith('legacy'));
  assert.deepEqual(files.filter((f) => read(path.join(SRC, f)).includes(MORE)), ['SKILL.md'], 'only SKILL.md holds the More line');
  const names = fs.readdirSync(path.join(BASE, 'commands')).map((f) => f.replace(/\.md$/, ''));
  const carry = names.filter((n) => cmd(n).includes(MORE)).sort();
  assert.deepEqual(carry, [...LANES, 'run'].sort());
  for (const n of carry) assert.equal(count(cmd(n), /^#### The closing message of a lane$/gm), 1, `${n}: once`);
});

test('each lane guide ends by pointing at the rule, once; the plan guide (the plan command) asks for no findings in chat', () => {
  for (const n of LANES) {
    const g = guide(n);
    assert.equal(count(g, /closing message of a lane/g), 1, `${n}: one pointer`);
    assert.ok(g.indexOf('closing message of a lane') < g.indexOf('## Offer a missing skill'), `${n}: it is a step of the lane, before the skill sections`);
    assert.ok(!g.includes('six lines'), `${n}: the rule itself is not repeated in the guide`);
  }
  for (const text of [guide('plan'), cmd('plan')]) {
    const before = text.slice(0, text.indexOf('#### The closing message of a lane') > 0 ? text.indexOf('#### The closing message of a lane') : undefined);
    assert.doesNotMatch(before.replace(/Findings, phase/g, ''), /what I found|findings summary|summary of (the )?findings|list (the )?findings|report (the )?findings/i);
  }
  assert.match(guide('plan'), /Your job ends here: write the closing message of a lane and stop\./);
  assert.match(guide('implement'), /Write the closing message of a lane and stop\./);
});

test('the habit of a lane finishing points at the rule; the one-completion-comment rule is as it was', () => {
  const skill = read(path.join(BASE, 'skills/laneconductor/SKILL.md'));
  assert.match(skill, /When a lane finishes, close with "The closing message of a lane" above \(six lines at most\)/);
  // the completion comment: one line, the emoji first, the same three meanings, written with author `system`
  const s = SKILL.replace(/\s+/g, ' ');
  assert.match(s, /\*\*Completion comment\.\*\* Every lane action ends with exactly one line in `history\.md`: `- <YYYY-MM-DD HH:MMZ> <emoji> <one-line summary>\.`/);
  assert.match(s, /`✅` success, no action needed; `⚠️` a human should look; `❌` failed\./);
  assert.match(s, /call `append_conversation` with author `system` and the text `<emoji> <one-line summary>`/);
  assert.match(s, /If an earlier step already posted a `⚠️`\/`❌` comment for the outcome, that one is enough\./);
  // and the guides still write their one line: plan, implement and merge a dated history line, review and the gate one comment
  assert.match(guide('plan'), /`✅ Plan complete - track now at <lane>:<status>\.`/);
  assert.match(guide('implement'), /`✅ Implementation complete - moved to <lane>\.`/);
  assert.match(guide('review'), /in one comment in `conversation\.md`/);
  assert.match(guide('quality-gate'), /in one comment in `conversation\.md`/);
});

// The commands carried 1.9.6 text of these sizes; the rule is paid for with shorter wording elsewhere, so no command grew. `run` carries five guides and has a ceiling.
const V196 = { plan: 27336, implement: 27575, review: 21034, 'quality-gate': 21368, merge: 17628, run: 67177, next: 32607, setup: 25944, 'new-project': 31579 };
test('sizes: no lane command grew against 1.9.6, and run stays under 68 KB', () => {
  for (const [n, max] of Object.entries(V196)) assert.ok(Buffer.byteLength(cmd(n)) <= max, `${n}: ${Buffer.byteLength(cmd(n))} <= ${max}`);
  assert.ok(Buffer.byteLength(cmd('run')) < 68 * 1000, 'run under 68 KB');
});

// The "More" line sends the person to the board, where the card shows the next step with a Copy button. That holds for every lane a track can finish.
const DEFAULT_WORKFLOW = (() => {
  const t = read(path.join(SRC, 'setup/templates.md'));
  const at = t.indexOf('**`conductor/workflow.json` default**');
  const fence = t.slice(at).match(/```json\n([\s\S]*?)\n```/);
  return JSON.parse(fence[1]);
})();
const LANE_NAMES = ['backlog', 'plan', 'implement', 'review', 'quality-gate', 'done'];

test('board: after a lane finishes, the track\'s card shows the next lane\'s command (the one the closing message names)', () => {
  const NEXT_CMD = { plan: 'implement', implement: 'review', review: 'quality-gate', 'quality-gate': 'merge' };
  for (const [lane, verb] of Object.entries(NEXT_CMD)) {
    // where the workflow puts the track on success: that lane and status is what the board reads
    const r = resolveNext(DEFAULT_WORKFLOW, lane, 'success');
    assert.ok(r.ok && r.next, `${lane}: the default workflow moves it`);
    const row = { number: 7, lane: r.next.lane, lane_status: r.next.status };
    const a = actionOf({ row, lanes: LANE_NAMES, workflow: DEFAULT_WORKFLOW });
    assert.equal(a?.c, `/laneconductor:${verb} 7`, `${lane}:success -> ${r.next.lane}:${r.next.status} shows ${verb}`);
    assert.ok(a.w.length > 0 && a.w.length <= 60, `${lane}: one short reason`);
  }
  // a track resting at success in a lane (a workflow that parks it there) shows the same next step
  for (const [lane, verb] of Object.entries(NEXT_CMD)) {
    const a = actionOf({ row: { number: 7, lane, lane_status: 'success' }, lanes: LANE_NAMES, workflow: DEFAULT_WORKFLOW });
    assert.equal(a?.c, `/laneconductor:${verb} 7`, `${lane}:success shows ${verb}`);
  }
});

test('board: a failed lane and a finished merge: the card names the retry or fix command, a merged track has nothing to copy', () => {
  const at = (lane, status) => actionOf({ row: { number: 7, lane, lane_status: status }, lanes: LANE_NAMES, workflow: DEFAULT_WORKFLOW });
  assert.equal(at('implement', 'failure').c, '/laneconductor:implement 7');
  assert.equal(at('implement', 'queue').c, '/laneconductor:implement 7', 'a failed review goes back to implement:queue');
  assert.equal(at('plan', 'queue').c, '/laneconductor:plan 7', 'a failed gate goes back to plan:queue');
  assert.equal(at('done', 'waiting').c, '/laneconductor:move 7 done:success', 'a PR in review: record the merge once it happens');
  assert.equal(at('done', 'success'), null, 'merged: nothing left to copy');
});

// Owner feedback, same day: setup filed the plan items by hand with the folder slug in the id (`# Track AM-001-plugin-packaging: ...`) and zero-padded numbers
// (`AM-001`), while the connector's create_track writes `AM-1` and the id only; the plan run had to correct them. The text now says how, and says to use the tool when present.
const TRACKS_MD = read(path.join(SRC, 'ops/tracks.md'));
const newTrackSection = (t) => t.slice(t.indexOf('## newTrack `[name] [description]`'), t.indexOf('## move `[track-number]'));

test('filing tracks by hand: the next free number unpadded, the id without the slug in every heading, as create_track writes them', () => {
  const s = newTrackSection(TRACKS_MD).replace(/\s+/g, ' ');
  assert.match(s, /With the add-on, call `create_track`/);
  assert.match(s, /By hand, write the files exactly as it would:/);
  assert.match(s, /The number is that plus one, never zero-padded \(`AM-1`, `AM-10`; `1` for the first track\)\./);
  assert.match(s, /The id is `INITIALS-<n>` without the slug; the folder is `INITIALS-<n>-slug\/`\./);
  assert.match(s, /# Track INITIALS-<n>: \[name\]/);
  assert.match(s, /\(`# History: Track INITIALS-<n>`, the id only\)/);
  assert.doesNotMatch(s, /INITIALS-NNN/, 'no placeholder that reads as a padded number');
  // what the tool writes, for the same input: the heading and the history header carry the id only, the number is unpadded, the folder has the slug
  const t = buildTrackFiles({ number: 1, initials: 'AM', title: 'Plugin packaging', problem: 'From `docs/plan.md`: package the plugin.' });
  assert.equal(t.id, 'AM-1');
  assert.equal(t.folder, 'AM-1-plugin-packaging');
  assert.match(t.files.index, /^# Track AM-1: Plugin packaging\n/);
  assert.equal(t.files.history, '# History: Track AM-1\n\n');
  assert.equal(nextNumber([]), 1);
  assert.equal(nextNumber(['AM-1-plugin-packaging', 'AM-12-x']), 13);
});

test('setup and the new-track commands carry that text; setup says create_track when the tool is present, else by hand, with the id-only heading', () => {
  const setup = read(path.join(SRC, 'setup/setup.md')).replace(/\s+/g, ' ');
  assert.match(setup, /then `create_track` when that tool is present, else by hand as `newTrack` writes the files: next free number, unpadded, heading `# Track AM-1: <Title>`, id only;/);
  for (const n of ['setup', 'new-project', 'new', 'bug', 'feature']) {
    const c = cmd(n).replace(/\s+/g, ' ');
    assert.match(c, /never zero-padded \(`AM-1`, `AM-10`; `1` for the first track\)/, `${n} carries the numbering`);
    assert.match(c, /\(`# History: Track INITIALS-<n>`, the id only\)/, `${n} carries the history header`);
  }
});
