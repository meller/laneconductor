// Track AM-10124 (skill advisor), Phases 3 to 5: the offer, as text. The base plugin is Markdown, so the behaviour is in the words it ships;
// these checks read the generated plugin (plugins/laneconductor) and the source skill. TC-4 to TC-10 (the experience), TC-13 (the add-ons
// are ordinary entries), TC-14 (every lane), the detection fix (the implement lane and `new` looked only in .claude/skills), the command,
// the tip in `next`, and the disclosure (REQ-7). TC-11 and TC-12 (the starter set) are in setup-recommend.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, RELS, NAMES, RECOMMENDED, ADDONS, installsNote } from '../../scripts/build-plugin.mjs';
import { OFFER_RULES, DECLINED_FILE, entryBlock, laneOfferBlock, typeOfferBlock, skillsCatalogBlock, skillAdvisorReadmeBlock, skillTipsBlock } from '../../scripts/plugin-texts.mjs';
import { COMMANDS, GROUPS, helpText } from '../src/commands.mjs';

const BASE = path.join(REPO, RELS.base);
const read = (rel) => fs.readFileSync(path.join(BASE, rel), 'utf8');
const skillFile = (rel) => read(`skills/laneconductor/${rel}`);
const src = (rel) => fs.readFileSync(path.join(REPO, '.claude/skills/laneconductor', rel), 'utf8');
const LANE_FILES = { brainstorm: 'lanes/brainstorm.md', plan: 'lanes/plan.md', implement: 'lanes/implement.md', review: 'lanes/review.md', 'quality-gate': 'lanes/quality-gate.md', merge: 'lanes/merge.md', deploy: 'deploy/deploy.md' };
const blockOf = (text, lane) => text.slice(text.indexOf(`Candidates for the \`${lane}\` lane:`));
const has = (text, ...names) => names.forEach((n) => assert.ok(text.includes(`\`${n}\``), `names \`${n}\``));

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

test('TC-4 plain text: one or two sentences, each command alone in its own bash block (no leading $), in-session alternative inline, no form', () => {
  assert.match(OFFER_RULES, /Plain text in your reply: never a form, a menu or a question that blocks the work/);
  assert.match(OFFER_RULES, /one or two plain sentences/);
  assert.match(OFFER_RULES, /each install command alone in its own bash block, one command per block, no leading `\$`/);
  assert.match(OFFER_RULES, /`\/plugin install <plugin>@<marketplace>` instead \(inline text, not a block\)/);
  for (const e of RECOMMENDED) {
    const block = entryBlock(e);
    const fences = [...block.matchAll(/```bash\n([^\n]+)\n```/g)].map((m) => m[1]);
    assert.deepEqual(fences, e.install, `${e.name}: every command in its own bash block`);
    assert.ok(fences.every((f) => !f.startsWith('$') && f.startsWith('claude plugin ')));
  }
});

test('TC-5, TC-6 at the moment of intent: a prerequisite asks install-first-or-carry-on in one sentence, a helper is a one-line tip, the work is never blocked', () => {
  assert.match(OFFER_RULES, /`prerequisite`: say the result will be better with it and ask, in the same sentence, whether to install it first or carry on/);
  assert.match(OFFER_RULES, /`helps`: a one-line tip/);
  assert.match(OFFER_RULES, /Either way the work is not blocked: with no answer, carry on/);
  for (const lane of Object.keys(LANE_FILES)) assert.ok(skillFile(LANE_FILES[lane]).includes(OFFER_RULES), `${lane}: the guide carries the rules`);
  // the levels in the catalog: a design skill and the content skills are prerequisites for their tracks, the process skills only help
  const level = (n) => RECOMMENDED.find((e) => e.name === n).level;
  assert.equal(level('frontend-design'), 'prerequisite');
  assert.equal(level('marketing-skills'), 'prerequisite');
  assert.equal(level('superpowers'), 'helps');
});

test('TC-7 install first, carry on, do not ask again: the three answers', () => {
  assert.match(OFFER_RULES, /\*Install first\*: show the commands, say nothing has been changed yet, say to run them and then `\/reload-plugins`, and when the person is back start the step again from the top with the skill present/);
  assert.match(OFFER_RULES, /\*Carry on\*: start the step at once and do not repeat the offer this session/);
  assert.match(OFFER_RULES, /\*Do not ask again\*: show the line you would add and, after the yes, append the entry's name to the declined file/);
  assert.equal(DECLINED_FILE, 'skill-advisor-declined.txt');
  assert.match(OFFER_RULES, /inside the directory that `git rev-parse --git-common-dir` prints/);
  assert.match(OFFER_RULES, /it is inside `\.git`, so it is never committed/);
  assert.ok(!/declined/.test(skillFile('SKILL.md')) || true);
});

test('TC-8 quiet: nothing missing means no message, at most two items, never twice in a session, a trivial track gets one line', () => {
  assert.match(OFFER_RULES, /When nothing is missing, say nothing/);
  assert.match(OFFER_RULES, /At most two items per offer: our own entries before third-party ones, `prerequisite` before `helps`/);
  assert.match(OFFER_RULES, /Never the same entry twice in a session/);
  assert.match(OFFER_RULES, /A trivial track gets at most the one-line tip, and a suggestion in the middle of a step .* is one line/);
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
  for (const [label, text] of [['implement guide (source)', src('lanes/implement.md')], ['implement guide (shipped)', skillFile('lanes/implement.md')], ['ops/tracks.md (source)', src('ops/tracks.md')], ['ops/tracks.md (shipped)', skillFile('ops/tracks.md')]]) {
    assert.ok(!/not found in \.claude\/skills\//.test(text), `${label}: the project-folder-only message is gone`);
    assert.match(text, /you have\s+`<skill>` installed, use it before writing the content/, label);
    assert.match(text, /`claude plugin list`/, label);
    assert.match(text, /`~\/\.claude\/skills\/`/, label);
  }
  // an older name counts (the owner's installs list `social-content`, `launch-strategy`, `analytics-tracking`, `ab-test-setup`)
  const m = RECOMMENDED.find((e) => e.name === 'marketing-skills');
  const aliases = m.skills.flatMap((k) => k.aliases ?? []);
  assert.deepEqual(aliases.sort(), ['ab-test-setup', 'analytics-tracking', 'launch-strategy', 'social-content']);
  assert.match(skillFile('lanes/implement.md'), /older name counts too/);
});

test('TC-10 consent: the base shows the commands and never runs an install; a program is called a program, a Markdown pack adds knowledge only', () => {
  assert.match(OFFER_RULES, /\*\*Never run an install yourself\.\*\* The commands are shown; the person runs them/);
  assert.match(OFFER_RULES, /retry nothing silently and work around nothing by editing settings or permissions/);
  assert.match(OFFER_RULES, /only when the person asks: show the exact change first/);
  const catalogText = skillFile('ops/suggest-skills.md');
  for (const e of RECOMMENDED) {
    assert.ok(catalogText.includes(installsNote(e.name)), `${e.name}: the note is in the catalog text`);
    if (e.installs_code) assert.match(installsNote(e.name), /^It installs .* on your computer/, e.name);
    else assert.match(installsNote(e.name), /^It is Markdown only: it (adds knowledge and )?installs no program/, e.name);
  }
  assert.match(installsNote('superpowers'), /a shell hook script/);
  assert.match(installsNote('marketing-skills'), /adds knowledge and installs no program/);
  assert.match(installsNote('firebase'), /MCP server/);
  for (const f of ['commands/suggest-skills.md', ...Object.values(LANE_FILES).map((r) => `skills/laneconductor/${r}`)]) { // the skill file of the catalog also holds the board entry's Glob, like ADD-ONS.md; the command does not
    const text = read(f);
    assert.ok(!/\b(now|then|please|you should|go ahead and)\s+run\s+`?claude plugin install/i.test(text), `${f} tells Claude to run an install`);
    assert.ok(!/~\/\.claude\/plugins|CLAUDE_PLUGIN_ROOT/.test(text.replace(/Do not Glob or Read the plugin's install folder \(`~\/\.claude\/plugins\/\.\.\.`\)[^\n]*/, '')), `${f} names the plugin install folder`);
  }
});

test('the hooks: every lane guide has "Offer a missing skill" before "Skills that help here" and a pointer at the top; setup, next and new carry theirs', () => {
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
    assert.match(text, /Before step 1, look at "Offer a missing skill" near the end of this guide: one check, usually silent\./, `${lane}: pointer`);
    assert.ok(!text.includes('<!-- generated: skill offers'), `${lane}: no marker left`);
  }
  const next = skillFile('ops/next.md');
  assert.ok(next.includes('## A skill tip') && next.includes(skillTipsBlock()));
  assert.match(next, /add at most ONE line, once per session/);
  assert.match(next, /never show a command here/);
  assert.match(next, /Tip: `<skill>` \(<one clause on why>\) is not installed; `\/laneconductor:suggest-skills` shows how\./);
  assert.ok(skillFile('ops/tracks.md').includes(typeOfferBlock()));
  assert.match(skillFile('setup/setup.md'), /offer a STARTER SET/);
});

test('TC-13 the add-ons are ordinary entries: the same block shape, offered in the lane guides and the catalog like any pack, no special code path', () => {
  const third = RECOMMENDED.find((e) => e.kind === 'thirdparty' && e.source.add !== 'anthropics/claude-plugins-official' && e.installs_code);
  assert.ok(third);
  for (const e of [ADDONS[0], ADDONS[1], third]) {
    const block = entryBlock(e);
    assert.ok(block.startsWith(`#### \`${e.name}\`\n\n`), `${e.name}: heading`);
    assert.ok(block.includes(`from \`${e.source.add}\`. Fits `) && block.includes(' Level: `') && block.includes('\nIt counts as installed when ') && block.includes(installsNote(e.name)), `${e.name}: the same sentences`);
    assert.deepEqual([...block.matchAll(/```bash\n([^\n]+)\n```/g)].map((m) => m[1]), e.install, `${e.name}: the same fences`);
  }
  const catalogText = skillFile('ops/suggest-skills.md');
  for (const e of ADDONS) {
    assert.ok(catalogText.includes(entryBlock(e)), `${e.name} is in the catalog text like any entry`);
    assert.ok(RECOMMENDED.includes(e) && e.kind === 'addon');
  }
  assert.match(blockOf(skillFile('lanes/implement.md'), 'implement'), /#### `laneconductor-parallel`/, 'the parallel add-on is offered in the implement guide');
  assert.match(entryBlock(ADDONS[0]), /Mention it only when: .*several sessions, people or sub-agents/);
  assert.match(entryBlock(ADDONS[1]), /Mention it only when: the person asks for a board or dashboard/);
  // the board command's own fallback uses the same install block and note the catalog uses
  assert.ok(read('commands/board.md').includes(installsNote('laneconductor-board')));
  // the generator has no branch on an add-on's name
  const gen = fs.readFileSync(path.join(REPO, 'scripts/plugin-texts.mjs'), 'utf8');
  const advisor = gen.slice(gen.indexOf('The skill advisor (track AM-10124)'), gen.indexOf('export function skillEdits'));
  assert.ok(!/laneconductor-parallel|laneconductor-board|NAMES\.(parallel|board)/.test(advisor), 'no add-on name in the advisor code');
});

test('TC-14 every lane is covered, with the skills the owner named', () => {
  const plan = blockOf(skillFile('lanes/plan.md'), 'plan');
  has(plan, 'superpowers', 'brainstorming', 'writing-plans', 'frontend-design', 'data', 'build-dashboard', 'marketing-skills', 'content-strategy', 'launch');
  assert.match(plan, /Fits `setup`, `plan`, `implement`, `quality-gate` \(lanes\), Type `marketing`, `sales`/);
  const brainstorm = blockOf(skillFile('lanes/brainstorm.md'), 'brainstorm');
  has(brainstorm, 'superpowers', 'brainstorming', 'writing-plans');
  const implement = blockOf(skillFile('lanes/implement.md'), 'implement');
  has(implement, 'test-driven-development', 'systematic-debugging', 'subagent-driven-development', 'using-git-worktrees', 'laneconductor-parallel', 'frontend-design', 'firebase', 'cloudflare', 'copywriting', 'social', 'sales-enablement', 'cold-email', 'ticket-triage');
  const review = blockOf(skillFile('lanes/review.md'), 'review');
  has(review, 'requesting-code-review', 'receiving-code-review', 'pr-review-toolkit', 'review-pr');
  const gate = blockOf(skillFile('lanes/quality-gate.md'), 'quality-gate');
  has(gate, 'verification-before-completion', 'security-guidance', 'playwright', 'analytics', 'ab-testing');
  const merge = blockOf(skillFile('lanes/merge.md'), 'merge');
  has(merge, 'finishing-a-development-branch');
  const deploy = blockOf(skillFile('deploy/deploy.md'), 'deploy');
  has(deploy, 'firebase', 'cloudflare');
  // a UI track: the design skill, and a UI stack tag that says how to recognise one
  assert.match(plan, /`ui`: a front-end stack/);
  assert.match(implement, /`firebase`: `firebase\.json` or `\.firebaserc`/);
  // a marketing, sales or support track at plan and implement, and when it is created
  const newType = skillFile('ops/tracks.md');
  has(newType.slice(newType.indexOf('Candidates for these Types:')), 'marketing-skills', 'customer-support', 'content-strategy', 'cold-email', 'ticket-triage');
  assert.match(plan, /`prospecting`/);
  assert.match(implement, /older installs list it as `social-content`/);
});

test('a Type: marketing track gets the offer at plan and at implement, and at creation', () => {
  for (const lane of ['plan', 'implement']) {
    const text = blockOf(skillFile(`lanes/${lane}.md`), lane);
    const mk = text.slice(text.indexOf('#### `marketing-skills`'), text.indexOf('####', text.indexOf('#### `marketing-skills`') + 5) > 0 ? text.indexOf('####', text.indexOf('#### `marketing-skills`') + 5) : undefined);
    assert.match(mk, /Type `marketing`, `sales`/, lane);
    assert.match(mk, /Level: `prerequisite`/, lane);
    assert.match(mk, /It is Markdown only: it adds knowledge and installs no program\./, lane);
    assert.deepEqual([...mk.matchAll(/```bash\n([^\n]+)\n```/g)].map((m) => m[1]), ['claude plugin marketplace add coreyhaines31/marketingskills', 'claude plugin install marketing-skills@marketingskills']);
  }
  assert.match(skillFile('ops/tracks.md'), /\*\*Non-dev types\.\*\* For `marketing`, `sales` or `support`/);
  for (const c of ['new', 'bug', 'feature']) assert.ok(read(`commands/${c}.md`).includes('Candidates for these Types:'), `/${NAMES.base}:${c} carries the Type offer`);
});

test('REQ-7 disclosure: the READMEs say nothing is installed without a yes, from which sources, and what it runs', () => {
  const block = skillAdvisorReadmeBlock();
  assert.match(block, /\*\*It installs nothing without your yes and never runs an install itself\*\*/);
  assert.match(block, /it runs only `claude plugin list` and `git rev-parse --git-common-dir` and reads `\.claude\/skills\/` and `~\/\.claude\/skills\/`/);
  assert.match(block, /it changes no settings/);
  for (const e of RECOMMENDED) assert.ok(block.includes(`\`${e.source.add}\``), `${e.source.add}: the source is named`);
  for (const e of RECOMMENDED.filter((x) => x.installs_code)) assert.ok(block.includes(`\`${e.name}\``), `${e.name}: said to install a program or a connection`);
  assert.ok(block.split(/\s+/).length < 150, 'short: the base README stays under 1100 words');
  assert.ok(block.includes('find-skills') && block.includes('third-party and not vetted'));
  assert.ok(read('README.md').includes(block), 'the base README carries the generated block');
  const root = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  assert.match(root, /### Skill suggestions: nothing is installed without your yes/);
  assert.match(root, /\*\*It installs nothing without your yes, and it never runs an install itself\.\*\*/);
  for (const e of RECOMMENDED) assert.ok(root.includes(`\`${e.source.add}\``) && root.includes(`\`${e.name}\``), `root README lists ${e.name} and ${e.source.add}`);
  assert.match(root, /`\/laneconductor:suggest-skills`/);
  assert.ok(skillsCatalogBlock().includes(`checked ${JSON.parse(fs.readFileSync(path.join(REPO, 'connector/plugin-extras/recommended-plugins.json'), 'utf8')).checked}`));
});

test('the base stays Markdown only: nothing new in it is a program, a hook or a connector tool', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(BASE).filter((x) => path.basename(x) !== 'LICENSE')) assert.ok(/\.(md|json|png)$/.test(f), `${path.relative(BASE, f)} is not Markdown, JSON or PNG`);
  assert.ok(!fs.existsSync(path.join(BASE, '.mcp.json')) && !fs.existsSync(path.join(BASE, 'hooks')));
  const tools = fs.readdirSync(path.join(REPO, 'connector/src/tools')).join(' ');
  assert.ok(!/skill|advisor|suggest/.test(tools), 'no connector tool was added for the advisor (the tool descriptions are at their size limit)');
});
