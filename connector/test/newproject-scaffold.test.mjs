// Track AM-10117 Phase 1 (TC-1): the scaffold generator from a recorded set of interview answers. The interview itself is
// Markdown (skill file ops/new-project.md) and is checked by a human (TC-9); this checks what must be deterministic.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO } from '../../scripts/build-plugin.mjs';
import { DEFAULT_WORKFLOW, GITIGNORE_LINES, firstTracks, mergeGitignore, normalizeAnswers, renderScaffold, writeScaffold } from '../src/newproject/scaffold.mjs';
import { parseMarkers } from '../src/markers.mjs';
import { git } from './helpers/repo.mjs';

const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-newproject-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let n = 0;
const fresh = () => path.join(TMP, `p${n++}`);
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

const ANSWERS = {
  name: 'Habit Tracker',
  summary: 'A small web app to track daily habits and show streaks.',
  users: 'Individuals who want a simple daily check-in.',
  features: ['Add a habit', 'Check it off each day', 'See the streak'],
  stack: { language: 'JavaScript (Node 22)', framework: 'Express', data: 'SQLite file', auth: 'none for v1', hosting: 'one small container', ai: 'none', testing: 'node --test' },
  constraints: ['No accounts in v1'],
  commands: { test: 'npm test', lint: 'npm run lint' },
  kpis: [{ metric: 'Daily active habits', target: '50', horizon: 'Q1' }],
  recipes: [
    { name: 'example-hello', why: 'matches the node and container stack', youRun: ['Sign in to the hosting CLI', 'Run the deploy command shown by the recipe'], claudeDoes: ['Write hello.json from the recipe files'] },
  ],
  deviations: [{ recipe: 'example-ci', reason: 'we use the existing CI of the team instead' }],
  initials: 'HT',
};

test('normalizeAnswers: name and summary are required, bad recipe names and duplicates are refused', () => {
  assert.throws(() => normalizeAnswers({ summary: 'x' }), /answers.name/);
  assert.throws(() => normalizeAnswers({ name: 'x' }), /answers.summary/);
  assert.throws(() => normalizeAnswers({ ...ANSWERS, recipes: [{ name: 'Not Kebab' }] }), /kebab-case/);
  assert.throws(() => normalizeAnswers({ ...ANSWERS, recipes: [{ name: 'a' }, { name: 'a' }] }), /twice/);
  assert.throws(() => normalizeAnswers({ ...ANSWERS, initials: 'TOOLONG1' }), /initials/);
  assert.equal(normalizeAnswers({ name: 'x', summary: 'y' }).stateBranch, 'main');
});

test('renderScaffold: every context file exists and is tailored to the answers', () => {
  const files = renderScaffold(ANSWERS);
  for (const f of ['product.md', 'tech-stack.md', 'workflow.md', 'workflow.json', 'product-guidelines.md', 'design-language.md', 'quality-gate.md', 'user-stories.md', 'kpis.md']) assert.ok(files.has(`conductor/${f}`), f);
  assert.ok(files.has('conductor/tracks/.gitkeep'));
  assert.match(files.get('conductor/product.md'), /# Product: Habit Tracker/);
  assert.match(files.get('conductor/product.md'), /- See the streak/);
  assert.match(files.get('conductor/tech-stack.md'), /- Framework: Express/);
  assert.match(files.get('conductor/tech-stack.md'), /example-hello: matches the node and container stack/);
  assert.match(files.get('conductor/kpis.md'), /\| Daily active habits \| 50 \| Q1 \|/);
  assert.deepEqual(JSON.parse(files.get('conductor/workflow.json')), DEFAULT_WORKFLOW);
});

test('quality-gate.md names only the commands the answers say exist', () => {
  const gate = renderScaffold(ANSWERS).get('conductor/quality-gate.md');
  assert.match(gate, /`npm test`/);
  assert.match(gate, /`npm run lint`/);
  for (const absent of ['typecheck', 'npm run build', 'coverage', 'audit', 'playwright', 'E2E']) assert.ok(!gate.includes(absent), `no aspirational ${absent} line`);
  assert.ok(!/\[x\]/i.test(gate), 'no box starts ticked');
  assert.match(gate, /Status: PENDING/);
  // No commands at all: an honest line instead of a made-up one.
  const bare = renderScaffold({ name: 'x', summary: 'y' }).get('conductor/quality-gate.md');
  assert.match(bare, /No verification commands exist yet/);
  assert.ok(!/- \[ \] (Syntax|Lint|Unit|Build|Coverage|Security)/.test(bare));
});

test('.laneconductor.json has a state branch and no database, mode, collector or worker content; no daemon text anywhere', () => {
  const files = renderScaffold({ ...ANSWERS, recipesPath: '~/my-recipes' });
  const cfg = JSON.parse(files.get('.laneconductor.json'));
  assert.deepEqual(cfg, { project: { name: 'Habit Tracker' }, connector: { state_branch: 'main' }, recipes: { path: '~/my-recipes' } });
  for (const [rel, text] of files) assert.ok(!/psql|postgres|database|collector|daemon|heartbeat|\bworker\b|local-api|remote-api/i.test(text), `${rel} has no daemon or database content`);
  assert.ok(!('recipes' in JSON.parse(renderScaffold(ANSWERS).get('.laneconductor.json'))), 'no recipes key when no library path was given');
});

test('.gitignore: the three entries are added once; an existing file keeps its lines', () => {
  assert.equal(mergeGitignore(null), `${GITIGNORE_LINES.join('\n')}\n`);
  const merged = mergeGitignore('node_modules/\n.worktrees/');
  assert.equal(merged, 'node_modules/\n.worktrees/\nconductor/tracks/**/conversation.md\nconductor/tracks/**/conversation.json\n');
  assert.equal(mergeGitignore(merged), null, 'a second merge changes nothing');
  assert.ok(GITIGNORE_LINES.includes('conductor/tracks/**/conversation.md'));
});

test('firstTracks: one plan-lane track per chosen recipe, then the walking skeleton; numbering continues from existing folders', () => {
  const t = firstTracks(ANSWERS, []);
  assert.deepEqual(t.map((x) => x.id), ['HT-1', 'HT-2']);
  assert.match(t[0].folder, /^HT-1-apply-recipe-example-hello$/);
  assert.match(t[1].folder, /^HT-2-walking-skeleton$/);
  const m = parseMarkers(t[0].files.index).values;
  assert.equal(m.Lane, 'plan');
  assert.equal(m['Lane Status'], 'queue');
  assert.match(t[0].files.plan, /- \[ \] Task 1 \(HUMAN\): Sign in to the hosting CLI/);
  assert.match(t[0].files.plan, /- \[ \] Task 2 \(HUMAN\): Run the deploy command/);
  assert.match(t[0].files.plan, /- \[ \] Task 1: Write hello.json from the recipe files/);
  assert.match(t[0].files.conversation, /^> \*\*human\*\*: Deviation from a recommendation \(example-ci\): we use the existing CI/m, 'a deviation is noted in the first track conversation');
  assert.ok(!/Deviation/.test(t[1].files.conversation));
  assert.equal(firstTracks({ name: 'x', summary: 'y' }, []).length, 1, 'no recipe: only the walking skeleton');
  assert.deepEqual(firstTracks({ name: 'x', summary: 'y', initials: 'ab' }, ['AB-7-old', 'AB-9-older']).map((x) => x.id), ['AB-10']);
});

test('writeScaffold in a new empty folder: git init, all files, tracks, gitignore; no commit', () => {
  const dir = fresh();
  const r = writeScaffold(dir, ANSWERS);
  assert.equal(r.gitInit, true);
  assert.ok(fs.existsSync(path.join(dir, '.git')));
  for (const rel of ['conductor/product.md', 'conductor/quality-gate.md', 'conductor/workflow.json', '.laneconductor.json', 'conductor/tracks/HT-1-apply-recipe-example-hello/plan.md', 'conductor/tracks/HT-2-walking-skeleton/index.md']) assert.ok(r.created.includes(rel), rel);
  assert.deepEqual(r.merged, ['.gitignore']);
  assert.equal(read(dir, '.gitignore'), `${GITIGNORE_LINES.join('\n')}\n`);
  assert.equal(spawnSync('git', ['-C', dir, 'rev-list', '--all', '--count'], { encoding: 'utf8' }).stdout.trim(), '0', 'nothing is committed');
  assert.deepEqual(git(dir, 'check-ignore', '-v', 'conductor/tracks/HT-1-apply-recipe-example-hello/conversation.md').includes('conversation.md'), true);
});

test('writeScaffold in an existing repository adds only what is missing and never overwrites', () => {
  const dir = fresh();
  fs.mkdirSync(path.join(dir, 'conductor'), { recursive: true });
  spawnSync('git', ['init', '-q', '-b', 'main', dir]);
  fs.writeFileSync(path.join(dir, 'conductor/product.md'), 'MINE\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/');
  const r = writeScaffold(dir, ANSWERS);
  assert.equal(r.gitInit, false);
  assert.ok(r.skipped.includes('conductor/product.md'));
  assert.equal(read(dir, 'conductor/product.md'), 'MINE\n');
  assert.equal(read(dir, '.gitignore'), `dist/\n${GITIGNORE_LINES.join('\n')}\n`);
  const again = writeScaffold(dir, ANSWERS);
  assert.deepEqual(again.created, [], 'a second run creates nothing');
  assert.deepEqual(again.merged, []);
});

test('writeScaffold dry run writes nothing', () => {
  const dir = fresh();
  const r = writeScaffold(dir, ANSWERS, { dryRun: true });
  assert.ok(r.created.length > 10);
  assert.ok(!fs.existsSync(dir), 'the folder is not even created');
});

test('lc-scaffold CLI: answers file in, JSON report out; a bad answers file exits 1 with the reason', () => {
  const dir = fresh();
  const answers = path.join(TMP, 'answers.json');
  fs.writeFileSync(answers, JSON.stringify(ANSWERS));
  const bin = path.join(REPO, 'connector/bin/lc-scaffold.mjs');
  const ok = spawnSync(process.execPath, [bin, '--answers', answers, '--dir', dir], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(JSON.parse(ok.stdout).created.includes('conductor/tracks/HT-2-walking-skeleton/spec.md'));
  fs.writeFileSync(answers, JSON.stringify({ name: 'x' }));
  const bad = spawnSync(process.execPath, [bin, '--answers', answers, '--dir', fresh()], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /answers.summary/);
  assert.equal(spawnSync(process.execPath, [bin], { encoding: 'utf8' }).status, 2);
});

test('skill templates.md shows the same default workflow.json the generator writes', () => {
  const md = fs.readFileSync(path.join(REPO, '.claude/skills/laneconductor/setup/templates.md'), 'utf8');
  const m = md.match(/\*\*`conductor\/workflow\.json` default\*\*[\s\S]*?```json\n([\s\S]*?)\n```/);
  assert.ok(m, 'templates.md carries the default workflow.json block');
  assert.deepEqual(JSON.parse(m[1]), DEFAULT_WORKFLOW);
});
