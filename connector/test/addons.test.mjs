// The two add-ons (track AM-10128): laneconductor-parallel (the connector, the scaffold script, the track-runner subagent) and
// laneconductor-board (the board script and its page): their layout, that every import inside each resolves inside it, that the board
// script runs from a bare temp copy of the board add-on alone (no connector, no node_modules: it imports no npm package), and that the
// connector in the parallel add-on answers over stdio. The connector starting from a temp copy with `npm ci` is also in
// directory-precheck.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, PARALLEL_REL, BOARD_REL, BOARD_SCRIPT_REL } from '../../scripts/build-plugin.mjs';
import { makeRepo, writeFile, commitAll, rm, INDEX } from './helpers/repo.mjs';

const PARALLEL = path.join(REPO, PARALLEL_REL);
const BOARD = path.join(REPO, BOARD_REL);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const real = fs.realpathSync(os.tmpdir());
const cleanup = [];
after(() => rm(...cleanup));
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };
const walk = (root, rel = '') => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
  const r = rel ? `${rel}/${e.name}` : e.name;
  if (e.name === 'node_modules') return [];
  return e.isDirectory() ? walk(root, r) : [r];
});

/** Every import specifier of a source file (static, export-from and dynamic). */
const specifiers = (src) => [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g)].map((m) => m[2]);

function importsResolveInside(plugin, allowedBare) {
  for (const rel of walk(plugin).filter((r) => r.endsWith('.mjs'))) {
    for (const spec of specifiers(fs.readFileSync(path.join(plugin, rel), 'utf8'))) {
      if (spec.startsWith('node:')) continue;
      if (/^\.{1,2}\//.test(spec)) {
        const target = path.resolve(plugin, path.dirname(rel), spec);
        assert.ok(target.startsWith(`${plugin}${path.sep}`) && fs.existsSync(target), `${rel} imports ${spec}, which is not inside the plugin`);
      } else assert.ok(allowedBare.has(spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')), `${rel} imports ${spec}, an npm package the plugin does not declare`);
    }
  }
}

test('laneconductor-parallel ships the connector, the scaffold script, the guides and the track-runner; every import resolves inside it; no slash commands', () => {
  const manifest = readJson(path.join(PARALLEL, '.claude-plugin/plugin.json'));
  assert.equal(manifest.name, 'laneconductor-parallel');
  assert.equal(manifest.dependencies, undefined);
  const files = walk(PARALLEL);
  for (const f of ['agents/track-runner.md', '.mcp.json', 'package.json', 'package-lock.json', 'server/bin/lc-connector.mjs', 'server/bin/lc-scaffold.mjs', '.claude-plugin/icon.png', 'README.md', 'LICENSE']) assert.ok(files.includes(f), f);
  assert.ok(files.some((f) => f.startsWith('server/guides/')), 'the lane guides ship (read by path)');
  assert.ok(!files.some((f) => f.startsWith('commands/') || f.startsWith('skills/')), 'all slash commands and the skill live in the base');
  importsResolveInside(PARALLEL, new Set(['@modelcontextprotocol/server', 'zod']));
  assert.ok(!files.includes('server/bin/lc-board.mjs') && !files.includes('server/src/board-page.html'), 'the board belongs to the board add-on');
  const readme = fs.readFileSync(path.join(PARALLEL, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(readme, /It adds no slash commands/);
  assert.match(readme, /no dependency on the base plugin/);
});

test('laneconductor-board ships the script and its page, imports no npm package, and has no package files or connector', () => {
  const manifest = readJson(path.join(BOARD, '.claude-plugin/plugin.json'));
  assert.equal(manifest.name, 'laneconductor-board');
  assert.equal(manifest.dependencies, undefined);
  const files = walk(BOARD);
  for (const f of [BOARD_SCRIPT_REL, 'server/src/board-page.html', 'server/src/board.mjs', 'server/src/board-docs.mjs', 'server/src/scan.mjs', '.claude-plugin/icon.png', 'README.md', 'LICENSE']) assert.ok(files.includes(f), f);
  assert.ok(!files.some((f) => f.startsWith('skills/') || f.startsWith('agents/')), 'no skill or agents');
  assert.deepEqual(files.filter((f) => f.startsWith('commands/')), [], 'no commands: everything is typed under /laneconductor: (the base `board refresh` is the partial publish)');
  assert.ok(!files.includes('.mcp.json') && !files.includes('package.json') && !files.includes('server/bin/lc-connector.mjs'));
  importsResolveInside(BOARD, new Set());
  assert.ok(fs.readFileSync(path.join(BOARD, 'server/src/board-page.html')).equals(fs.readFileSync(path.join(REPO, 'connector/src/board-page.html'))), 'the page is the repository\'s page');
});

test('the board script runs from a temp copy of the board add-on ALONE (no node_modules, no connector) and produces board.html and board.json', () => {
  const copy = path.join(tmp('lc-board-addon-'), 'laneconductor-board');
  fs.cpSync(BOARD, copy, { recursive: true });
  assert.ok(!fs.existsSync(path.join(copy, 'node_modules')));
  // A node_modules above the copy would hide a missing dependency; the temp dir has none.
  let up = path.dirname(copy);
  for (let i = 0; i < 6 && up !== path.dirname(up); i += 1, up = path.dirname(up)) assert.ok(!fs.existsSync(path.join(up, 'node_modules')), `${up}/node_modules exists`);

  const repo = makeRepo({ prefix: 'lc-board-fixture-' });
  cleanup.push(repo);
  writeFile(repo, '.laneconductor.json', JSON.stringify({ project: { name: 'Board Fixture' } }));
  const tr = (n, title, lane, status) => writeFile(repo, `conductor/tracks/AM-${n}-t${n}/index.md`, INDEX(n, title, { lane, status }));
  tr(301, 'Planned thing', 'plan', 'queue');
  tr(302, 'Being built', 'implement', 'running');
  tr(303, 'Shipped', 'done', 'success');
  writeFile(repo, 'conductor/tracks/AM-301-t301/spec.md', '# Spec\nA plain spec.\n');
  commitAll(repo);

  const site = path.join(tmp('lc-board-site-'), 'out');
  const r = spawnSync(process.execPath, [path.join(copy, BOARD_SCRIPT_REL), '--repo', repo, '--site', site, '--json'], { encoding: 'utf8', cwd: path.dirname(copy), env: { ...process.env, NODE_PATH: '' } });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.page, path.join(site, 'board.html'));
  assert.ok(out.files.includes('board.json') && out.files.includes('docs/301.json') && out.files.includes('docs/302.json'), out.files.join(','));
  assert.ok(!out.files.includes('docs/303.json'), 'done tracks get no documents');
  const html = fs.readFileSync(out.page, 'utf8');
  assert.ok(/<title>[^<]+ Board<\/title>/.test(html) && html.length > 2000, 'board.html is the page');
  const data = readJson(path.join(site, 'board.json'));
  assert.equal(data.project, 'Board Fixture');
  const ids = JSON.stringify(data.tracks ?? data);
  for (const n of ['301', '302', '303']) assert.ok(ids.includes(n), `track ${n} is on the board`);
  assert.ok(readJson(path.join(site, 'docs/301.json')), 'a track document was written');
});
