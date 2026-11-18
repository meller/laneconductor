// Track AM-10132: the front-door commands (setup, next, new-project) of the base plugin carry their whole procedure, generated from the skill
// (the single source) by scripts/plugin-inline.mjs. Why: a command that tells the model to read a skill file makes it read the plugin's install
// folder (~/.claude/plugins/cache/...), outside the project: an interactive session asks "Allow this read outside the working directories?",
// and `claude -p` (headless) denies the read and cannot even find the folder. These three are the only commands exempt from the 40-line limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, RELS, INLINED_COMMANDS, REFERENCES, REFERENCE_COMMANDS, BOARD_SCRIPT_COMMANDS, buildPlugin, setupRecommendBlock } from '../../scripts/build-plugin.mjs';

const BASE = path.join(REPO, RELS.base);
const SKILL = path.join(REPO, '.claude/skills/laneconductor');
const cmd = (name) => fs.readFileSync(path.join(BASE, `commands/${name}.md`), 'utf8');
const src = (rel) => fs.readFileSync(path.join(SKILL, rel), 'utf8');
/** The body without the one notice paragraph, which names the plugin folder in order to forbid reading it. */
const NO_READ = [...new Set([...INLINED_COMMANDS, ...REFERENCE_COMMANDS])].filter((n) => !BOARD_SCRIPT_COMMANDS.includes(n));
const withoutNotice = (t) => t.split('\n\n').filter((p) => !p.startsWith('This command carries')).join('\n\n');

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
  assert.ok(NO_READ.length === 19, `${NO_READ.length} commands carry their text`);
});

test('the inlined bodies are built from the shipped skill: change the source and the command changes (no hand-written copy)', () => {
  const built = buildPlugin(REPO, 'base');
  for (const n of INLINED_COMMANDS) assert.equal(String(built.get(`commands/${n}.md`).content), cmd(n), `${n} on disk is what the generator builds`);
  // The same sentence is in the skill file and in the command.
  assert.ok(cmd('new-project').includes('ONE question per message, adaptive, short, in chat'));
  assert.ok(src('ops/new-project.md').includes('ONE question per message, adaptive, short, in chat'));
});

test('every skill file a command names is carried in the command: under Reference, or as the source of its body', () => {
  const carried = new Set(['setup/setup.md', 'ops/new-project.md', 'ops/next.md', 'ops/lanes-and-statuses.md']); // sources of the three full bodies
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
