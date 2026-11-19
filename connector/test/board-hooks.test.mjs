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
  assert.ok(out.reason.includes('/laneconductor-board:refresh') && out.reason.length < 300, out.reason);
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

test('the hook script: no network, no child process, no write inside a project; the stop instruction names a command the add-on ships', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(!/node:(http|https|net|dgram|child_process|dns|tls)|fetch\(|XMLHttpRequest|spawn|exec\(|execSync/.test(src));
  assert.ok(src.length < 8000);
  const name = JSON.parse(fs.readFileSync(path.join(BOARD, '.claude-plugin/plugin.json'), 'utf8')).name;
  const command = /const REFRESH = '\/([a-z-]+):([a-z-]+)'/.exec(src);
  assert.deepEqual([command[1], command[2]], [name, 'refresh']);
  assert.ok(fs.existsSync(path.join(BOARD, 'commands', `${command[2]}.md`)));
});

test('the refresh command: reads the live manifest, passes it to --previous, publishes only the publish map, full publish on first publish, conflict or failure, keeps the privacy handling', () => {
  const text = fs.readFileSync(path.join(BOARD, 'commands/refresh.md'), 'utf8');
  assert.match(text, /^---\ndescription: .+\n---\n/);
  assert.ok(text.includes('"manifest.json", "board.json"') && text.includes('--previous') && text.includes('--live-board') && text.includes('`none`'));
  assert.ok(text.includes('${CLAUDE_PLUGIN_ROOT}/server/bin/lc-board.mjs'), 'the add-on\'s own script, no Glob needed');
  assert.match(text, /`files` = the `publish` map and nothing more/);
  assert.match(text, /A conflict or any failure: run step 3 again with `none`/);
  assert.match(text, /scope: "files"/);
  assert.match(text, /Only Claude can publish an artifact/);
  assert.match(text, /withheld/);
  assert.match(text, /never the matched text/);
  assert.match(text, /never share it/i);
  assert.ok(Buffer.byteLength(text) < 4000, 'short');
  // It never creates a board: with no stored URL it points to the base command, which asks first.
  assert.match(text, /If there is none, say so, point to `\/laneconductor:board`/);
});

test('the BASE plugin still has no hooks: no hooks folder, no hooks key in its manifest, no hook script, and no command or file of the board add-on', () => {
  assert.ok(!fs.existsSync(path.join(BASE, 'hooks')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(BASE, '.claude-plugin/plugin.json'), 'utf8')).hooks, undefined);
  assert.ok(!fs.existsSync(path.join(BASE, 'commands/refresh.md')));
  const all = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const f of all(BASE)) {
    assert.ok(!/lc-board-hook|hooks\.json/.test(path.basename(f)), f);
    assert.ok(!/\.(mjs|js|sh)$/.test(f), `${f}: the base is Markdown and JSON only`);
  }
  assert.ok(!fs.existsSync(path.join(REPO, PARALLEL_REL, 'hooks')), 'the parallel add-on has none either');
});
