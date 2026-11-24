// Track AM-10115 Phase 2 and AM-10116: every command of the skill's routing table is in the command catalog (connector/src/commands.mjs)
// or has a recorded reason (connector/plugin-extras/coverage.json); every catalog entry yields exactly one plugin command file and
// one MCP prompt; the commands and agents are well formed.
// All slash commands live in the base (plugins/laneconductor); the commands name the parallel add-on's connector tools
// (`mcp__plugin_laneconductor-parallel_lc__*`) only for when they are present, and find the board script of the board add-on by Glob.
// HUMAN, not covered here: running the commands and the subagent in a real Claude Code session (plan Task 8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, PLUGIN_REL, PARALLEL_REL, BOARD_REL, PLUGIN_NAME, CONNECTOR_TOOL_PREFIX, INLINED_COMMANDS, REFERENCES, toolsUsedBy } from '../../scripts/build-plugin.mjs';
import { TOOLS } from '../src/tools/index.mjs';
import { COMMANDS as CATALOG, COMMAND_NAMES, argumentHint, helpLines } from '../src/commands.mjs';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, rm } from './helpers/repo.mjs';

const PLUGIN = path.join(REPO, PLUGIN_REL);
const PARALLEL = path.join(REPO, PARALLEL_REL);
const BOARD = path.join(REPO, BOARD_REL);
const SKILL = path.join(PLUGIN, 'skills/laneconductor');
const lsIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort() : []);
const COVERAGE = JSON.parse(fs.readFileSync(path.join(REPO, 'connector/plugin-extras/coverage.json'), 'utf8'));
const ls = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []);
const COMMANDS = ls(path.join(PLUGIN, 'commands')).map((f) => f.replace(/\.md$/, ''));
const AGENTS = ls(path.join(PLUGIN, 'agents')).map((f) => f.replace(/\.md$/, ''));
const read = (rel) => fs.readFileSync(path.join(PLUGIN, rel), 'utf8');
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));
const MCP_PREFIX = CONNECTOR_TOOL_PREFIX; // mcp__plugin_laneconductor-parallel_lc__

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
    'move', 'comment', 'board', 'workflow', 'setup', 'deploy', 'review-plan', 'help', 'repair-duplicates'];
  assert.deepEqual(want.filter((c) => !COMMANDS.includes(c)), []);
  for (const c of COMMANDS) {
    const { fm, body } = parse(read(`commands/${c}.md`));
    assert.ok((fm.get('description') ?? '').length > 10, `${c}: frontmatter needs a description`);
    if (CATALOG.find((x) => x.name === c).args.length) assert.ok(fm.has('argument-hint'), `${c}: frontmatter needs an argument-hint`);
    for (const k of fm.keys()) assert.ok(['description', 'argument-hint', 'allowed-tools', 'model'].includes(k), `${c}: undocumented frontmatter field ${k}`);
    // Track AM-10132: a command that makes the model read a file in the plugin's install folder prompts interactively and is denied headless.
    // So setup, next and new-project carry their whole procedure, and every command that named skill files carries the text it uses under
    // "Reference" (REFERENCES in scripts/plugin-references.mjs, each entry with its reason). All of it is generated from the skill, which stays the
    // single source. Only those commands are exempt from the line limit, and only from it; inlined-commands.test.mjs holds what they must contain.
    if (INLINED_COMMANDS.includes(c) || REFERENCES[c]) {
      if (REFERENCES[c]) assert.ok(REFERENCES[c].why.length >= 40, `${c}: an exempt command needs a stated reason`);
    } else assert.ok(body.trim().split('\n').length < (c === 'help' ? 45 : 40), `${c}: body must stay under 40 lines (the skill is the single source)`);
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
    for (const m of text.matchAll(/\bmcp__plugin_[A-Za-z_-]+?_lc(?:-connector)?__/g)) assert.equal(m[0], CONNECTOR_TOOL_PREFIX, `${rel}: wrong tool prefix ${m[0]} (the connector is the parallel add-on's: ${CONNECTOR_TOOL_PREFIX}*)`);
    assert.ok(!/laneconductor-(plus|extended|connector|lite)/.test(text), `${rel}: names a plugin that does not exist`);
    assert.ok(!/\bgit add (-A|\.)(\s|$)/.test(text.replace(/never `git add -A`[^\n]*/g, '')), `${rel}: must not tell anyone to git add -A`);
  }
  // Connector tool names used in command bodies (backticked snake_case) exist.
  for (const c of COMMANDS) {
    for (const m of read(`commands/${c}.md`).matchAll(/`((?:get|list|create|update|append|report|health)_[a-z_]+)`/g)) {
      assert.ok(TOOL_NAMES.has(m[1]), `commands/${c}.md names unknown connector tool ${m[1]}`);
    }
  }
});

test('agents: documented frontmatter only, valid isolation, tool names that exist; the base has the read-only plan-reviewer, the parallel add-on has track-runner with isolation', () => {
  const allowed = ['name', 'description', 'model', 'effort', 'maxTurns', 'tools', 'disallowedTools', 'skills', 'memory', 'background', 'isolation', 'color'];
  const ignored = ['permissionMode', 'hooks', 'mcpServers', 'initialPrompt'];
  assert.deepEqual(AGENTS, ['plan-reviewer'], 'the base ships plan-reviewer only: no `isolation`, no connector tools');
  assert.deepEqual(lsIn(path.join(PARALLEL, 'agents')), ['track-runner']);
  const check = (name, text) => {
    const { fm, body } = parse(text);
    for (const k of fm.keys()) {
      assert.ok(!ignored.includes(k), `${name}: ${k} is ignored in plugin agents; do not use it`);
      assert.ok(allowed.includes(k), `${name}: undocumented frontmatter field ${k}`);
    }
    assert.equal(fm.get('name'), name);
    assert.ok((fm.get('description') ?? '').length > 20, `${name}: description`);
    if (fm.has('isolation')) assert.equal(fm.get('isolation'), 'worktree');
    assert.ok(body.trim().length > 0);
    for (const t of (fm.get('tools') ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
      if (t.startsWith('mcp__')) assert.ok(t.startsWith(CONNECTOR_TOOL_PREFIX) && TOOL_NAMES.has(t.slice(CONNECTOR_TOOL_PREFIX.length)), `${name}: ${t} is not a connector tool of laneconductor-parallel`);
      else assert.ok(['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'].includes(t), `${name}: unexpected tool ${t} (no web tools)`);
    }
    return fm;
  };
  const reviewer = check('plan-reviewer', read('agents/plan-reviewer.md'));
  assert.equal(reviewer.has('isolation'), false);
  assert.deepEqual(reviewer.get('tools').split(',').map((s) => s.trim()), ['Read', 'Grep', 'Glob'], 'plan-reviewer is read-only and carries no connector tool in the base');
  const runner = check('track-runner', fs.readFileSync(path.join(PARALLEL, 'agents/track-runner.md'), 'utf8'));
  assert.equal(runner.get('isolation'), 'worktree');
  assert.ok(Number(runner.get('maxTurns')) > 0);
  const P = CONNECTOR_TOOL_PREFIX;
  const runnerTools = (runner.get('tools') ?? '').split(',').map((s) => s.trim());
  assert.deepEqual(runnerTools, ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', `${P}get_context`, `${P}get_track`, `${P}update_track`, `${P}append_conversation`], 'the connector tools are in track-runner\'s tools list');
});

test('run, implement and review dispatch the add-on\'s track-runner (the command is the yes), show the dispatch first; without the add-on they work in session', () => {
  for (const c of ['run', 'implement', 'review']) {
    const t = read(`commands/${c}.md`);
    assert.ok(t.includes('laneconductor-parallel:track-runner'), `${c}: names the subagent`);
    assert.match(t, /DISPATCH it now/, `${c}: dispatches`);
    assert.match(t, /one sub-agent per track/, `${c}: one subagent per track`);
    assert.match(t, /own worktree/, `${c}: own worktree`);
    assert.match(t, /typing this command is my yes/, `${c}: the command is the yes`);
    assert.match(t, /If it is not listed: do the lane in this session/, `${c}: works without the add-on`);
    assert.match(t, /git worktree add/, `${c}: the by-hand way`);
    assert.match(t, /Otherwise mention nothing/, `${c}: no nagging`);
  }
  assert.match(read('commands/deploy.md'), /runs only because I named it/, 'deploy: only when named');
  assert.match(read('commands/setup.md'), /runs when I named it, or said go to the card of `next` that named it/, 'setup: when named, or on go to the card');
  const skill = fs.readFileSync(path.join(SKILL, 'ops/working-a-track.md'), 'utf8');
  assert.match(skill, /Plugin users: one subagent per track in a worktree/);
  assert.match(skill, /Without the add-on, work the lane in this session/);
});

test('the real table: automatic and skill-only rows are exactly the recorded ones', () => {
  assert.deepEqual(Object.keys(COVERAGE.entries).sort(), ['delete', 'init-tracks-summary', 'revert']);
});

test('commands that use the connector name its tools only for when they are present, and the steps above them work without; the board commands find the script by Glob', () => {
  const usesConnector = COMMANDS.filter((c) => read(`commands/${c}.md`).includes(`${MCP_PREFIX}`));
  assert.ok(usesConnector.length >= 10, `only ${usesConnector.length} commands name connector tools`);
  for (const c of usesConnector) {
    const t = read(`commands/${c}.md`);
    assert.match(t, /add-on's tools are present/, `${c}: says when the tools apply`);
    assert.match(t, /If they are not present, the steps above are the whole job/, `${c}: says what to do when they are not`);
    assert.match(t, /ops\/tracks\.md|\bops\/(working-a-track|new-project|next)\.md/, `${c}: points at the skill for the file formats`);
    // Every tool the catalog's own procedure uses is named, with the add-on's prefix (generated, not hand-written).
    const cat = CATALOG.find((x) => x.name === c);
    for (const tool of toolsUsedBy(cat.procedure)) assert.ok(t.includes(`${MCP_PREFIX}${tool}`), `${c}: names ${MCP_PREFIX}${tool}`);
  }
  // The explicit board commands (REQ-8, TC-9).
  // Track AM-10115: `board` is the only board command. No argument opens the board, `refresh` rebuilds and republishes it.
  assert.deepEqual(COMMANDS.filter((c) => /board/.test(c)), ['board'], 'no show-board or refresh-board command');
  for (const gone of ['commands/show-board.md', 'commands/refresh-board.md']) assert.ok(!fs.existsSync(path.join(PLUGIN, gone)), `${gone} is gone`);
  const board = read('commands/board.md');
  assert.equal(argumentHint(CATALOG.find((x) => x.name === 'board')), '[refresh]', 'the argument hint is [refresh]');
  assert.match(board, /nothing given means open the existing board/);
  assert.match(board, /never regenerate or republish it/i);
  assert.match(board, /Opening never calls `publish`/);
  assert.match(board, /Artifact tool, action `open`/);
  assert.match(board, /more than an hour old, say so and suggest refreshing it/);
  assert.match(board, /In Claude Code, type the refresh as `\/laneconductor:board refresh`/);
  assert.match(board, /republish them to the stored URL/);
  assert.match(board, /no board yet and running this command means I want one: do not ask/);
  assert.doesNotMatch(board, /create nothing without my yes, and then follow/);
  assert.match(board, /If the board add-on is not installed, say that it has to be installed first/);
  assert.match(board, /Only Claude can publish an artifact/);
  assert.match(board, /If the argument is anything else, ask me which one I mean/);
  // help lists every command exactly once, grouped, and says which commands need an add-on.
  const help = read('commands/help.md');
  assert.ok(help.includes(helpLines('LaneConductor commands. Say one in your own words, or use it as a slash command.').join('\n')), 'help.md holds the catalog help lines');
  for (const c of CATALOG) assert.equal(help.split('\n').filter((l) => new RegExp(`^- ${c.name}( |:)`).test(l)).length, 1, `${c.name} listed once in help`);
  assert.match(help, /Works on its own: every command edits the track files directly\. Needs the laneconductor-board add-on: board \(only to refresh\), explain; without it it says so/);
  // board: finds the board script by Glob, and says so + shows the install commands when it does not exist.
  for (const c of ['board']) {
    const t = read(`commands/${c}.md`);
    assert.ok(t.includes('**/laneconductor-board/**/bin/lc-board.mjs'), `${c}: finds the script with a Glob under ~/.claude/plugins`);
    assert.ok(!t.includes('is on PATH'), `${c}: names no program on PATH as an alternative`);
    assert.match(t, /add-on is not installed: say so/, `${c}: says so when neither exists`);
    assert.match(t, /claude plugin install laneconductor-board@laneconductor/, `${c}: shows the install command`);
  }
  assert.ok(!fs.existsSync(path.join(PLUGIN, 'server')), 'the base ships no script: the commands name the add-on\'s');
});

test('TC-5/TC-9 shape: all slash commands live in the base; the add-ons ship no commands/ or skills/ folder', () => {
  assert.equal(JSON.parse(read('.claude-plugin/plugin.json')).name, PLUGIN_NAME);
  assert.ok(!fs.existsSync(path.join(PARALLEL, 'commands')), `${PARALLEL} has a commands/ folder`);
  assert.ok(!fs.existsSync(path.join(BOARD, 'commands')), 'the board add-on ships no commands: all of them live in the base');
  for (const dir of [PARALLEL, BOARD]) assert.ok(!fs.existsSync(path.join(dir, 'skills')), `${dir} has a skills/ folder`);
  assert.deepEqual(fs.readdirSync(path.join(REPO, 'plugins')).sort(), ['laneconductor', 'laneconductor-analytics-monitoring', 'laneconductor-board', 'laneconductor-firebase', 'laneconductor-gemini', 'laneconductor-node-postgres', 'laneconductor-nodejs-frontend', 'laneconductor-parallel', 'laneconductor-skill-from-code']);
});
