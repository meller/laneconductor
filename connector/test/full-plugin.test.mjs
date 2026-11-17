// The one full plugin (plugins/laneconductor): its layout, that every import inside it resolves inside it, and that the board
// script (server/bin/lc-board.mjs) runs from a bare temp copy with the plugin's own node_modules installed by `npm ci --offline`
// (skipped with a clear message when the offline npm cache is cold: then the script still has to run, but without the MCP SDK
// on disk it only does so because the board imports no npm package, which the import audit below proves). The connector
// starting over stdio from a temp copy is in directory-precheck.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, PLUGIN_REL } from '../../scripts/build-plugin.mjs';
import { makeRepo, writeFile, commitAll, rm, INDEX } from './helpers/repo.mjs';

const PLUGIN = path.join(REPO, PLUGIN_REL);
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

test('the plugin ships skill, commands, agents, connector and board script; no add-on split; every import resolves inside it', () => {
  const manifest = readJson(path.join(PLUGIN, '.claude-plugin/plugin.json'));
  assert.equal(manifest.name, 'laneconductor');
  assert.equal(manifest.dependencies, undefined);
  const files = walk(PLUGIN);
  for (const f of ['skills/laneconductor/SKILL.md', 'commands/board.md', 'agents/track-runner.md', '.mcp.json', 'package.json', 'package-lock.json',
    'server/bin/lc-connector.mjs', 'server/bin/lc-board.mjs', 'server/src/board-page.html', '.claude-plugin/icon.png']) assert.ok(files.includes(f), f);
  assert.ok(files.some((f) => f.startsWith('server/guides/')), 'the lane guides ship (read by path)');
  // Relative imports resolve to files inside the plugin; bare specifiers are node: built-ins or the npm packages of the connector (MCP SDK, zod, yaml).
  const allowedBare = new Set(['@modelcontextprotocol/server', 'zod', 'yaml']);
  for (const rel of files.filter((r) => r.endsWith('.mjs'))) {
    for (const spec of specifiers(fs.readFileSync(path.join(PLUGIN, rel), 'utf8'))) {
      if (spec.startsWith('node:')) continue;
      if (/^\.{1,2}\//.test(spec)) {
        const target = path.resolve(PLUGIN, path.dirname(rel), spec);
        assert.ok(target.startsWith(`${PLUGIN}${path.sep}`) && fs.existsSync(target), `${rel} imports ${spec}, which is not inside the plugin`);
      } else assert.ok(allowedBare.has(spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')), `${rel} imports ${spec}, an npm package the plugin does not declare`);
    }
  }
  // The board script reaches no npm package: it is the connector's SDK only the MCP server needs.
  const boardOnly = ['server/bin/lc-board.mjs', 'server/src/board.mjs', 'server/src/board-docs.mjs', 'server/src/scan.mjs'];
  for (const rel of boardOnly) assert.ok(!/@modelcontextprotocol|from 'zod'/.test(fs.readFileSync(path.join(PLUGIN, rel), 'utf8')), `${rel} imports an npm package`);
  const readme = fs.readFileSync(path.join(PLUGIN, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(readme.includes('server/bin/lc-board.mjs'));
  assert.match(readme, /connector, the board script and the subagents run in Claude Code and Cowork on your own computer/i);
});

test('the board script runs from a temp copy of the plugin (node_modules by `npm ci --offline`) and produces board.html and board.json', (t) => {
  const copy = path.join(tmp('lc-full-plugin-'), 'laneconductor');
  fs.cpSync(PLUGIN, copy, { recursive: true });
  assert.ok(!fs.existsSync(path.join(copy, 'node_modules')));
  // A node_modules above the copy would hide a missing dependency; the temp dir has none.
  let up = path.dirname(copy);
  for (let i = 0; i < 6 && up !== path.dirname(up); i += 1, up = path.dirname(up)) assert.ok(!fs.existsSync(path.join(up, 'node_modules')), `${up}/node_modules exists`);
  const ci = spawnSync('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: copy, encoding: 'utf8' });
  if (ci.status !== 0) t.diagnostic(`SKIP-NOTE: npm ci --offline failed (cold cache?), so the board script ran WITHOUT node_modules (it needs none): ${(ci.stderr || '').split('\n')[0]}`);
  else t.diagnostic('node_modules installed by npm ci --offline from the plugin lockfile');

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
  const r = spawnSync(process.execPath, [path.join(copy, 'server/bin/lc-board.mjs'), '--repo', repo, '--site', site, '--json'], { encoding: 'utf8', cwd: path.dirname(copy), env: { ...process.env, NODE_PATH: '' } });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.page, path.join(site, 'board.html'));
  assert.ok(out.files.includes('board.json') && out.files.includes('docs/301.json') && out.files.includes('docs/302.json'), out.files.join(','));
  assert.ok(!out.files.includes('docs/303.json'), 'done tracks get no documents');
  const html = fs.readFileSync(out.page, 'utf8');
  assert.ok(html.includes('<title>LaneConductor Board</title>') && html.length > 2000, 'board.html is the page');
  const data = readJson(path.join(site, 'board.json'));
  assert.equal(data.project, 'Board Fixture');
  const ids = JSON.stringify(data.tracks ?? data);
  for (const n of ['301', '302', '303']) assert.ok(ids.includes(n), `track ${n} is on the board`);
  assert.ok(readJson(path.join(site, 'docs/301.json')), 'a track document was written');
  // It is the same page the repository's own generator writes.
  assert.ok(fs.readFileSync(path.join(PLUGIN, 'server/src/board-page.html')).equals(fs.readFileSync(path.join(REPO, 'connector/src/board-page.html'))));
});
