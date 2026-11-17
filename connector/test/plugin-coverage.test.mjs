// Track AM-10115 Phase 2: every command of the skill's routing table has a plugin action (a command file) or a
// recorded reason (connector/plugin-extras/coverage.json), and the commands and agents are well formed.
// The commands and agents live in the LEAN plugin (plugins/laneconductor); the connector tools they may use belong to the
// laneconductor-connector plugin, so the lean agents must not name them in `tools`.
// HUMAN, not covered here: running the commands and the subagent in a real Claude Code session (plan Task 8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, PLUGIN_REL, BOARD_REL, CONNECTOR_REL, BOARD_NAME, CONNECTOR_NAME, CONNECTOR_TOOL_PREFIX } from '../../scripts/build-plugin.mjs';
import { TOOLS } from '../src/tools/index.mjs';

const PLUGIN = path.join(REPO, PLUGIN_REL);
const SKILL = path.join(PLUGIN, 'skills/laneconductor');
const COVERAGE = JSON.parse(fs.readFileSync(path.join(REPO, 'connector/plugin-extras/coverage.json'), 'utf8'));
const ls = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []);
const COMMANDS = ls(path.join(PLUGIN, 'commands')).map((f) => f.replace(/\.md$/, ''));
const AGENTS = ls(path.join(PLUGIN, 'agents')).map((f) => f.replace(/\.md$/, ''));
const read = (rel) => fs.readFileSync(path.join(PLUGIN, rel), 'utf8');
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));
const MCP_PREFIX = CONNECTOR_TOOL_PREFIX; // mcp__plugin_laneconductor-connector_lc__

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
  assert.deepEqual(unmapped, [], 'add a commands/<name>.md in connector/plugin-extras, or list the name with a reason in coverage.json');
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
    'move', 'comment', 'board', 'workflow', 'setup', 'deploy', 'review-plan'];
  assert.deepEqual(want.filter((c) => !COMMANDS.includes(c)), []);
  for (const c of COMMANDS) {
    const { fm, body } = parse(read(`commands/${c}.md`));
    assert.ok((fm.get('description') ?? '').length > 10, `${c}: frontmatter needs a description`);
    assert.ok(fm.has('argument-hint'), `${c}: frontmatter needs an argument-hint`);
    for (const k of fm.keys()) assert.ok(['description', 'argument-hint', 'allowed-tools', 'model'].includes(k), `${c}: undocumented frontmatter field ${k}`);
    assert.ok(body.trim().split('\n').length < 40, `${c}: body must stay under 40 lines (the skill is the single source)`);
    assert.ok(body.includes('$ARGUMENTS'), `${c}: must use $ARGUMENTS`);
  }
});

test('commands and agents reference only files and tools that ship', () => {
  for (const rel of [...COMMANDS.map((c) => `commands/${c}.md`), ...AGENTS.map((a) => `agents/${a}.md`)]) {
    const text = read(rel);
    for (const m of text.matchAll(/`((?:lanes|ops|setup|deploy)\/[A-Za-z0-9._-]+)`/g)) {
      assert.ok(fs.existsSync(path.join(SKILL, m[1])), `${rel} names ${m[1]}, which is not in the shipped skill`);
    }
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9._/-]+)/g)) assert.ok(fs.existsSync(path.join(PLUGIN, m[1])), `${rel} names ${m[1]}, which is not shipped`);
    for (const m of text.matchAll(/\bmcp__plugin_[A-Za-z-]+_lc__(\w+)/g)) assert.ok(TOOL_NAMES.has(m[1]), `${rel} names unknown connector tool ${m[1]}`);
    assert.ok(!/mcp__plugin_laneconductor_|mcp__plugin_[A-Za-z-]+_lc-connector__/.test(text), `${rel}: an old tool prefix (single plugin or server key lc-connector) no longer exists`);
    assert.ok(!/laneconductor-(plus|extended)/.test(text), `${rel}: names a plugin that does not exist`);
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
    for (const t of (fm.get('tools') ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      // The lean plugin has no connector, so a tool list naming one would name a tool that does not exist.
      assert.ok(!t.startsWith('mcp__'), `${a}: the lean build must not name connector tools in tools (${t})`);
      assert.ok(['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'].includes(t), `${a}: unexpected tool ${t} (no web tools)`);
    }
  }
  const runner = parse(read('agents/track-runner.md')).fm;
  assert.equal(runner.get('isolation'), 'worktree');
  assert.ok(Number(runner.get('maxTurns')) > 0);
  const reviewer = (parse(read('agents/plan-reviewer.md')).fm.get('tools') ?? '').split(',').map((s) => s.trim());
  assert.deepEqual(reviewer, ['Read', 'Grep', 'Glob'], 'plan-reviewer is read-only');
  const runnerTools = (runner.get('tools') ?? '').split(',').map((s) => s.trim());
  assert.deepEqual(runnerTools, ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob']);
});

test('run, implement and review recommend track-runner, show the dispatch and start nothing unasked', () => {
  for (const c of ['run', 'implement', 'review']) {
    const t = read(`commands/${c}.md`);
    assert.ok(t.includes('laneconductor:track-runner'), `${c}: names the subagent`);
    assert.match(t, /RECOMMEND, do not start/, `${c}: recommends, does not start`);
    assert.match(t, /one per track/, `${c}: one subagent per track`);
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

test('commands that use the connector name the plugin and its tool prefix, and say what to do without it', () => {
  const usesConnector = COMMANDS.filter((c) => /`(?:get|list|create|update|append)_[a-z_]+`/.test(read(`commands/${c}.md`)));
  assert.ok(usesConnector.length >= 10, `only ${usesConnector.length} commands use connector tools`);
  for (const c of usesConnector) {
    const t = read(`commands/${c}.md`);
    assert.ok(t.includes(CONNECTOR_NAME), `${c}: names the connector plugin (${CONNECTOR_NAME})`);
    assert.ok(t.includes(`${MCP_PREFIX}*`), `${c}: names the tool prefix ${MCP_PREFIX}*`);
    assert.match(t, /[Ww]ithout the connector/, `${c}: says what to do without the connector`);
    assert.match(t, /ops\/tracks\.md/, `${c}: points at the skill for the file formats`);
  }
  // board and run say plainly that generating the board needs the board plugin or `lc`.
  for (const c of ['board', 'run']) {
    const t = read(`commands/${c}.md`);
    assert.ok(t.includes(`needs the \`${BOARD_NAME}\` plugin or the \`lc\` command on PATH`), `${c}: board generation needs ${BOARD_NAME} or lc`);
    assert.match(t, /say so/, `${c}: stops and says so when neither exists`);
  }
});

test('the lean plugin ships no connector tool, and the add-ons ship no skill, commands or agents', () => {
  for (const rel of [BOARD_REL, CONNECTOR_REL]) {
    for (const d of ['skills', 'commands', 'agents']) assert.ok(!fs.existsSync(path.join(REPO, rel, d)), `${rel} must not ship ${d}/`);
  }
  const lean = fs.readdirSync(PLUGIN, { recursive: true }).map(String);
  assert.ok(!lean.some((r) => r === '.mcp.json' || r.startsWith('server')), 'lean plugin has no server');
});
