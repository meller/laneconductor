// Suggestions that come from the project itself (owner feedback from a real first run, 2026-11-19). The four first suggestions (licence, secrets, CI,
// audit) were generic; the useful list appeared only when the owner asked about the project and the model read its own docs/plan.md. So now the
// first-track card (state S04, and the close of setup and new-project) leads with the project's own plan, in its own order and words, names the file,
// shows at most four and "N more in <file>", shows its open decisions as questions, and only then at most two generic items and the audit last. A
// project with no plan gets the generic list; nothing is invented. Later on (S20: nothing is ready) `next` offers the plan items that have no track yet.
// An empty folder goes to new-project (a brainstorm), and the freshness line of next no longer warns about a repository with no upstream.
// The Markdown an agent follows is the behaviour, so most of these tests pin its text; the two reading rules are also code (planItems, planCoverage).
// HUMAN, not covered here: that a real client follows the card (checked by running the client headlessly, see the track conversation).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, RELS } from '../../scripts/build-plugin.mjs';
import { classifyFacts, gatherFacts, planCoverage, planItems, PLAN_FILES } from '../src/next.mjs';
import { attentionReasons, computeFreshness, provenanceLine } from '../src/provenance.mjs';
import { INSTRUCTIONS_LIMIT } from '../src/instructions.mjs';

const SRC = path.join(REPO, '.claude/skills/laneconductor');
const BASE = path.join(REPO, RELS.base);
const read = (p) => fs.readFileSync(p, 'utf8');
const NEXT_MD = read(path.join(SRC, 'ops/next.md'));
const NEW_PROJECT_MD = read(path.join(SRC, 'ops/new-project.md'));
const SETUP_MD = read(path.join(SRC, 'setup/setup.md'));
const cmd = (n) => read(path.join(BASE, `commands/${n}.md`));
const section = (text, heading) => {
  const at = text.indexOf(`\n## ${heading}\n`);
  assert.ok(at >= 0, `section ${heading}`);
  const rest = text.slice(at + 1);
  const end = rest.indexOf('\n## ', 3);
  return end < 0 ? rest : rest.slice(0, end);
};
const CARD = section(NEXT_MD, 'The first-track card');
const STILL = section(NEXT_MD, 'What is still in the plan');
const cardLines = CARD.split('\n').filter((l) => l.startsWith('> '));

const cleanup = [];
after(() => { for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true }); });
const tmpRepo = (files = {}, { commit = true } = {}) => {
  const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-plan-'));
  cleanup.push(d);
  execFileSync('git', ['init', '-q', '-b', 'main', d]);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
    fs.writeFileSync(path.join(d, rel), content);
  }
  if (commit && Object.keys(files).length) {
    execFileSync('git', ['-C', d, 'add', '-A']);
    execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'init']);
  }
  return d;
};

/** A plan with six items and one open decision, the shape of the fixture project of the headless run. */
const PLAN = `# Plan

## Done
- [x] The first tool works

## What is still missing
- [ ] **Publish checklist**: licence, README, tags
- [ ] An /openapi.json door
- [ ] A /prompt paste pack
- [ ] Plugin packaging
- [x] A thing already finished
- [ ] A compatibility matrix
- [ ] A short demo video

## Open decisions
- Should there be browse-only dry-run variants?
`;

// ---- the reading rules, as code ----

test('planItems: the unticked checkboxes in the plan\'s own order, the ticked and done ones left out, the open decision a question and not an item', () => {
  const { items, questions } = planItems(PLAN);
  assert.deepEqual(items, ['Publish checklist: licence, README, tags', 'An /openapi.json door', 'A /prompt paste pack', 'Plugin packaging', 'A compatibility matrix', 'A short demo video']);
  assert.equal(items.length, 6, 'the count the confirmation names');
  assert.deepEqual(questions, ['Should there be browse-only dry-run variants?']);
  assert.ok(items.every((i) => i.length <= 100), 'one line each');
});

test('planItems: without checkboxes it takes the bullets, then the ### headings; a plan with nothing yields no item (nothing is invented)', () => {
  assert.deepEqual(planItems('# Roadmap\n\n## Next\n\n- Alpha thing\n- Beta thing\n1. Gamma thing\n').items, ['Alpha thing', 'Beta thing', 'Gamma thing']);
  assert.deepEqual(planItems('# Roadmap\n\n### Alpha thing\ntext\n\n### Beta thing\ntext\n\n### Shipped already\ntext\n').items, ['Alpha thing', 'Beta thing']);
  assert.deepEqual(planItems('# Notes\n\nJust prose, no list.\n'), { items: [], questions: [] });
  assert.deepEqual(planItems(''), { items: [], questions: [] });
  assert.deepEqual(planItems(null), { items: [], questions: [] });
  assert.deepEqual(planItems('## Done\n- Old thing\n- ~~Struck~~\n## Next\n- New thing\n- Quiet thing, done\n').items, ['New thing']);
  assert.deepEqual(PLAN_FILES, ['docs/plan.md', 'PLAN.md', 'ROADMAP.md', 'TODO.md']);
});

test('planCoverage: an item that is in a track is `has`, a half match is `maybe` ("may already be a track"), the rest `none`; conservative', () => {
  const tracks = [{ title: 'Prompt paste pack for the connector', problem: 'A paste pack so a person can start in a client.' }, { title: 'Marketplace packaging', problem: 'Package the plugin for the marketplace listing.' }];
  assert.equal(planCoverage('A /prompt paste pack', tracks), 'has');
  assert.equal(planCoverage('Plugin packaging for the marketplace', tracks), 'has', 'every word of the item is in a track');
  assert.equal(planCoverage('Plugin packaging for the store', tracks), 'maybe', 'part of the words, or all of a short title: shown, not dropped');
  assert.equal(planCoverage('Packaging', [{ title: 'Packaging the whole release process', problem: 'x' }]), 'has');
  assert.equal(planCoverage('Packaging the plugins for a store listing', [{ title: 'Packaging', problem: '' }]), 'maybe', 'a short title inside a longer item is never enough to drop it');
  assert.equal(planCoverage('A compatibility matrix', tracks), 'none');
  assert.equal(planCoverage('An /openapi.json door', []), 'none');
  assert.equal(planCoverage('', tracks), 'none', 'an item with no word of four letters is never matched');
});

// ---- the first-track card leads with the plan ----

test('the S04 card leads with the plan items, names the source file, caps at four with "N more in <file>", and shows the open question after them', () => {
  assert.match(cardLines[0], /^> \*\*Next: your first track\.\*\* From your plan in `docs\/plan\.md`:$/, 'the lead names the source file');
  const items = cardLines.filter((l) => /^> \d\. /.test(l));
  const plan = items.slice(0, 4);
  assert.equal(plan.length, 4, 'four plan items are shown');
  assert.ok(cardLines.some((l) => /^> 2 more in `docs\/plan\.md`\./.test(l)), 'then "N more in <file>"');
  const more = cardLines.find((l) => /more in `docs\/plan\.md`/.test(l));
  assert.match(more, /Open question there: .+\? \(not filed\)$/, 'an open decision is shown as a question, never as a track');
  assert.ok(cardLines.indexOf(more) > cardLines.indexOf(cardLines.find((l) => l.startsWith('> 4. '))), 'after the items');
  assert.match(CARD, /at most four items, "N more in `<file>`", at most two open questions/);
  assert.match(CARD, /\*\*The plan\*\* \(read only, one look; setup's reading counts\): `docs\/plan\.md`, `PLAN\.md`, `ROADMAP\.md`, `TODO\.md`, `docs\/roadmap\*\.md`, and README sections on the roadmap, next steps, status, todo or what is missing/);
  assert.match(CARD, /in the file's order and words, cut to one line/);
  assert.match(CARD, /A decision or question still open .* is an open question, not an item/);
});

test('the generic items come after the plan items, only when the plan does not say them, at most two, and the audit is always last', () => {
  assert.match(CARD, /then, only for what the plan does not say, at most two generic suggestions, the audit last/);
  const items = cardLines.filter((l) => /^> \d\. /.test(l));
  const generic = items.slice(4);
  assert.ok(generic.length >= 1 && generic.length <= 3, 'at most two generic items and the audit');
  assert.match(generic[0], /Choose a licence/);
  assert.match(generic[generic.length - 1], /^> \d\. Audit: review the code for privacy, security and quality, and file each finding as its own track$/);
  assert.ok(cardLines.findIndex((l) => l.includes('/laneconductor:board')) > cardLines.indexOf(cardLines.find((l) => /Audit:/.test(l))), 'the board line after the suggestions');
  assert.ok(cardLines.every((l) => l.length < 160), 'one line each');
});

test('a project with no plan gets today\'s generic list; nothing is invented', () => {
  assert.match(CARD, /\*\*Without a plan\*\*, only generic suggestions, at most four, one line each/);
  for (const fact of ['no licence file', 'public, demo or open source', 'no CI files but a test command', 'no lint or format config', 'no `SECURITY.md`', 'no lockfile']) assert.ok(CARD.includes(fact), fact);
  assert.match(CARD, /Keep the first three that fit, then always last: Audit/);
  assert.match(CARD, /\*\*Never invent\*\*: every line is text from a file \(named\) or a fact a command or a read checked/);
  // the reading rule gives nothing for a folder without a plan: no plan means no plan item
  assert.deepEqual(planItems(undefined).items, []);
});

test('"file all N" and numbers: the existing `new` procedure (search first), in the plan\'s order, in the plan lane, the plan item as the problem with its source named; nothing before the answer', () => {
  assert.match(CARD, /Nothing is created before the person answers/);
  assert.match(CARD, /\*\*The answer\*\*: numbers, "all N" \(every plan item, the hidden ones too\) or a title\./);
  assert.match(CARD, /For each, in the plan's order, follow `new`: search first \(a fitting track is offered an update\), then create in the plan lane, the plan item as the problem \("From `docs\/plan\.md`: <the item as written>"\)/);
  assert.match(CARD, /An open question is filed only if asked/);
  assert.match(cardLines[cardLines.length - 1], /^> Reply with numbers, "all 6 plan items", or tell me a title of your own\.$/);
  assert.match(CARD, /<!-- generated: add-ons one-line install -->/, 'the board line and its install line are still there');
});

test('one text: next, setup and new-project carry the same card, and the shipped copies lead with the plan too', () => {
  for (const n of ['next', 'setup', 'new-project']) assert.ok(cmd(n).includes('From your plan in `docs/plan.md`:'), n);
  assert.match(SETUP_MD, /it leads with the plan found in step 1 and holds the board line/);
  assert.match(NEW_PROJECT_MD, /The plan documents \("The first-track card" in \[next\.md\]\(next\.md\) says which\): one line, "Found your plan in `docs\/plan\.md`: 6 items"/);
  assert.match(NEW_PROJECT_MD, /nothing when there is none/);
});

// ---- setup's reading step says what it found ----

test('setup says in one line what plan it found, and nothing when there is none; the confirmation stays within about twelve lines', () => {
  const form = NEW_PROJECT_MD.slice(NEW_PROJECT_MD.indexOf('Show the result as ONE message'), NEW_PROJECT_MD.indexOf('Do not add the walking-skeleton'));
  const lines = form.split('\n').filter((l) => l.startsWith('> ')).map((l) => l.slice(2));
  assert.ok(lines.includes('Found your plan in `docs/plan.md`: 6 items.'));
  assert.ok(lines.length <= 12 - 3, `${lines.length} example lines leave room for the unusual ones`);
  assert.match(form, /ONE message in this form, at most twelve lines/);
  assert.match(SETUP_MD, /the plan documents \(one line, if any\)/);
  for (const n of ['setup', 'new-project']) assert.match(cmd(n), /Found your plan in `docs\/plan\.md`: 6 items/, n);
});

// ---- later on: nothing is ready ----

test('later on, S20 offers the plan items that have no track yet, as the same card, conservatively, text first', () => {
  const row = NEXT_MD.split('\n').find((l) => l.startsWith('| S20 |'));
  assert.match(row, /First "What is still in the plan" below: the plan's items that have no track/);
  assert.match(row, /None left: offer `new`, `board` to look at the whole project, `status` for the list/);
  assert.match(STILL, /In S20, before the offer to create a track: look for the plan as above and drop the items that already have a track/);
  assert.match(STILL, /all the item's words in one track: it has a track, leave it out; at least half of them, or all of a title's words in the item: show it ending "\(may already be a track\)"/);
  assert.match(STILL, /"\*\*Next: what is still in your plan\.\*\*", with no generic suggestions and no audit\. None left, or no plan: the S20 offer\./);
  assert.ok(cmd('next').includes('## What is still in the plan'), 'the generated command carries the procedure: no connector needed');
  assert.doesNotMatch(STILL, /list_tracks|get_track|mcp__/, 'works with no connector');
  // the same state ids: no new state was needed
  assert.equal(NEXT_MD.split('\n').filter((l) => /^\| S\d\d /.test(l)).length, 23);
});

// ---- an empty folder goes to the new-project workflow ----

test('an empty git repository is S02 with new-project as the command (the classifier and the board), and the texts say so', async () => {
  const dir = tmpRepo({}, { commit: false });
  const facts = await gatherFacts(dir);
  const r = classifyFacts(facts);
  assert.equal(r.state, 'S02');
  assert.equal(r.command, '/laneconductor:new-project');
  assert.equal(r.default, 'new');
  const readme = classifyFacts(await gatherFacts(tmpRepo({ 'README.md': '# x\n' })));
  assert.equal(readme.command, '/laneconductor:setup', 'a folder with files and history is the existing-project path in the classifier; the text sends one with no code and no plan to new-project');
  assert.match(NEXT_MD, /an empty or nearly empty folder \(no code, no plan document\) defaults to \(b\)/);
  const first = section(NEXT_MD, 'The first card');
  assert.match(first, /In an empty or nearly empty folder \(no code, no plan document; a README or licence alone does not count\) it is a new project: line 1 is "\*\*Next: start a new project\.\*\* `\/laneconductor:new-project`" and line 2 "A short brainstorm about the idea, then the scaffold, first tracks and suggested skills\."/);
  assert.match(NEXT_MD, /\| S02 \| A repository \(or any folder, even an empty one\) with no `conductor\/` folder \|/);
  assert.match(SETUP_MD, /A folder with no code and no plan document \(empty, or only a README or licence\) is a new project: say in one line that `\/laneconductor:new-project` is the command for it \(a brainstorm, the scaffold, first tracks, suggested skills\) and stop/);
  assert.match(NEW_PROJECT_MD, /Empty or nearly empty folder \(no code and no plan document; a README, licence or `\.gitignore` alone does not count\): a new project: `\/laneconductor:new-project` is the command for it, not `setup`/);
  assert.match(cmd('setup'), /new-project` is the command for it/);
});

test('the new-project interview is a brainstorm: options and decisions are explored before a file is written, and it ends with the same card and one question', () => {
  const interview = section(NEW_PROJECT_MD, '2. Interview');
  assert.match(interview, /This is a brainstorm, in the style of \[\.\.\/lanes\/brainstorm\.md\]/);
  assert.match(interview, /Explore before you decide: for a choice that shapes the project \(the stack, the data, hosting, authentication\) give two or three options with the trade-off in a line and a recommendation, and let the person choose\./);
  assert.match(interview, /Write no file until the interview is done and they say to scaffold/);
  const close = section(NEW_PROJECT_MD, '6. Summarize and close');
  assert.match(close, /end with the first-track card \(\[next\.md\]\(next\.md\), "The first-track card": written once, shared with `next` and `setup`\)/);
  assert.match(close, /for a new project the plan is the interview: item 1 is planning its walking skeleton \(`\/laneconductor:plan` with its number\), then the key features the person named, in their words, from `conductor\/product\.md`/);
  assert.match(close, /and no other question: the track choice is the one question/);
  assert.match(NEW_PROJECT_MD, /## 5\. Say what else fits this project\n\n<!-- generated: recommended plugins -->/, 'the starter set of suggested skills is part of the workflow');
  assert.ok(cmd('new-project').includes('offer a STARTER SET'), 'and in the generated command');
  assert.ok(cmd('new-project').includes('From your plan in `docs/plan.md`:'), 'with the card');
});

// ---- freshness noise ----

test('a repository with no upstream, or a rebuilt summary, is not a stale line in next: the text, the line the connector composes, the instructions', () => {
  assert.match(NEXT_MD, /Say so in one line before the card only when its reasons need the person: `behind_upstream`, `unpushed_local_commits`, `dirty_state_files`, a stale claim\. No upstream \(`no_upstream`\) or a rebuilt summary \(`track_summary_regenerated`\) is normal: no line\./);
  assert.ok(cmd('next').includes('is normal: no line.'));
  const local = { backend: 'local', dirtyPaths: [], upstream: null, now: Date.now() };
  const f = computeFreshness(local);
  assert.deepEqual(f.stale_reasons, ['no_upstream'], 'the structured field keeps saying it');
  const p = { backend: 'local', repo: '/x', branch: 'main', commit: 'abcdef1234', dirty_paths: [], upstream: null, ...f };
  assert.deepEqual(attentionReasons(p), []);
  assert.doesNotMatch(provenanceLine(p, Date.now()), /Freshness/, 'the line says "no upstream" as a fact and no longer "Freshness: possibly_stale"');
  assert.match(provenanceLine(p, Date.now()), /no upstream\./);
  const rebuilt = { ...p, stale_reasons: ['no_upstream', 'track_summary_regenerated'] };
  assert.deepEqual(attentionReasons(rebuilt), []);
  assert.doesNotMatch(provenanceLine(rebuilt, Date.now()), /Freshness/);
  // the reasons that matter still make a line
  for (const reason of ['unpushed_local_commits', 'dirty_state_files', 'behind_upstream']) {
    const q = { ...p, freshness: 'possibly_stale', stale_reasons: ['no_upstream', reason] };
    assert.deepEqual(attentionReasons(q), [reason]);
    assert.match(provenanceLine(q, Date.now()), new RegExp(`Freshness: possibly_stale \\(no_upstream, ${reason}\\)`));
  }
  const dirty = computeFreshness({ ...local, dirtyPaths: ['conductor/tracks/x/index.md'] });
  assert.ok(attentionReasons({ stale_reasons: dirty.stale_reasons }).includes('dirty_state_files'));
  assert.match(fs.readFileSync(path.join(REPO, 'connector/src/instructions.mjs'), 'utf8'), /no upstream and a rebuilt summary are normal and need no word/);
  assert.ok(INSTRUCTIONS_LIMIT >= 4096);
});

// ---- the size ceilings: next, setup, new-project and run must not grow ----

test('the generated next, setup, new-project and run commands are no bigger than before this change (bytes)', () => {
  const BEFORE = { next: 32827, setup: 30790, 'new-project': 35416, run: 67201 };
  for (const [n, max] of Object.entries(BEFORE)) assert.ok(Buffer.byteLength(cmd(n), 'utf8') <= max, `${n}: ${Buffer.byteLength(cmd(n), 'utf8')} > ${max}`);
});
