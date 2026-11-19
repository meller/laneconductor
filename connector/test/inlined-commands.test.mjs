// Track AM-10132: the front-door commands (setup, next, new-project) of the base plugin carry their whole procedure, generated from the skill
// (the single source) by scripts/plugin-inline.mjs. Why: a command that tells the model to read a skill file makes it read the plugin's install
// folder (~/.claude/plugins/cache/...), outside the project: an interactive session asks "Allow this read outside the working directories?",
// and `claude -p` (headless) denies the read and cannot even find the folder. These three are the only commands exempt from the 40-line limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, RELS, INLINED_COMMANDS, REFERENCES, REFERENCE_COMMANDS, BOARD_SCRIPT_COMMANDS, buildPlugin, setupRecommendBlock, frontDoorBlock } from '../../scripts/build-plugin.mjs';

const BASE = path.join(REPO, RELS.base);
const SKILL = path.join(REPO, '.claude/skills/laneconductor');
const cmd = (name) => fs.readFileSync(path.join(BASE, `commands/${name}.md`), 'utf8');
const src = (rel) => fs.readFileSync(path.join(SKILL, rel), 'utf8');
/** The body without the one notice paragraph, which names the plugin folder in order to forbid reading it. */
const NO_READ = [...new Set([...INLINED_COMMANDS, ...REFERENCE_COMMANDS])].filter((n) => !BOARD_SCRIPT_COMMANDS.includes(n));
const withoutNotice = (t) => t.split('\n\n').filter((p) => !p.startsWith('This command carries')).join('\n\n');

test('exactly setup, next, new-project and suggest-skills are inlined', () => {
  assert.deepEqual([...INLINED_COMMANDS].sort(), ['new-project', 'next', 'setup', 'suggest-skills']);
  for (const f of fs.readdirSync(path.join(BASE, 'commands'))) {
    const n = f.replace(/\.md$/, '');
    assert.equal(cmd(n).includes('This command carries its whole procedure below'), INLINED_COMMANDS.includes(n), n);
  }
});

test('setup carries the write-first procedure, the file rules, the permission note, newTrack and the first-track card (no starter set since 1.9.5)', () => {
  const t = cmd('setup');
  for (const part of ['## What setup does', '## The path in detail', '### Create the files', '## Reference: scaffold', 'newTrack',
    'Stop and ask first, one line each, only for something unusual', 'File the plan items', 'Undo: `rm -r conductor`, then `git checkout .gitignore`.', 'allows it this one time', 'Never ask anyone to change their permission settings',
    '## The first-track card', 'The conductor files are not committed; say commit when you want them committed.', 'Board, or plan the first track?']) {
    assert.ok(t.includes(part), `setup lacks: ${part}`);
  }
  // Track AM-10130 Phase 7 (release 1.9.5): the pre-write confirmation is gone (it superseded the "one pre-filled message ending Reply ok" rule of 10132 TC-2)
  assert.ok(!t.includes('Reply ok, or tell me what differs') && !/Write nothing until that reply/.test(t), 'no pre-write confirmation');
  assert.ok(!t.includes('STARTER SET') && !t.includes('## What else fits this project'), 'no starter set: it moved to new-project and suggest-skills');
  assert.ok(!t.includes('Both add-ons in one line:'), 'no add-ons paragraph in setup');
  // The first-track card (the one section of ops/next.md, carried here) ends the no-plan case; the closing has no "run next" line.
  assert.ok(t.includes(src('ops/next.md').match(/## The first-track card[\s\S]*?(?=\n## Levels)/)[0].split('<!--')[0].split('\n').slice(0, 14).join('\n')), 'the first-track card of ops/next.md, word for word');
  assert.doesNotMatch(t.replace(/no "Next: run `\/laneconductor:next`"/, ''), /Next: run `\/laneconductor:next`/, 'no "run next" line is asked for');
  // The reading rules of setup.md are there word for word (the single source).
  assert.ok(t.includes('The tracks choice, declared and never asked: private when something says the project is public'), 'the privacy rule of setup/setup.md');
});

test('next carries the gather steps, every state row, the rank, the card, the levels, the front door and the transition grammar', () => {
  const t = cmd('next');
  for (const part of ['## When to use it', '## Gather', '## States', '## Rank', '## The card', '## Levels', '## The front door', '## A stale project-level skill', '## Rules',
    '## Reference: lanes, statuses and transitions', '### The five lane statuses', '### The two meanings of `done`', '### Transitions', 'a bare `done` from another lane']) {
    assert.ok(t.includes(part), `next lacks: ${part}`);
  }
  const rows = src('ops/next.md').split('\n').filter((l) => /^\| S\d\d /.test(l));
  assert.equal(rows.length, 23);
  // The rows are copied as they are, except that a link to another skill file is written as its path.
  for (const row of rows) assert.ok(t.includes(row.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')) || t.includes(row), `row missing: ${row.slice(0, 40)}`);
  assert.ok(t.includes(frontDoorBlock().split('\n')[0]), 'the add-ons offer of the front door');
});

test('new-project carries all six steps and the rules, with the scaffold done by hand (no search for the add-on script); an existing repository goes to setup', () => {
  const t = cmd('new-project');
  for (const part of ['## 1. Detect the situation', '## 2. Interview', '## 3. Scaffold', '## 4. First tracks', '## 5. Say what else fits this project',
    '## 6. Summarize and close', '## Rules', '## The first-track card', 'Board, or plan the first track?', 'The conductor files are not committed; say commit when you want them committed.', 'chore: add the LaneConductor scaffold']) {
    assert.ok(t.includes(part), `new-project lacks: ${part}`);
  }
  assert.ok(!t.includes('Reply ok, or tell me what differs'), 'no pre-write confirmation text');
  assert.ok(t.includes('`/laneconductor:setup` is the command for it'), 'an existing repository goes to setup');
  assert.doesNotMatch(t, /### Existing repository|### File the plan items/, 'the existing-repository procedure is setup\'s, not carried here');
  assert.doesNotMatch(t, /Glob `\*\*\/laneconductor-parallel/);
  assert.doesNotMatch(t, /--detect|--answers|--dry-run|--no-first-track/);
});

test('no command that carries its text tells the model to read or search a plugin folder: no plugin path, no plugin Glob, no "read the skill file", no link to a skill file', () => {
  for (const n of NO_READ) {
    const t = withoutNotice(cmd(n));
    assert.doesNotMatch(t, /~\/\.claude\/plugins|\.claude\/plugins\/cache|CLAUDE_PLUGIN_ROOT|PLUGINS_CACHE/, `${n}: names the plugin install folder`);
    assert.doesNotMatch(t, /\bGlob `\*\*\/laneconductor/, `${n}: Globs the plugin folders`);
    assert.doesNotMatch(t, /read it in full first|read the file in full|Read the file in full first|\bread (?:the )?skill file/i, `${n}: tells the model to read a skill file`);
    assert.doesNotMatch(t, /\]\([^)]*\.md\)/, `${n}: a Markdown link to a skill file does not resolve from a command`);
    assert.doesNotMatch(t, /Follow (?:the )?(?:skill file )?`(?:ops|lanes|setup)\//, `${n}: sends the model to a skill file`);
    // Any skill file path that is still named must say it is a reference (the notice does), or be the explicit write-step pointer.
    for (const m of t.matchAll(/`((?:ops|lanes|setup|deploy)\/[A-Za-z0-9._-]+)`/g)) assert.ok(fs.existsSync(path.join(BASE, 'skills/laneconductor', m[1])), `${n} names ${m[1]}, which does not ship`);
  }
  assert.match(cmd('setup'), /Do not Glob or Read the plugin's install folder/);
  assert.ok(NO_READ.length === 20, `${NO_READ.length} commands carry their text`);
});

test('the inlined bodies are built from the shipped skill: change the source and the command changes (no hand-written copy)', () => {
  const built = buildPlugin(REPO, 'base');
  for (const n of INLINED_COMMANDS) assert.equal(String(built.get(`commands/${n}.md`).content), cmd(n), `${n} on disk is what the generator builds`);
  // The same sentence is in the skill file and in the command.
  assert.ok(cmd('new-project').includes('ONE question per message, adaptive, short, in chat'));
  assert.ok(src('ops/new-project.md').includes('ONE question per message, adaptive, short, in chat'));
});

test('every skill file a command names is carried in the command: under Reference, or as the source of its body', () => {
  const carried = new Set(['setup/setup.md', 'ops/new-project.md', 'ops/next.md', 'ops/lanes-and-statuses.md', 'ops/suggest-skills.md']); // sources of the full bodies
  for (const f of fs.readdirSync(path.join(BASE, 'commands'))) {
    const n = f.replace(/\.md$/, '');
    const t = cmd(n);
    const at = t.indexOf('\n## Reference');
    const head = at < 0 ? t : t.slice(0, at);
    const refs = new Set([...(at < 0 ? '' : t.slice(at)).matchAll(/^### `([^`]+)`/gm)].map((m) => m[1]));
    for (const m of head.matchAll(/`((?:ops|lanes|setup|deploy)\/[A-Za-z0-9._-]+)`/g)) {
      assert.ok(refs.has(m[1]) || carried.has(m[1]), `${n} names ${m[1]} but does not carry it`);
    }
    if (REFERENCES[n]) assert.ok(at > 0 && refs.size > 0, `${n} has a Reference part`);
  }
  assert.deepEqual(['help', 'review-plan'].filter((n) => /`(?:ops|lanes|setup|deploy)\//.test(cmd(n))), [], 'help and review-plan name no skill file');
});

test('each Reference carries the real text of its source: the first line of every whole file and every named section is in the command', () => {
  for (const [n, spec] of Object.entries(REFERENCES)) {
    const t = cmd(n);
    for (const r of spec.refs) {
      if (!r.file) continue;
      const text = src(r.file);
      const heads = r.heads ?? [];
      for (const h of heads) assert.ok(t.includes(h.replace(/^## /, '')), `${n}: section ${h} of ${r.file}`);
      if (!r.heads && !r.from && !r.to) {
        const first = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'))[0].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').slice(0, 40);
        assert.ok(t.includes(first.slice(0, 30)), `${n}: first line of ${r.file}`);
      }
    }
  }
  // The templates keep their own `#` lines (they are inside code fences, never shifted into headings).
  assert.ok(cmd('setup').includes('\n# Design Language\n') && cmd('new-project').includes('\n# Quality Gate\n'));
  assert.ok(cmd('bug').includes('## Symptom') && cmd('feature').includes('## Out of scope'));
  assert.ok(!cmd('setup').includes('Track spec forms'), 'setup carries the file templates only');
});

test('the lane commands carry their guide: plan, implement, review, quality-gate, merge, brainstorm, and run carries all five', () => {
  for (const g of ['plan', 'implement', 'review', 'quality-gate', 'merge', 'brainstorm']) {
    assert.ok(cmd(g).includes(`### \`lanes/${g}.md\``), `${g} carries its guide`);
  }
  for (const g of ['plan', 'implement', 'review', 'quality-gate', 'merge']) assert.ok(cmd('run').includes(`### \`lanes/${g}.md\``), `run carries ${g}`);
  for (const g of ['implement', 'review', 'run']) assert.ok(cmd(g).includes("### The add-on's install commands") && !/Read the skill's `ADD-ONS\.md`/.test(cmd(g)), `${g}: the add-on's commands are carried`);
  // Only the board commands still search a plugin folder: the board script is a file of another plugin.
  for (const n of REFERENCE_COMMANDS) assert.equal(/Glob `\*\*\/laneconductor-board/.test(cmd(n)), BOARD_SCRIPT_COMMANDS.includes(n), n);
});

test('the commands that need nothing from the skill stay short', () => {
  for (const n of ['help', 'review-plan']) assert.ok(cmd(n).split('\n').length < 60, n);
});
