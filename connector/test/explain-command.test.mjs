// Track AM-10157: /laneconductor:explain, a base slash command that finds the board add-on's lc-explain script and runs it.
// The base plugin stays Markdown only: the script is a file of the board add-on, found by Glob like the board script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, PLUGIN_REL, PARALLEL_REL, BOARD_REL, BOARD_SCRIPT_COMMANDS, EXPLAIN_SCRIPT_GLOB, PLUGINS_CACHE, MARKETPLACE_ADD_COMMAND, installCommands, buildPlugin } from '../../scripts/build-plugin.mjs';
import { COMMANDS, COMMAND_NAMES, GROUPS, helpLines, helpText, helpData } from '../src/commands.mjs';

const BASE = path.join(REPO, PLUGIN_REL);
const read = (rel) => fs.readFileSync(path.join(BASE, rel), 'utf8');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (d.name === 'node_modules' ? [] : files(path.join(dir, d.name))) : [path.join(dir, d.name)]));
const explain = () => COMMANDS.find((c) => c.name === 'explain');

// ---- Phase 1: the catalog and the help list (TC-1, TC-2) ----

test('TC-1: the catalog has explain in the board group, needing the board script, with an example phrase', () => {
  assert.ok(COMMAND_NAMES.includes('explain'));
  const c = explain();
  assert.equal(c.group, 'board');
  assert.ok(GROUPS.includes(c.group));
  assert.equal(c.needsBoardScript, 'always', 'explain cannot run without the board add-on script');
  assert.equal(c.args.length, 1);
  assert.equal(c.args[0].required, false, 'an empty argument asks which track');
  assert.match(c.example, /explain track 10106/);
  assert.ok(BOARD_SCRIPT_COMMANDS.includes('explain'), 'it keeps its one read outside the project, like board');
});

test('TC-1: help lists explain once, with its example phrase, in the catalog help, the help tool data and the help note', () => {
  const lines = helpLines('x').join('\n');
  assert.equal(lines.split('\n').filter((l) => /^- explain( |:)/.test(l)).length, 1);
  assert.ok(lines.split('\n').find((l) => /^- explain( |:)/.test(l)).includes(`Example: "${explain().example}"`));
  const data = helpData().commands.find((c) => c.name === 'explain');
  assert.equal(data.example, explain().example);
  assert.equal(data.needs_board_script, 'always');
  assert.match(helpText(), /Needs the board add-on's script: board \(only to refresh\), explain\./);
  const help = read('commands/help.md');
  assert.equal(help.split('\n').filter((l) => /^- explain( |:)/.test(l)).length, 1, 'commands/help.md lists it once');
  assert.match(help, /Needs the laneconductor-board add-on: board \(only to refresh\), explain; without it it says so/);
});

test('TC-2: the procedure handles a track number, the word statistics, an empty argument and anything else', () => {
  const p = explain().procedure;
  assert.match(p, /a track number \(`10106` or `AM-10106`\) explains that one track/);
  assert.match(p, /`--repo \. --track <number>`/);
  assert.match(p, /`--repo \. --statistics`/);
  assert.match(p, /empty: ask which track, and name the track that is in the running lane/);
  assert.match(p, /anything else: ask which one I mean/i);
  assert.match(p, /never work them out, estimate them or write the report by hand/);
  assert.match(p, /at most three/);
  assert.match(p, /make no commit/);
  assert.match(p, /conductor\/tracks\/<folder>\/explain\.md/);
  assert.match(p, /conductor\/statistics\.md/);
  assert.ok(!/~\/\.claude|\.claude\/plugins/.test(p), 'the catalog stays neutral: no plugin path in it');
});

// ---- Phase 1 and 2: the generated command of the base plugin (TC-3, TC-4, TC-5) ----

test('TC-2c (D4): a track the checkout does not have gets a plain answer: no such track here, maybe behind origin, the five newest tracks, nothing written or pulled', () => {
  const t = read('commands/explain.md');
  assert.match(t, /If the script prints `No track folder for number N`, say in one line that this checkout has no track N \(it may be behind origin: `git pull`\)/);
  assert.match(t, /list the five newest tracks that do exist here \(the highest numbers under `conductor\/tracks\/`\), and ask which one I mean/);
  assert.match(t, /write nothing and pull nothing yourself/);
});

test('TC-2d (D5): a single track shows its short plan, its suggestions and its Insight lines by default', () => {
  const t = read('commands/explain.md');
  assert.match(t, /3\. For a track, show the short plan as the script printed it: its table, the suggestion lines below it \(at most three\), one line each, and then its Insight lines \(the `## Insight` section: time, work, context, sub-agents, the biggest lane and phase\), one line each, so the Insight comes by default/);
  assert.match(t, /3b\. For the project summary, show how many tracks it summarized/);
  for (const line of explain().procedure.split('\n')) assert.ok(line.length < 600, `a procedure line is ${line.length} characters (the directory precheck rejects 600 and more)`);
});

test('TC-3: the generated command names the script glob and, for a missing add-on, both install commands each in its own block', () => {
  const t = read('commands/explain.md');
  assert.ok(t.startsWith('---\ndescription: '));
  assert.match(t, /^argument-hint: "?\[?track number \| statistics/m);
  assert.ok(t.includes(EXPLAIN_SCRIPT_GLOB), 'names the Glob');
  assert.equal(EXPLAIN_SCRIPT_GLOB, '**/laneconductor-board/**/bin/lc-explain.mjs');
  assert.ok(t.includes(PLUGINS_CACHE), 'under the plugin cache, not the marketplace clone');
  assert.ok(t.includes('connector/bin/lc-explain.mjs'), 'or the repository copy');
  assert.match(t, /If neither exists, the laneconductor-board add-on is not installed: say so in one sentence/);
  assert.match(t, /never run an install command yourself/);
  assert.match(t, /run nothing, do not work out the numbers and do not write the report by hand/);
  const fences = [...t.matchAll(/^```(\w*)\n([\s\S]*?)\n```$/gm)].filter((m) => /claude plugin/.test(m[2]));
  assert.deepEqual(fences.map((m) => m[2]), ['claude plugin marketplace add meller/laneconductor', 'claude plugin install laneconductor-board@laneconductor']);
  assert.ok(fences.every((m) => m[1] === 'bash'), 'each in its own bash block');
  assert.deepEqual(fences.map((m) => m[2]), installCommands('board'));
  assert.equal(fences[0][2], MARKETPLACE_ADD_COMMAND);
  assert.match(t, /Then run `\/reload-plugins` in the session/);
});

test('TC-3: the generated command says how to type it and that the board shows the result after a refresh', () => {
  const t = read('commands/explain.md');
  assert.match(t, /\/laneconductor:explain 10106/);
  assert.match(t, /\/laneconductor:explain statistics/);
  assert.match(t, /\/laneconductor:board refresh/);
  assert.match(t, /"Agent run" tab/);
  assert.match(t, /node <that path> --repo \. --track <number>/);
  assert.match(t, /node <that path> --repo \. --statistics/);
});

test('TC-2b (D2): the generated command takes one track or the project summary (statistics, summary, project), summarizes only tracks already explained and offers no all argument', () => {
  const t = read('commands/explain.md');
  assert.match(t, /`statistics`, `summary` or `project` \(the same thing\) gives the project summary/);
  assert.match(t, /\/laneconductor:explain statistics` \(also `summary` or `project`\)/);
  assert.match(t, /--statistics` for the project summary\. The summary analyses no new track: it only adds up the tracks that already have an `explain\.md`/);
  assert.match(t, /show how many tracks it summarized/);
  assert.match(t, /a track missing from it needs `explain <number>` first/);
  assert.match(t, /needs `\/laneconductor:explain <number>` first/);
  // No all argument and no loop: asking for all gets the one-by-one answer.
  assert.match(t, /There is no `all`: if I ask to explain all tracks, say that explaining every track is slow and is not offered as one step, and tell me to explain the tracks I care about one by one and then run the summary/);
  assert.ok(!/argument-hint: .*\ball\b/.test(t), 'the argument hint offers no all');
  assert.ok(!/`all`[^.]*(runs|explains) every/i.test(t) && !/for each track|every track in turn|loop over/i.test(t), 'no loop over the tracks');
  const arg = explain().args[0];
  assert.ok(!/\ball\b/.test(arg.hint) && !/\ball\b/.test(arg.description.replace(/all tracks/g, '')), 'the catalog argument offers no all');
});

test('TC-4: the generated command says the script keeps numbers only and shows or writes no prompt, message or file content', () => {
  const t = read('commands/explain.md');
  assert.match(t, /numbers only \(timestamps, token counts, tool names\)/);
  assert.match(t, /no prompt, message or file content is shown or written/);
});

test('TC-5: the generated command calls no file inside the base plugin, and carries no skill reference to read', () => {
  const t = read('commands/explain.md');
  const calls = [...t.matchAll(/\bnode\s+(<that path>|\S+)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 2, 'it runs the script with node');
  for (const c of calls) assert.equal(c, '<that path>', `node is run only on the path found by Glob, not on a file of the base: ${c}`);
  assert.ok(!/\.mjs\b/.test(t.replace(/lc-explain\.mjs/g, '')), 'no other script is named');
  assert.ok(!/CLAUDE_PLUGIN_ROOT/.test(t));
  assert.ok(!/## Reference/.test(t), 'it copies no skill text');
  assert.ok(!/Do not Glob or Read the plugin's install folder/.test(t), 'the Reference notice would contradict the Glob it needs');
});

test('TC-5: the base plugin has no script, package file or MCP server, and the build is clean', () => {
  assert.ok(fs.existsSync(path.join(BASE, 'commands/explain.md')));
  const rels = files(BASE).map((f) => path.relative(BASE, f));
  assert.deepEqual(rels.filter((r) => /\.(mjs|js|cjs|ts|sh)$/.test(r) || /(^|\/)(package(-lock)?\.json|\.mcp\.json)$/.test(r)), []);
  // The script itself stays in the board add-on only.
  assert.ok(fs.existsSync(path.join(REPO, BOARD_REL, 'server/bin/lc-explain.mjs')));
  assert.ok(!fs.existsSync(path.join(REPO, PARALLEL_REL, 'commands/explain.md')), 'the parallel add-on has no commands');
  // What the build writes for the base is what is committed (the same check as `build-plugin.mjs --check`).
  const built = buildPlugin(REPO, 'base');
  assert.equal(built.get('commands/explain.md').content.toString('utf8'), read('commands/explain.md'));
});

// ---- Phase 2: docs (TC-6) ----

test('TC-6: the plugin map lists the command (twice: the base commands, the connector prompts) and the table says it needs the board add-on', () => {
  const map = fs.readFileSync(path.join(REPO, 'docs/plugin-map.md'), 'utf8');
  assert.equal([...map.matchAll(/`explain`/g)].length, 3, 'the command list, the prompt list and the needs table');
  assert.match(map, /^\| `explain` \| no \(shows how to get the add-on\) \| nothing \| yes \|$/m);
  // The base README lists no command by name (it says "every slash command"); if it ever names this one it must not claim a release.
  assert.ok(!/explain[^.\n]*(released|available now|is out)/i.test(read('README.md')));
});
