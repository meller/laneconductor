// Track AM-10133: LaneConductor is three plugins plus files in git. No `lc` command line, no daemon scripts, no `make install`. Nothing the plugins
// ship (and nothing the generator or the catalog writes into them) may tell Claude or a person to run one of those, or to look for one.
// The scripts keep their file names (`lc-board.mjs`, `lc-scaffold.mjs`, `lc-connector.mjs`; owner decision D3) and the connector keeps its MCP
// server key `lc`; those are allowed. `legacy/` of the source skill is not shipped and is not scanned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, RELS, PROFILES, buildPlugin } from '../../scripts/build-plugin.mjs';

// The subcommands of the old command line, read from its own dispatch table so a new one cannot slip by, plus the names the track lists.
const LC_SRC = fs.readFileSync(path.join(REPO, 'bin/lc.mjs'), 'utf8');
const SUBCOMMANDS = new Set([
  ...[...LC_SRC.matchAll(/command === '([a-z][a-z-]*)'/g)].map((m) => m[1]),
  ...'board new move delete status workflow update-track report-bug feature-request track-dir worktrees deploy setup setup-deploy brainstorm init-summary summary worker start stop restart state ui api logs config add-target list-targets remove-target remote-sync pulse comment show rerun quality-gate plan implement review merge'.split(' '),
]);
const SUB_RE = new RegExp(`(^|[^\\w./-])lc (?!-)(${[...SUBCOMMANDS].sort((a, b) => b.length - a.length).join('|')})\\b`);
const OTHER = [
  /which lc\b/, /command -v lc\b/, /make install/, /laneconductorrc/, /\b(un)?lock\.mjs\b/, /measure\.mjs/, /init-tracks-summary\.mjs/, /track-dir/, /worktrees (merge|create-pr)/,
];
const BARE_LC = /`lc`/;
const BARE_ALLOWED = /server key|MCP key|plugin:laneconductor/;

/** The hits of one text: `line number: text` for every line that names an `lc` command or a daemon script. */
export function noLcHits(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    const bad = SUB_RE.test(line) || OTHER.some((re) => re.test(line)) || (BARE_LC.test(line) && !BARE_ALLOWED.test(line));
    if (bad) hits.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return hits;
}

const walk = (dir, skip = () => false) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (skip(p, e)) return [];
  return e.isDirectory() ? walk(p, skip) : [p];
});
const TEXT = /\.(md|mjs|js|json|html|txt)$/;
const skipNoise = (p, e) => e.name === 'node_modules' || e.name === 'package-lock.json' || e.name === '.git';
const read = (p) => fs.readFileSync(p, 'utf8');
const rel = (p) => path.relative(REPO, p);

test('the pattern: it catches an lc subcommand, which lc, make install and the daemon scripts, and lets the script names and the MCP key through', () => {
  for (const bad of ['lc new "x"', 'Run lc board --site d', 'which lc', 'make install', 'node conductor/lock.mjs 5', '`lc`', 'use lc track-dir 5', 'lc worktrees merge 5', 'node measure.mjs --track 1']) {
    assert.ok(noLcHits(bad).length === 1, `should hit: ${bad}`);
  }
  for (const ok of ['node lc-board.mjs --site d', 'the server key `lc`', 'plugin:laneconductor:lc', 'mcp__plugin_laneconductor-parallel_lc__get_track', 'server/bin/lc-scaffold.mjs', 'The MCP key is `lc`', 'ABC lc-connector.mjs']) {
    assert.deepEqual(noLcHits(ok), [], `should pass: ${ok}`);
  }
  assert.ok(SUBCOMMANDS.has('setup-deploy') && SUBCOMMANDS.has('add-target') && SUBCOMMANDS.has('track-dir'), 'the list was read from bin/lc.mjs');
});

test('the three generated plugins on disk, the same three built in memory, and the source skill (without legacy/) name no lc command', () => {
  const hits = [];
  for (const profile of PROFILES) {
    const root = path.join(REPO, RELS[profile]);
    for (const f of walk(root, skipNoise).filter((p) => TEXT.test(p))) for (const h of noLcHits(read(f))) hits.push(`${rel(f)}:${h}`);
    const built = buildPlugin(REPO, profile);
    for (const [r, f] of built.files ?? built) {
      if (!TEXT.test(r)) continue;
      const content = f.content ?? f;
      const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
      for (const h of noLcHits(text)) hits.push(`(built ${profile}) ${r}:${h}`);
    }
  }
  const skill = path.join(REPO, '.claude/skills/laneconductor');
  for (const f of walk(skill, (p, e) => skipNoise(p, e) || p === path.join(skill, 'legacy')).filter((p) => TEXT.test(p))) for (const h of noLcHits(read(f))) hits.push(`${rel(f)}:${h}`);
  assert.deepEqual(hits, []);
});

test('the generator, the catalog, the command catalog, the connector and its docs, the root README and the docs name no lc command', () => {
  const files = [
    ...walk(path.join(REPO, 'connector/plugin-extras'), skipNoise),
    ...['connector/src', 'connector/bin'].flatMap((d) => walk(path.join(REPO, d), skipNoise)),
    ...['scripts/plugin-texts.mjs', 'scripts/build-plugin.mjs', 'README.md', 'connector/README.md', 'connector/ARCHITECTURE.md'].map((f) => path.join(REPO, f)),
    ...fs.readdirSync(path.join(REPO, 'docs')).filter((f) => f.endsWith('.md')).map((f) => path.join(REPO, 'docs', f)),
  ].filter((p) => TEXT.test(p));
  assert.ok(files.length > 40, `read ${files.length} files`);
  const hits = [];
  for (const f of files) for (const h of noLcHits(read(f))) hits.push(`${rel(f)}:${h}`);
  assert.deepEqual(hits, []);
});

test('the settings file is named only where the base explains it: ops/settings.md, the board texts, the README and the skill pointer; never by setup', () => {
  const skill = path.join(REPO, RELS.base, 'skills/laneconductor');
  const base = path.join(REPO, RELS.base);
  const files = walk(base, skipNoise).filter((p) => TEXT.test(p));
  const allowed = new Set(['skills/laneconductor/ops/settings.md', 'skills/laneconductor/ops/board.md', 'skills/laneconductor/SKILL.md', 'commands/board.md', 'commands/show-board.md', 'commands/refresh-board.md', 'README.md']);
  const named = files.filter((f) => read(f).includes('.laneconductor.json')).map((f) => path.relative(base, f));
  assert.deepEqual(named.filter((r) => !allowed.has(r)), [], 'a text outside the allowed list names the settings file');
  for (const r of ['setup/setup.md', 'setup/scaffold.md', 'setup/templates.md', 'ops/new-project.md']) assert.ok(!read(path.join(skill, r)).includes('.laneconductor.json'), `${r} never names the settings file`);
  assert.ok(!read(path.join(base, 'commands/setup.md')).includes('.laneconductor.json'));
  assert.ok(!read(path.join(base, 'commands/new-project.md')).includes('.laneconductor.json'));
});

test('the Glob the source skill gives for the board script and the scaffold script is the one the generator names', async () => {
  const { BOARD_SCRIPT_GLOB, SCAFFOLD_SCRIPT_GLOB, PLUGINS_CACHE, toolRef } = await import('../../scripts/build-plugin.mjs');
  const skill = path.join(REPO, '.claude/skills/laneconductor');
  assert.ok(read(path.join(skill, 'ops/board.md')).includes(BOARD_SCRIPT_GLOB) && read(path.join(skill, 'ops/board.md')).includes(PLUGINS_CACHE));
  assert.ok(read(path.join(skill, 'ops/new-project.md')).includes(SCAFFOLD_SCRIPT_GLOB));
  assert.ok(read(path.join(skill, 'ops/new-project.md')).includes(toolRef('create_track')));
  assert.ok(read(path.join(skill, 'ops/tracks.md')).includes(toolRef('create_track')));
});
