// Track AM-10117 (TC-7, TC-8, AC-6): the recipes live inside the skill as nested files. They are not registered as skills of their
// own (the plugin's skills/ folder holds one skill), they add no connector tool or always-on text, the shipped library passes the
// checker, the scripts ship in the full plugin, and the Markdown-only (lean) variant stays text-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, PLUGIN_REL, SERVER_ENTRIES, buildPlugin } from '../../scripts/build-plugin.mjs';
import { checkLibraryDir } from '../src/recipes/check-library.mjs';
import { TOOLS } from '../src/tools/index.mjs';

const PLUGIN = path.join(REPO, PLUGIN_REL);
const SKILL_SRC = path.join(REPO, '.claude/skills/laneconductor');

function skillFiles(root, rel = '') {
  return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? skillFiles(root, r) : [r];
  });
}

test('TC-7: the plugin registers ONE skill; recipes are nested files inside it', () => {
  assert.deepEqual(fs.readdirSync(path.join(PLUGIN, 'skills')), ['laneconductor'], 'skills/ holds only the laneconductor skill');
  const skillMds = skillFiles(path.join(PLUGIN, 'skills')).filter((f) => path.basename(f) === 'SKILL.md');
  assert.deepEqual(skillMds.filter((f) => f.split('/').length === 2), ['laneconductor/SKILL.md'], 'only one SKILL.md sits where Claude Code looks for a skill');
  assert.ok(skillMds.includes('laneconductor/recipes/example-hello/SKILL.md'), 'the shipped library is nested under the skill');
  for (const f of ['ops/new-project.md', 'ops/recipes.md', 'ops/apply-recipe.md', 'ops/add-recipe.md']) assert.ok(fs.existsSync(path.join(PLUGIN, 'skills/laneconductor', f)), f);
});

test('TC-7: no connector tool and no always-on text was added for recipes; the commands are prompts, not tools', () => {
  assert.deepEqual(TOOLS.map((t) => t.name).filter((n) => /recipe|project|bootstrap/i.test(n)), [], 'find_recipe and bootstrap_project are NOT added; the discovery test (Phase 4) decides');
  const fm = fs.readFileSync(path.join(SKILL_SRC, 'SKILL.md'), 'utf8').match(/^---\n([\s\S]*?)\n---\n/)[1];
  const field = (k) => (fm.match(new RegExp(`^${k}: (.*)$`, 'm')) ?? [])[1] ?? '';
  assert.ok(field('description').length + field('when_to_use').length <= 1536, 'the skill listing stays within its budget');
  assert.ok(!/recipe/i.test(field('description')), 'the always-loaded description does not grow for recipes');
});

test('the shipped library passes the checker with no errors (warnings only for references with no checkout here)', async () => {
  const res = await checkLibraryDir(SKILL_SRC);
  assert.equal(res.recipes, 1);
  assert.deepEqual(res.findings.filter((f) => f.severity === 'error'), []);
  assert.deepEqual(fs.readdirSync(path.join(SKILL_SRC, 'recipes')), ['example-hello'], 'the library ships empty apart from the one synthetic example (the real recipes wait for the privacy gate and the human)');
});

test('the full plugin ships the recipes, their scripts and yaml; the lean variant ships the recipe text but no scripts and no non-text recipe files', () => {
  const full = [...buildPlugin(REPO, 'full').keys()];
  for (const e of SERVER_ENTRIES) assert.ok(full.includes(`server/${e}`), e);
  for (const f of ['server/src/recipes/format.mjs', 'server/src/recipes/match.mjs', 'server/src/newproject/scaffold.mjs', 'skills/laneconductor/recipes/example-hello/files/HELLO.md.tmpl']) assert.ok(full.includes(f), f);
  assert.ok(JSON.parse(fs.readFileSync(path.join(PLUGIN, 'package.json'), 'utf8')).dependencies.yaml, 'the checker needs yaml: declared in the plugin package.json');
  const lean = [...buildPlugin(REPO, 'lean').keys()];
  assert.ok(lean.includes('skills/laneconductor/recipes/example-hello/SKILL.md'));
  assert.ok(lean.includes('skills/laneconductor/recipes/example-hello/files/hello.config.json'), 'a .json recipe file is text and stays');
  assert.ok(!lean.includes('skills/laneconductor/recipes/example-hello/files/HELLO.md.tmpl'), 'a .tmpl file is not on the lean variant\'s allowed list');
  assert.deepEqual(lean.filter((f) => f.startsWith('server/') || /\.mjs$/.test(f)), []);
});

test('the skill\'s recipe procedures name no private path or service, and never ask for a credential', () => {
  for (const f of ['new-project.md', 'recipes.md', 'apply-recipe.md', 'add-recipe.md']) {
    const text = fs.readFileSync(path.join(SKILL_SRC, 'ops', f), 'utf8');
    assert.ok(!/\/home\/|lc-recipes|laneconductor-site/.test(text), `${f} names no private path or project`);
    assert.match(text, /never|Never/, `${f} states what it never does`);
  }
  const apply = fs.readFileSync(path.join(SKILL_SRC, 'ops/apply-recipe.md'), 'utf8');
  assert.match(apply, /Never ask for a credential/);
  assert.match(apply, /shown, never executed/);
});
