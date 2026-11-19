// Track AM-10133: `.laneconductor.json` is an optional, personal settings file, written down once (ops/settings.md). Setup never creates or
// reads it; every tool that reads a key ignores the rest, silently, and an older file with other keys keeps working untouched.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, RELS, buildPlugin } from '../../scripts/build-plugin.mjs';
import { COMMANDS, helpText, helpData } from '../src/commands.mjs';
import { resolveStateBranch } from '../src/state-branch.mjs';
import { readPushPolicy } from '../src/push-policy.mjs';
import { renderScaffold, writeScaffold } from '../src/newproject/scaffold.mjs';
import { git } from './helpers/repo.mjs';
import { noLcHits } from './helpers/no-lc.mjs';

const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-settings-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let n = 0;
const BOARD = path.join(REPO, 'connector/bin/lc-board.mjs');
const KEYS = ['connector.state_branch', 'connector.push', 'board.artifact_url', 'board.include_docs', 'board.include_conversation', 'project.name', 'next.level', 'skills.declined'];
const SETTINGS_SRC = path.join(REPO, '.claude/skills/laneconductor/ops/settings.md');

function repo(settings, { branch = 'main' } = {}) {
  const dir = path.join(TMP, `r${n++}`);
  fs.mkdirSync(path.join(dir, 'conductor/tracks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'conductor/workflow.json'), '{"lanes":{"plan":{},"implement":{}}}\n');
  if (settings !== undefined) fs.writeFileSync(path.join(dir, '.laneconductor.json'), settings);
  git(dir, 'init', '-q', '-b', branch);
  git(dir, 'config', 'user.name', 'T'); git(dir, 'config', 'user.email', 't@example.invalid');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

test('TC-1 ops/settings.md is in the source skill and in the built base, lists exactly the eight keys, says optional and personal, and names the .gitignore line', () => {
  const built = buildPlugin(REPO, 'base');
  const f = (built.files ?? built).get('skills/laneconductor/ops/settings.md');
  assert.ok(f, 'the base ships ops/settings.md');
  const texts = [fs.readFileSync(SETTINGS_SRC, 'utf8'), String(f.content ?? f)];
  for (const text of texts) {
    const listed = [...text.matchAll(/^\| `([a-z_.]+)` \|/gm)].map((m) => m[1]);
    assert.deepEqual(listed, KEYS);
    assert.match(text, /optional/i);
    assert.match(text, /personal/i);
    assert.match(text, /`\.gitignore`/);
    assert.match(text, /\.laneconductor\.json/);
  }
  assert.equal(texts[0], texts[1].toString(), 'the base copy equals the source');
});

test('TC-2 parity: every key the code reads is listed in ops/settings.md, and every listed key is read by the code or the board procedure', () => {
  const doc = fs.readFileSync(SETTINGS_SRC, 'utf8');
  const listed = new Set([...doc.matchAll(/^\| `([a-z_.]+)` \|/gm)].map((m) => m[1]));
  const code = ['connector/src/state-branch.mjs', 'connector/src/push-policy.mjs', 'connector/bin/lc-board.mjs', 'connector/src/board-docs.mjs'].map((f) => fs.readFileSync(path.join(REPO, f), 'utf8')).join('\n');
  const read = new Set([...code.matchAll(/\bcfg\??\.([a-z_]+)\??\.([a-z_]+)/g)].map((m) => `${m[1]}.${m[2]}`));
  assert.ok(read.size >= 4, `found ${[...read]}`);
  for (const k of read) assert.ok(listed.has(k), `the code reads ${k}, which ops/settings.md does not list`);
  const procedure = ['board.md', 'next.md'].map((f) => fs.readFileSync(path.join(REPO, '.claude/skills/laneconductor/ops', f), 'utf8')).join('\n');
  for (const k of listed) assert.ok(read.has(k) || procedure.includes(k), `${k} is listed but read nowhere`);
});

test('TC-3 the scaffold file map and writeScaffold create no .laneconductor.json and add no line for it to .gitignore', () => {
  const files = renderScaffold({ name: 'x', summary: 'y' });
  assert.ok(![...files.keys()].some((k) => k.includes('.laneconductor.json')));
  const dir = path.join(TMP, `s${n++}`);
  const r = writeScaffold(dir, { name: 'x', summary: 'y' });
  assert.ok(!fs.existsSync(path.join(dir, '.laneconductor.json')) && !r.created.includes('.laneconductor.json'));
  assert.ok(!fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').includes('.laneconductor.json'));
});

test('TC-4 an OLD settings file (mode, project id, collectors): the state branch, the push policy, the board script and the scaffold run with no problem and leave it byte-identical', () => {
  const old = '{"mode":"local-api","project":{"id":4},"collectors":[{"url":"x"}],"worker":{"mode":"sync-only"}}\n';
  const dir = repo(old);
  const sb = resolveStateBranch(dir);
  assert.equal(sb.problem, undefined);
  assert.equal(sb.source, 'current_branch');
  assert.deepEqual(readPushPolicy(dir), { policy: 'ask' });
  const site = path.join(TMP, `site${n++}`);
  const b = spawnSync(process.execPath, [BOARD, '--repo', dir, '--site', site, '--json'], { encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr);
  assert.equal(b.stderr, '', 'no warning on stderr');
  writeScaffold(dir, { name: 'x', summary: 'y' }, { firstTrack: false });
  assert.equal(fs.readFileSync(path.join(dir, '.laneconductor.json'), 'utf8'), old);
});

test('TC-5 a settings file that is not valid JSON: the push policy says so once and uses ask; the state branch and the board carry on with defaults', () => {
  const dir = repo('{ not json');
  assert.match(readPushPolicy(dir).problem, /not valid JSON/);
  assert.equal(readPushPolicy(dir).policy, 'ask');
  assert.equal(resolveStateBranch(dir).branch, 'main');
  const b = spawnSync(process.execPath, [BOARD, '--repo', dir], { encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr);
});

test('TC-6 a new project with no remote on main and no settings file: the state branch is main, from the current branch', () => {
  const dir = repo(undefined);
  assert.deepEqual(resolveStateBranch(dir), { branch: 'main', source: 'current_branch' });
});

test('TC-12 helpText and helpData carry no lc command-line wording; the JSON field is needs_board_script', () => {
  assert.deepEqual(noLcHits(helpText()), []);
  assert.doesNotMatch(helpText(), /command-line tool/);
  assert.match(helpText(), /Needs the board add-on's script: board \(only to refresh\)./);
  const cmds = helpData().commands;
  assert.ok(cmds.every((c) => 'needs_board_script' in c && !('needs_lc' in c)));
  assert.deepEqual(cmds.filter((c) => c.needs_board_script).map((c) => c.name), ['board']);
});

test('TC-13 the board script prints board: (not lc board:) on stderr, and --check says how to rebuild with node', () => {
  const dir = repo(undefined);
  const bad = spawnSync(process.execPath, [BOARD, '--repo', dir, '--now', 'nope'], { encoding: 'utf8' });
  assert.match(bad.stderr, /^board: --now is not a date/);
  const chk = spawnSync(process.execPath, [BOARD, '--repo', dir, '--check', path.join(TMP, 'missing.json')], { encoding: 'utf8' });
  assert.match(chk.stdout, /Run: node .*lc-board\.mjs --out /);
  assert.ok(!/lc board/.test(chk.stdout + chk.stderr + bad.stderr));
});

test('TC-14 board (no argument) still reads board.artifact_url and handles the missing file or key', () => {
  const show = COMMANDS.find((c) => c.name === 'board');
  assert.match(show.procedure, /board\.artifact_url/);
  assert.match(show.procedure, /If no board URL is stored, say so and ask me "Create a private board for this project\?"; create nothing without my yes/);
  const board = fs.readFileSync(path.join(REPO, RELS.base, 'skills/laneconductor/ops/board.md'), 'utf8');
  assert.match(board, /may be missing or have no `board` key; then there is no stored URL/);
  assert.match(board, /listed in `\.gitignore`/);
});
