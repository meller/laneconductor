// Track AM-10116 Phase 2 (TC-3, TC-5, TC-8): the command catalog served as MCP prompts and the help tool, driven through the SDK client.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, git, rm } from './helpers/repo.mjs';
import { COMMANDS, COMMAND_NAMES, GROUPS, argumentHint, fillProcedure, helpText } from '../src/commands.mjs';
import { createContext } from '../src/server.mjs';
import { TOOLS } from '../src/tools/index.mjs';
import { INSTRUCTIONS_LIMIT } from '../src/instructions.mjs';

const cleanup = [];
const sessions = [];
after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  rm(...cleanup);
});
const open = async () => {
  const dir = makeRepo();
  cleanup.push(dir);
  const s = await connect(dir);
  sessions.push(s);
  return s;
};

const sampleValue = (a) => `<${a.name} value>`;
const sampleArgs = (cmd) => Object.fromEntries(cmd.args.map((a) => [a.name, sampleValue(a)]));

test('catalog: every command has the fields, unique names, a known group and exactly the commands of the spec', () => {
  assert.equal(new Set(COMMAND_NAMES).size, COMMAND_NAMES.length);
  const want = ['plan', 'brainstorm', 'implement', 'review', 'quality-gate', 'merge', 'run', 'new', 'bug', 'feature', 'status', 'move', 'comment',
    'board', 'workflow', 'setup', 'deploy', 'review-plan', 'help', 'show-board', 'refresh-board', 'new-project', 'repair-duplicates'];
  assert.deepEqual([...COMMAND_NAMES].sort(), [...want].sort());
  for (const c of COMMANDS) {
    assert.ok(GROUPS.includes(c.group), `${c.name}: group`);
    assert.ok(c.title && c.description.length > 10 && !/\n/.test(c.description), `${c.name}: title and one-line description`);
    assert.ok(c.example.length > 3, `${c.name}: example phrase`);
    assert.ok(c.render === 'help' || c.procedure.length > 20, `${c.name}: procedure`);
    for (const a of c.args) assert.ok(a.name && a.description && typeof a.required === 'boolean', `${c.name}.${a.name}: arg fields`);
    for (const m of (c.procedure ?? '').matchAll(/\{\{(\w+)\}\}/g)) assert.ok(c.args.some((a) => a.name === m[1]), `${c.name}: placeholder ${m[1]} has no argument`);
  }
});

// TC-5, REQ-6: nothing Claude-specific in the catalog or in what a prompt returns.
test('catalog and prompt output name no Claude-specific string', () => {
  const claude = /mcp__|laneconductor:|track-runner|plan-reviewer|CLAUDE_PLUGIN_ROOT|~\/\.claude|\bClaude\b|\$ARGUMENTS|\/laneconductor|Artifact tool|allowed-tools/;
  for (const c of COMMANDS) {
    const text = JSON.stringify(c) + (c.render === 'help' ? helpText() : fillProcedure(c, sampleArgs(c)));
    assert.doesNotMatch(text, claude, `${c.name} is not neutral`);
  }
});

// TC-3 / AC-1
test('prompts/list returns every catalog command and prompts/get fills the arguments', async () => {
  const s = await open();
  const { prompts } = await s.client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name).sort(), [...COMMAND_NAMES].sort());
  const byName = new Map(prompts.map((p) => [p.name, p]));
  assert.deepEqual(byName.get('move').arguments.map((a) => [a.name, a.required]), [['track', true], ['lane', true]]);
  assert.deepEqual(byName.get('status').arguments.map((a) => [a.name, a.required]), [['track', false]]);
  assert.equal(byName.get('help').arguments?.length ?? 0, 0);
  for (const c of COMMANDS) {
    const got = await s.client.getPrompt({ name: c.name, arguments: sampleArgs(c) });
    assert.equal(got.messages.length, 1, c.name);
    assert.equal(got.messages[0].role, 'user');
    const text = got.messages[0].content.text;
    for (const a of c.args) assert.ok(text.includes(sampleValue(a)) || c.render === 'help', `${c.name} did not substitute ${a.name}`);
    assert.doesNotMatch(text, /\{\{/, `${c.name} left a placeholder`);
  }
  const plan = await s.client.getPrompt({ name: 'plan', arguments: { track: '10106' } });
  assert.match(plan.messages[0].content.text, /^Work on track 10106 in the plan lane\./);
  const status = await s.client.getPrompt({ name: 'status', arguments: {} });
  assert.match(status.messages[0].content.text, /Show status for: \(none given\)/);
});

test('prompts/get without a required argument is an error that names the argument', async () => {
  const s = await open();
  await assert.rejects(() => s.client.getPrompt({ name: 'comment', arguments: { track: '10106' } }), /text/);
  await assert.rejects(() => s.client.getPrompt({ name: 'plan', arguments: {} }), /track/);
});

test('the help prompt and the help tool list every command exactly once, with an example phrase and the note on the board script', async () => {
  const s = await open();
  const prompt = (await s.client.getPrompt({ name: 'help', arguments: {} })).messages[0].content.text;
  assert.equal(prompt, helpText());
  const tool = await s.call('help', {});
  assert.equal(tool.isError, false, tool.text);
  assert.deepEqual(tool.env.data.commands.map((c) => c.name), COMMAND_NAMES);
  for (const c of COMMANDS) {
    const lines = prompt.split('\n').filter((l) => l.startsWith(`- ${c.name}`) && (l[2 + c.name.length] === ':' || l[2 + c.name.length] === ' '));
    assert.equal(lines.length, 1, `${c.name} listed ${lines.length} times`);
    assert.ok(lines[0].includes(`Example: "${c.example}"`), `${c.name}: example phrase`);
    assert.ok(tool.env.data.commands.find((x) => x.name === c.name).example === c.example);
  }
  for (const g of GROUPS) assert.ok(prompt.includes(`${g[0].toUpperCase()}${g.slice(1)}\n`), `group ${g}`);
  assert.match(prompt, /Needs the board add-on's script: board \(only to refresh\), refresh-board\./);
  assert.match(tool.text, /Example: "what can LaneConductor do"/);
});

test('help works in a directory that is not a LaneConductor repo and writes nothing there', async () => {
  const dir = makeRepo({ workflow: false });
  cleanup.push(dir);
  rm(`${dir}/conductor`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'drop conductor');
  const s = await connect(dir);
  sessions.push(s);
  const before = git(dir, 'status', '--porcelain');
  const r = await s.call('help', {});
  assert.equal(r.isError, false, r.text);
  const other = await s.call('list_tracks', {});
  assert.equal(other.env.error.code, 'NOT_A_LANECONDUCTOR_REPO');
  assert.equal(git(dir, 'status', '--porcelain'), before);
});

// TC-8 / AC-6
test('every tool carries the four annotation hints and an Example line; help is read-only', async () => {
  const s = await open();
  const { tools } = await s.client.listTools();
  assert.ok(tools.some((t) => t.name === 'help'));
  for (const t of tools) {
    for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) assert.equal(typeof t.annotations?.[k], 'boolean', `${t.name}.${k}`);
    assert.match(t.description, /\nExample: ".+" -> \w+/, `${t.name}: Example line`);
  }
  const help = tools.find((t) => t.name === 'help');
  assert.equal(help.annotations.readOnlyHint, true);
  assert.deepEqual(help.inputSchema.properties ?? {}, {});
  for (const d of TOOLS) assert.equal(Object.keys(d.annotations).sort().join(), 'destructiveHint,idempotentHint,openWorldHint,readOnlyHint', d.name);
});

// KC-8: what a session pays for (instructions + tool list). Measured 2478 tokens at 0.3.0 (before this track); the budget is +15%.
test('KC-8: the context estimate stays within 15 percent of the 0.3.0 figure, and the instructions stay under 4,096 characters and mention prompts', () => {
  const ctx = createContext({ stores: [{ describe: () => ({ repo: '/x' }) }], version: '0' });
  const BEFORE = 2478;
  assert.ok(ctx.contextTokens() <= Math.floor(BEFORE * 1.15), `${ctx.contextTokens()} tokens exceeds ${Math.floor(BEFORE * 1.15)}`);
  assert.ok(ctx.instructions.length < INSTRUCTIONS_LIMIT);
  assert.match(ctx.instructions, /MCP prompts/);
  assert.match(ctx.instructions, /help tool/);
});

test('argumentHint reads like a usage line', () => {
  assert.equal(argumentHint(COMMANDS.find((c) => c.name === 'plan')), '<track number or title>');
  assert.equal(argumentHint(COMMANDS.find((c) => c.name === 'board')), '[show | update]');
  assert.equal(argumentHint(COMMANDS.find((c) => c.name === 'move')), '<track number> <lane[:status]>');
  assert.equal(argumentHint(COMMANDS.find((c) => c.name === 'help')), '');
});

// Track AM-10130: `setup` means "add LaneConductor to this project" and follows the new-project existing-repository path; `scaffold`
// is the explicit action that goes straight to the files. Both stay "runs only because you named it" and announce changes first.
test('setup: follows ops/new-project.md (the existing-repository path), scaffold goes straight to setup/scaffold.md; nothing from the old install text', () => {
  const setup = COMMANDS.find((c) => c.name === 'setup');
  assert.match(setup.description, /Add LaneConductor to this project/);
  assert.match(setup.description, /runs only because you named it/);
  const text = fillProcedure(setup, { action: '' });
  const scaffold = fillProcedure(setup, { action: 'scaffold' });
  for (const t of [text, scaffold]) {
    assert.match(t, /This runs only because I named it/);
    assert.match(t, /tell me what you are about to create or change before you write anything/);
    assert.match(t, /`ops\/new-project\.md`/, "the procedure names the new-project file");
    assert.match(t, /`setup\/scaffold\.md`/);
    assert.doesNotMatch(t, /setup\/setup\.md|make install|laneconductorrc|worker|daemon|collection/i, "no stale install text");
  }
  assert.match(text, /existing[- ]repository path/i, "setup takes the existing-repository path");
  assert.match(text, /ask only to confirm/i);
  assert.match(text, /import nothing silently/i);
  assert.match(scaffold, /`scaffold`, go straight to `setup\/scaffold\.md`/);
  assert.match(setup.args.find((a) => a.name === 'action').description, /straight to/);
});
