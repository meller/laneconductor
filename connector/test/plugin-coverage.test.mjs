// Track AM-10115 Phase 2: every command of the skill's routing table has a plugin action (a command file) or a
// recorded reason (connector/plugin-extras/coverage.json), and the commands and agents are well formed.
// HUMAN, not covered here: running the commands and the subagent in a real Claude Code session (plan Task 8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, PLUGIN_REL } from '../../scripts/build-plugin.mjs';
import { TOOLS } from '../src/tools/index.mjs';

const PLUGIN = path.join(REPO, PLUGIN_REL);
const SKILL = path.join(PLUGIN, 'skills/laneconductor');
const COVERAGE = JSON.parse(fs.readFileSync(path.join(REPO, 'connector/plugin-extras/coverage.json'), 'utf8'));
const ls = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []);
const COMMANDS = ls(path.join(PLUGIN, 'commands')).map((f) => f.replace(/\.md$/, ''));
const AGENTS = ls(path.join(PLUGIN, 'agents')).map((f) => f.replace(/\.md$/, ''));
const read = (rel) => fs.readFileSync(path.join(PLUGIN, rel), 'utf8');
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));
const MCP_PREFIX = 'mcp__plugin_laneconductor_lc-connector__';

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
    for (const m of text.matchAll(/\bmcp__plugin_laneconductor_lc-connector__(\w+)/g)) assert.ok(TOOL_NAMES.has(m[1]), `${rel} names unknown connector tool ${m[1]}`);
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
      if (t.startsWith('mcp__')) {
        assert.ok(t.startsWith(MCP_PREFIX) && TOOL_NAMES.has(t.slice(MCP_PREFIX.length)), `${a}: unknown connector tool ${t}`);
      } else {
        assert.ok(['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'].includes(t), `${a}: unexpected tool ${t} (no web tools)`);
      }
    }
  }
  const runner = parse(read('agents/track-runner.md')).fm;
  assert.equal(runner.get('isolation'), 'worktree');
  assert.ok(Number(runner.get('maxTurns')) > 0);
  const reviewer = (parse(read('agents/plan-reviewer.md')).fm.get('tools') ?? '').split(',').map((s) => s.trim());
  for (const t of reviewer) assert.ok(['Read', 'Grep', 'Glob', `${MCP_PREFIX}get_track`, `${MCP_PREFIX}get_context`].includes(t), `plan-reviewer must be read-only, has ${t}`);
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
