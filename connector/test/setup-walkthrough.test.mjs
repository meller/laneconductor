// Track AM-10133: `/laneconductor:setup` works on a machine that has no `lc` command and no settings file, and on one that still has the old
// `lc` and `~/.laneconductorrc`: nothing looks for them, nothing calls them. The deterministic part of setup is the scaffold script, the board
// script, the connector and the generated procedure text; the walk-through runs all of them with a PATH that holds only `node` and `git`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, RELS, buildPlugin } from '../../scripts/build-plugin.mjs';
import { COMMANDS, renderCommand } from '../src/commands.mjs';
import { noLcHits } from './helpers/no-lc.mjs';
import { connect } from './helpers/mcp.mjs';
import { git } from './helpers/repo.mjs';

const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-walk-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let n = 0;
const SCAFFOLD = path.join(REPO, 'connector/bin/lc-scaffold.mjs');
const BOARD = path.join(REPO, 'connector/bin/lc-board.mjs');

const which = (name) => {
  for (const d of (process.env.PATH ?? '').split(path.delimiter)) { const p = path.join(d, name); if (fs.existsSync(p)) return p; }
  throw new Error(`${name} not found on PATH`);
};
/** A PATH holding symlinks to node and git only (plus, optionally, a fake `lc` that leaves a marker when it is run). */
function bareEnv({ fakeLc = false } = {}) {
  const bin = path.join(TMP, `bin${n++}`);
  const home = path.join(TMP, `home${n++}`);
  fs.mkdirSync(bin); fs.mkdirSync(home);
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  fs.symlinkSync(which('git'), path.join(bin, 'git'));
  const marker = path.join(TMP, `lc-was-run${n++}`);
  if (fakeLc) { fs.writeFileSync(path.join(bin, 'lc'), `#!/bin/sh\necho run > "${marker}"\n`); fs.chmodSync(path.join(bin, 'lc'), 0o755); }
  return { env: { PATH: bin, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' }, bin, home, marker };
}
const run = (file, args, { env, cwd }) => spawnSync(process.execPath, [file, ...args], { env, cwd, encoding: 'utf8' });

const PACKAGE_JSON = `${JSON.stringify({ name: 'inventory-api', version: '1.0.0', description: 'REST API that keeps the warehouse inventory.', scripts: { test: 'node --test test/', lint: 'eslint .' }, dependencies: { express: '^4.19.0' } }, null, 2)}\n`;
function scratch(extra = {}) {
  const dir = path.join(TMP, `repo${n++}`);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), PACKAGE_JSON);
  fs.writeFileSync(path.join(dir, 'README.md'), '# Inventory API\n\nA REST API that keeps the warehouse inventory.\n');
  fs.writeFileSync(path.join(dir, 'src/index.js'), 'export {};\n');
  for (const [rel, content] of Object.entries(extra)) fs.writeFileSync(path.join(dir, rel), content);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'T'); git(dir, 'config', 'user.email', 't@example.invalid');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}
const commits = (dir) => spawnSync('git', ['-C', dir, 'rev-list', '--all', '--count'], { encoding: 'utf8' }).stdout.trim();

/** Runs the five deterministic steps of setup against `dir`; returns every stdout/stderr text produced. */
function walk(dir, ctx) {
  const outputs = [];
  const step = (file, args) => { const r = run(file, args, { env: ctx.env, cwd: dir }); outputs.push(r.stdout, r.stderr); return r; };
  const d = step(SCAFFOLD, ['--detect', '--dir', '.']);
  assert.equal(d.status, 0, d.stderr);
  const detected = JSON.parse(d.stdout);
  assert.ok(detected.answers && detected.evidence && detected.existing, 'detect prints answers, evidence and existing');
  const answersFile = path.join(TMP, `answers${n++}.json`);
  fs.writeFileSync(answersFile, JSON.stringify(detected.answers));
  const before = fs.readdirSync(dir).sort();
  const dry = step(SCAFFOLD, ['--answers', answersFile, '--dir', '.', '--dry-run', '--no-first-track']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.ok(JSON.parse(dry.stdout).created.includes('conductor/product.md'), 'the dry run lists what it would create');
  assert.deepEqual(fs.readdirSync(dir).sort(), before, 'a dry run writes nothing');
  const real = step(SCAFFOLD, ['--answers', answersFile, '--dir', '.', '--no-first-track']);
  assert.equal(real.status, 0, real.stderr);
  const site = path.join(TMP, `site${n++}`);
  const board = step(BOARD, ['--repo', '.', '--site', site, '--json']);
  assert.equal(board.status, 0, board.stderr);
  assert.ok(JSON.parse(board.stdout).page.endsWith('board.html') && fs.existsSync(path.join(site, 'board.html')));
  return { outputs, detected, created: JSON.parse(real.stdout) };
}

test('setup walk-through on a scratch repository with no lc on PATH: scaffold, board, no settings file, no commit, no lc anywhere in the output', () => {
  const ctx = bareEnv();
  const probe = spawnSync('which', ['lc'], { env: ctx.env, encoding: 'utf8' });
  assert.notEqual(probe.status, 0, 'lc is not found in this environment');
  const dir = scratch();
  const { outputs, created } = walk(dir, ctx);
  for (const rel of ['conductor/product.md', 'conductor/quality-gate.md', 'conductor/workflow.json']) assert.ok(fs.existsSync(path.join(dir, rel)), rel);
  assert.ok(fs.existsSync(path.join(dir, 'conductor/tracks')));
  assert.ok(!fs.existsSync(path.join(dir, '.laneconductor.json')), 'no settings file is created');
  assert.ok(!created.created.includes('.laneconductor.json'));
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /\.worktrees\//);
  assert.equal(commits(dir), '1', 'nothing was committed');
  for (const text of outputs) assert.deepEqual(noLcHits(text), [], 'no output names an lc command');
});

test('the same walk-through with an OLD settings file and a fake lc on PATH: nothing calls lc, the old file is untouched and reported as left alone', () => {
  const ctx = bareEnv({ fakeLc: true });
  const old = '{"mode":"local-api","project":{"id":4},"collectors":[]}\n';
  const dir = scratch({ '.laneconductor.json': old });
  fs.writeFileSync(path.join(ctx.home, '.laneconductorrc'), '{}\n');
  const { outputs, detected } = walk(dir, ctx);
  assert.ok(!fs.existsSync(ctx.marker), 'the fake lc was never run');
  assert.equal(fs.readFileSync(path.join(dir, '.laneconductor.json'), 'utf8'), old, 'the old file is byte-identical');
  assert.equal(detected.existing.config, true);
  assert.ok(detected.evidence.some((e) => /settings file.*left as it is/.test(e)));
  for (const text of outputs) { assert.deepEqual(noLcHits(text), []); assert.ok(!/warning|not valid|ignored key/i.test(text), 'no complaint about the old keys'); }
  assert.equal(fs.readFileSync(path.join(ctx.home, '.laneconductorrc'), 'utf8'), '{}\n', 'the rc file in HOME is not touched');
});

test('the generated setup procedure, read the way a session would, names no program that does not exist', () => {
  const base = buildPlugin(REPO, 'base');
  const get = (rel) => { const f = (base.files ?? base).get(rel); const c = f.content ?? f; return Buffer.isBuffer(c) ? c.toString('utf8') : String(c); };
  const texts = {
    command: renderCommand(COMMANDS.find((c) => c.name === 'setup'), { action: '' }),
    newProject: get('skills/laneconductor/ops/new-project.md'),
    setup: get('skills/laneconductor/setup/setup.md'),
  };
  const ALLOWED = new Set(['node', 'git', 'gh', 'claude', 'npm', 'npx']);
  const SHELLISH = /^(node|git|gh|claude|npm|npx|make|lc|which|command|sudo|brew|apt|pip|docker|psql|curl|wget|sh|bash|rm|cp|ln) /;
  const bad = [];
  // Shown, never run: the removal of a stale project-level skill (a plain delete of that one path).
  const STALE_SKILL_REMOVAL = /^(git )?rm( -r)?( \.claude\/skills\/laneconductor)?$/;
  for (const [name, text] of Object.entries(texts)) {
    assert.deepEqual(noLcHits(text), [], `${name} names no lc command`);
    assert.ok(!/\.laneconductor\.json/.test(text), `${name} never names the settings file`);
    for (const m of text.matchAll(/`([^`\n]+)`/g)) if (SHELLISH.test(m[1]) && !ALLOWED.has(m[1].split(' ')[0]) && !STALE_SKILL_REMOVAL.test(m[1])) bad.push(`${name}: ${m[1]}`);
  }
  assert.deepEqual(bad, []);
  assert.match(texts.command, /look for no program other than `git`/);
  assert.match(texts.command, /say which optional plugins fit it/);
});

test('the connector starts and serves get_context and list_tracks with no lc on PATH', async () => {
  const ctx = bareEnv();
  const dir = scratch();
  assert.equal(run(SCAFFOLD, ['--answers', (() => { const f = path.join(TMP, `a${n++}.json`); fs.writeFileSync(f, JSON.stringify({ name: 'x', summary: 'y' })); return f; })(), '--dir', '.', '--no-first-track'], { env: ctx.env, cwd: dir }).status, 0);
  git(dir, 'add', 'conductor', '.gitignore'); git(dir, 'commit', '-q', '-m', 'scaffold');
  const saved = process.env.PATH;
  process.env.PATH = ctx.bin;
  let s;
  try {
    s = await connect(dir);
    const a = await s.call('get_context', {});
    assert.equal(a.isError, false, a.text);
    const b = await s.call('list_tracks', {});
    assert.equal(b.isError, false, b.text);
  } finally { process.env.PATH = saved; await s?.close(); }
});
