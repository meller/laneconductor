// A shorter first run (owner feedback after a real first run, 2026-11-19): "do you think users will really read all of that?"
// The Markdown an agent follows is the behaviour, so these tests pin its text: the S02 card of `next` at the default level is the step, one line on what it
// does and one pointer to `next explain` (no primer, no three paths, no board or add-ons note, no "say go"), the explain level keeps the full text, a fact
// in a card comes from a command run for that purpose, and the setup confirmation is one short message with one decision and the reply line.
// HUMAN, not covered here: how many lines a real session prints (checked by running the client headlessly, see the track conversation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, RELS } from '../../scripts/build-plugin.mjs';
import { BASE_PROCEDURES, ADDONS_INSTALL } from '../../scripts/plugin-texts.mjs';
import { COMMANDS } from '../src/commands.mjs';
import { resolveLevel } from '../src/next.mjs';

const SRC = path.join(REPO, '.claude/skills/laneconductor');
const BASE = path.join(REPO, RELS.base);
const read = (p) => fs.readFileSync(p, 'utf8');
const NEXT_MD = read(path.join(SRC, 'ops/next.md'));
const NEW_PROJECT_MD = read(path.join(SRC, 'ops/new-project.md'));
const SETUP_MD = read(path.join(SRC, 'setup/setup.md'));
const cmd = (n) => read(path.join(BASE, `commands/${n}.md`));
/** The text of one `## ` section of a Markdown file, up to the next `## `. */
const section = (text, heading) => {
  const at = text.indexOf(`\n## ${heading}\n`);
  assert.ok(at >= 0, `section ${heading}`);
  const rest = text.slice(at + 1);
  const end = rest.indexOf('\n## ', 3);
  return end < 0 ? rest : rest.slice(0, end);
};
const FIRST_CARD = section(NEXT_MD, 'The first card');
const cardLines = (text) => text.split('\n').filter((l) => l.startsWith('> '));

// ---- next: the first card ----

test('the S02 card at the default level is three lines: the step, one line on what it does, one pointer to `next explain`', () => {
  const card = cardLines(FIRST_CARD);
  assert.equal(card.length, 3, 'the example card has three lines');
  assert.match(card[0], /^> \*\*Next: .*\*\* `\/laneconductor:setup`$/, 'the step with its command');
  assert.ok(card[1].length < 140, 'one line on what it does');
  assert.match(card[2], /`\/laneconductor:next explain`\.$/, 'the pointer');
  assert.match(card[2], /the lanes, the other paths, the board and the add-ons/, 'the pointer says what explain adds');
});

test('the S02 card at the default level has no lane primer, no three-paths list, no board note, no add-ons note and no "say go"', () => {
  const lines = cardLines(FIRST_CARD);
  const card = lines.join('\n');
  const body = lines.slice(0, 2).join('\n'); // the third line is the pointer, which names what explain adds
  assert.doesNotMatch(card, /five lanes|five statuses|There are five|queue|running|\bmarker\b/i, 'no lane primer');
  assert.doesNotMatch(card, /\(a\)|\(b\)|\(c\)|three paths|new-project|look around/i, 'no list of paths');
  assert.doesNotMatch(card, /What's next button|opens the whole project as a board|\/laneconductor:board/, 'no board note');
  assert.doesNotMatch(body, /add-on|\bboard\b/i, 'no board or add-ons note outside the pointer');
  assert.doesNotMatch(card, /laneconductor-parallel|laneconductor-board|claude plugin|\/plugin /i, 'no add-ons note');
  assert.doesNotMatch(card, /say go/i, 'no second confirmation');
  // The rules around the card say the same in words.
  assert.match(FIRST_CARD, /No why line, no primer, no paths, no board or add-ons note, no "Say go"/);
  assert.match(FIRST_CARD, /In S01 to S03 nothing is ranked\. At the default level the card is these three lines and nothing else/);
});

test('the level rule: auto is the first card in S01 to S04, and only `explain` gives the full text; the code and the text agree', () => {
  for (const st of ['S01', 'S02', 'S03', 'S04']) {
    assert.equal(resolveLevel({ saved: 'auto', state: st, tracks: [] }), 'short', st);
    assert.equal(resolveLevel({ saved: 'auto', state: st, tracks: [], arg: 'explain' }), 'explain', st);
    assert.equal(resolveLevel({ saved: 'explain', state: st, tracks: [] }), 'explain', `${st}: a saved explain keeps the full text`);
  }
  const levels = section(NEXT_MD, 'Levels');
  assert.match(levels, /behaves as `short` in S01 to S04 \(the first card, with its pointer to `next explain`; in S04 the first-track card\)/);
  assert.match(levels, /`short` is the one-line card[^\n]*In S01 to S03 it is the first card, in S04 the first-track card/);
});

test('the explain level still has everything the first card leaves out: the primer, the three paths, the board note and the add-ons offer', () => {
  const levels = section(NEXT_MD, 'Levels');
  assert.match(levels, /`explain` adds a primer in plain words, then the card \(in S01 to S04: the full text of the table row, S04: the first-track card, then the front door\)/);
  for (const part of ['There are five lanes', 'There are five statuses', '`done:queue` means gated but not merged yet']) assert.ok(levels.includes(part), part);
  const row = NEXT_MD.split('\n').find((l) => l.startsWith('| S02 |'));
  for (const part of ['Explain level: three paths', '(a) Continue this project', '(b) Start a new project', '(c) Look around', 'defaults to (a)', 'Then the add-ons and the board']) assert.ok(row.includes(part), `S02 row: ${part}`);
  const door = section(NEXT_MD, 'The front door');
  assert.match(door, /At the explain level in S02, S03 and S04 the card is followed, once per session, by the optional add-ons/);
  assert.match(door, /At the explain level in S02 and S03 add one sentence, once: `\/laneconductor:board` opens the whole project as a board/);
  assert.match(door, /At the default level, and in later runs with tracks, add-ons are not offered on the card/);
  assert.ok(NEXT_MD.includes('<!-- generated: recommended plugins -->'), 'the generated add-ons block is still in the file');
  const gen = read(path.join(BASE, 'skills/laneconductor/ops/next.md'));
  assert.ok(gen.includes('claude plugin install'), 'and carries the install commands in the shipped skill');
  // S03 repeats the same extras only at the explain level; S04 keeps its primer and the card, then the add-ons without the board (the card has the board line).
  assert.match(NEXT_MD.split('\n').find((l) => l.startsWith('| S03 |')), /Explain level: then the add-ons and the board/, 'S03');
  assert.match(NEXT_MD.split('\n').find((l) => l.startsWith('| S04 |')), /Explain level: the primer, the card, then the add-ons except the board/, 'S04');
});

test('no "say go" before a command that asks for confirmation itself: the card rule, the generated command and both procedure texts say so', () => {
  const rule = 'except when the command asks for confirmation itself (`setup`, `new-project`, `merge`, `deploy`): the card then ends with the command, so the person confirms once';
  assert.ok(NEXT_MD.includes(rule));
  assert.ok(cmd('next').includes(rule), 'the generated command carries it');
  const offer = 'a command that asks for confirmation itself (`setup`, `new-project`, `merge`) is named without that offer';
  assert.ok(COMMANDS.find((c) => c.name === 'next').procedure.includes(offer), 'the connector prompt');
  assert.ok(BASE_PROCEDURES.next.includes(offer), 'the base procedure');
  assert.match(COMMANDS.find((c) => c.name === 'next').procedure, /With no tracks yet, the default is a three-line first card that points to `explain`/);
});

test('a number in a card comes from a command run for that purpose, never from a truncated listing: it says so, in the source and the command', () => {
  for (const [name, text] of [['ops/next.md', NEXT_MD], ['commands/next.md', cmd('next')]]) {
    assert.match(text, /`git rev-list --count HEAD`/, `${name}: the command for the commit count`);
    assert.match(text, /A count \(commits, tracks, files\) comes from a command or a read run for that purpose, never from a truncated listing; if you did not run one, say no number/, `${name}: the rule`);
  }
});

// ---- setup: the confirmation ----

/** The form of the confirmation message, from the source of ops/new-project.md: an example message, then the rules. */
const FORM = NEW_PROJECT_MD.slice(NEW_PROJECT_MD.indexOf('Show the result as ONE message'), NEW_PROJECT_MD.indexOf('Do not add the walking-skeleton'));
const example = (text) => cardLines(text).map((l) => l.slice(2));

test('the setup confirmation has the required parts in order: name and purpose, stack, commands that exist, what will be created, the one decision, the reply line', () => {
  const lines = example(FORM);
  assert.equal(lines.length, 6);
  assert.match(lines[0], /^\*\*[\w-]+\*\*: .+\.$/, 'name and purpose in one line');
  assert.match(lines[1], /^Stack: /);
  assert.match(lines[2], /^Commands: `[^`]+`(, `[^`]+`)*\.$/, 'only commands that exist');
  assert.match(lines[3], /^I will create `conductor\/`/, 'what will be created, in one line');
  assert.match(lines[4], /^Tracks: committed with the code, or private \(.*\)\? I recommend private: the README says this is a public demo\.$/, 'the one decision with a recommendation');
  assert.equal(lines[5], 'Reply ok, or tell me what differs.', 'the last line is the reply line');
  assert.match(FORM, /Recommend private for a repository that looks public \(a README that says public demo, no licence yet\), committed otherwise/);
});

test('the setup confirmation stays within the line limit: at most twelve lines, and an extra line only for something unusual or that needs a decision', () => {
  assert.match(FORM, /ONE message in this form, at most twelve lines, everything filled in/);
  assert.ok(example(FORM).length <= 12 - 3, 'the example leaves room for the named extra lines');
  assert.ok(example(FORM).every((l) => l.length < 150), 'every line of the example is one line');
  assert.match(FORM, /Add a line only for something unusual or that needs a decision \(an existing `conductor\/` folder, a stale project-level skill, a conflict\)/);
  assert.match(SETUP_MD, /about\s+twelve lines, ending "Reply ok, or tell me what differs"/);
  assert.match(SETUP_MD, /\*\*An existing `conductor\/`\*\* \(an older LaneConductor\) is one more line in the message/);
  assert.match(SETUP_MD, /\*\*A stale project-level skill\*\* is one more line in the message, only if/);
});

test('the setup confirmation says nothing about what does not exist or does not apply: the rule is there and the old absent-thing lines are gone', () => {
  for (const [name, text] of [['ops/new-project.md', NEW_PROJECT_MD], ['setup/setup.md', SETUP_MD], ['commands/setup.md', cmd('setup')], ['commands/new-project.md', cmd('new-project')]]) {
    assert.match(text.replace(/\s+/g, ' '), /Say nothing about what does not exist or does not apply/, `${name}: the rule`);
    assert.doesNotMatch(text, /one line for each one you left out|Say so when you leave one out|where each fact came from, and the tracks folder/, `${name}: the list of absent things is gone`);
    assert.doesNotMatch(text, /Show the plan, then write|List the files the scaffold would create and the ones it would skip/, `${name}: no second plan after the confirmation`);
  }
  assert.match(NEW_PROJECT_MD.replace(/\s+/g, ' '), /no list of commands left out, no "nothing to clean up", no "no optional plugins", no "I will not touch your README", no repository facts/);
  assert.ok(!example(FORM).join('\n').match(/commits|branch|touch|leave|left out|nothing to/i), 'the example itself says nothing about what is absent or always true');
  assert.match(SETUP_MD, /\*\*Say what else fits\*\*, in the closing summary, not in the message above: .*say nothing when none fits/s);
});

test('the setup confirmation keeps what the earlier tests require: nothing written before the reply, the reply line, the private option, a count from a command, and the reply is the yes', () => {
  for (const [name, text] of [['setup.md', SETUP_MD], ['new-project.md', NEW_PROJECT_MD], ['commands/setup.md', cmd('setup')], ['commands/new-project.md', cmd('new-project')]]) {
    assert.match(text, /Reply ok, or tell me what differs/, name);
    assert.match(text, /[Ww]rite nothing until that reply/, name);
    assert.match(text, /private/, name);
  }
  for (const [name, text] of [['new-project.md', NEW_PROJECT_MD], ['commands/setup.md', cmd('setup')]]) {
    assert.match(text, /`git rev-list --count HEAD`/, `${name}: counts by command`);
    assert.match(text, /For an existing repository the step 1 reply is that yes/, `${name}: no second confirmation before the files`);
  }
  assert.match(SETUP_MD, /\*\*Write after the reply\.\*\* The reply is the yes/);
  assert.doesNotMatch(cmd('setup'), /\bworkers?\b|daemon|collection|make install|laneconductorrc/i, 'no daemon-era words');
});

// ---- the generated commands do not grow ----

// The sizes of the four generated front-door commands before this change (bytes). They may shrink, never grow: a longer first run is the bug this fixes.
// (next 32908, setup 30811, new-project 35420, run 67201: the sizes of the commit before the first-track card of track AM-10144, Phase 10.)
const CEILING = { next: 32908, setup: 30811, 'new-project': 35420, run: 67201 };

test('the generated next, setup, new-project and run commands do not grow in bytes', () => {
  for (const [name, max] of Object.entries(CEILING)) {
    const bytes = Buffer.byteLength(cmd(name), 'utf8');
    assert.ok(bytes <= max, `${name}: ${bytes} bytes, ceiling ${max}`);
  }
});

// ---- S04: the first-track card (track AM-10144, Phase 10; track AM-10130, Phase 5) ----
// Owner feedback on a real first run: setup ended with "Next: run /laneconductor:next", and `next` then printed the whole lane primer for a project that is
// set up and has no tracks. Now S04 has a short card (suggested tracks, the board line, the person's own title), written ONCE in ops/next.md and carried
// word for word by next, setup and new-project; setup ends with it and asks one question. HUMAN, not covered here: that a real client follows it
// (checked by running the client headlessly, see the track conversation).

const TRACK_CARD = section(NEXT_MD, 'The first-track card');
const trackCardLines = cardLines(TRACK_CARD);
const AUDIT = 'Audit: review the code for privacy, security and quality, and file each finding as its own track';

test('the S04 card has the step line, numbered suggestions with the audit last, the board line and the own-title option', () => {
  assert.equal(trackCardLines[0], '> **Next: your first track.**');
  const items = trackCardLines.filter((l) => /^> \d\. /.test(l));
  assert.ok(items.length >= 1 && items.length <= 4, 'at most four suggestions');
  assert.ok(items.every((l) => l.length < 150), 'one line each');
  assert.ok(items[items.length - 1].includes(AUDIT), 'the audit track is the last suggestion');
  assert.ok(trackCardLines.some((l) => /`\/laneconductor:board`/.test(l)), 'the board line');
  assert.match(trackCardLines[trackCardLines.length - 1], /tell me a title of your own\.$/, 'the last line offers the own title');
  assert.ok(trackCardLines.indexOf(trackCardLines.find((l) => l.includes('/laneconductor:board'))) > trackCardLines.indexOf(items[items.length - 1]), 'the board line comes after the suggestions');
});

test('the S04 card has no lane primer, no three-paths list and no "say go"', () => {
  const card = trackCardLines.join('\n');
  assert.doesNotMatch(card, /five lanes|five statuses|There are five|\bqueue\b|running|\bmarker\b/i, 'no lane primer');
  assert.doesNotMatch(card, /\(a\)|\(b\)|\(c\)|three paths|new-project|look around/i, 'no list of paths');
  assert.doesNotMatch(card, /say go/i, 'no second confirmation');
  assert.ok(trackCardLines.length <= 8, 'a short card');
});

test('the S04 rules: at most four, only facts that were read, nothing claimed that was not checked, the audit always last, nothing created before the answer', () => {
  assert.match(TRACK_CARD, /at most four, one line each/);
  assert.match(TRACK_CARD, /Use only facts you have read/);
  assert.match(TRACK_CARD, /claim no finding you did not check/);
  assert.match(TRACK_CARD, /Keep the first three that fit, then always last: Audit: review the code for privacy, security and quality, and file each finding as its own track/);
  for (const fact of ['no licence file', 'public, demo or open source', 'no CI files but a test command', 'no lint or format config', 'no `SECURITY.md`', 'no lockfile']) assert.ok(TRACK_CARD.includes(fact), fact);
  for (const title of ['Choose a licence', 'Check the repository for secrets and personal data before it is public', 'Add CI that runs']) assert.ok(TRACK_CARD.includes(title), title);
  assert.match(TRACK_CARD, /nothing is created before the person answers/);
  assert.match(TRACK_CARD, /For each, follow `new`: search first \(a fitting track is offered an update\), then create/);
});

test('the S04 board line: the board command when the add-on is installed, else the one-line install shown alone in its own bash block and never run; detected without chaining', () => {
  assert.match(TRACK_CARD, /\*\*The board line\*\*: as above when the board add-on is installed/);
  assert.match(TRACK_CARD, /only if that is not enough run `claude plugin list` as a command of its own, never chained/);
  assert.match(TRACK_CARD, /the line below alone in its own bash block, never run by you/);
  assert.match(TRACK_CARD, /<!-- generated: add-ons one-line install -->/, 'the source holds a marker, the catalog supplies the line');
  assert.doesNotMatch(TRACK_CARD, /claude plugin install/, 'the source names no install command by hand');
  const shipped = section(cmd('next'), 'The first-track card');
  assert.ok(shipped.includes(`\`\`\`bash\n${ADDONS_INSTALL}\n\`\`\``), 'the shipped card carries the catalog one-liner in its own fence');
  assert.ok(!shipped.includes('<!-- generated'), 'the marker is replaced');
});

test('the S04 row and the explain level: the default level is the card, the explain level keeps the primer and the add-ons', () => {
  const row = NEXT_MD.split('\n').find((l) => l.startsWith('| S04 |'));
  assert.ok(row.includes('Default level: the first-track card'), 'default level');
  assert.ok(row.includes('Explain level: the primer, the card, then the add-ons except the board'), 'explain level');
  assert.ok(row.trimEnd().endsWith('| `/laneconductor:new <title>` |'), 'the command is still new');
  assert.equal(resolveLevel({ saved: 'auto', state: 'S04', tracks: [] }), 'short');
  assert.equal(resolveLevel({ saved: 'auto', state: 'S04', tracks: [], arg: 'explain' }), 'explain');
  assert.match(section(NEXT_MD, 'Levels'), /There are five lanes: plan, implement, review, quality-gate, done/, 'the primer is still there');
});

test('one text: next, setup and new-project carry the same first-track card word for word, in the skill and in the generated commands', () => {
  const shippedSkill = read(path.join(BASE, 'skills/laneconductor/ops/next.md'));
  const want = section(shippedSkill, 'The first-track card');
  assert.ok(want.includes('**Next: your first track.**'));
  for (const name of ['next', 'setup', 'new-project']) {
    // (the generator may add its own closing line after the body of a command, so the card is compared as a prefix)
    assert.ok(section(cmd(name), 'The first-track card').trim().startsWith(want.trim()), `${name} carries the card unchanged`);
  }
  for (const [name, text] of [['setup/setup.md', SETUP_MD], ['ops/new-project.md', NEW_PROJECT_MD]]) {
    assert.ok(!text.includes('**Next: your first track.**'), `${name} holds no second copy of the card`);
    assert.match(text, /first-track card/, name);
  }
});

test('setup ends with the card and one question: no "Next: run" line, the commit question folded into one short line, the board line once', () => {
  const step6 = SETUP_MD.slice(SETUP_MD.indexOf('6. **Close with the first track.**'), SETUP_MD.indexOf('## What else fits this project'));
  assert.ok(step6.length > 100, 'step 6 is there');
  assert.match(step6, /End with the first-track card/);
  assert.match(step6, /the line "Say commit when you want the conductor files committed\."/);
  assert.match(step6, /The track choice is\s+the one question: no "Next: run `\/laneconductor:next`" line and no second question/);
  assert.doesNotMatch(SETUP_MD.replace(step6, ''), /Next: run/, 'no "Next: run" instruction anywhere else in setup');
  assert.doesNotMatch(SETUP_MD, /Commit this\s+scaffold\?|Commit this scaffold\?/);
  assert.doesNotMatch(SETUP_MD, /opens the whole project as a board/, 'step 5 no longer says the board sentence: the card has the board line');
  assert.doesNotMatch(cmd('setup'), /opens the whole project as a board/);
  // The new-project close: the card for an existing repository, the plan step for a new project, the same commit line, no "run next".
  const close = NEW_PROJECT_MD.slice(NEW_PROJECT_MD.indexOf('## 6. Summarize and close'), NEW_PROJECT_MD.indexOf('## Rules'));
  assert.match(close, /with no "Next: run `\/laneconductor:next`" line/);
  assert.match(close, /the line\n"Say commit when you want the conductor files committed\." and no other question/);
  for (const text of [step6.replace(/no "Next: run[^"]*"/, ''), close.replace(/no "Next: run[^"]*"/, '')]) assert.doesNotMatch(text, /Next: run/);
  // Setup's ordering: the starter set, if any, comes before the card, so the track choice is the last question and the board is named once.
  assert.match(SETUP_MD, /Do not wait for an answer: step 6 follows in the same message/);
  assert.match(TRACK_CARD, /Skip it when setup's starter set offered the board/);
});
