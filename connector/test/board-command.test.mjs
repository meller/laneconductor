// Track AM-10115: one board command. `show-board` and `refresh-board` are gone from the catalog and from everything generated from it;
// `board` with no argument opens the board and `board refresh` rebuilds and republishes it. The page's Refresh board button copies that exact prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, PLUGIN_REL, PARALLEL_REL, BOARD_REL } from '../../scripts/build-plugin.mjs';
import { COMMANDS, COMMAND_NAMES, helpLines, helpData } from '../src/commands.mjs';
import { connect } from './helpers/mcp.mjs';
import { makeRepo, rm } from './helpers/repo.mjs';

const BASE = path.join(REPO, PLUGIN_REL);
const read = (rel) => fs.readFileSync(path.join(BASE, rel), 'utf8');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (d.name === 'node_modules' ? [] : files(path.join(dir, d.name))) : [path.join(dir, d.name)]));

test('the catalog has board and no show-board or refresh-board; board takes the one argument refresh', () => {
  assert.ok(COMMAND_NAMES.includes('board'));
  assert.deepEqual(COMMAND_NAMES.filter((n) => /board/.test(n)), ['board']);
  const board = COMMANDS.find((c) => c.name === 'board');
  assert.deepEqual(board.args.map((a) => a.hint), ['refresh']);
  assert.equal(board.args[0].required, false, 'no argument opens the board');
  assert.equal(board.needsBoardScript, 'refreshing', 'the board script is needed only to refresh');
  assert.match(board.procedure, /nothing given means open the existing board/);
  assert.match(board.procedure, /never regenerate or republish it/);
});

test('help lists the board command once and the old names nowhere, in the catalog help and the help tool data', () => {
  const lines = helpLines('x').join('\n');
  assert.equal(lines.split('\n').filter((l) => /^- board( |:)/.test(l)).length, 1);
  assert.ok(!/show-board|refresh-board/.test(lines));
  assert.ok(!/show-board|refresh-board/.test(JSON.stringify(helpData())));
});

test('the base plugin ships board.md only: no command file for the old names, none of their text anywhere in the shipped plugins', () => {
  for (const n of ['show-board', 'refresh-board']) assert.ok(!fs.existsSync(path.join(BASE, 'commands', `${n}.md`)), n);
  for (const rel of [PLUGIN_REL, PARALLEL_REL, BOARD_REL]) {
    for (const f of files(path.join(REPO, rel))) {
      if (/\.(png|jpe?g|gif|ico|woff2?)$/i.test(f)) continue;
      assert.ok(!/show-board|refresh-board/.test(fs.readFileSync(f, 'utf8')), `${path.relative(REPO, f)} still names a removed command`);
    }
  }
});

test('the board command text: opens by default, refreshes with the argument, suggests refresh after an hour, asks before creating, only Claude publishes', () => {
  const t = read('commands/board.md');
  assert.match(t, /^argument-hint: "?\[refresh\]"?$/m);
  assert.match(t, /nothing given means open the existing board/);
  assert.match(t, /Open the existing board\. Read only: never regenerate or republish it\./);
  assert.match(t, /more than an hour old, say so and suggest refreshing it/);
  assert.match(t, /type the refresh as `\/laneconductor:board refresh`/);
  assert.match(t, /no board yet and running this command means I want one: do not ask/);
  assert.doesNotMatch(t, /create nothing without my yes, and then follow/);
  assert.match(t, /If the board add-on is not installed, say that it has to be installed first/);
  assert.match(t, /Only Claude can publish an artifact/);
  assert.match(t, /If the argument is anything else, ask me which one I mean/);
  // It works with or without the add-on: the script is found by Glob and the install commands are shown when it is missing.
  assert.ok(t.includes('**/laneconductor-board/**/bin/lc-board.mjs'));
  assert.match(t, /claude plugin install laneconductor-board@laneconductor/);
});

test('the shipped skill and help say the same: board opens, board refresh rebuilds; the routing table keeps the plain-words names', () => {
  const skill = read('skills/laneconductor/SKILL.md');
  assert.match(skill, /`board refresh` rebuilds and republishes it/);
  assert.match(read('skills/laneconductor/ops/board.md'), /suggest `\/laneconductor:board refresh`/);
  const help = read('commands/help.md');
  assert.match(help, /Needs the laneconductor-board add-on: board \(only to refresh\), explain; without it it says so/);
  assert.match(read('skills/laneconductor/ADD-ONS.md'), /`\/laneconductor:board`, `\/laneconductor:board refresh`/);
});

test('the MCP prompts: one board prompt that fills the argument, none for the old names', async () => {
  const dir = makeRepo();
  const s = await connect(dir);
  try {
    const { prompts } = await s.client.listPrompts();
    const names = prompts.map((p) => p.name);
    assert.ok(names.includes('board'));
    assert.ok(!names.includes('show-board') && !names.includes('refresh-board'));
    const got = await s.client.getPrompt({ name: 'board', arguments: { action: 'refresh' } });
    assert.match(got.messages[0].content.text, /^Board: refresh/);
  } finally {
    await s.close();
    rm(dir);
  }
});
