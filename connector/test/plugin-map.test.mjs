// docs/plugin-map.md (track AM-10128): a table of what each plugin provides and which base commands depend on which add-on, GENERATED from
// the three generated plugin folders and the command catalog, never hand-written. The drift check (`build-plugin.mjs --check`, and the
// first test in plugin-build.test.mjs) covers the file; these tests check that what it says is true of the real folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, RELS, NAMES, PROFILES, PLUGIN_MAP_REL, pluginFacts, buildPlugin, buildPluginMap, shortMap, CONNECTOR_TOOL_PREFIX } from '../../scripts/build-plugin.mjs';
import { COMMANDS as CATALOG } from '../src/commands.mjs';
import { TOOLS } from '../src/tools/index.mjs';

const map = fs.readFileSync(path.join(REPO, PLUGIN_MAP_REL), 'utf8');
const ls = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => f.replace(/\.md$/, '')).sort() : []);
const facts = Object.fromEntries(PROFILES.map((p) => [p, pluginFacts(p, buildPlugin(REPO, p))]));

test('the facts are the real folders: commands, skills, agents, scripts, tools and prompts', () => {
  for (const p of PROFILES) {
    const dir = path.join(REPO, RELS[p]);
    assert.deepEqual(facts[p].commands, ls(path.join(dir, 'commands')), `${p}: commands`);
    assert.deepEqual(facts[p].agents.map((a) => a.name), ls(path.join(dir, 'agents')), `${p}: agents`);
    assert.deepEqual(facts[p].skills, ls(path.join(dir, 'skills')), `${p}: skills`);
    const bins = fs.existsSync(path.join(dir, 'server/bin')) ? fs.readdirSync(path.join(dir, 'server/bin')).sort() : [];
    assert.deepEqual(facts[p].scripts, bins, `${p}: scripts`);
  }
  assert.deepEqual(facts.base.commands, CATALOG.map((c) => c.name).sort());
  assert.deepEqual(facts.parallel.tools, TOOLS.map((t) => t.name).sort(), 'the tools are the real tool list (read from the shipped sources)');
  assert.deepEqual(facts.parallel.prompts, CATALOG.map((c) => c.name));
  assert.deepEqual(facts.base.tools.concat(facts.board.tools, facts.base.prompts, facts.board.prompts), [], 'only the connector has tools and prompts');
  assert.deepEqual(facts.parallel.agents, [{ name: 'track-runner', isolation: 'worktree' }]);
  assert.deepEqual(facts.base.agents, [{ name: 'plan-reviewer', isolation: null }]);
  assert.deepEqual(facts.board.scripts, ['lc-board.mjs']);
  assert.deepEqual(facts.parallel.scripts, ['lc-connector.mjs', 'lc-scaffold.mjs']);
  assert.equal(facts.base.program, false);
});

test('docs/plugin-map.md says exactly that: every provided name appears in its column, and every base command has a row with its dependency', () => {
  assert.equal(map, buildPluginMap(facts));
  const row = (label) => map.split('\n').find((l) => l.startsWith(`| ${label} |`)).split(' | ');
  const cmds = row('Slash commands');
  for (const c of CATALOG) assert.ok(cmds[1].includes(`\`${c.name}\``), `${c.name} is a base command`);
  assert.match(cmds[2], /none/);
  assert.match(cmds[3], /none/);
  assert.ok(row('MCP tools')[2].includes(`${CONNECTOR_TOOL_PREFIX}<tool>`));
  for (const t of TOOLS) assert.ok(row('MCP tools')[2].includes(`\`${t.name}\``), t.name);
  assert.ok(row('Agents')[2].includes('`track-runner` (isolation: worktree)'));
  assert.ok(row('Agents')[1].includes('`plan-reviewer`') && !row('Agents')[1].includes('isolation'));
  assert.ok(row('Scripts')[3].includes('`server/bin/lc-board.mjs`'));
  // The dependency table: one row per catalog command, the board add-on needed exactly where the catalog flags it.
  const deps = map.slice(map.indexOf('## Base commands and the add-ons'));
  for (const c of CATALOG) {
    const line = deps.split('\n').find((l) => l.startsWith(`| \`${c.name}\` |`));
    assert.ok(line, `${c.name} has a row`);
    const cells = line.split(' | ');
    const needs = c.needsBoardScript === 'always' ? /yes \|$/ : c.needsBoardScript === 'refreshing' ? /only to refresh \|$/ : /no \|$/;
    assert.match(line, needs, `${c.name}: board add-on dependency`);
    assert.equal(cells[1].startsWith('yes'), c.needsBoardScript !== 'always', `${c.name}: works alone`);
  }
  assert.ok(deps.includes('| `implement` | yes | its tools (`get_context`, `get_track`, `update_track`), the `track-runner` sub-agent | no |'));
  assert.ok(deps.includes('| `new-project` | yes | its scaffold script | no |'));
});

test('every README carries the same short plugin map, generated from the same facts', () => {
  const short = shortMap(facts);
  for (const p of PROFILES) {
    const readme = fs.readFileSync(path.join(REPO, RELS[p], 'README.md'), 'utf8');
    assert.ok(readme.includes(short), `${NAMES[p]} README holds the short map`);
  }
  assert.ok(short.includes('`laneconductor-parallel` (add-on) | the connector\'s tools') && short.includes('No slash commands.'));
  assert.ok(!/\b\d+\s+(slash\s+)?commands\b/.test(short), 'no command count');
});
