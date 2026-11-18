// Track AM-10115 Phase 2 and AM-10116: every command of the skill's routing table is in the command catalog (connector/src/commands.mjs)
// or has a recorded reason (connector/plugin-extras/coverage.json); every catalog entry yields exactly one plugin command file and
// one MCP prompt; the commands and agents are well formed.
// The commands, agents, connector and board script all live in the one plugin (plugins/laneconductor); the commands and agents
// use the connector tools (`mcp__plugin_laneconductor_lc__*`) and say what to do when the tools are unavailable.
// HUMAN, not covered here: running the commands and the subagent in a real Claude Code session (plan Task 8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, PLUGIN_REL, PLUGIN_NAME, CONNECTOR_TOOL_PREFIX } from '../../scripts/build-plugin.mjs';
import { TOOLS } from '../src/tools/index.mjs';
import { COMMANDS as CATALOG, COMMAND_NAMES, argumentHint, helpText } from '../src/commands.mjs';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, rm } from './helpers/repo.mjs';

const PLUGIN = path.join(REPO, PLUGIN_REL);
const SKILL = path.join(PLUGIN, 'skills/laneconductor');
const COVERAGE = JSON.parse(fs.readFileSync(path.join(REPO, 'connector/plugin-extras/coverage.json'), 'utf8'));
const ls = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []);
const COMMANDS = ls(path.join(PLUGIN, 'commands')).map((f) => f.replace(/\.md$/, ''));
const AGENTS = ls(path.join(PLUGIN, 'agents')).map((f) => f.replace(/\.md$/, ''));
const read = (rel) => fs.readFileSync(path.join(PLUGIN, rel), 'utf8');
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));
const MCP_PREFIX = CONNECTOR_TOOL_PREFIX; // mcp__plugin_laneconductor_lc__

/** { fm: Map<key, value>, body: string } of a markdown file with simple `key: value` frontmatter. */
function parse(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'file must start with YAML frontmatter');
  const fm = new Map();
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    assert.ok(kv, `frontmatter line is not "key: value": ${line}`);
    fm.set(kv[1], kv[2]);
  }
  return { fm, body: m[2] };
}

/** The command names in the first column of every routing-table row of the generated SKILL.md. */
function routingNames() {
  const md = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^\| Command \|/.test(l));
  assert.ok(start >= 0, 'routing table header not found in SKILL.md');
  const names = [];
  for (const l of lines.slice(start + 2)) {
    if (!l.startsWith('|')) break;
    const first = l.split('|')[1];
    for (const part of first.split(',')) names.push(part.replace(/`/g, '').trim());
  }
  return names.filter(Boolean);
}

test('every routing-table command has a command file, an alias to one, or a reason in coverage.json', () => {
  const names = routingNames();
  assert.ok(names.length >= 20, `parsed ${names.length} routing names; the parser is probably broken`);
  const unmapped = [];
  for (const n of names) {
    const target = COVERAGE.aliases[n] ?? n;
    if (COMMANDS.includes(target)) continue;
    if (COVERAGE.entries[n]?.reason) continue;
    unmapped.push(n);
  }
  assert.deepEqual(unmapped, [], 'add the command to connector/src/commands.mjs, or list the name with a reason in coverage.json');
});

test('every catalog command is a routing-table name, an alias target, or listed under catalogOnly with a reason', () => {
  const names = new Set(routingNames());
  const targets = new Set([...names].map((n) => COVERAGE.aliases[n] ?? n));
  for (const c of COMMAND_NAMES) {
    if (targets.has(c) || names.has(c)) continue;
    assert.ok(COVERAGE.catalogOnly?.[c]?.length >= 20, `${c} is in the catalog but not in the skill routing table: add an alias or a catalogOnly reason in coverage.json`);
  }
  for (const [c, reason] of Object.entries(COVERAGE.catalogOnly ?? {})) {
    assert.ok(COMMAND_NAMES.includes(c), `catalogOnly ${c} is not a catalog command; remove it`);
    assert.ok(!targets.has(c) && !names.has(c), `catalogOnly ${c} is in the routing table; remove it from catalogOnly`);
    assert.ok(reason.length >= 20, `${c}: needs a real reason`);
  }
});

// REQ-3, REQ-5 / AC-2, TC-4: the plugin's commands ARE the catalog, one file and one MCP prompt per entry, no hand-written command file.
test('one plugin command file and one MCP prompt per catalog entry; no hand-written command source remains', async () => {
  assert.deepEqual([...COMMANDS].sort(), [...COMMAND_NAMES].sort());
  assert.ok(!fs.existsSync(path.join(REPO, 'connector/plugin-extras/commands')), 'connector/plugin-extras/commands/ must stay removed: commands are generated from connector/src/commands.mjs');
  for (const c of CATALOG) {
    const { fm } = parse(read(`commands/${c.name}.md`));
    assert.equal(fm.get('description').replace(/^"|"$/g, '').replace(/\\"/g, '"'), c.description, `${c.name}: description comes from the catalog`);
    assert.equal(fm.has('argument-hint'), c.args.length > 0, `${c.name}: argument-hint exists exactly when there are arguments`);
    if (c.args.length) assert.equal(JSON.parse(`[${fm.get('argument-hint').startsWith('"') ? fm.get('argument-hint') : JSON.stringify(fm.get('argument-hint'))}]`)[0], argumentHint(c), `${c.name}: argument-hint`);
  }
  const dir = makeRepo();
  const s = await connect(dir);
  try {
    const { prompts } = await s.client.listPrompts();
    assert.deepEqual(prompts.map((p) => p.name).sort(), [...COMMANDS].sort(), 'one prompt per command file');
  } finally {
    await s.close();
    rm(dir);
  }
});

test('coverage.json is honest: reasons present, no stale names, nothing listed twice', () => {
  const names = new Set(routingNames());
  for (const [n, e] of Object.entries(COVERAGE.entries)) {
    assert.ok(['automatic', 'skill-only'].includes(e.kind), `${n}: kind`);
    assert.ok(typeof e.reason === 'string' && e.reason.length >= 20, `${n}: needs a real reason`);
    assert.ok(names.has(n), `${n} is not a routing-table command any more; remove it`);
    assert.ok(!COMMANDS.includes(n) && !(n in COVERAGE.aliases), `${n} is both listed as uncovered and covered by a command`);
  }
  for (const [alias, cmd] of Object.entries(COVERAGE.aliases)) {
    assert.ok(names.has(alias), `alias ${alias} is not a routing-table command; remove it`);
    assert.ok(COMMANDS.includes(cmd), `alias ${alias} points at missing command ${cmd}`);
  }
});

test('commands: the spec list exists, each has a description and an argument-hint, and a short body', () => {
  const want = ['plan', 'brainstorm', 'implement', 'review', 'quality-gate', 'merge', 'run', 'new', 'bug', 'feature', 'status',
    'move', 'comment', 'board', 'workflow', 'setup', 'deploy', 'review-plan', 'help', 'show-board', 'refresh-board'];
  assert.deepEqual(want.filter((c) => !COMMANDS.includes(c)), []);
  for (const c of COMMANDS) {
    const { fm, body } = parse(read(`commands/${c}.md`));
    assert.ok((fm.get('description') ?? '').length > 10, `${c}: frontmatter needs a description`);
    if (CATALOG.find((x) => x.name === c).args.length) assert.ok(fm.has('argument-hint'), `${c}: frontmatter needs an argument-hint`);
    for (const k of fm.keys()) assert.ok(['description', 'argument-hint', 'allowed-tools', 'model'].includes(k), `${c}: undocumented frontmatter field ${k}`);
    assert.ok(body.trim().split('\n').length < (c === 'help' ? 45 : 40), `${c}: body must stay under 40 lines (the skill is the single source)`);
    if (CATALOG.find((x) => x.name === c).args.length) assert.ok(body.includes('$ARGUMENTS'), `${c}: must use $ARGUMENTS`);
  }
});

test('commands and agents reference only files and tools that ship', () => {
  for (const rel of [...COMMANDS.map((c) => `commands/${c}.md`), ...AGENTS.map((a) => `agents/${a}.md`)]) {
    const text = read(rel);
    for (const m of text.matchAll(/`((?:lanes|ops|setup|deploy)\/[A-Za-z0-9._-]+)`/g)) {
      assert.ok(fs.existsSync(path.join(SKILL, m[1])), `${rel} names ${m[1]}, which is not in the shipped skill`);
    }
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9._/-]+)/g)) assert.ok(fs.existsSync(path.join(PLUGIN, m[1])), `${rel} names ${m[1]}, which is not shipped`);
    for (const m of text.matchAll(/\bmcp__plugin_[A-Za-z_-]+?_lc__(\w+)/g)) assert.ok(TOOL_NAMES.has(m[1]), `${rel} names unknown connector tool ${m[1]}`);
    for (const m of text.matchAll(/\bmcp__plugin_[A-Za-z_-]+?_lc(?:-connector)?__/g)) assert.equal(m[0], CONNECTOR_TOOL_PREFIX, `${rel}: wrong tool prefix ${m[0]} (the plugin is one: ${CONNECTOR_TOOL_PREFIX}*)`);
    assert.ok(!/laneconductor-(plus|extended|board|connector)/.test(text), `${rel}: names a plugin that does not exist`);
    assert.ok(!/\bgit add (-A|\.)(\s|$)/.test(text.replace(/never `git add -A`[^\n]*/g, '')), `${rel}: must not tell anyone to git add -A`);
  }
  // Connector tool names used in command bodies (backticked snake_case) exist.
  for (const c of COMMANDS) {
    for (const m of read(`commands/${c}.md`).matchAll(/`((?:get|list|create|update|append|report|health)_[a-z_]+)`/g)) {
      assert.ok(TOOL_NAMES.has(m[1]), `commands/${c}.md names unknown connector tool ${m[1]}`);
    }
  }
});

test('agents: documented frontmatter only, valid isolation, tool names that exist, plan-reviewer read-only', () => {
  const allowed = ['name', 'description', 'model', 'effort', 'maxTurns', 'tools', 'disallowedTools', 'skills', 'memory', 'background', 'isolation', 'color'];
  const ignored = ['permissionMode', 'hooks', 'mcpServers', 'initialPrompt'];
  assert.deepEqual(['plan-reviewer', 'track-runner'].filter((a) => !AGENTS.includes(a)), []);
  for (const a of AGENTS) {
    const { fm, body } = parse(read(`agents/${a}.md`));
    for (const k of fm.keys()) {
      assert.ok(!ignored.includes(k), `${a}: ${k} is ignored in plugin agents; do not use it`);
      assert.ok(allowed.includes(k), `${a}: undocumented frontmatter field ${k}`);
    }
    assert.equal(fm.get('name'), a);
    assert.ok((fm.get('description') ?? '').length > 20, `${a}: description`);
    if (fm.has('isolation')) assert.equal(fm.get('isolation'), 'worktree');
    assert.ok(body.trim().length > 0);
    for (const t of (fm.get('tools') ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
      if (t.startsWith('mcp__')) assert.ok(t.startsWith(CONNECTOR_TOOL_PREFIX) && TOOL_NAMES.has(t.slice(CONNECTOR_TOOL_PREFIX.length)), `${a}: ${t} is not a connector tool of this plugin`);
      else assert.ok(['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'].includes(t), `${a}: unexpected tool ${t} (no web tools)`);
    }
  }
  const runner = parse(read('agents/track-runner.md')).fm;
  assert.equal(runner.get('isolation'), 'worktree');
  assert.ok(Number(runner.get('maxTurns')) > 0);
  const P = CONNECTOR_TOOL_PREFIX;
  const reviewer = (parse(read('agents/plan-reviewer.md')).fm.get('tools') ?? '').split(',').map((s) => s.trim());
  assert.deepEqual(reviewer, ['Read', 'Grep', 'Glob', `${P}get_track`, `${P}get_context`], 'plan-reviewer is read-only: only read tools of the connector');
  const runnerTools = (runner.get('tools') ?? '').split(',').map((s) => s.trim());
  assert.deepEqual(runnerTools, ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', `${P}get_context`, `${P}get_track`, `${P}update_track`, `${P}append_conversation`]);
});

test('run, implement and review recommend track-runner, show the dispatch and start nothing unasked', () => {
  for (const c of ['run', 'implement', 'review']) {
    const t = read(`commands/${c}.md`);
    assert.ok(t.includes('laneconductor:track-runner'), `${c}: names the subagent`);
    assert.match(t, /RECOMMEND, do not start/, `${c}: recommends, does not start`);
    assert.match(t, /one sub-agent per track/, `${c}: one subagent per track`);
    assert.match(t, /own worktree/, `${c}: own worktree`);
    assert.match(t, /Start nothing until I say yes/, `${c}: waits for a yes`);
  }
  for (const c of ['setup', 'deploy']) assert.match(read(`commands/${c}.md`), /runs only because I named it/, `${c}: only when named`);
  const skill = fs.readFileSync(path.join(SKILL, 'ops/working-a-track.md'), 'utf8');
  assert.match(skill, /Plugin users: one subagent per track in a worktree/);
});

test('the real table: automatic and skill-only rows are exactly the recorded ones', () => {
  assert.deepEqual(Object.keys(COVERAGE.entries).sort(), ['delete', 'init-tracks-summary', 'revert']);
});

test('commands that use the connector name its tool prefix, and say what to do when the tools are unavailable', () => {
  const usesConnector = COMMANDS.filter((c) => /`(?:get|list|create|update|append)_[a-z_]+`/.test(read(`commands/${c}.md`)));
  assert.ok(usesConnector.length >= 10, `only ${usesConnector.length} commands use connector tools`);
  for (const c of usesConnector) {
    const t = read(`commands/${c}.md`);
    assert.ok(t.includes(`${MCP_PREFIX}*`), `${c}: names the tool prefix ${MCP_PREFIX}*`);
    assert.match(t, /tools are unavailable/, `${c}: says what to do when the connector's tools are unavailable`);
    assert.match(t, /ops\/tracks\.md/, `${c}: points at the skill for the file formats`);
    assert.ok(!/[Ww]ithout the connector/.test(t), `${c}: the connector is part of the plugin, not optional`);
  }
  // The explicit board commands (REQ-8, TC-9).
  const show = read('commands/show-board.md');
  assert.match(show, /never regenerate/i);
  assert.match(show, /Never call `publish`/);
  assert.match(show, /Artifact tool, action `open`/);
  const refresh = read('commands/refresh-board.md');
  assert.match(refresh, /republish them to the stored URL/);
  assert.match(refresh, /ask me "Create a private board for this project\?" and create nothing without my yes/);
  assert.match(read('commands/board.md'), /ask me which one I want/);
  // help lists every command exactly once, grouped, with the note on the `lc` command-line tool.
  const help = read('commands/help.md');
  assert.ok(help.includes(helpText()), 'help.md holds the catalog help text');
  for (const c of CATALOG) assert.equal(help.split('\n').filter((l) => new RegExp(`^- ${c.name}( |:)`).test(l)).length, 1, `${c.name} listed once in help`);
  assert.match(help, /Needs the `lc` command-line tool .* when it is missing/);
  // board and run say plainly that generating the board needs the plugin's own script or `lc`, and how to find the script.
  for (const c of ['board', 'run']) {
    const t = read(`commands/${c}.md`);
    assert.match(t, /plugin's own board script/, `${c}: the board script is the plugin's own`);
    assert.ok(t.includes('**/laneconductor/**/server/bin/lc-board.mjs'), `${c}: finds the script with a Glob under ~/.claude/plugins`);
    assert.ok(t.includes('`lc` command on PATH'), `${c}: names lc as the alternative`);
    assert.match(t, /say so/, `${c}: stops and says so when neither exists`);
  }
  assert.ok(fs.existsSync(path.join(PLUGIN, 'server/bin/lc-board.mjs')), 'the script the commands name ships');
});

test('the full plugin: manifest name, the connector and board script ship; the only other plugin directory is LaneConductor Lite', () => {
  assert.equal(JSON.parse(read('.claude-plugin/plugin.json')).name, PLUGIN_NAME);
  for (const f of ['.mcp.json', 'server/bin/lc-connector.mjs', 'server/bin/lc-board.mjs', 'server/src/board-page.html']) assert.ok(fs.existsSync(path.join(PLUGIN, f)), f);
  assert.deepEqual(fs.readdirSync(path.join(REPO, 'plugins')).sort(), ['laneconductor', 'laneconductor-lite']);
});
