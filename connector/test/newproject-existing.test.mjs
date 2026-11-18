// Track AM-10130: adding LaneConductor to an EXISTING repository. The interview is Markdown (ops/new-project.md); what must be
// deterministic is the reading of the repository (stack, test and lint commands, older tracks) and the scaffold that follows:
// the fixture is a small Node project with a package.json (test script), a README and a CI file.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO } from '../../scripts/build-plugin.mjs';
import { detectProject } from '../src/newproject/detect.mjs';
import { writeScaffold } from '../src/newproject/scaffold.mjs';
import { git } from './helpers/repo.mjs';

const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-existing-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let n = 0;
const BIN = path.join(REPO, 'connector/bin/lc-scaffold.mjs');

const PACKAGE_JSON = `${JSON.stringify({
  name: '@acme/inventory-api', version: '2.1.0', description: 'REST API that keeps the warehouse inventory.', type: 'module',
  scripts: { start: 'node server.js', test: 'node --test test/', lint: 'eslint .', build: 'tsc -p .', 'test:e2e': 'playwright test' },
  dependencies: { express: '^4.19.0' }, devDependencies: { eslint: '^9.0.0', typescript: '^5.4.0', '@playwright/test': '^1.45.0' },
  engines: { node: '>=20' },
}, null, 2)}\n`;
const README = '# Inventory API\n\nA REST API that keeps the warehouse inventory.\n\n## Run\n\nnpm start\n';
const CI = 'name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm test\n';

/** A committed existing repository: package.json, README, a CI file, a lockfile marker, a lint config and one source file. */
function existingRepo(extra = {}) {
  const dir = path.join(TMP, `repo${n++}`);
  fs.mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), PACKAGE_JSON);
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}\n');
  fs.writeFileSync(path.join(dir, 'README.md'), README);
  fs.writeFileSync(path.join(dir, '.github/workflows/ci.yml'), CI);
  fs.writeFileSync(path.join(dir, 'eslint.config.js'), 'export default [];\n');
  fs.writeFileSync(path.join(dir, 'src/index.js'), 'export {};\n');
  for (const [rel, content] of Object.entries(extra)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); }
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'T'); git(dir, 'config', 'user.email', 't@example.invalid');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
/** path -> sha1 of every file outside .git, to prove a run changed nothing. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.git') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex'); } };
  walk(dir);
  return out;
}

test('detectProject reads the project name, summary, stack and the REAL commands from package.json, README and CI', () => {
  const dir = existingRepo();
  const before = snapshot(dir);
  const { answers, evidence, existing } = detectProject(dir);
  assert.deepEqual(snapshot(dir), before, 'detection is read-only');
  assert.equal(answers.name, 'inventory-api');
  assert.equal(answers.summary, 'REST API that keeps the warehouse inventory.');
  assert.match(answers.stack.language, /TypeScript|JavaScript/);
  assert.match(answers.stack.language, /Node/);
  assert.equal(answers.stack.framework, 'Express');
  assert.match(answers.stack.testing, /node --test/);
  assert.deepEqual(answers.commands, { test: 'npm test', lint: 'npm run lint', build: 'npm run build', e2e: 'npm run test:e2e' });
  assert.ok(evidence.some((e) => /package\.json/.test(e)) && evidence.some((e) => /ci\.yml/.test(e)), `evidence names its sources: ${evidence}`);
  assert.equal(existing.conductor, false);
  assert.equal(existing.tracks.count, 0);
});

test('detectProject never invents a command: the npm placeholder test script, a missing lint script and a lint config alone give none', () => {
  const dir = path.join(TMP, `bare${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
  fs.writeFileSync(path.join(dir, '.eslintrc.json'), '{}');
  const { answers, evidence } = detectProject(dir);
  assert.deepEqual(answers.commands, {});
  assert.ok(evidence.some((e) => /no lint script/i.test(e)), `says the lint config has no script: ${evidence}`);
  assert.ok(answers.summary.length > 0, 'a summary placeholder keeps the answers valid');
  // Another toolchain: pnpm picks its own runner; a Python project with pytest gets pytest.
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'vitest run', lint: 'eslint .' } }));
  assert.deepEqual(detectProject(dir).answers.commands, { test: 'pnpm test', lint: 'pnpm run lint' });
  const py = path.join(TMP, `py${n++}`);
  fs.mkdirSync(py, { recursive: true });
  fs.writeFileSync(path.join(py, 'pyproject.toml'), '[project]\nname = "tool"\n[tool.pytest.ini_options]\n');
  assert.equal(detectProject(py).answers.commands.test, 'pytest');
  assert.equal(detectProject(py).answers.stack.language, 'Python');
});

test('an existing repository gets the conductor files with the detected stack and the real test command in quality-gate.md', () => {
  const dir = existingRepo();
  const { answers } = detectProject(dir);
  const r = writeScaffold(dir, answers, { firstTrack: false });
  assert.equal(r.gitInit, false, 'it is already a repository');
  for (const f of ['product.md', 'tech-stack.md', 'workflow.md', 'workflow.json', 'product-guidelines.md', 'design-language.md', 'quality-gate.md', 'user-stories.md', 'kpis.md']) assert.ok(fs.existsSync(path.join(dir, 'conductor', f)), `conductor/${f}`);
  assert.deepEqual(JSON.parse(read(dir, '.laneconductor.json')), { project: { name: 'inventory-api' }, connector: { state_branch: 'main' } });
  const gate = read(dir, 'conductor/quality-gate.md');
  assert.match(gate, /- \[ \] Unit \+ integration tests: `npm test`/);
  assert.match(gate, /`npm run lint`/);
  assert.match(gate, /`npm run test:e2e`/);
  assert.ok(!/\[x\]/i.test(gate), 'no box starts ticked');
  assert.ok(!gate.includes('audit') && !gate.includes('coverage'), 'no command the project does not have');
  const stack = read(dir, 'conductor/tech-stack.md');
  assert.match(stack, /- Framework: Express/);
  assert.match(stack, /Language: .*Node/);
  assert.match(read(dir, 'conductor/product.md'), /REST API that keeps the warehouse inventory\./);
  assert.ok(!fs.readdirSync(path.join(dir, 'conductor/tracks')).some((d) => /walking-skeleton/.test(d)), 'an existing project gets no made-up walking-skeleton track');
  assert.match(read(dir, '.gitignore'), /conductor\/tracks\/\*\*\/conversation\.md/);
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD'), '1', 'nothing is committed');
});

test('a second run changes nothing; an existing README, package.json, CI file and lint config are never touched', () => {
  const dir = existingRepo();
  const { answers } = detectProject(dir);
  const protectedFiles = ['README.md', 'package.json', 'package-lock.json', '.github/workflows/ci.yml', 'eslint.config.js', 'src/index.js'];
  const guard = Object.fromEntries(protectedFiles.map((f) => [f, read(dir, f)]));
  writeScaffold(dir, answers, { firstTrack: false });
  for (const f of protectedFiles) assert.equal(read(dir, f), guard[f], `${f} is byte for byte the same`);
  const after1 = snapshot(dir);
  const again = writeScaffold(dir, detectProject(dir).answers, { firstTrack: false });
  assert.deepEqual(again.created, []);
  assert.deepEqual(again.merged, []);
  assert.ok(again.skipped.length > 8, 'it reports what it skipped');
  assert.deepEqual(snapshot(dir), after1, 'the second run changed no file');
  // The same through the CLI, end to end: --detect (read only), then --answers with --no-first-track.
  const cli = existingRepo();
  const cliBefore = snapshot(cli);
  const d = spawnSync(process.execPath, [BIN, '--detect', '--dir', cli], { encoding: 'utf8' });
  assert.equal(d.status, 0, d.stderr);
  assert.deepEqual(snapshot(cli), cliBefore, '--detect writes nothing');
  const found = JSON.parse(d.stdout);
  assert.equal(found.answers.commands.test, 'npm test');
  const answersFile = path.join(TMP, `answers${n++}.json`);
  fs.writeFileSync(answersFile, JSON.stringify(found.answers));
  const run1 = JSON.parse(spawnSync(process.execPath, [BIN, '--answers', answersFile, '--dir', cli, '--no-first-track'], { encoding: 'utf8' }).stdout);
  assert.ok(run1.created.includes('conductor/quality-gate.md'));
  const cliAfter = snapshot(cli);
  const run2 = JSON.parse(spawnSync(process.execPath, [BIN, '--answers', answersFile, '--dir', cli, '--no-first-track'], { encoding: 'utf8' }).stdout);
  assert.deepEqual(run2.created, []);
  assert.deepEqual(snapshot(cli), cliAfter);
  assert.equal(read(cli, 'README.md'), README);
  assert.equal(read(cli, 'package.json'), PACKAGE_JSON);
});

test('files the project already has under conductor/ are kept, not replaced', () => {
  const dir = existingRepo({ 'conductor/quality-gate.md': 'MY GATE\n', 'conductor/product.md': 'MY PRODUCT\n', '.gitignore': 'node_modules/\n' });
  const r = writeScaffold(dir, detectProject(dir).answers, { firstTrack: false });
  assert.equal(read(dir, 'conductor/quality-gate.md'), 'MY GATE\n');
  assert.equal(read(dir, 'conductor/product.md'), 'MY PRODUCT\n');
  assert.ok(r.skipped.includes('conductor/quality-gate.md') && r.skipped.includes('conductor/product.md'));
  assert.match(read(dir, '.gitignore'), /^node_modules\/\n/);
});

test('conductor/tracks from an older LaneConductor are described, never imported or changed', () => {
  const dir = existingRepo({
    'conductor/tracks/AM-12-old-feature/index.md': '# Track AM-12: Old feature\n\n**Lane**: done\n**Lane Status**: success\n',
    'conductor/tracks/AM-13-in-flight/index.md': '# Track AM-13: In flight\n\n**Lane**: implement\n**Lane Status**: running\n',
    'conductor/tracks/007-bare-form/index.md': '# Track 7: bare\n\n**Lane**: plan\n**Lane Status**: queue\n',
    'conductor/tracks/feature_x_20260213/README.md': '# Gemini conductor track\n',
    'conductor/tracks/file_sync_queue.md': '# queue\n',
    'conductor/tracks.md': '# tracks\n',
    '.laneconductor.json': '{"mode":"local-api","project":{"id":4}}\n',
  });
  const before = snapshot(dir);
  const { existing, evidence } = detectProject(dir);
  assert.equal(existing.conductor, true);
  assert.equal(existing.config, true);
  assert.deepEqual({ count: existing.tracks.count, prefixed: existing.tracks.prefixed, bare: existing.tracks.bare }, { count: 4, prefixed: 2, bare: 1 });
  assert.deepEqual(existing.tracks.foreign, ['feature_x_20260213'], 'a folder that follows neither numbering form is named, not imported');
  assert.deepEqual(existing.tracks.lanes, { done: 1, implement: 1, plan: 1 });
  assert.ok(evidence.some((e) => /conductor\/tracks/.test(e) && /4/.test(e)), `evidence says what was found: ${evidence}`);
  assert.deepEqual(snapshot(dir), before, 'detection changed nothing');
  // The scaffold adds the missing context files only: the tracks and the old config stay byte for byte, and no track is added.
  const r = writeScaffold(dir, detectProject(dir).answers, { firstTrack: false });
  const after = snapshot(dir);
  for (const [f, sha] of Object.entries(before)) assert.equal(after[f], sha, `${f} is unchanged`);
  assert.ok(r.skipped.includes('.laneconductor.json'));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'conductor/tracks')).sort(), ['007-bare-form', 'AM-12-old-feature', 'AM-13-in-flight', 'feature_x_20260213', 'file_sync_queue.md']);
});

test('the walking skeleton is still the default for a new project and can be turned off for an existing one', () => {
  const a = { name: 'x', summary: 'y' };
  const on = writeScaffold(path.join(TMP, `new${n++}`), a);
  assert.ok(on.created.some((f) => /walking-skeleton/.test(f)));
  const off = writeScaffold(path.join(TMP, `new${n++}`), a, { firstTrack: false });
  assert.ok(!off.created.some((f) => /walking-skeleton/.test(f)));
});
