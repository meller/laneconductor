// Track AM-10124 (skill advisor), Phases 3 to 5: the offer, as text. The base plugin is Markdown, so the behaviour is in the words it ships;
// these checks read the generated plugin (plugins/laneconductor) and the source skill. TC-4 to TC-10 (the experience), TC-13 (the add-ons
// are ordinary entries), TC-14 (every lane), the detection fix (the implement lane and `new` looked only in .claude/skills), the command,
// the tip in `next`, the size of the carried text, and the disclosure (REQ-7). TC-11 and TC-12 (the starter set) are in
// setup-recommend.test.mjs, TC-18 to TC-20 in skill-advisor-track.test.mjs.
//
// Carried text is kept small (the directory plugin loads a command's whole text on every use): a lane command carries ONE short offer rule
// (SHORT_RULE) and one line per candidate; the long procedure (OFFER_RULES) and the whole catalog live only in suggest-skills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, RELS, NAMES, RECOMMENDED, ADDONS, installsNote } from '../../scripts/build-plugin.mjs';
import { OFFER_RULES, SHORT_RULE, DECLINED_FILE, DECLINED_KEY, entryLine, laneOfferBlock, typeOfferBlock, skillsCatalogBlock, skillAdvisorReadmeBlock, skillTipsBlock } from '../../scripts/plugin-texts.mjs';
import { COMMANDS, GROUPS, helpText } from '../src/commands.mjs';

const BASE = path.join(REPO, RELS.base);
const read = (rel) => fs.readFileSync(path.join(BASE, rel), 'utf8');
const skillFile = (rel) => read(`skills/laneconductor/${rel}`);
const src = (rel) => fs.readFileSync(path.join(REPO, '.claude/skills/laneconductor', rel), 'utf8');
const LANE_FILES = { brainstorm: 'lanes/brainstorm.md', plan: 'lanes/plan.md', implement: 'lanes/implement.md', review: 'lanes/review.md', 'quality-gate': 'lanes/quality-gate.md', merge: 'lanes/merge.md', deploy: 'deploy/deploy.md' };
const blockOf = (text, lane) => text.slice(text.indexOf(`Candidates for the \`${lane}\` lane`));
const has = (text, ...names) => names.forEach((n) => assert.ok(text.includes(n), `names ${n}`));
// A lane guide lists the stack skill packs as one line that names each (`name` (stack ...)), so a pack is found on that line too.
const lineOf = (text, name) => text.split('\n').find((l) => l.includes('`claude plugin ') && (l.startsWith(`- \`${name}\``) || (l.startsWith('- `laneconductor-') && l.includes(`\`${name}\` (stack `))));
const cmds = (e) => e.install.map((c) => `\`${c}\``).join(', ');

test('the command: suggest-skills is in the catalog, in the first group next to next, with the plain description and the example phrase; the base ships it with its whole procedure', () => {
  const cmd = COMMANDS.find((c) => c.name === 'suggest-skills');
  assert.ok(cmd);
  assert.equal(cmd.group, 'start here');
  assert.equal(GROUPS[0], 'start here');
  const names = COMMANDS.filter((c) => c.group === 'start here').map((c) => c.name);
  assert.deepEqual(names.slice(0, 2), ['next', 'suggest-skills'], 'next to next');
  assert.equal(cmd.description, 'What could help with this track: skills you already have that apply, and ones worth installing');
  assert.equal(cmd.example, 'what skills help with this track');
  assert.equal(cmd.readOnly, true);
  assert.match(helpText(), /- suggest-skills \[all \| dry-run \| lane\]: What could help with this track.*Example: "what skills help with this track"/);
  const text = read('commands/suggest-skills.md');
  assert.match(text, /This command carries its whole procedure below/);
  assert.match(text, /\*\*How to offer\.\*\*/);
  assert.ok(text.includes('### The entries (checked'));
  assert.ok(!/\bskill-finder\b/.test(JSON.stringify(COMMANDS) + text), 'the command is not called skill-finder, and no third-party tool is');
  assert.ok(fs.existsSync(path.join(REPO, '.claude/skills/laneconductor/ops/suggest-skills.md')));
  assert.ok(!fs.existsSync(path.join(REPO, '.claude/skills/laneconductor/ops/skills.md')) && !fs.existsSync(path.join(REPO, '.claude/skills/laneconductor/ops/skill-finder.md')));
  assert.match(src('SKILL.md'), /\| `suggest-skills` \| \[ops\/suggest-skills\.md\]/);
});

test('size: a lane command carries one short rule (at most 12 lines) and one line per candidate; the long procedure lives only in suggest-skills', () => {
  assert.ok(SHORT_RULE.split('\n').length <= 12, `${SHORT_RULE.split('\n').length} lines`);
  assert.ok(SHORT_RULE.length < 1500, `${SHORT_RULE.length} characters`);
  assert.ok(OFFER_RULES.length > SHORT_RULE.length * 1.5, 'the long procedure is the long one');
  for (const [lane, rel] of Object.entries(LANE_FILES)) {
    const text = skillFile(rel);
    assert.equal(text.split(SHORT_RULE).length - 1, 1, `${lane}: the short rule once`);
    assert.ok(!text.includes('**How to offer.**') && !text.includes('1. **Look first.**'), `${lane}: not the long procedure`);
    assert.ok(!text.includes('#### `') && !/#### /.test(blockOf(text, lane)), `${lane}: no per-entry heading blocks`);
    const list = blockOf(text, lane);
    assert.ok(!/```bash/.test(list.slice(0, list.indexOf('## Skills that help here') > 0 ? list.indexOf('## Skills that help here') : undefined)) || lane === 'deploy', `${lane}: no per-entry bash fences`);
    for (const l of list.split('\n').filter((x) => x.startsWith('- `'))) assert.ok(l.length < 560, `${lane}: one short line per entry (${l.length}): ${l.slice(0, 40)}`);
  }
  // the lane commands: the generated guide is the carried text, and `run` carries the rule once for its five guides
  const run = read('commands/run.md');
  assert.equal(run.split(SHORT_RULE).length - 1, 1, 'run: the short rule once');
  assert.ok(run.includes('**Offer rule**: as in the first lane guide above.'));
  for (const lane of ['plan', 'implement', 'review', 'quality-gate', 'merge']) assert.ok(run.includes(`Candidates for the \`${lane}\` lane`), `run: the ${lane} candidates`);
  // track AM-10147 Phase 5 added the owner-step text to the implement and quality-gate guides (+14 lines in run); the lines bound moved from 850 to 875, the bytes bound stays
  assert.ok(Buffer.byteLength(run) < 66 * 1024 && run.split('\n').length < 875, `run is ${Buffer.byteLength(run)} bytes, ${run.split('\n').length} lines`);
  // new-project is no lane: it carries no skill offer of the brainstorm guide or of newTrack
  const np = read('commands/new-project.md');
  assert.ok(!np.includes('## Offer a missing skill') && !np.includes('Candidates for the `brainstorm` lane') && !np.includes('Candidates for these Types'));
  assert.ok(!read('commands/next.md').includes(SHORT_RULE));
});

test('TC-4 plain text: one or two sentences, each command alone in its own bash block (no leading $), in-session alternative inline, no form', () => {
  assert.match(OFFER_RULES, /Plain text in your reply: never a form, a menu or a question that blocks the work/);
  assert.match(OFFER_RULES, /one or two plain sentences/);
  assert.match(OFFER_RULES, /each install command alone in its own bash block, one command per block, no leading `\$`/);
  assert.match(OFFER_RULES, /`\/plugin install <plugin>@<marketplace>` instead \(inline text, not a block\)/);
  assert.match(SHORT_RULE, /Plain text, never a form, never blocking/);
  assert.match(SHORT_RULE, /each install command alone in its own bash block, no leading `\$`/);
  for (const e of RECOMMENDED) {
    const line = entryLine(e);
    assert.ok(line.endsWith(cmds(e)), `${e.name}: the commands close its line, in inline code`);
    assert.ok(e.install.every((c) => !c.startsWith('$') && c.startsWith('claude plugin ')));
    assert.ok(!line.includes('```'), `${e.name}: no fence in a candidate line`);
  }
});

test('TC-5, TC-6 at the moment of intent: a prerequisite asks install-first-or-carry-on in one sentence, a helper is a one-line tip, the work is never blocked', () => {
  assert.match(OFFER_RULES, /`prerequisite`: say the result will be better with it and ask, in the same sentence, whether to install it first or carry on/);
  assert.match(OFFER_RULES, /`helps`: a one-line tip/);
  assert.match(OFFER_RULES, /Either way the work is not blocked: with no answer, carry on/);
  assert.match(SHORT_RULE, /`prerequisite`: ask, in the same sentence, whether to install first or carry on; otherwise a one-line tip\. No answer: carry on\./);
  for (const [lane, rel] of Object.entries(LANE_FILES)) assert.ok(skillFile(rel).includes(SHORT_RULE), `${lane}: the guide carries the short rule`);
  const level = (n) => RECOMMENDED.find((e) => e.name === n).level;
  assert.equal(level('frontend-design'), 'prerequisite');
  assert.equal(level('marketing-skills'), 'prerequisite');
  assert.equal(level('superpowers'), 'helps');
  assert.match(lineOf(skillFile('lanes/plan.md'), 'frontend-design'), /\(prerequisite; stack ui\)/, 'a prerequisite is marked on its line');
});

test('TC-7 install first, carry on, do not ask again: the three answers', () => {
  assert.match(OFFER_RULES, /\*Install first\*: show the commands, say nothing has been changed yet, say to run them and then `\/reload-plugins`, and when the person is back start the step again from the top with the skill present/);
  assert.match(OFFER_RULES, /\*Carry on\*: start the step at once and do not repeat the offer this session/);
  assert.equal(DECLINED_KEY, 'skills.declined');
  assert.equal(DECLINED_FILE, 'skill-advisor-declined.txt', 'the previous location, still read');
  // Phase 7: the client refuses writes inside the repository's hidden directory, so the list lives in the personal settings file; the old file is still read, never written.
  assert.match(OFFER_RULES, /\*Do not ask again\*: show the exact change \(`\.laneconductor\.json` and the new `skills\.declined` list\) and write it only after the yes: create the file with only that key if it is missing, keep every other key and valid JSON; first see that `\.gitignore` lists `\.laneconductor\.json`, adding the line only after asking, as the board procedure does\. On a failed write, skip it this session\./);
  assert.match(OFFER_RULES, /never an entry named in `skills\.declined` of `\.laneconductor\.json` \(the older `\.git\/skill-advisor-declined\.txt`, one name per line, is read too\)/);
  assert.match(SHORT_RULE, /never one in `skills\.declined` of `\.laneconductor\.json` \(or older `\.git\/skill-advisor-declined\.txt`\)/);
  assert.match(SHORT_RULE, /"Do not ask again": show the change; on a yes add it there \(`\.gitignore` first, asked\)/);
  assert.ok(!/git-common-dir/.test(OFFER_RULES + SHORT_RULE), 'the old lookup of the common directory is gone');
  assert.match(skillFile('ops/next.md'), /named in `skills\.declined` of `\.laneconductor\.json`/);
  assert.match(skillFile('ops/settings.md'), /\| `skills\.declined` \| a list of skill-catalog entry names \|/);
  assert.ok(skillFile('ops/suggest-skills.md').includes(OFFER_RULES));
});

test('TC-9 declined (Phase 7): the list is `skills.declined` in the personal settings file, listed in the settings table; no shipped text sends the write inside the repository hidden directory; the old file is only read', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(BASE).filter((x) => x.endsWith('.md'))) {
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(!/git-common-dir/.test(text), `${path.relative(BASE, f)} still looks up the common git directory`);
    for (const m of text.matchAll(/skill-advisor-declined\.txt/g)) assert.match(text.slice(Math.max(0, m.index - 30), m.index), /older `\.git\/$/, `${path.relative(BASE, f)} names the old file only as the older location`);
  }
  const settings = skillFile('ops/settings.md');
  assert.match(settings, /^\| `skills\.declined` \| a list of skill-catalog entry names \| none \|/m);
  assert.match(settings, /`skills\.declined` \(the person says "don't ask again"\) are written only after a yes to the exact change shown, with the `\.gitignore` line first, as for the board URL\. The older `\.git\/skill-advisor-declined\.txt` is still read/);
  const cmd = COMMANDS.find((c) => c.name === 'suggest-skills');
  assert.match(JSON.stringify(cmd), /`skills\.declined` in my git-ignored `\.laneconductor\.json`, only when I say so/);
  for (const lane of Object.keys(LANE_FILES)) assert.ok(skillFile(LANE_FILES[lane]).includes('skills.declined'), `${lane}: the guide carries the declined key`);
});

test('TC-8 quiet: nothing missing means no message, at most two items, never twice in a session, a trivial track gets one line', () => {
  assert.match(OFFER_RULES, /When nothing is missing, say nothing/);
  assert.match(OFFER_RULES, /At most two items per offer: our own entries before third-party ones, `prerequisite` before `helps`/);
  assert.match(OFFER_RULES, /Never the same entry twice in a session/);
  assert.match(OFFER_RULES, /A trivial track gets at most the one-line tip, and a suggestion in the middle of a step .* is one line/);
  assert.match(SHORT_RULE, /else say nothing\. At most two, ours first, never twice in a session/);
  const procedure = skillFile('ops/suggest-skills.md');
  assert.match(procedure, /dry-run`: the same as nothing, but a rehearsal: print the offer with its commands and change nothing, ask nothing and\s+write\s+nothing/);
});

test('TC-9 detection: the session skills list, `claude plugin list`, .claude/skills and ~/.claude/skills; an installed skill is named, not recommended; the old lookup is gone', () => {
  assert.match(OFFER_RULES, /it is in the skills list this session shows you \(that list already covers project, user and plugin skills/);
  assert.match(OFFER_RULES, /`claude plugin list` \(read only/);
  assert.match(OFFER_RULES, /`\.claude\/skills\/` of the project or in `~\/\.claude\/skills\/`/);
  assert.match(OFFER_RULES, /A skill listed under an older name counts too/);
  assert.match(OFFER_RULES, /you have `<skill>` installed, use it before writing the content/);
  assert.match(OFFER_RULES, /Offer only what is missing/);
  assert.match(SHORT_RULE, /a skill is installed when it is in the session's skills list, `claude plugin list` \(read only\), `\.claude\/skills\/` or `~\/\.claude\/skills\/`; an older name counts/);
  assert.match(SHORT_RULE, /you have `<skill>` installed, use it before writing the content/);
  for (const [label, text] of [['implement guide (source)', src('lanes/implement.md')], ['implement guide (shipped)', skillFile('lanes/implement.md')], ['ops/tracks.md (source)', src('ops/tracks.md')], ['ops/tracks.md (shipped)', skillFile('ops/tracks.md')]]) {
    assert.ok(!/not found in \.claude\/skills\//.test(text), `${label}: the project-folder-only message is gone`);
    assert.match(text, /you have\s+`<skill>` installed, use it before writing the content/, label);
    assert.match(text, /`claude plugin list`/, label);
    assert.match(text, /`~\/\.claude\/skills\/`/, label);
    assert.match(text, /an older\s+name counts/, label);
  }
  // an older name counts (the owner's installs list `social-content`, `launch-strategy`, `analytics-tracking`, `ab-test-setup`)
  const aliases = RECOMMENDED.find((e) => e.name === 'marketing-skills').skills.flatMap((k) => k.aliases ?? []);
  assert.deepEqual(aliases.sort(), ['ab-test-setup', 'analytics-tracking', 'launch-strategy', 'social-content']);
  assert.match(src('lanes/implement.md'), /`social-content`, `launch-strategy`, `analytics-tracking`, `ab-test-setup`/);
});

test('TC-10 consent: the base shows the commands and never runs an install; a program is called a program, a Markdown pack adds knowledge only', () => {
  assert.match(OFFER_RULES, /\*\*Never run an install yourself\.\*\* The commands are shown; the person runs them/);
  assert.match(OFFER_RULES, /retry nothing silently and work around nothing by editing settings or permissions/);
  assert.match(OFFER_RULES, /only when the person asks: show the exact change first/);
  assert.match(SHORT_RULE, /Never run an install yourself: the person runs it, then `\/reload-plugins`/);
  assert.match(SHORT_RULE, /\(what, why here, program or only knowledge\)/);
  const catalogText = skillFile('ops/suggest-skills.md');
  for (const e of RECOMMENDED) {
    const l = lineOf(catalogText, e.name);
    assert.ok(l && l === entryLine(e, { full: true }), `${e.name}: its line is in the catalog text`);
    if (e.installs_code) { assert.ok(l.includes(`Installs ${e.installs}.`), e.name); assert.match(installsNote(e.name), /^It installs .* on your computer/, e.name); }
    else { assert.ok(l.includes(' Markdown only.'), `${e.name}: says Markdown only`); assert.match(installsNote(e.name), /^It is Markdown only: it (adds knowledge and )?installs no program/, e.name); }
  }
  assert.match(installsNote('superpowers'), /a session-start hook script/);
  assert.match(installsNote('marketing-skills'), /adds knowledge and installs no program/);
  assert.match(installsNote('firebase'), /MCP server/);
  for (const f of ['commands/suggest-skills.md', ...Object.values(LANE_FILES).map((r) => `skills/laneconductor/${r}`)]) { // the skill file of the catalog also holds the board entry's Glob, like ADD-ONS.md; the command does not
    const text = read(f);
    assert.ok(!/\b(now|then|please|you should|go ahead and)\s+run\s+`?claude plugin install/i.test(text), `${f} tells Claude to run an install`);
    assert.ok(!/~\/\.claude\/plugins|CLAUDE_PLUGIN_ROOT/.test(text.replace(/Do not Glob or Read the plugin's install folder \(`~\/\.claude\/plugins\/\.\.\.`\)[^\n]*/, '')), `${f} names the plugin install folder`);
  }
});

test('the hooks: every lane guide has "Offer a missing skill" before "Skills that help here"; new-project and next carry theirs', () => {
  for (const [lane, rel] of Object.entries(LANE_FILES)) {
    const text = skillFile(rel);
    if (lane === 'deploy') {
      assert.match(text, /Before step 1, offer the stack's deploy pack if it is missing/);
      assert.ok(text.includes(laneOfferBlock('deploy')));
      continue;
    }
    const at = text.indexOf('## Offer a missing skill');
    assert.ok(at > 0 && at < text.indexOf('## Skills that help here'), `${lane}: the offer comes before the skills section`);
    assert.ok(text.includes(laneOfferBlock(lane)), `${lane}: the generated block`);
    assert.ok(!text.includes('<!-- generated: skill offers'), `${lane}: no marker left`);
  }
  const next = skillFile('ops/next.md');
  assert.ok(next.includes('## A skill tip') && next.includes(skillTipsBlock()));
  assert.match(next, /add at most ONE line, once per session/);
  assert.match(next, /never show a command here/);
  assert.match(next, /Tip: `<skill>` \(<one clause on why>\) is not installed; `\/laneconductor:suggest-skills` shows how\./);
  assert.ok(skillFile('ops/tracks.md').includes(typeOfferBlock()));
  assert.match(skillFile('ops/new-project.md'), /offer a STARTER SET/);
});

test('TC-13 the add-ons are ordinary entries: the same line, offered in the lane guides and the catalog like any pack, no special code path', () => {
  const third = RECOMMENDED.find((e) => e.kind === 'thirdparty' && e.source.add !== 'anthropics/claude-plugins-official' && e.installs_code);
  assert.ok(third);
  for (const e of [ADDONS[0], ADDONS[1], third]) {
    const line = entryLine(e, { full: true });
    assert.ok(line.startsWith(`- \`${e.name}\``), `${e.name}: the same line`);
    assert.ok(line.includes(`: ${e.why}`) && line.includes(`Installs ${e.installs}.`) && line.endsWith(cmds(e)), `${e.name}: why, what it installs, its commands`);
  }
  const catalogText = skillFile('ops/suggest-skills.md');
  for (const e of ADDONS) {
    assert.ok(catalogText.includes(entryLine(e, { full: true })), `${e.name} is in the catalog text like any entry`);
    assert.ok(RECOMMENDED.includes(e) && e.kind === 'addon');
  }
  assert.match(blockOf(skillFile('lanes/implement.md'), 'implement'), /\n- `laneconductor-parallel`/, 'the parallel add-on is offered in the implement guide');
  assert.match(entryLine(ADDONS[0], { full: true }), /Mention only when .*several sessions, people or sub-agents/);
  assert.match(entryLine(ADDONS[1], { full: true }), /Mention only when the person asks for a board or dashboard/);
  // the board command's own fallback uses the note the catalog uses
  assert.ok(read('commands/board.md').includes(installsNote('laneconductor-board')));
  // the generator has no branch on an add-on's name
  const gen = fs.readFileSync(path.join(REPO, 'scripts/plugin-texts.mjs'), 'utf8');
  const advisor = gen.slice(gen.indexOf('The skill advisor (track AM-10124)'), gen.indexOf('export function skillAdvisorReadmeBlock'));
  assert.ok(!/laneconductor-parallel|laneconductor-board|NAMES\.(parallel|board)/.test(advisor), 'no add-on name in the advisor code');
});

test('TC-14 every lane is covered, with the skills the owner named', () => {
  const plan = blockOf(skillFile('lanes/plan.md'), 'plan');
  has(plan, 'superpowers', 'brainstorming', 'writing-plans', 'frontend-design', 'data', 'build-dashboard', 'marketing-skills', 'content-strategy', 'launch', 'prospecting');
  assert.match(plan.split('\n')[0], /stack tags: .*ui/);
  assert.match(lineOf(plan, 'marketing-skills'), /\(prerequisite; Type marketing\/sales\)/);
  const brainstorm = blockOf(skillFile('lanes/brainstorm.md'), 'brainstorm');
  has(brainstorm, 'superpowers', 'brainstorming', 'writing-plans');
  const implement = blockOf(skillFile('lanes/implement.md'), 'implement');
  has(implement, 'test-driven-development', 'systematic-debugging', 'subagent-driven-development', 'using-git-worktrees', 'laneconductor-parallel', 'frontend-design', 'firebase', 'cloudflare', 'copywriting', 'social', 'sales-enablement', 'cold-email', 'ticket-triage');
  assert.match(implement, /social \(was social-content\)/);
  const review = blockOf(skillFile('lanes/review.md'), 'review');
  has(review, 'requesting-code-review', 'receiving-code-review', 'pr-review-toolkit', 'review-pr');
  const gate = blockOf(skillFile('lanes/quality-gate.md'), 'quality-gate');
  has(gate, 'verification-before-completion', 'security-guidance', 'playwright', 'analytics', 'ab-testing');
  const merge = blockOf(skillFile('lanes/merge.md'), 'merge');
  has(merge, 'finishing-a-development-branch');
  const deploy = blockOf(skillFile('deploy/deploy.md'), 'deploy');
  has(deploy, 'firebase', 'cloudflare');
  // the stack tags say how to recognise a UI or Firebase project (in the catalog text)
  const catalogText = skillFile('ops/suggest-skills.md');
  assert.match(catalogText, /- `ui`: a front-end stack/);
  assert.match(catalogText, /- `firebase`: `firebase\.json` or `\.firebaserc`/);
  // a marketing, sales or support track at plan and implement, and when it is created
  const newType = skillFile('ops/tracks.md');
  has(newType.slice(newType.indexOf('Candidates for these Types:')), 'marketing-skills', 'customer-support', 'content-strategy', 'cold-email', 'ticket-triage');
});

test('every catalog entry appears in the guide of each lane it names, and in no guide of a lane it does not (TC-3, TC-14)', () => {
  for (const e of RECOMMENDED) {
    for (const lane of ['brainstorm', 'plan', 'implement', 'review', 'quality-gate', 'merge', 'deploy']) {
      const text = blockOf(skillFile(LANE_FILES[lane]), lane);
      const list = text.slice(0, text.indexOf('## Skills that help here') > 0 ? text.indexOf('## Skills that help here') : undefined);
      const should = e.skills.length ? e.skills.some((k) => (k.lanes ?? e.lanes).includes(lane)) : e.lanes.includes(lane);
      assert.equal(Boolean(lineOf(list, e.name)), should, `${e.name} in the ${lane} guide: ${should}`);
    }
  }
});

test('a Type: marketing track gets the offer at plan and at implement, and at creation', () => {
  for (const lane of ['plan', 'implement']) {
    const mk = lineOf(blockOf(skillFile(`lanes/${lane}.md`), lane), 'marketing-skills');
    assert.match(mk, /\(prerequisite; Type marketing\/sales\)/, lane);
    assert.match(mk, /Markdown only\./, lane);
    assert.ok(mk.endsWith('`claude plugin marketplace add coreyhaines31/marketingskills`, `claude plugin install marketing-skills@marketingskills`'), lane);
  }
  assert.match(skillFile('ops/tracks.md'), /\*\*Non-dev types\.\*\* For `marketing`, `sales` or `support`/);
  for (const c of ['new', 'bug', 'feature']) assert.ok(read(`commands/${c}.md`).includes('Candidates for these Types:'), `/${NAMES.base}:${c} carries the Type offer`);
});

test('REQ-7 disclosure: the READMEs say nothing is installed without a yes, from which sources, and what it runs', () => {
  const block = skillAdvisorReadmeBlock();
  assert.match(block, /\*\*It installs nothing without your yes and never runs an install itself\*\*/);
  assert.match(block, /it runs only `claude plugin list` and reads `\.claude\/skills\/` and `~\/\.claude\/skills\/`\. Your "do not ask again" goes in `\.laneconductor\.json`, after a yes/);
  assert.match(block, /A plugin that installs a program or a hosted connection says so first/);
  for (const e of RECOMMENDED) assert.ok(block.includes(`\`${e.source.add}\``), `${e.source.add}: the source is named`);
  assert.ok(block.split(/\s+/).length < 110, 'short: the base README stays under 900 words');
  assert.ok(read('README.md').includes(block), 'the base README carries the generated block');
  const root = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  assert.match(root, /### Skill suggestions: nothing is installed without your yes/);
  assert.match(root, /\*\*It installs nothing without your yes, and it never runs an install itself\.\*\*/);
  for (const e of RECOMMENDED) assert.ok(root.includes(`\`${e.source.add}\``) && root.includes(`\`${e.name}\``), `root README lists ${e.name} and ${e.source.add}`);
  assert.ok(root.includes('`find-skills`'), 'the root README names the third-party fallback with its real name');
  assert.match(root, /`\/laneconductor:suggest-skills`/);
  assert.ok(skillsCatalogBlock().includes(`checked ${JSON.parse(fs.readFileSync(path.join(REPO, 'connector/plugin-extras/recommended-plugins.json'), 'utf8')).checked}`));
  assert.ok(skillsCatalogBlock().includes('`find-skills`'));
});

test('the base stays Markdown only: nothing new in it is a program, a hook or a connector tool', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(BASE).filter((x) => path.basename(x) !== 'LICENSE')) assert.ok(/\.(md|json|png)$/.test(f), `${path.relative(BASE, f)} is not Markdown, JSON or PNG`);
  assert.ok(!fs.existsSync(path.join(BASE, '.mcp.json')) && !fs.existsSync(path.join(BASE, 'hooks')));
  const tools = fs.readdirSync(path.join(REPO, 'connector/src/tools')).join(' ');
  assert.ok(!/skill|advisor|suggest/.test(tools), 'no connector tool was added for the advisor (the tool descriptions are at their size limit)');
});
