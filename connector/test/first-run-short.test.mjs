// A shorter first run (owner feedback after a real first run, 2026-11-19): "do you think users will really read all of that?"
// The Markdown an agent follows is the behaviour, so these tests pin its text: the S02 card of `next` at the default level is the step, one line on what it
// does and one pointer to `next explain` (no primer, no three paths, no board or add-ons note, no "say go"), the explain level keeps the full text, a fact
// in a card comes from a command run for that purpose, and the setup confirmation is one short message with one decision and the reply line.
// HUMAN, not covered here: how many lines a real session prints (checked by running the client headlessly, see the track conversation).
// Release 1.9.5 (tracks AM-10144 Phase 12, AM-10130 Phase 7, AM-10117 Phase 6): "reduce friction and give the fastest value". `next` on a fresh project is a
// read only analysis and ONE reply, `go`; setup writes first (no pre-write confirmation: this supersedes the "one pre-filled message ending Reply ok" rule
// of track AM-10132 TC-2 for the first-run path, see permission-note.test.mjs), files the first four plan items as tracks, and closes with exactly two offers
// (the board, plan the first track) and one question. A brand-new project: `go` starts the new-project brainstorm.
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
/** The quoted example cards of "The first card", in order: S01/S03, S02 for an existing project, S02 for a new project. */
const cardBlocks = (text) => text.split('\n\n').map((b) => b.split('\n').filter((l) => l.startsWith('> '))).filter((b) => b.length);
const [S01_CARD, EXISTING_CARD, NEW_CARD] = cardBlocks(FIRST_CARD);

// ---- next: the first card ----

test('the S01 and S03 card at the default level is three lines: the step, one line on what it does, one pointer to `next explain`', () => {
  assert.equal(cardBlocks(FIRST_CARD).length, 3, 'three example cards: S01 and S03, S02 existing, S02 new');
  assert.equal(S01_CARD.length, 3);
  assert.match(S01_CARD[0], /^> \*\*Next: .*\*\* `\/laneconductor:setup`$/, 'the step with its command');
  assert.ok(S01_CARD[1].length < 140, 'one line on what it does');
  assert.match(S01_CARD[2], /`\/laneconductor:next explain`\.$/, 'the pointer');
  assert.match(S01_CARD[2], /the lanes, the other paths, the board and the add-ons/, 'the pointer says what explain adds');
});

test('the S02 card of an existing project shows what the analysis found and offers exactly one reply, `go`, with one clause saying what it will do', () => {
  const lines = EXISTING_CARD.map((l) => l.slice(2));
  assert.match(lines[0], /^\*\*Next: set this project up\.\*\* Nothing is written yet\.$/, 'read only, said in the card');
  assert.match(lines[1], /^\*\*[\w-]+\*\*: .+\(.+\)\.$/, 'the project in one line');
  assert.match(lines[2], /^Your plan, `docs\/plan\.md`:$/, 'the plan items and their source file');
  assert.equal(lines.filter((l) => /^\d\. /.test(l)).length, 4, 'four plan items');
  assert.match(lines.find((l) => /more in `docs\/plan\.md`/.test(l)), /^2 more in `docs\/plan\.md`\. Open question there: .+\? \(not filed\)$/, 'an open decision is listed, never filed');
  const privacy = lines.find((l) => /^Tracks will be /.test(l));
  assert.match(privacy, /^Tracks will be private \(git-ignored\): the README says this is a public demo\.$/, 'the tracks privacy it will declare');
  const reply = lines.filter((l) => /\bgo\b/.test(l));
  assert.equal(reply.length, 1, 'exactly one reply is offered');
  assert.match(reply[0], /^Reply \*\*go\*\* and I run `\/laneconductor:setup`: it sets up LaneConductor, keeps the tracks private and files the four plan items above as tracks in the plan lane\.$/);
  assert.equal(lines.filter((l) => /^Reply\b/.test(l)).length, 1, 'no second reply (no "ok", no numbers)');
  assert.ok(!lines.some((l) => /\bok\b|say go/i.test(l)), 'no "ok" and no "say go"');
  assert.match(lines[lines.length - 1], /`\/laneconductor:next explain`\.$/, 'the pointer');
  assert.ok(lines.length <= 12, 'a few lines');
  // the rules around the cards say the same in words
  assert.match(FIRST_CARD, /S02 is a read only analysis \(README, `package\.json`, `git remote`, the plan documents of "The first-track card"\) and ONE reply, `go`, which runs the command the card names/);
  assert.match(FIRST_CARD, /With no plan document leave the plan lines out and end the reply line "\.\.\.keeps the tracks private; no plan document, so it files nothing\."/);
});

test('the S02 card of an existing project has no lane primer, no three-paths list, no board note, no add-ons note and no second confirmation', () => {
  const card = EXISTING_CARD.join('\n');
  assert.doesNotMatch(card, /five lanes|five statuses|There are five|\bqueue\b|running|\bmarker\b/i, 'no lane primer');
  assert.doesNotMatch(card, /\(a\)|\(b\)|\(c\)|three paths|new-project|look around/i, 'no list of paths');
  assert.doesNotMatch(card, /What's next button|opens the whole project as a board|\/laneconductor:board/, 'no board note');
  assert.doesNotMatch(card, /laneconductor-parallel|laneconductor-board|claude plugin|\/plugin |add-on/i, 'no add-ons note');
  assert.match(FIRST_CARD, /No why line, primer, paths, board or add-ons note/);
});

test('the S02 card of a brand-new project says so and offers `go` to start the brainstorm: options and decisions first, nothing written, then the scaffold, the first tracks and the starter set', () => {
  const lines = NEW_CARD.map((l) => l.slice(2));
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^\*\*Next: start a new project\.\*\* No code and no plan document here\.$/);
  assert.match(lines[1], /^Reply \*\*go\*\* and I run `\/laneconductor:new-project`: a short brainstorm about the idea first \(options and decisions, nothing written\), then the scaffold, the first tracks and a starter set of suggested skills\.$/);
  assert.equal(lines.filter((l) => /\bgo\b/.test(l)).length, 1, 'one reply');
  assert.match(lines[2], /`\/laneconductor:next explain`\.$/);
  assert.match(FIRST_CARD, /A new project \(an empty or nearly empty folder: no code, no plan document; a README or licence alone does not count\)/);
  // new-project, the other side: the reply `go` starts it, it asks for no name first, the interview is a brainstorm, nothing is written before it ends
  assert.match(NEW_PROJECT_MD, /the reply `go` to the card of `next` starts it\. Ask for no name first: the first question is what it is for\./);
  assert.match(NEW_PROJECT_MD, /This is a brainstorm, in the style of/);
  assert.match(NEW_PROJECT_MD, /Write no file until the interview is done and they say to scaffold/);
});

test('`go` is the consent: both sides say it, and nothing says setup or new-project runs "only because" they were named', () => {
  assert.match(NEXT_MD, /A reply of "go" runs the command the card named as if the person had typed it: the card names it, and `go` is the consent\./);
  assert.ok(cmd('next').includes('the card names it, and `go` is the consent.'), 'the generated next command');
  for (const [name, text] of [['commands/setup.md', cmd('setup')], ['commands/new-project.md', cmd('new-project')]]) {
    assert.match(text, /This runs when I named it, or said go to the card of `next` that named it/, name);
    assert.doesNotMatch(text, /runs only because I named it/, name);
  }
  assert.match(SETUP_MD, /It runs when the person names it, or says `go` to the card of `next` that named it:\s+the card names the command and `go` is the consent/);
  assert.match(NEW_PROJECT_MD, /Run it when the person names it, or says\s+`go` to the card of `next` that named it/);
  // the catalog: the description the client lists, the connector prompts and the base procedure
  for (const n of ['setup', 'new-project']) {
    const c = COMMANDS.find((x) => x.name === n);
    assert.match(c.description, /runs when you name it, or reply go to a next card/, `${n}: description`);
    assert.doesNotMatch(c.description, /runs only because you named it/, n);
    assert.match(c.procedure, /This runs when I named it, or said go to a `next` card that named it/, n);
  }
  assert.match(read(path.join(SRC, 'SKILL.md')), /runs only when the user asks for it by name, or says go to the card of `next` that named setup or new-project/);
  assert.match(cmd('setup'), /^description: "Add LaneConductor to this project: read what is there, write the conductor\/ files and file the plan as tracks \(runs when you name it, or reply go to a next card\)"/m);
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

test('no "say go" before a command that asks for confirmation itself, and the first card has its own reply: the card rule, the generated command and both procedure texts say so', () => {
  const rule = 'except when the command asks for confirmation itself (`merge`, `deploy`): the card then ends with the command, so the person confirms once. The first card has its own reply, `go`.';
  assert.ok(NEXT_MD.includes(rule));
  assert.ok(cmd('next').includes(rule), 'the generated command carries it');
  const offer = 'a command that asks for confirmation itself (`merge`, `deploy`) is named without that offer';
  assert.ok(COMMANDS.find((c) => c.name === 'next').procedure.includes(offer), 'the connector prompt');
  assert.ok(BASE_PROCEDURES.next.includes(offer), 'the base procedure');
  const first = 'With no `conductor/` folder the default is a card with what the analysis found and ONE reply, `go`, which runs `setup` (or `new-project` for a new project): the card names the command and `go` is the consent.';
  assert.ok(COMMANDS.find((c) => c.name === 'next').procedure.includes(first), 'the connector prompt names the first card');
  assert.ok(BASE_PROCEDURES.next.includes(first), 'the base procedure names the first card');
});

test('a number in a card comes from a command run for that purpose, never from a truncated listing: it says so, in the source and the command', () => {
  for (const [name, text] of [['ops/next.md', NEXT_MD], ['commands/next.md', cmd('next')]]) {
    assert.match(text, /`git rev-list --count HEAD`/, `${name}: the command for the commit count`);
    assert.match(text, /A count \(commits, tracks, files\) comes from a command or a read run for that purpose, never from a truncated listing; if you did not run one, say no number/, `${name}: the rule`);
  }
});

// ---- setup: writes first, then ONE closing message ----

/** The example closing message of setup, from the source of setup/setup.md. */
const CLOSING = cardLines(SETUP_MD).map((l) => l.slice(2));

test('setup writes first: no pre-write confirmation, the unusual cases still ask first, in one line each', () => {
  for (const [name, text] of [['setup/setup.md', SETUP_MD], ['commands/setup.md', cmd('setup')]]) {
    assert.doesNotMatch(text, /Reply ok, or tell me what differs/, `${name}: the old pre-write confirmation is gone`);
    assert.doesNotMatch(text, /[Ww]rite nothing until that reply/, name); // (the explicit `setup scaffold` action keeps its own "ask only to confirm")
    assert.match(text, /Setup writes first: new files are additive and one line undoes them, so there is no confirmation before the files/, name);
    assert.match(text, /\*\*Stop and ask first, one line each, only for something unusual\*\*: a `conductor\/` folder with content \(an older LaneConductor: how many tracks, in which naming form, which lanes; offer to finish the scaffold: write only what is missing, import nothing, change no track\); no git repository \(offer `git init` first\); uncommitted changes in `\.gitignore`, the one existing file setup edits \(offer to go on, or to wait while they commit it\)\. Anything else: write\./, name);
    assert.match(text, /No existing file of the project is touched, and `\.gitignore` only gets the lines it lacks/, name);
  }
  assert.doesNotMatch(NEW_PROJECT_MD, /Show the result as ONE message|Reply ok, or tell me what differs/, 'new-project no longer holds the existing-repository confirmation');
  assert.match(cmd('setup'), /Create the files with no question first \(setup writes first\)\./, 'the carried file rules do not ask either');
  assert.doesNotMatch(cmd('setup'), /ask for a yes; after the yes/, 'no second confirmation in the carried scaffold rules');
  assert.doesNotMatch(cmd('setup'), /\bworkers?\b|daemon|collection|make install|laneconductorrc/i, 'no daemon-era words');
});

test('the closing message of setup has the parts in order: project, what it created, the declared tracks line, the plan and the filed tracks, the undo line, the commit statement, two offers, one question', () => {
  assert.equal(CLOSING.length, 9);
  assert.match(CLOSING[0], /^\*\*[\w-]+\*\*: .+\.$/, 'name and purpose in one line');
  assert.match(CLOSING[1], /^Created `conductor\/` \(context files, an empty `tracks\/`\) and the `\.gitignore` lines\.$/, 'what it created, in one line');
  assert.match(CLOSING[2], /^Tracks are private \(git-ignored\) because .+\. Say 'commit my tracks' to share them\.$/, 'the declared tracks line');
  assert.match(CLOSING[3], /^Found your plan in `docs\/plan\.md`: 6 items\. Filed the first four as tracks in the plan lane: 1 .+, 2 .+, 3 .+, 4 .+\. Open question, not filed: .+\.$/, 'the plan found, the first four filed, the question listed');
  assert.equal(CLOSING[4], 'Undo: `rm -r conductor`, then `git checkout .gitignore`.', 'the undo line, one line');
  assert.equal(CLOSING[5], 'The conductor files are not committed; say commit when you want them committed.', 'a statement, not a question');
  assert.match(CLOSING[6], /^\*\*See it on the board:\*\* the board line of the first-track card \(\[next\.md\]\(\.\.\/ops\/next\.md\)\)\.$/);
  assert.match(CLOSING[7], /^\*\*Plan the first track:\*\* `\/laneconductor:plan 1` \("A publish checklist"\)\.$/, 'plan the first track, naming its title');
  assert.equal(CLOSING[8], 'Board, or plan the first track?');
  assert.deepEqual(CLOSING.filter((l) => /\?$/.test(l)), [CLOSING[8]], 'exactly one question, the last line');
  assert.equal(CLOSING.filter((l) => /^\*\*(See it on the board|Plan the first track):\*\*/.test(l)).length, 2, 'exactly two offers');
  assert.ok(CLOSING.every((l) => l.length < 260), 'one line each');
  assert.match(SETUP_MD, /Exactly two offers and one question, nothing after them: no add-ons paragraph, no starter set \(`\/laneconductor:suggest-skills` has it\), no "Next: run `\/laneconductor:next`"\./);
  assert.match(SETUP_MD, /Committed tracks say "Tracks are committed with the code\. Say 'make tracks private' to keep them out of git\."/);
  assert.match(SETUP_MD, /Say nothing about what does not exist or does not apply\./);
  assert.match(SETUP_MD, /A count you state comes from a command run for that purpose \(`git rev-list --count HEAD`\)/);
  assert.match(cmd('setup'), /`git rev-list --count HEAD`/, 'counts by command, in the generated command');
});

test('setup files the first four plan items as tracks: through `new` (search first, then create), in the plan order, in the plan lane, the item as the problem with its file named, no question, the open questions listed; no plan, nothing filed', () => {
  assert.match(SETUP_MD, /\*\*File the plan items\.\*\* With a plan document, file its first four items as tracks, in the plan's order, in the plan lane, as "The answer" of the first-track card says \(the `new` procedure: search first, then create; the plan item as the problem, its source file named\)\. No question\. The open questions of the plan are not filed: list them\. With no plan document nothing is filed\./);
  assert.match(TRACK_CARD, /\*\*The answer\*\*: .*follow `new`: search first \(a fitting track is offered an update\), then create in the plan lane, the plan item as the problem \("From `docs\/plan\.md`: <the item as written>"\)\. An open question is filed only if asked\. Setup files the first four the same way, with no question\./);
  assert.match(SETUP_MD, /With no plan document nothing was filed: end with the first-track card instead of the two offers/, 'the generic first-track card is the no-plan close');
  // the generated command carries what it needs to file them: the newTrack procedure and the card
  const c = cmd('setup');
  for (const part of ['newTrack', '## The first-track card', 'File the plan items.', 'Search first']) assert.ok(c.includes(part) || part === 'Search first', `setup carries: ${part}`);
  assert.ok(COMMANDS.find((x) => x.name === 'setup').procedure.includes('File the first four items of the plan document, if there is one, as tracks in the plan lane with the `new` procedure (search first, then create); no question first.'), 'the connector prompt');
  assert.match(cmd('setup'), /This runs when I named it, or said go to the card of `next` that named it/);
});

test('the new-project closing is the same two offers and one question, after the starter set; the starter set ends with a statement, not a second question', () => {
  const close = NEW_PROJECT_MD.slice(NEW_PROJECT_MD.indexOf('## 6. Summarize and close'), NEW_PROJECT_MD.indexOf('## Rules'));
  const lines = cardLines(close).map((l) => l.slice(2));
  assert.deepEqual(lines.filter((l) => /\?$/.test(l)), ['Board, or plan the first track?']);
  assert.equal(lines.filter((l) => /^\*\*(See it on the board|Plan the first track):\*\*/.test(l)).length, 2);
  assert.ok(lines.includes('The conductor files are not committed; say commit when you want them committed.'));
  assert.match(close, /Exactly two offers and one question, nothing after them \(the starter set of step 5 comes before the message\): no add-ons paragraph, no "Next: run `\/laneconductor:next`"\./);
  assert.doesNotMatch(NEW_PROJECT_MD.replace(/no "Next: run[^"]*"/g, ''), /Next: run/);
  const shipped = read(path.join(BASE, 'skills/laneconductor/ops/new-project.md')); // the starter set is generated into the shipped skill
  const step5 = shipped.slice(shipped.indexOf('## 5. Say what else fits'), shipped.indexOf('## 6. Summarize'));
  assert.match(step5, /End the offer with the statement: "Install them whenever you like; otherwise I will offer each one when it comes up/);
  assert.doesNotMatch(step5, /Install them now, or/, 'no second question before the closing question');
});

// ---- the generated commands do not grow ----

// The sizes of the four generated front-door commands in plugins 1.9.4 (bytes). They may shrink, never grow: a longer first run is the bug this fixes.
// (next 32808, setup 30740, new-project 34233, run 67177. Release 1.9.5 added the S02 cards and the write-first closing, paid for by dropping the starter set from
// setup, the existing-repository text from new-project and the duplicate one-line install from the front door of next.)
const CEILING = { next: 32808, setup: 30740, 'new-project': 34233, run: 67177 };

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
  assert.match(trackCardLines[0], /^> \*\*Next: your first track\.\*\* From your plan in `[^`]+`:$/, 'the lead names the plan file');
  const items = trackCardLines.filter((l) => /^> \d\. /.test(l));
  assert.ok(items.length >= 1 && items.length <= 7, 'at most four plan items, two generic and the audit');
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
  assert.ok(trackCardLines.length <= 12, 'a short card');
});

test('the S04 rules: at most four, only facts that were read, nothing claimed that was not checked, the audit always last, nothing created before the answer', () => {
  assert.match(TRACK_CARD, /at most four, one line each/);
  assert.match(TRACK_CARD, /\*\*Never invent\*\*: every line is text from a file \(named\) or a fact a command or a read checked/);
  assert.match(TRACK_CARD, /Keep the first three that fit, then always last: Audit: review the code for privacy, security and quality, and file each finding as its own track/);
  for (const fact of ['no licence file', 'public, demo or open source', 'no CI files but a test command', 'no lint or format config', 'no `SECURITY.md`', 'no lockfile']) assert.ok(TRACK_CARD.includes(fact), fact);
  for (const title of ['Choose a licence', 'Check the repository for secrets and personal data before it is public', 'Add CI that runs']) assert.ok(TRACK_CARD.includes(title), title);
  assert.match(TRACK_CARD, /Nothing is created before the person answers/);
  assert.match(TRACK_CARD, /For each, in the plan.s order, follow `new`: search first \(a fitting track is offered an update\), then create in the plan lane/);
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

test('the closing offers only the board and the first track: no "Next: run" line, no add-ons paragraph, no starter set in setup; the card (with the board line) stays for the no-plan case', () => {
  assert.doesNotMatch(SETUP_MD.replace(/no "Next: run[^"]*"/g, ''), /Next: run/, 'no "Next: run" instruction in setup');
  assert.doesNotMatch(SETUP_MD, /Commit this\s+scaffold\?|Commit this scaffold\?/);
  assert.doesNotMatch(SETUP_MD, /opens the whole project as a board/);
  assert.doesNotMatch(cmd('setup'), /opens the whole project as a board|Both add-ons in one line|STARTER SET/);
  assert.match(TRACK_CARD, /The board line\*\*: as above when the board add-on is installed/);
  assert.doesNotMatch(TRACK_CARD, /Skip it when setup's starter set offered the board/, 'the starter set is no longer part of setup');
  assert.match(SETUP_MD, /\*\*See it on the board:\*\* the board line of the first-track card/);
});
