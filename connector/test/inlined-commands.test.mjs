// Track AM-10132: the front-door commands (setup, next, new-project) of the base plugin carry their whole procedure, generated from the skill
// (the single source) by scripts/plugin-inline.mjs. Why: a command that tells the model to read a skill file makes it read the plugin's install
// folder (~/.claude/plugins/cache/...), outside the project: an interactive session asks "Allow this read outside the working directories?",
// and `claude -p` (headless) denies the read and cannot even find the folder. These three are the only commands exempt from the 40-line limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, RELS, INLINED_COMMANDS, buildPlugin, setupRecommendBlock } from '../../scripts/build-plugin.mjs';

const BASE = path.join(REPO, RELS.base);
const SKILL = path.join(REPO, '.claude/skills/laneconductor');
const cmd = (name) => fs.readFileSync(path.join(BASE, `commands/${name}.md`), 'utf8');
const src = (rel) => fs.readFileSync(path.join(SKILL, rel), 'utf8');
/** The body without the one notice paragraph, which names the plugin folder in order to forbid reading it. */
const withoutNotice = (t) => t.split('\n\n').filter((p) => !p.startsWith('This command carries its whole procedure below')).join('\n\n');

test('exactly setup, next and new-project are inlined', () => {
  assert.deepEqual([...INLINED_COMMANDS].sort(), ['new-project', 'next', 'setup']);
  for (const f of fs.readdirSync(path.join(BASE, 'commands'))) {
    const n = f.replace(/\.md$/, '');
    assert.equal(cmd(n).includes('This command carries its whole procedure below'), INLINED_COMMANDS.includes(n), n);
  }
});

test('setup carries the interview, the existing-repository path, the permission note and the recommendation block', () => {
  const t = cmd('setup');
  for (const part of ['## What setup does', '## What else fits this project', '## setup scaffold', '## The path in detail', '#### Existing repository', '### Create the files',
    'Reply ok, or tell me what differs', 'Write nothing until that reply', 'allows it this one time', 'Never ask anyone to change their permission settings',
    'Starter set: reserved for the skill advisor', 'Next: run `/laneconductor:next`']) {
    assert.ok(t.includes(part), `setup lacks: ${part}`);
  }
  assert.ok(t.includes(setupRecommendBlock().split('\n').slice(0, 3).join('\n')), 'the generated recommendation block is inlined');
  assert.ok(t.includes('claude plugin install laneconductor-parallel@laneconductor'), 'the install commands of the add-ons');
  // The existing-repository section of new-project is there word for word (the single source).
  const existing = src('ops/new-project.md').match(/Show the result as ONE message[\s\S]*?\nDo not add the walking-skeleton/)[0].split('\n')[0];
  assert.ok(t.includes(existing), 'the one-message text of ops/new-project.md');
});

test('next carries the gather steps, every state row, the rank, the card, the levels, the front door and the transition grammar', () => {
  const t = cmd('next');
  for (const part of ['## When to use it', '## Gather', '## States', '## Rank', '## The card', '## Levels', '## The front door', '## A stale project-level skill', '## Rules',
    '## Reference: lanes, statuses and transitions', '### The five lane statuses', '### The two meanings of `done`', '### Transitions', 'a bare `done` from another lane']) {
    assert.ok(t.includes(part), `next lacks: ${part}`);
  }
  const rows = src('ops/next.md').split('\n').filter((l) => /^\| S\d\d /.test(l));
  assert.equal(rows.length, 21);
  // The rows are copied as they are, except that a link to another skill file is written as its path.
  for (const row of rows) assert.ok(t.includes(row.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')) || t.includes(row), `row missing: ${row.slice(0, 40)}`);
  assert.ok(t.includes(setupRecommendBlock().split('\n').slice(0, 3).join('\n')));
});

test('new-project carries all six steps and the rules, with the scaffold done by hand (no search for the add-on script)', () => {
  const t = cmd('new-project');
  for (const part of ['## 1. Detect the situation', '### Existing repository', '## 2. Interview', '## 3. Scaffold', '## 4. First tracks', '## 5. Say what else fits this project',
    '## 6. Summarize and ask before any commit', '## Rules', 'Reply ok, or tell me what differs', 'Commit this\nscaffold?', 'chore: add the LaneConductor scaffold']) {
    assert.ok(t.includes(part), `new-project lacks: ${part}`);
  }
  assert.doesNotMatch(t, /Glob `\*\*\/laneconductor-parallel/);
  assert.doesNotMatch(t, /--detect|--answers|--dry-run|--no-first-track/);
});

test('none of the three tells the model to read or search a plugin folder: no plugin path, no plugin Glob, no "read the skill file", no link to a skill file', () => {
  for (const n of INLINED_COMMANDS) {
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
});

test('the inlined bodies are built from the shipped skill: change the source and the command changes (no hand-written copy)', () => {
  const built = buildPlugin(REPO, 'base');
  for (const n of INLINED_COMMANDS) assert.equal(String(built.get(`commands/${n}.md`).content), cmd(n), `${n} on disk is what the generator builds`);
  // The same sentence is in the skill file and in the command.
  assert.ok(cmd('new-project').includes('ONE question per message, adaptive, short, in chat'));
  assert.ok(src('ops/new-project.md').includes('ONE question per message, adaptive, short, in chat'));
});

test('the other commands are unchanged in kind: short, and still pointing at the skill (reported in the track, not inlined)', () => {
  for (const f of fs.readdirSync(path.join(BASE, 'commands'))) {
    const n = f.replace(/\.md$/, '');
    if (INLINED_COMMANDS.includes(n)) continue;
    assert.ok(cmd(n).split('\n').length < 60, `${n} stays short`);
  }
  assert.match(cmd('plan'), /lanes\/plan\.md/);
});
