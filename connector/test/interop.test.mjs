// Interoperability of the three plugins (track AM-10128 Phase 5, TC-3 to TC-6; the owner installs all three and checks they work together).
// The matrix runs over COPIES of the generated folders laid out the way Claude Code keeps installed plugins
// (<plugins home>/cache/laneconductor/<plugin>/<version>/), for each set of installed plugins: the base alone, base + parallel, base + board,
// all three. Per set:
//   - every installed plugin validates with `claude plugin validate --strict` (skipped, with a message, when the claude CLI is missing);
//   - no two installed plugins register the same slash command, skill or agent name;
//   - the base's board command finds the board script (by the Glob the command gives, evaluated here under the plugins home) when the
//     board add-on is installed, and runs it; when it is not, nothing matches and the command shows the install commands;
//   - the base's connector-tool prefix equals what Claude Code derives from the add-on's plugin name and server key, and every tool the
//     base names exists in the tools/list the RUNNING add-on server answers over stdio.
// HUMAN, not covered: a real Claude Code session (TC-10).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, PLUGIN_REL, PARALLEL_REL, BOARD_REL, PROFILES, NAMES, RELS, BOARD_SCRIPT_GLOB, CONNECTOR_TOOL_PREFIX, SERVER_KEY, installBlock, toolsUsedBy } from '../../scripts/build-plugin.mjs';
import { COMMANDS as CATALOG } from '../src/commands.mjs';
import { TOOLS } from '../src/tools/index.mjs';
import { spawnRaw } from './helpers/rawstdio.mjs';
import { makeRepo, writeFile, commitAll, rm, INDEX } from './helpers/repo.mjs';

const real = fs.realpathSync(os.tmpdir());
const cleanup = [];
after(() => rm(...cleanup));
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const walk = (root, rel = '') => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
  const r = rel ? `${rel}/${e.name}` : e.name;
  if (e.name === 'node_modules') return [];
  return e.isDirectory() ? walk(root, r) : [r];
});
const claudeAvailable = () => { const r = spawnSync('claude', ['--version'], { encoding: 'utf8' }); return !r.error && r.status === 0; };
const SETS = [['base alone', ['base']], ['base + parallel', ['base', 'parallel']], ['base + board', ['base', 'board']], ['all three', ['base', 'parallel', 'board']]];

/** A plugins home as Claude Code lays it out: <home>/cache/<marketplace>/<plugin>/<version>/ . Returns { home, dir(profile) }. */
function install(profiles) {
  const home = tmp('lc-plugins-home-');
  const dirs = {};
  for (const p of profiles) {
    const src = path.join(REPO, RELS[p]);
    const dest = path.join(home, 'cache', 'laneconductor', NAMES[p], readJson(path.join(src, '.claude-plugin/plugin.json')).version);
    fs.cpSync(src, dest, { recursive: true });
    dirs[p] = dest;
  }
  // The marketplace clone sits under the plugins home too, but it holds the repository, not an install; the matrix does not count it.
  return { home, dirs };
}

/** Glob under `home`: `**` crosses folders, `*` stays within one. The same reading Claude's Glob tool gives these patterns. */
function globUnder(home, pattern) {
  const re = new RegExp(`^${pattern.split('/').map((seg) => (seg === '**' ? '(?:.+/)?' : `${seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}/`)).join('').replace(/\/$/, '')}$`);
  return walk(home).filter((r) => re.test(r)).map((r) => path.join(home, r));
}

const surface = (dir) => ({
  commands: fs.existsSync(path.join(dir, 'commands')) ? fs.readdirSync(path.join(dir, 'commands')).map((f) => f.replace(/\.md$/, '')) : [],
  skills: fs.existsSync(path.join(dir, 'skills')) ? fs.readdirSync(path.join(dir, 'skills')) : [],
  agents: fs.existsSync(path.join(dir, 'agents')) ? fs.readdirSync(path.join(dir, 'agents')).map((f) => f.replace(/\.md$/, '')) : [],
});

test('the glob the base gives for the board script matches the add-on in an installed layout and in a marketplace clone, and nothing else', () => {
  const home = tmp('lc-glob-');
  const touch = (rel) => { fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); fs.writeFileSync(path.join(home, rel), 'x'); };
  touch('cache/laneconductor/laneconductor-board/1.0.0/server/bin/lc-board.mjs');
  touch('marketplaces/laneconductor/plugins/laneconductor-board/server/bin/lc-board.mjs');
  touch('marketplaces/laneconductor/connector/bin/lc-board.mjs');
  touch('cache/laneconductor/laneconductor/1.0.0/server/bin/lc-board.mjs');
  touch('cache/laneconductor/laneconductor-parallel/1.0.0/server/bin/lc-connector.mjs');
  assert.deepEqual(globUnder(home, BOARD_SCRIPT_GLOB).map((p) => path.relative(home, p)).sort(), [
    'cache/laneconductor/laneconductor-board/1.0.0/server/bin/lc-board.mjs',
    'marketplaces/laneconductor/plugins/laneconductor-board/server/bin/lc-board.mjs',
  ]);
});

for (const [label, profiles] of SETS) {
  test(`matrix (${label}): every installed plugin validates --strict, and no two register the same command, skill or agent name (TC-3)`, (t) => {
    const { dirs } = install(profiles);
    if (claudeAvailable()) {
      for (const p of profiles) {
        const r = spawnSync('claude', ['plugin', 'validate', dirs[p], '--strict'], { encoding: 'utf8', cwd: os.tmpdir() });
        assert.equal(r.status, 0, `${NAMES[p]}: ${r.stdout}\n${r.stderr}`);
        assert.match(r.stdout, /Validation passed/);
      }
    } else t.diagnostic('the claude CLI is not on PATH: run `claude plugin validate <path> --strict` by hand');
    const seen = new Map();
    for (const p of profiles) {
      const s = surface(dirs[p]);
      for (const [kind, names] of Object.entries(s)) {
        for (const n of names) {
          assert.ok(!seen.has(`${kind}:${n}`), `${kind} ${n} is registered by ${seen.get(`${kind}:${n}`)} and ${NAMES[p]}`);
          seen.set(`${kind}:${n}`, NAMES[p]);
        }
      }
    }
    // Across kinds as well: a command and an agent may not share a bare name either, so nothing is ambiguous when typed.
    const bare = [...seen.keys()].map((k) => k.split(':')[1]);
    for (const n of bare) assert.equal(bare.filter((b) => b === n).length, 1, `${n} is a name of more than one kind or plugin`);
    // The add-ons ship no slash commands and no skill: only the base registers those.
    for (const p of profiles.filter((x) => x !== 'base')) assert.deepEqual([surface(dirs[p]).commands, surface(dirs[p]).skills], [[], []], `${NAMES[p]} registers commands or skills`);
  });

  test(`matrix (${label}): the base's board command finds the script by its Glob when the board add-on is installed, and shows the install commands when it is not (TC-4, TC-6)`, () => {
    const { home, dirs } = install(profiles);
    const board = fs.readFileSync(path.join(dirs.base, 'commands/board.md'), 'utf8');
    const refresh = fs.readFileSync(path.join(dirs.base, 'commands/refresh-board.md'), 'utf8');
    for (const text of [board, refresh]) {
      assert.ok(text.includes(BOARD_SCRIPT_GLOB), 'the command names the Glob');
      assert.ok(text.includes(installBlock('board')), 'the command holds the install commands for when the script is missing');
    }
    const found = globUnder(home, BOARD_SCRIPT_GLOB);
    if (profiles.includes('board')) {
      assert.equal(found.length, 1, found.join('\n'));
      assert.equal(found[0], path.join(dirs.board, 'server/bin/lc-board.mjs'));
      // And it builds a board from the track files, with no connector installed or needed.
      const repo = makeRepo({ prefix: 'lc-matrix-board-' });
      cleanup.push(repo);
      writeFile(repo, '.laneconductor.json', JSON.stringify({ project: { name: 'Matrix' } }));
      writeFile(repo, 'conductor/tracks/AM-401-t/index.md', INDEX(401, 'A track', { lane: 'implement', status: 'running' }));
      commitAll(repo);
      const site = path.join(tmp('lc-matrix-site-'), 'out');
      const r = spawnSync(process.execPath, [found[0], '--repo', repo, '--site', site, '--json'], { encoding: 'utf8', cwd: home });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(path.join(site, 'board.html')) && JSON.stringify(readJson(path.join(site, 'board.json'))).includes('401'));
    } else {
      assert.deepEqual(found, [], 'no script is found, so the command shows the install commands and does nothing else');
    }
  });

  if (profiles.includes('parallel')) {
    test(`matrix (${label}): the base's tool prefix equals the add-on's real tool names, read over stdio from the running add-on server (TC-5)`, async (t) => {
      const { dirs } = install(profiles);
      const plugin = dirs.parallel;
      const project = makeRepo({ prefix: 'lc-matrix-project-' });
      cleanup.push(project);
      // Dependencies as Claude Code installs them: `npm ci`. A cold offline cache falls back to the repo's installed modules.
      const ci = spawnSync('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: plugin, encoding: 'utf8' });
      if (ci.status !== 0) {
        fs.rmSync(path.join(plugin, 'node_modules'), { recursive: true, force: true });
        fs.symlinkSync(path.join(REPO, 'connector/node_modules'), path.join(plugin, 'node_modules'), 'dir');
        t.diagnostic('dependencies by symlink (offline npm cache cold)');
      }
      const manifest = readJson(path.join(plugin, '.claude-plugin/plugin.json'));
      const entry = readJson(path.join(plugin, '.mcp.json')).mcpServers[SERVER_KEY];
      assert.ok(entry, `the server key is ${SERVER_KEY}`);
      const raw = spawnRaw(process.execPath, entry.args.map((a) => a.replaceAll('${CLAUDE_PLUGIN_ROOT}', plugin)), { cwd: tmp('lc-matrix-cwd-'), env: { ...process.env, CLAUDE_PROJECT_DIR: project } });
      try {
        await raw.initialize();
        const list = await raw.request('tools/list', {});
        // Claude Code names an MCP tool mcp__plugin_<plugin name>_<server key>__<tool>.
        const real = list.result.tools.map((x) => `mcp__plugin_${manifest.name}_${SERVER_KEY}__${x.name}`).sort();
        assert.deepEqual(real, TOOLS.map((x) => `${CONNECTOR_TOOL_PREFIX}${x.name}`).sort(), 'the running server answers the tools the generator names');
        assert.ok(real.every((n) => n.startsWith(CONNECTOR_TOOL_PREFIX)));
        // Everything the base says about the connector's tools: the prefix, the wildcard, and every tool by name.
        const mentioned = new Set();
        for (const rel of walk(dirs.base).filter((r) => /\.md$/.test(r))) {
          for (const m of fs.readFileSync(path.join(dirs.base, rel), 'utf8').matchAll(/mcp__plugin_[A-Za-z0-9_-]*?_lc__(\*|\w+)/g)) mentioned.add(m[0]);
        }
        assert.ok(mentioned.size > 3);
        for (const m of mentioned) assert.ok(m === `${CONNECTOR_TOOL_PREFIX}*` || real.includes(m), `the base names ${m}, which the add-on does not provide (the add-on provides ${real.join(', ')})`);
        // Every tool a base command is built from exists on the server.
        for (const c of CATALOG) for (const tool of toolsUsedBy(c.procedure)) assert.ok(real.includes(`${CONNECTOR_TOOL_PREFIX}${tool}`), `${c.name} uses ${tool}`);
        // The add-on's track-runner lists real tools and the agent name the base dispatches.
        const runner = fs.readFileSync(path.join(plugin, 'agents/track-runner.md'), 'utf8');
        for (const t2 of runner.match(/^tools: (.*)$/m)[1].split(',').map((x) => x.trim()).filter((x) => x.startsWith('mcp__'))) assert.ok(real.includes(t2), `track-runner lists ${t2}`);
        assert.match(runner, /^isolation: worktree$/m);
        assert.match(fs.readFileSync(path.join(dirs.base, 'commands/implement.md'), 'utf8'), new RegExp(`${NAMES.parallel}:track-runner`));
        assert.match(runner, /^name: track-runner$/m);
      } finally {
        await raw.kill();
      }
    });
  }
}

test('TC-7 over stdio from the generated add-on: an otralingo-style workflow.json (planning, in-progress) gets a suggestion, and get_track and get_context list the valid names', async (t) => {
  const { dirs } = install(['parallel']);
  const plugin = dirs.parallel;
  const ci = spawnSync('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: plugin, encoding: 'utf8' });
  if (ci.status !== 0) {
    fs.rmSync(path.join(plugin, 'node_modules'), { recursive: true, force: true });
    fs.symlinkSync(path.join(REPO, 'connector/node_modules'), path.join(plugin, 'node_modules'), 'dir');
  }
  const wf = JSON.stringify({ lanes: { planning: { on_success: 'in-progress:queue' }, backlog: {}, 'in-progress': { on_success: 'review:queue' }, review: {}, 'quality-gate': {}, done: {} } });
  const project = makeRepo({ prefix: 'lc-otralingo-', files: { 'conductor/workflow.json': wf } });
  cleanup.push(project);
  const raw = spawnRaw(process.execPath, [path.join(plugin, 'server/bin/lc-connector.mjs')], { cwd: tmp('lc-otralingo-cwd-'), env: { ...process.env, CLAUDE_PROJECT_DIR: project } });
  const call = async (name, args) => (await raw.request('tools/call', { name, arguments: args })).result;
  try {
    await raw.initialize();
    const made = await call('create_track', { title: 'Probe', problem: 'p' });
    assert.ok(!made.isError, JSON.stringify(made));
    const { track, base } = made.structuredContent.data;
    assert.equal(base.markers.Lane, 'planning');
    const refused = await call('update_track', { track: track.number, base, markers: { Lane: 'implement', 'Lane Status': 'in_progress' } });
    assert.equal(refused.isError, true);
    const e = refused.structuredContent.error;
    assert.equal(e.code, 'VALIDATION_FAILED');
    assert.deepEqual(e.details.suggestions, { Lane: 'in-progress', 'Lane Status': 'running' });
    assert.match(e.message, /Lane: did you mean "in-progress"\?/);
    assert.match(e.message, /Lane Status: did you mean "running"\?/);
    const got = await call('get_track', { track: track.number });
    assert.deepEqual(got.structuredContent.data.valid.lanes, ['planning', 'backlog', 'in-progress', 'review', 'quality-gate', 'done']);
    const ctx = await call('get_context', {});
    assert.deepEqual(ctx.structuredContent.data.valid.statuses, ['queue', 'running', 'success', 'failure', 'waiting']);
    const ok = await call('update_track', { track: track.number, base, markers: { Lane: 'in-progress', 'Lane Status': 'running' } });
    assert.ok(!ok.isError, JSON.stringify(ok));
    assert.ok(raw.stderr().includes('serving'));
  } finally {
    await raw.kill();
  }
});
