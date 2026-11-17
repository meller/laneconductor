// Track AM-10117 Phase 3 (TC-5, TC-6): applying recipes (render, conflicts, never overwrite) and add-recipe's save
// (checker result first, nothing saved without approval, a local commit that is never pushed, update and retire).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO } from '../../scripts/build-plugin.mjs';
import { planApply, render, varsIn, writePlan } from '../src/recipes/apply.mjs';
import { checkDraft, retireRecipe, saveRecipe } from '../src/recipes/save.mjs';
import { addRemote, git, readFile, rm, writeFile } from './helpers/repo.mjs';
import { fakeGoogleKey, makeLibrary, skill } from './helpers/recipes.mjs';

const cleanup = [];
after(() => rm(...cleanup));
const tmpDir = (prefix) => { const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix)); cleanup.push(d); return d; };
const lib = (recipes) => { const d = makeLibrary(recipes); cleanup.push(d); return d; };
const recipeAt = (library, name) => ({ name, dir: path.join(library, 'recipes', name) });

test('render fills {{var}} and reports every variable that has no value; varsIn lists them', () => {
  assert.deepEqual(render('a {{x}} b {{ y }} c {{x}}', { x: '1', y: '2' }), { text: 'a 1 b 2 c 1', missing: [] });
  assert.deepEqual(render('{{x}} {{nope}} {{nope}} {{empty}}', { x: '1', empty: '' }), { text: '1 {{nope}} {{nope}} {{empty}}', missing: ['nope', 'empty'] });
  assert.deepEqual(varsIn('{{a}} {{b.c}} {{a}}'), ['a', 'b.c']);
});

test('apply: .tmpl files are rendered with the answers (suffix dropped), others copied as they are', async () => {
  const l = lib({ r1: { files: { 'HELLO.md.tmpl': 'Hi {{project_name}}\n', 'conf/a.json': '{ "a": 1 }\n' } } });
  const target = tmpDir('lc-apply-');
  const plan = await planApply([recipeAt(l, 'r1')], { project_name: 'Habit Tracker' }, target);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.writes.map((w) => [w.path, w.rendered]), [['HELLO.md', true], ['conf/a.json', false]]);
  assert.deepEqual(await writePlan(plan, target), ['HELLO.md', 'conf/a.json']);
  assert.equal(readFile(target, 'HELLO.md'), 'Hi Habit Tracker\n');
  assert.equal(readFile(target, 'conf/a.json'), '{ "a": 1 }\n');
});

test('apply: a missing variable is an error, nothing is written, and the file is named', async () => {
  const l = lib({ r1: { files: { 'x.md.tmpl': '{{who}} at {{where}}\n', 'plain.md': 'p\n' } } });
  const target = tmpDir('lc-apply-');
  const plan = await planApply([recipeAt(l, 'r1')], { who: 'me' }, target);
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.missing_vars, [{ recipe: 'r1', file: 'x.md.tmpl', vars: ['where'] }]);
  await assert.rejects(writePlan(plan, target), /nothing was written/);
  assert.deepEqual(fs.readdirSync(target), []);
});

test('TC-5: two recipes writing the same path are a conflict, reported with both names, and neither is written', async () => {
  const l = lib({
    'one': { files: { 'firebase.json': '{ "one": 1 }\n', 'only-one.md': '1\n' } },
    'two': { files: { 'firebase.json': '{ "two": 2 }\n', 'only-two.md': '2\n' } },
    'same': { files: { 'only-one.md': '1\n' } },
  });
  const target = tmpDir('lc-apply-');
  const plan = await planApply(['one', 'two', 'same'].map((n) => recipeAt(l, n)), {}, target);
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.conflicts, [
    { path: 'firebase.json', recipes: ['one', 'two'], identical: false },
    { path: 'only-one.md', recipes: ['one', 'same'], identical: true },
  ], 'even identical content is reported: the human decides, nothing is merged silently');
  assert.deepEqual(plan.writes.map((w) => w.path), ['only-two.md']);
  await assert.rejects(writePlan(plan, target), /conflicts/);
  assert.deepEqual(fs.readdirSync(target), [], 'no partial write');
});

test('apply never overwrites an existing file', async () => {
  const l = lib({ r1: { files: { 'keep.md': 'recipe\n', 'new.md': 'n\n' } } });
  const target = tmpDir('lc-apply-');
  writeFile(target, 'keep.md', 'mine\n');
  const plan = await planApply([recipeAt(l, 'r1')], {}, target);
  assert.deepEqual(plan.existing, ['keep.md']);
  await writePlan(plan, target);
  assert.equal(readFile(target, 'keep.md'), 'mine\n');
  assert.equal(readFile(target, 'new.md'), 'n\n');
});

test('lc-recipe-apply CLI: dry run reports, --write writes, a conflict exits 1', () => {
  const bin = path.join(REPO, 'connector/bin/lc-recipe-apply.mjs');
  const shipped = path.join(REPO, '.claude/skills/laneconductor/recipes/example-hello');
  const target = tmpDir('lc-apply-cli-');
  const dry = spawnSync(process.execPath, [bin, '--recipe', shipped, '--target', target, '--var', 'project_name=Demo'], { encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.deepEqual(JSON.parse(dry.stdout).would_write.map((w) => w.path), ['HELLO.md', 'hello.config.json']);
  assert.deepEqual(fs.readdirSync(target), []);
  const missing = spawnSync(process.execPath, [bin, '--recipe', shipped, '--target', target], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.deepEqual(JSON.parse(missing.stdout).missing_vars, [{ recipe: 'example-hello', file: 'HELLO.md.tmpl', vars: ['project_name'] }]);
  const wrote = spawnSync(process.execPath, [bin, '--recipe', shipped, '--target', target, '--var', 'project_name=Demo', '--write'], { encoding: 'utf8' });
  assert.equal(wrote.status, 0, wrote.stderr);
  assert.match(readFile(target, 'HELLO.md'), /for the project Demo by the synthetic recipe/);
  const twice = spawnSync(process.execPath, [bin, '--recipe', shipped, '--recipe', shipped, '--target', tmpDir('lc-apply-cli2-')], { encoding: 'utf8' });
  assert.equal(twice.status, 1, 'the same recipe twice writes the same paths: a conflict');
  assert.equal(spawnSync(process.execPath, [bin], { encoding: 'utf8' }).status, 2);
});

// ---- add-recipe: save ----

/** A draft recipe folder (named for the recipe) outside any library. */
function draft(name, { text, files = {} } = {}) {
  const root = tmpDir('lc-draft-');
  const dir = path.join(root, name);
  writeFile(dir, 'SKILL.md', text ?? skill({ name }));
  for (const [rel, content] of Object.entries(files)) writeFile(dir, `files/${rel}`, content);
  return dir;
}
const log = (dir) => git(dir, 'log', '--format=%s').split('\n').filter(Boolean);

test('TC-6: the checker result is returned first; without approval nothing is saved, and a clean draft says it needs approval', async () => {
  const l = lib({ existing: {} });
  const before = git(l, 'rev-parse', 'HEAD');
  const r = await saveRecipe({ libDir: l, draftDir: draft('new-one'), approved: false });
  assert.deepEqual([r.saved, r.reason, r.check.errors], [false, 'needs_approval', 0]);
  assert.equal(git(l, 'rev-parse', 'HEAD'), before, 'no commit');
  assert.ok(!fs.existsSync(path.join(l, 'recipes/new-one')), 'nothing written');
  // not strictly true, not truthy-ish: only `true` is approval
  assert.equal((await saveRecipe({ libDir: l, draftDir: draft('new-two'), approved: 'yes' })).saved, false);
});

test('TC-6: a draft with checker errors is not saved even when approved, and the secret is never echoed', async () => {
  const l = lib({ existing: {} });
  const key = fakeGoogleKey();
  const bad = draft('leaky', { files: { 'c.ts': `const k = "${key}";\n` } });
  const r = await saveRecipe({ libDir: l, draftDir: bad, approved: true });
  assert.deepEqual([r.saved, r.reason], [false, 'checker_errors']);
  assert.ok(r.check.findings.some((f) => /possible secret/.test(f.message)));
  assert.ok(!JSON.stringify(r).includes(key));
  assert.ok(!fs.existsSync(path.join(l, 'recipes/leaky')));
  const misnamed = draft('misnamed', { text: skill({ name: 'other-name' }) });
  assert.equal((await saveRecipe({ libDir: l, draftDir: misnamed, approved: true })).reason, 'checker_errors');
});

test('TC-6: an approved clean draft is saved as ONE local commit touching only that recipe, and nothing is pushed', async () => {
  const l = lib({ existing: {} });
  addRemote(l); // a bare origin the library tracks; the save must not advance it
  const pushed = git(l, 'rev-parse', 'origin/main');
  writeFile(l, 'unrelated-staged.txt', 'x');
  git(l, 'add', 'unrelated-staged.txt');
  const r = await saveRecipe({ libDir: l, draftDir: draft('fresh-recipe', { files: { 'a.md': 'a\n' } }), approved: true });
  assert.equal(r.saved, true);
  assert.equal(r.action, 'add');
  assert.equal(log(l)[0], 'recipe: add fresh-recipe');
  assert.deepEqual(git(l, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['recipes/fresh-recipe/SKILL.md', 'recipes/fresh-recipe/files/a.md']);
  assert.match(git(l, 'status', '--porcelain'), /A  unrelated-staged\.txt/, 'what else was staged stays staged');
  assert.equal(git(l, 'rev-parse', 'origin/main'), pushed, 'origin did not move');
  assert.match(git(l, 'status', '-sb').split('\n')[0], /ahead 1/, 'the commit is local and unpushed');
});

test('TC-6: saving an existing name updates it (the old files are replaced), and retire removes it with a commit; both need approval', async () => {
  const l = lib({ 'old-one': { files: { 'stale.md': 's\n' } } });
  const r = await saveRecipe({ libDir: l, draftDir: draft('old-one', { files: { 'fresh.md': 'f\n' } }), approved: true });
  assert.equal(r.action, 'update');
  assert.deepEqual([fs.existsSync(path.join(l, 'recipes/old-one/files/stale.md')), fs.existsSync(path.join(l, 'recipes/old-one/files/fresh.md'))], [false, true]);
  assert.equal(log(l)[0], 'recipe: update old-one');
  assert.deepEqual(await retireRecipe({ libDir: l, name: 'old-one', approved: false }), { retired: false, reason: 'needs_approval' });
  assert.ok(fs.existsSync(path.join(l, 'recipes/old-one')));
  const gone = await retireRecipe({ libDir: l, name: 'old-one', approved: true });
  assert.equal(gone.retired, true);
  assert.ok(!fs.existsSync(path.join(l, 'recipes/old-one')));
  assert.equal(log(l)[0], 'recipe: retire old-one');
  await assert.rejects(retireRecipe({ libDir: l, name: 'nope', approved: true }), /no recipe nope/);
});

test('a library that is not its own git repository is refused; a non-recipe draft folder is refused', async () => {
  const plain = tmpDir('lc-plain-lib-');
  await assert.rejects(saveRecipe({ libDir: plain, draftDir: draft('ok-name'), approved: true }), /not a git repository|inside the git repository/);
  const nested = lib({});
  fs.mkdirSync(path.join(nested, 'sub'));
  await assert.rejects(saveRecipe({ libDir: path.join(nested, 'sub'), draftDir: draft('ok-name'), approved: true }), /root of its own repository/);
  await assert.rejects(saveRecipe({ libDir: nested, draftDir: tmpDir('lc-empty-draft-'), approved: true }), /kebab-case|no SKILL.md/);
  const noSkill = path.join(tmpDir('lc-nos-'), 'valid-name');
  fs.mkdirSync(noSkill);
  await assert.rejects(saveRecipe({ libDir: nested, draftDir: noSkill, approved: true }), /has no SKILL\.md/);
});

test('checkDraft checks the draft alone: the other recipes of the library cannot block it', async () => {
  const c = await checkDraft(draft('solo'));
  assert.equal(c.errors, 0);
  assert.equal(c.name, 'solo');
});

test('lc-recipe-save CLI: dry run prints the checker result and "needs approval"; --approved commits; a bad draft exits 1', () => {
  const bin = path.join(REPO, 'connector/bin/lc-recipe-save.mjs');
  const l = lib({});
  const d = draft('cli-recipe');
  const run = (...a) => spawnSync(process.execPath, [bin, '--lib', l, ...a, '--ref-root', tmpDir('lc-noroot-')], { encoding: 'utf8' });
  const dry = run('--draft', d);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /checker: 0 errors/);
  assert.match(dry.stdout, /not saved: needs approval/);
  assert.ok(!fs.existsSync(path.join(l, 'recipes/cli-recipe')));
  const ok = run('--draft', d, '--approved');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /saved \(add\) cli-recipe: local commit [0-9a-f]+ .*\(not pushed\)/);
  const bad = run('--draft', draft('bad-one', { files: { 'k.txt': fakeGoogleKey() } }), '--approved');
  assert.equal(bad.status, 1);
  assert.ok(!bad.stdout.includes('AIza'), 'the secret is not printed');
  const retire = run('--retire', 'cli-recipe');
  assert.match(retire.stdout, /needs approval/);
  assert.equal(run('--retire', 'cli-recipe', '--approved').status, 0);
  assert.equal(spawnSync(process.execPath, [bin], { encoding: 'utf8' }).status, 2);
});

