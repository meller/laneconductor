// Track AM-10115 Phase 0 (tasks 0.4, 0.5, 0.6, 0.7): the board add-on's two hooks and its refresh command. The hook script is run as Claude Code
// runs it: the event JSON on stdin, CLAUDE_PLUGIN_DATA and CLAUDE_PROJECT_DIR in the environment. Protocol facts used (Claude Code hooks reference,
// code.claude.com/docs/en/hooks, checked 2026-11-19): PostToolUse input has cwd, tool_name, tool_input, tool_response; Stop input has
// stop_hook_active; a Stop hook continues Claude with {"decision":"block","reason":...}; systemMessage is shown to the user; a plugin's hooks are
// in hooks/hooks.json under a top-level "hooks" key; CLAUDE_PLUGIN_DATA is the plugin's persistent data directory.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, PLUGIN_REL, PARALLEL_REL, BOARD_REL } from '../../scripts/build-plugin.mjs';

const BOARD = path.join(REPO, BOARD_REL);
const BASE = path.join(REPO, PLUGIN_REL);
const SCRIPT = path.join(BOARD, 'hooks/lc-board-hook.mjs');
const UPDATE = 'mcp__plugin_laneconductor-parallel_lc__update_track';
const CREATE = 'mcp__plugin_laneconductor-parallel_lc__create_track';
const real = fs.realpathSync(os.tmpdir());
const cleanup = [];
after(() => { for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };
const write = (dir, rel, text) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
const tree = (dir, rel = '') => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tree(dir, path.join(rel, e.name)) : [path.join(rel, e.name)])).sort();

/** A project with a track folder; `settings` becomes .laneconductor.json (a string is written as is, null writes none). */
function project(settings = { board: { artifact_url: 'https://claude.ai/artifact/abc' } }) {
  const dir = tmp('lc-hook-proj-');
  write(dir, 'conductor/tracks/AM-1-one/index.md', '# Track AM-1: One\n\n**Lane**: plan\n');
  write(dir, 'conductor/product.md', '# Product\n');
  write(dir, 'README.md', '# readme\n');
  if (settings !== null) write(dir, '.laneconductor.json', typeof settings === 'string' ? settings : JSON.stringify(settings));
  return dir;
}
const auto = (extra = {}) => ({ board: { artifact_url: 'https://claude.ai/artifact/abc', auto_update: true, ...extra } });

function run(kind, input, { data, project: proj, env = {}, raw } = {}) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [SCRIPT, kind], {
    input: raw ?? JSON.stringify(input),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...(data ? { CLAUDE_PLUGIN_DATA: data } : {}), ...(proj ? { CLAUDE_PROJECT_DIR: proj } : {}), ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}
const post = (proj, tool_name, tool_input, data, more = {}) => run('post', { hook_event_name: 'PostToolUse', session_id: 's1', cwd: proj, tool_name, tool_input, tool_response: {}, ...more }, { data, project: proj });
const stop = (proj, data, more = {}) => run('stop', { hook_event_name: 'Stop', session_id: 's1', cwd: proj, stop_hook_active: false, ...more }, { data, project: proj });
const markers = (data) => (fs.existsSync(path.join(data, 'state')) ? fs.readdirSync(path.join(data, 'state')).filter((f) => f.startsWith('stale-')) : []);
const silent = (r, what) => { assert.equal(r.status, 0, `${what}: ${r.stderr}`); assert.equal(r.stdout, '', `${what}: prints nothing`); assert.equal(r.stderr, '', `${what}: no stderr`); };

test('H2 a lane change by the connector sets the marker, in the plugin data directory and nowhere in the project; it prints nothing', () => {
  const proj = project(); const data = tmp('lc-hook-data-');
  const before = tree(proj);
  silent(post(proj, UPDATE, { track: '1', base: {}, markers: { 'Lane Status': 'success', Progress: '40%' } }, data), 'update_track');
  assert.equal(markers(data).length, 1);
  assert.deepEqual(tree(proj), before, 'nothing written into the project (so none in .git or the working tree)');
  assert.ok(/^stale-[0-9a-f]{16}\.json$/.test(markers(data)[0]), 'keyed by a hash of the project path');
  assert.ok(!fs.readFileSync(path.join(data, 'state', markers(data)[0]), 'utf8').includes(proj), 'the marker holds no path');
});

test('H2 create_track and an outcome both set it; an update_track that changes nothing, a failed one and an unrelated tool do not', () => {
  const proj = project();
  const check = (tool, input, more, expected, what) => {
    const data = tmp('lc-hook-data-');
    silent(post(proj, tool, input, data, more), what);
    assert.equal(markers(data).length, expected, what);
  };
  check(CREATE, { title: 'x' }, {}, 1, 'create_track');
  check(UPDATE, { track: '1', base: {}, outcome: 'success' }, {}, 1, 'outcome');
  check(UPDATE, { track: '1', base: {}, files: { plan: '# p' } }, {}, 1, 'files');
  check(UPDATE, { track: '1', base: {}, markers: {} }, {}, 0, 'empty markers');
  check(UPDATE, { track: '1', base: {} }, {}, 0, 'nothing to update');
  check(UPDATE, { track: '1', base: {}, markers: { Lane: 'x' } }, { tool_response: { isError: true } }, 0, 'a failed call');
  check('mcp__plugin_laneconductor-parallel_lc__get_track', { track: '1' }, {}, 0, 'a read tool');
  check('Bash', { command: 'ls conductor/tracks' }, {}, 0, 'Bash');
});

test('H2 Edit and Write of a track document set it (absolute and relative path); README, the project files, other files and no-op edits do not', () => {
  const proj = project();
  const check = (tool, input, expected, what, more = {}) => {
    const data = tmp('lc-hook-data-');
    silent(post(proj, tool, input, data, more), what);
    assert.equal(markers(data).length, expected, what);
  };
  check('Edit', { file_path: path.join(proj, 'conductor/tracks/AM-1-one/index.md'), old_string: 'plan', new_string: 'implement' }, 1, 'Edit of index.md (absolute)');
  check('Edit', { file_path: 'conductor/tracks/AM-1-one/index.md', old_string: 'plan', new_string: 'implement' }, 1, 'Edit of index.md (relative to cwd)');
  check('Write', { file_path: path.join(proj, 'conductor/tracks/AM-1-one/plan.md'), content: '# plan' }, 1, 'Write of plan.md');
  check('Write', { file_path: path.join(proj, 'conductor/tracks/AM-1-one/spec.md'), content: '# spec' }, 1, 'Write of spec.md');
  check('Write', { file_path: path.join(proj, 'conductor/tracks/AM-1-one/test.md'), content: '# test' }, 1, 'Write of test.md');
  check('Edit', { file_path: path.join(proj, 'README.md'), old_string: 'readme', new_string: 'changed' }, 0, 'Edit of README.md');
  check('Write', { file_path: path.join(proj, 'conductor/product.md'), content: 'x' }, 0, 'a project file is not a track');
  check('Write', { file_path: path.join(proj, 'conductor/tracks/AM-1-one/notes.txt'), content: 'x' }, 0, 'another file of the track folder');
  check('Write', { file_path: path.join(proj, 'conductor/tracks/AM-1-one/conversation.md'), content: 'x' }, 0, 'conversation.md is not on the board by default');
  check('Write', { file_path: path.join(proj, 'conductor/tracks/_duplicate-1/index.md'), content: 'x' }, 0, 'an archived copy');
  check('Write', { file_path: path.join(proj, 'conductor/tracks/index.md'), content: 'x' }, 0, 'a file directly under tracks/');
  check('Edit', { file_path: path.join(proj, 'conductor/tracks/AM-1-one/index.md'), old_string: 'same', new_string: 'same' }, 0, 'an edit that changes nothing');
  check('Edit', { file_path: path.join(real, 'elsewhere/conductor/tracks/AM-9-x/index.md'), old_string: 'a', new_string: 'b' }, 0, 'a track of another project');
  check('Edit', { old_string: 'a', new_string: 'b' }, 0, 'no file path');
  // conversation.md counts only when the board shows it.
  const withConv = project({ board: { include_conversation: true } });
  const data = tmp('lc-hook-data-');
  silent(post(withConv, 'Write', { file_path: path.join(withConv, 'conductor/tracks/AM-1-one/conversation.md'), content: 'x' }, data), 'conversation');
  assert.equal(markers(data).length, 1);
});

test('H2 silent in a project with no conductor/tracks/ (and writes nothing, not even the data directory); garbage or empty input is silent too', () => {
  const plain = tmp('lc-hook-plain-'); write(plain, 'src/a.js', 'x'); write(plain, '.laneconductor.json', '{}');
  const data = path.join(tmp('lc-hook-data-'), 'never-created');
  silent(post(plain, 'Write', { file_path: path.join(plain, 'conductor/tracks/AM-1-x/index.md'), content: 'x' }, data), 'post, no tracks folder');
  silent(stop(plain, data), 'stop, no tracks folder');
  assert.ok(!fs.existsSync(data), 'the data directory is not even created');
  for (const raw of ['', 'not json', 'null', '[]', '{"tool_name":5}']) {
    silent(run('post', null, { data, raw }), `post input ${JSON.stringify(raw)}`);
    silent(run('stop', null, { data, raw }), `stop input ${JSON.stringify(raw)}`);
  }
  silent(run('other', {}, { data }), 'unknown event');
  assert.ok(!fs.existsSync(data));
});

test('H3 default on, explicit off: with no auto_update key and a stored board Stop asks Claude to refresh; only an explicit false (or the string "false") keeps it silent and leaves the marker', () => {
  const dflt = project({ board: { artifact_url: 'https://claude.ai/artifact/abc' } }); const d1 = tmp('lc-hook-data-');
  silent(stop(dflt, d1), 'no marker yet');
  post(dflt, UPDATE, { track: '1', base: {}, markers: { Lane: 'implement' } }, d1);
  const first = stop(dflt, d1);
  assert.equal(first.status, 0);
  assert.equal(JSON.parse(first.stdout).decision, 'block', 'the default is on');
  assert.equal(markers(d1).length, 0);
  for (const off of [false, 'false']) {
    const proj = project({ board: { artifact_url: 'https://claude.ai/artifact/abc', auto_update: off } }); const data = tmp('lc-hook-data-');
    post(proj, UPDATE, { track: '1', base: {}, summary: 'x' }, data);
    silent(stop(proj, data), `auto_update ${JSON.stringify(off)}`);
    assert.equal(markers(data).length, 1, 'the marker stays; nothing is printed, no nagging line');
  }
  // anything that is not false keeps the default on, including true and a string like "true"
  for (const on of [true, 'true', 'yes']) {
    const proj = project({ board: { artifact_url: 'https://claude.ai/artifact/abc', auto_update: on } }); const data = tmp('lc-hook-data-');
    post(proj, UPDATE, { track: '1', base: {}, summary: 'x' }, data);
    assert.equal(JSON.parse(stop(proj, data).stdout).decision, 'block', `auto_update ${JSON.stringify(on)}`);
  }
});

test('H3 option on with the marker and a stored board: Stop asks Claude to continue once with one short instruction naming the refresh command, and clears the marker', () => {
  const proj = project(auto()); const data = tmp('lc-hook-data-');
  post(proj, 'Edit', { file_path: path.join(proj, 'conductor/tracks/AM-1-one/index.md'), old_string: 'plan', new_string: 'review' }, data);
  assert.equal(markers(data).length, 1);
  const r = stop(proj, data);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.ok(out.reason.includes('/laneconductor:board refresh') && out.reason.length < 300, out.reason);
  assert.equal(markers(data).length, 0, 'cleared before asking: the refresh itself cannot re-arm a loop');
  assert.ok(!/https?:|abc|\.md/.test(out.reason), 'no URL and no file names');
  silent(stop(proj, data), 'the next Stop: nothing is left to do');
});

test('H3 loop guard: with stop_hook_active true the hook does nothing and keeps the marker for the next turn', () => {
  const proj = project(auto()); const data = tmp('lc-hook-data-');
  post(proj, UPDATE, { track: '1', base: {}, markers: { Lane: 'review' } }, data);
  silent(stop(proj, data, { stop_hook_active: true }), 'stop_hook_active');
  assert.equal(markers(data).length, 1);
  assert.equal(JSON.parse(stop(proj, data, { stop_hook_active: false }).stdout).decision, 'block');
});

test('H3 no stored board: there is nothing to refresh, so Stop is silent whatever the option says, and the marker stays; no marker is silent too', () => {
  for (const board of [{ auto_update: true }, {}, { auto_update: false }]) {
    const noUrl = project({ board }); const data = tmp('lc-hook-data-');
    silent(stop(noUrl, data), 'no marker');
    post(noUrl, UPDATE, { track: '1', base: {}, markers: { Lane: 'plan' } }, data);
    silent(stop(noUrl, data), `no URL, board ${JSON.stringify(board)}`);
    assert.equal(markers(data).length, 1);
  }
});

test('H3 .laneconductor.json missing, invalid or without a board key: silent, no crash, marker untouched', () => {
  for (const [name, settings] of [['missing', null], ['invalid', '{ not json'], ['empty', ''], ['array', '[]'], ['no board key', '{"project":{"name":"x"}}'], ['board is a string', '{"board":"yes"}']]) {
    const proj = project(settings); const data = tmp('lc-hook-data-');
    silent(post(proj, UPDATE, { track: '1', base: {}, markers: { Lane: 'plan' } }, data), `${name}: post`);
    silent(stop(proj, data), `${name}: stop`);
    assert.equal(markers(data).length, 1, `${name}: marker kept`);
  }
});

test('the marker is per project (hash of the path), and without CLAUDE_PLUGIN_DATA the fallback is the system temp directory, still outside the project', () => {
  const a = project(); const b = project(); const data = tmp('lc-hook-data-');
  post(a, UPDATE, { track: '1', base: {}, markers: { Lane: 'plan' } }, data);
  assert.equal(markers(data).length, 1);
  post(b, UPDATE, { track: '1', base: {}, markers: { Lane: 'plan' } }, data);
  assert.equal(markers(data).length, 2, 'two projects, two markers');
  const sys = tmp('lc-hook-tmpdir-');
  const before = tree(a);
  const r = run('post', { cwd: a, tool_name: UPDATE, tool_input: { track: '1', base: {}, markers: { Lane: 'plan' } } }, { project: a, env: { TMPDIR: sys } });
  silent(r, 'no CLAUDE_PLUGIN_DATA');
  assert.equal(fs.readdirSync(path.join(sys, 'laneconductor-board-hook/state')).filter((f) => f.startsWith('stale-')).length, 1);
  assert.deepEqual(tree(a), before);
});

test('speed: one hook run is far under a second (the budget is 100 ms of work; node start-up is included here)', () => {
  const proj = project(auto()); const data = tmp('lc-hook-data-');
  const times = [post(proj, 'Write', { file_path: path.join(proj, 'conductor/tracks/AM-1-one/plan.md'), content: 'x' }, data).ms, stop(proj, data).ms];
  for (const t of times) assert.ok(t < 1000, `${t} ms`);
});

// ---- what ships: hooks.json, the refresh command, and a base that stays free of hooks ----

test('the board add-on\'s hooks.json: the documented shape, the two events, every command path through ${CLAUDE_PLUGIN_ROOT} only, the script it names exists', () => {
  const file = JSON.parse(fs.readFileSync(path.join(BOARD, 'hooks/hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(file).sort(), ['description', 'hooks'], 'a top-level "hooks" key');
  assert.deepEqual(Object.keys(file.hooks).sort(), ['PostToolUse', 'Stop']);
  const matcher = file.hooks.PostToolUse[0].matcher.split('|');
  assert.deepEqual(matcher, [`${UPDATE.replace('update_track', 'create_track')}`, UPDATE, 'Edit', 'Write']);
  assert.equal(file.hooks.Stop[0].matcher, undefined, 'Stop has no matcher');
  const hooks = [...file.hooks.PostToolUse, ...file.hooks.Stop].flatMap((g) => g.hooks);
  assert.equal(hooks.length, 2);
  for (const h of hooks) {
    assert.equal(h.type, 'command');
    assert.ok(h.timeout <= 10);
    assert.deepEqual([...new Set(h.command.match(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g))], ['${CLAUDE_PLUGIN_ROOT}'], 'only ${CLAUDE_PLUGIN_ROOT}');
    assert.match(h.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}"\/hooks\/lc-board-hook\.mjs (post|stop)$/);
    assert.ok(!/npx|npm|curl|wget|sudo/.test(h.command));
  }
  assert.ok(fs.existsSync(SCRIPT));
  const manifest = JSON.parse(fs.readFileSync(path.join(BOARD, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.hooks, undefined, 'hooks/hooks.json is the standard location: the manifest does not repeat it');
  assert.equal(manifest.dependencies, undefined);
});

test('the hook script: no network, no write inside a project, and the only child process is a read-only git (rev-parse, status); the stop instruction names a command of the base plugin', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(!/node:(http|https|net|dgram|dns|tls)|fetch\(|XMLHttpRequest|spawn|exec\(|execSync/.test(src));
  const imports = [...src.matchAll(/from 'node:child_process'/g)].length;
  assert.equal(imports, 1, 'one child_process import');
  assert.ok(src.includes("import { execFileSync } from 'node:child_process';"), 'only execFileSync, never a shell');
  assert.equal([...src.matchAll(/execFileSync\(/g)].length, 1, 'one place runs a program');
  assert.ok(src.includes("execFileSync('git', ['-C', root, ...args]"), 'that program is git');
  const verbs = [...src.matchAll(/\bgit\(root, \['([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(verbs.length >= 2 && verbs.every((v) => ['rev-parse', 'status'].includes(v)), `only read-only git verbs: ${verbs}`);
  assert.ok(src.length < 16000);
  // The hook asks for a BASE command, so everything is typed under /laneconductor: (the add-on ships no commands).
  const baseName = JSON.parse(fs.readFileSync(path.join(BASE, '.claude-plugin/plugin.json'), 'utf8')).name;
  const command = src.match(/const REFRESH = '\/([a-z-]+):([a-z-]+) ([a-z]+)'/);
  assert.deepEqual([command[1], command[2], command[3]], [baseName, 'board', 'refresh']);
  assert.ok(fs.existsSync(path.join(BASE, 'commands', `${command[2]}.md`)), 'the base has that command');
  assert.ok(!fs.existsSync(path.join(BOARD, 'commands')), 'the add-on has no commands folder');
});

const BOARD_OPS = () => fs.readFileSync(path.join(BASE, 'skills/laneconductor/ops/board.md'), 'utf8');
test('the base board refresh: reads the live manifest, passes it to --previous, publishes only the publish map, full publish on first publish, conflict or failure, keeps the privacy handling', () => {
  const text = BOARD_OPS();
  assert.ok(text.includes('"manifest.json", "board.json"') && text.includes('--previous') && text.includes('--live-board') && text.includes('`none`'));
  assert.match(text, /`files` = the `publish` map and nothing more/);
  assert.match(text, /A conflict or any failure: run step 2 again with `none`/);
  assert.match(text, /scope: "files"/);
  assert.match(text, /Only Claude can create or update an artifact/);
  assert.match(text, /withheld/);
  assert.match(text, /never repeat or look for the matched text/);
  assert.match(text, /never share/i);
  // With no stored URL the base command creates the board (owner: running the command is the request); the add-on is found by Glob.
  assert.match(text, /## 3b\. No URL: create/);
  assert.ok(text.includes('**/laneconductor-board/**/bin/lc-board.mjs'));
});

test('the BASE plugin still has no hooks: no hooks folder, no hooks key in its manifest, no hook script, and no command or file of the board add-on', () => {
  assert.ok(!fs.existsSync(path.join(BASE, 'hooks')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(BASE, '.claude-plugin/plugin.json'), 'utf8')).hooks, undefined);
  assert.ok(!fs.existsSync(path.join(BASE, 'commands/refresh.md')));
  assert.ok(!fs.existsSync(path.join(BOARD, 'commands')), 'and the add-on ships no command either');
  const all = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const f of all(BASE)) {
    assert.ok(!/lc-board-hook|hooks\.json/.test(path.basename(f)), f);
    assert.ok(!/\.(mjs|js|sh)$/.test(f), `${f}: the base is Markdown and JSON only`);
  }
  assert.ok(!fs.existsSync(path.join(REPO, PARALLEL_REL, 'hooks')), 'the parallel add-on has none either');
});

// ---- H4: the Stop hook also notices a change of the tracks by any tool (Bash, a scratch worktree, another session, a push).
const sh = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
/** A git project on `main` whose origin/main points at its HEAD, like a clone after a fetch. */
function gitProject(settings) {
  const dir = project(settings);
  sh(dir, 'init', '-q', '-b', 'main'); sh(dir, 'config', 'user.email', 't@example.com'); sh(dir, 'config', 'user.name', 't');
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'init'); sh(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return dir;
}
const pushTrackChange = (dir, text = '# Track AM-1: One\n\n**Lane**: implement\n') => {
  // what a push from a scratch worktree does to this clone: origin/main moves, the working tree here does not
  sh(dir, 'checkout', '-q', '-b', 'scratch'); write(dir, 'conductor/tracks/AM-1-one/index.md', text);
  sh(dir, 'commit', '-qam', 'track'); sh(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD'); sh(dir, 'checkout', '-q', 'main');
};
const REFRESH_ASK = /Run `\/laneconductor:board refresh` now/;

test('H4 the first Stop only remembers the tracks (silent, state in the plugin data directory); a later push of a track change asks for one refresh, then stays silent', () => {
  const dir = gitProject(); const data = tmp('lc-hook-data-');
  silent(stop(dir, data), 'first stop');
  assert.ok(fs.readdirSync(path.join(data, 'state')).some((f) => f.startsWith('seen-')), 'the fingerprint is kept in the plugin data directory');
  assert.ok(!fs.existsSync(path.join(dir, '.git', 'lc-seen')), 'nothing written into the project');
  silent(stop(dir, data), 'nothing changed');
  pushTrackChange(dir);
  const r = stop(dir, data);
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  assert.equal(JSON.parse(r.stdout).decision, 'block');
  assert.match(JSON.parse(r.stdout).reason, REFRESH_ASK);
  silent(stop(dir, data), 'asked once; the same state asks nothing more');
});

test('H4 an uncommitted edit of a track made without Edit or Write (a shell command) is caught; a change outside the tracks is not', () => {
  const dir = gitProject(); const data = tmp('lc-hook-data-');
  silent(stop(dir, data), 'baseline');
  write(dir, 'README.md', '# changed readme\n'); write(dir, 'conductor/product.md', '# Product, edited\n');
  silent(stop(dir, data), 'files outside conductor/tracks do not matter');
  write(dir, 'conductor/tracks/AM-1-one/index.md', '# Track AM-1: One\n\n**Lane**: review\n');
  assert.match(JSON.parse(stop(dir, data).stdout).reason, REFRESH_ASK);
  write(dir, 'conductor/tracks/AM-2-two/index.md', '# Track AM-2: Two\n\n**Lane**: plan\n');
  assert.match(JSON.parse(stop(dir, data).stdout).reason, REFRESH_ASK, 'a new track folder counts too');
});

test('H4 board.auto_update false, no stored board, a Stop that is already continuing, and a project that is not a git repository: all silent, nothing breaks', () => {
  for (const settings of [auto({ auto_update: false }), { board: {} }, null]) {
    const dir = gitProject(settings); const data = tmp('lc-hook-data-');
    silent(stop(dir, data), 'baseline'); pushTrackChange(dir);
    silent(stop(dir, data), `settings ${JSON.stringify(settings)}`);
  }
  const dir = gitProject(auto()); const data = tmp('lc-hook-data-');
  silent(stop(dir, data), 'baseline'); pushTrackChange(dir);
  silent(stop(dir, data, { stop_hook_active: true }), 'no loop while a stop hook is already continuing');
  assert.match(JSON.parse(stop(dir, data).stdout).reason, REFRESH_ASK, 'and the change is still reported on the next normal stop');
  const plain = project(auto()); const data2 = tmp('lc-hook-data-');
  silent(stop(plain, data2), 'not a git repository'); silent(stop(plain, data2), 'still not');
});

test('H4 the state branch from connector.state_branch is the one watched', () => {
  const dir = gitProject({ board: { artifact_url: 'https://claude.ai/artifact/abc' }, connector: { state_branch: 'trunk' } });
  sh(dir, 'branch', 'trunk'); sh(dir, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD');
  const data = tmp('lc-hook-data-');
  silent(stop(dir, data), 'baseline');
  pushTrackChange(dir); // moves origin/main only
  silent(stop(dir, data), 'a change on main is not the state branch');
  sh(dir, 'update-ref', 'refs/remotes/origin/trunk', 'refs/remotes/origin/main');
  assert.match(JSON.parse(stop(dir, data).stdout).reason, REFRESH_ASK);
});

// ---- H5: `seen`, run by the refresh command after it published: the next Stop does not ask for the refresh that was just made.
const seenRun = (proj, data, env = {}) => spawnSync(process.execPath, [SCRIPT, 'seen'], { cwd: proj, encoding: 'utf8', input: '', env: { PATH: process.env.PATH, ...(data ? { CLAUDE_PLUGIN_DATA: data } : {}), CLAUDE_PROJECT_DIR: proj, ...env } });
const quiet = (r, what) => { assert.equal(r.status, 0, `${what}: ${r.stderr}`); assert.equal(r.stdout, '', `${what}: prints nothing`); assert.equal(r.stderr, '', `${what}: no stderr`); };

test('H5 after a change was pushed, `seen` records it: the next Stop is silent, and a later change asks again', () => {
  const dir = gitProject(); const data = tmp('lc-hook-data-');
  silent(stop(dir, data), 'baseline');
  pushTrackChange(dir);
  quiet(seenRun(dir, data), 'seen');
  silent(stop(dir, data), 'the refresh was made: nothing to ask');
  write(dir, 'conductor/tracks/AM-3-three/index.md', '# Track AM-3: Three\n\n**Lane**: plan\n');
  assert.match(JSON.parse(stop(dir, data).stdout).reason, REFRESH_ASK, 'a change after the refresh still asks');
});

test('H5 `seen` clears the marker an Edit left, so the refresh that follows it is not asked for again', () => {
  const dir = gitProject(); const data = tmp('lc-hook-data-');
  silent(stop(dir, data), 'baseline');
  silent(post(dir, UPDATE, { track: '1', base: {}, markers: { Progress: '40%' } }, data), 'update_track');
  assert.equal(markers(data).length, 1);
  quiet(seenRun(dir, data), 'seen');
  assert.equal(markers(data).length, 0, 'the marker is gone');
  silent(stop(dir, data), 'nothing to ask');
});

test('H5 `seen` run from a shell without CLAUDE_PLUGIN_DATA still counts: the hook reads the temp fallback too, and the newest record wins', () => {
  const dir = gitProject(); const data = tmp('lc-hook-data-'); const tmpdir = tmp('lc-hook-tmp-');
  const env = { TMPDIR: tmpdir };
  const stopWith = () => run('stop', { hook_event_name: 'Stop', session_id: 's1', cwd: dir, stop_hook_active: false }, { data, project: dir, env });
  silent(stopWith(), 'baseline');
  pushTrackChange(dir);
  quiet(seenRun(dir, null, env), 'seen without the plugin data directory');
  silent(stopWith(), 'the fallback record is newer than the one in the plugin data directory');
  write(dir, 'conductor/tracks/AM-4-four/index.md', '# Track AM-4: Four\n\n**Lane**: plan\n');
  assert.match(JSON.parse(stopWith().stdout).reason, REFRESH_ASK, 'and a later change asks again');
});

test('H5 `seen` in a project that is not a git repository, or with no tracks folder, prints nothing and breaks nothing', () => {
  const plain = project(auto()); const data = tmp('lc-hook-data-');
  quiet(seenRun(plain, data), 'not a git repository');
  const empty = tmp('lc-hook-empty-'); quiet(seenRun(empty, data), 'no tracks folder');
});

test('H5 the base board refresh ends with the `seen` step, found by Glob, after a successful publish', () => {
  const text = BOARD_OPS();
  assert.match(text, /7\. After a success, from the project root run `node <path> seen`, with `<path>` found by Glob `\*\*\/laneconductor-board\/\*\*\/hooks\/lc-board-hook\.mjs` under `~\/\.claude\/plugins\/cache` \(skip it if not found\)/);
  assert.ok(text.indexOf('4. Artifact tool, action `publish`') < text.indexOf('7. After a success'));
  assert.match(fs.readFileSync(path.join(BASE, 'commands/board.md'), 'utf8'), /record the state with the `seen` step of the hook script/);
});

// ---- H6: a lane that starts asks for one quiet refresh right then; the end-of-turn refresh is quiet too.
const claimIndex = (lane, status) => `# Track AM-7: Seven\n\n**Lane**: ${lane}\n**Lane Status**: ${status}\n**Progress**: 0%\n`;
const IDX = 'conductor/tracks/AM-7-seven/index.md';
/** An Edit of a track's index.md: the file on disk already holds the result, as it does when PostToolUse runs. */
function editIndex(proj, data, lane, status, more = {}) {
  write(proj, IDX, claimIndex(lane, status));
  return post(proj, 'Edit', { file_path: path.join(proj, IDX), old_string: 'x', new_string: 'y' }, data, more);
}
const asksNow = (r) => { assert.equal(r.status, 0, r.stderr); const o = JSON.parse(r.stdout); assert.equal(o.decision, 'block'); return o.reason; };

test('H6 setting a track to running in plan, implement, review or quality-gate asks for one quiet refresh at once, once per claim; the marker is still set', () => {
  for (const lane of ['plan', 'implement', 'review', 'quality-gate']) {
    const proj = project(auto()); const data = tmp('lc-hook-data-');
    const reason = asksNow(editIndex(proj, data, lane, 'running'));
    assert.match(reason, /Run `\/laneconductor:board refresh` once now, quietly/, lane);
    assert.match(reason, /say nothing about it unless it fails/, lane);
    assert.match(reason, /carry on with the lane exactly where you were/, lane);
    assert.equal(markers(data).length, 1, `${lane}: the end-of-turn marker is set as before`);
    silent(editIndex(proj, data, lane, 'running'), `${lane}: the same claim again (a progress edit) asks nothing`);
    silent(editIndex(proj, data, lane, 'success'), `${lane}: finishing asks nothing`);
    assert.match(asksNow(editIndex(proj, data, lane, 'running')), /quietly/, `${lane}: a new run of the lane asks again`);
  }
});

test('H6 other lanes and statuses, an older lane name, and the connector\'s update_track', () => {
  const proj = project(auto()); const data = tmp('lc-hook-data-');
  for (const [lane, status] of [['merge', 'running'], ['done', 'running'], ['plan', 'queue'], ['implement', 'success'], ['backlog', 'queue']]) silent(editIndex(proj, data, lane, status), `${lane}:${status}`);
  assert.match(asksNow(editIndex(proj, data, 'in-progress', 'running')), /quietly/, 'in-progress is the implement lane');
  assert.match(asksNow(post(proj, UPDATE, { track: '9', base: {}, markers: { Lane: 'plan', 'Lane Status': 'running' } }, data)), /quietly/, 'update_track that sets both markers');
  silent(post(proj, UPDATE, { track: '9', base: {}, markers: { Lane: 'plan', 'Lane Status': 'running' } }, data), 'the same claim through update_track, again');
  silent(post(proj, UPDATE, { track: '10', base: {}, markers: { Progress: '40%' } }, data), 'a status-only change is not a claim');
});

test('H6 a sub-agent, board.auto_update false and no stored board are never asked; a claim is still remembered so it does not ask later', () => {
  const sub = project(auto()); const d1 = tmp('lc-hook-data-');
  silent(editIndex(sub, d1, 'implement', 'running', { agent_id: 'agent-1', agent_type: 'track-runner' }), 'a sub-agent');
  const off = project(auto({ auto_update: false })); const d2 = tmp('lc-hook-data-');
  silent(editIndex(off, d2, 'plan', 'running'), 'auto_update false');
  const none = project({ board: {} }); const d3 = tmp('lc-hook-data-');
  silent(editIndex(none, d3, 'plan', 'running'), 'no stored board');
  const noset = project(null); const d4 = tmp('lc-hook-data-');
  silent(editIndex(noset, d4, 'plan', 'running'), 'no settings file');
});

test('H6 the end-of-turn instruction is quiet too, and the base board refresh reports nothing when asked quietly unless a step failed', () => {
  const dir = gitProject(); const data = tmp('lc-hook-data-');
  silent(stop(dir, data), 'baseline'); pushTrackChange(dir);
  assert.match(JSON.parse(stop(dir, data).stdout).reason, /Run `\/laneconductor:board refresh` now, quietly \(it publishes only the changed files; say nothing about it unless it fails\), then stop/);
  const text = BOARD_OPS();
  assert.match(text, /8\. \*\*Quiet\.\*\* When the check at a lane start or at the end of a turn asked for this \(its message says quietly\), report nothing, not the link, the counts or the withheld files, unless a step failed: then one line with the step and the error\./);
  assert.match(fs.readFileSync(path.join(BASE, 'commands/board.md'), 'utf8'), /When the check at a lane start or at the end of a turn asked for it, say nothing unless it failed/);
});

// ---- H7: a git worktree has no copy of the git-ignored settings file, so the hook reads the main checkout's.
test('H7 in a git worktree the hook uses the main checkout\'s settings file (stored board, auto_update); with no file anywhere it stays silent', () => {
  const main = gitProject(auto()); const data = tmp('lc-hook-data-');
  const wt = path.join(tmp('lc-hook-wt-'), 'wt');
  sh(main, 'worktree', 'add', '-q', '-b', 'wt-branch', wt);
  // gitProject commits the settings file, so remove the worktree's copy to match a real git-ignored one
  fs.rmSync(path.join(wt, '.laneconductor.json'), { force: true });
  assert.match(asksNow(editIndex(wt, data, 'plan', 'running')), /quietly/, 'a claim in the worktree asks, using the main checkout\'s settings');
  // the same worktree, with the main checkout's auto_update switched off: silent
  fs.writeFileSync(path.join(main, '.laneconductor.json'), JSON.stringify(auto({ auto_update: false })));
  silent(editIndex(wt, tmp('lc-hook-data-'), 'implement', 'running'), 'auto_update false in the main checkout');
  // and with no settings file anywhere: silent
  fs.rmSync(path.join(main, '.laneconductor.json'), { force: true });
  silent(editIndex(wt, tmp('lc-hook-data-'), 'review', 'running'), 'no settings file in either place');
});
