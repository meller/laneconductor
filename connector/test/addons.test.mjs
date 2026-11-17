// The two local add-ons of the LaneConductor plugin family (plugins/laneconductor-board and plugins/laneconductor-connector):
// manifest, layout and dependencies. The connector starting over stdio from a bare copy is in plugin-build.test.mjs; the board
// script running from a bare copy (no node_modules anywhere) is here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, BOARD_REL, CONNECTOR_REL, PLUGIN_REL } from '../../scripts/build-plugin.mjs';
import { makeRepo, writeFile, commitAll, rm, INDEX } from './helpers/repo.mjs';

const BOARD = path.join(REPO, BOARD_REL);
const CONN = path.join(REPO, CONNECTOR_REL);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const real = fs.realpathSync(os.tmpdir());
const cleanup = [];
after(() => rm(...cleanup));
const tmp = (p) => { const d = fs.mkdtempSync(path.join(real, p)); cleanup.push(d); return d; };
const walk = (root, rel = '') => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
  const r = rel ? `${rel}/${e.name}` : e.name;
  return e.isDirectory() ? walk(root, r) : [r];
});

/** Every import specifier of a source file (static, export-from and dynamic). */
const specifiers = (src) => [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g)].map((m) => m[2]);

for (const [label, dir] of [['board', BOARD], ['connector', CONN]]) {
  test(`${label} add-on: depends on the lean plugin, ships no skill, commands or agents, and every import resolves inside it`, () => {
    const manifest = readJson(path.join(dir, '.claude-plugin/plugin.json'));
    assert.deepEqual(manifest.dependencies, ['laneconductor']);
    assert.equal(manifest.name, `laneconductor-${label}`);
    for (const d of ['skills', 'commands', 'agents']) assert.ok(!fs.existsSync(path.join(dir, d)), `no ${d}/`);
    assert.ok(fs.existsSync(path.join(dir, '.claude-plugin/icon.png')));
    // Relative imports resolve to files inside the plugin; bare specifiers are node: built-ins, or (connector only) its two npm packages.
    const allowedBare = label === 'connector' ? new Set(['@modelcontextprotocol/server', 'zod']) : new Set();
    for (const rel of walk(dir).filter((r) => r.endsWith('.mjs'))) {
      for (const spec of specifiers(fs.readFileSync(path.join(dir, rel), 'utf8'))) {
        if (spec.startsWith('node:')) continue;
        if (/^\.{1,2}\//.test(spec)) {
          const target = path.resolve(dir, path.dirname(rel), spec);
          assert.ok(target.startsWith(`${dir}${path.sep}`) && fs.existsSync(target), `${rel} imports ${spec}, which is not inside the plugin`);
        } else assert.ok(allowedBare.has(spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')), `${rel} imports ${spec}, an npm package the ${label} plugin does not declare`);
      }
    }
  });
}

test('board add-on: no npm dependency at all (no package.json, no lockfile, no .mcp.json), and exactly the files lc-board.mjs reaches', () => {
  const files = walk(BOARD).sort();
  for (const f of ['package.json', 'package-lock.json', '.mcp.json']) assert.ok(!files.includes(f), `board plugin must not ship ${f}`);
  assert.deepEqual(files.filter((f) => f.startsWith('server/')), [
    'server/bin/lc-board.mjs', 'server/src/blob.mjs', 'server/src/board-docs.mjs', 'server/src/board-page.html', 'server/src/board.mjs',
    'server/src/errors.mjs', 'server/src/markers.mjs', 'server/src/scan.mjs', 'server/src/state-branch.mjs', 'server/src/summary.mjs', 'server/src/tracks.mjs',
  ]);
  assert.deepEqual(files.filter((f) => f.startsWith('conductor/')), ['conductor/services/track-folder.mjs']);
  // The connector's server is not in it, and the MCP SDK is not imported anywhere.
  for (const rel of files.filter((r) => r.endsWith('.mjs'))) {
    const src = fs.readFileSync(path.join(BOARD, rel), 'utf8');
    assert.ok(!/@modelcontextprotocol|from 'zod'/.test(src), `${rel} imports an npm package`);
  }
  const readme = fs.readFileSync(path.join(BOARD, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(readme, /needs a script that runs on your computer, so it is a separate plugin you install from the marketplace, not from Anthropic's directory/);
  assert.ok(readme.includes('--site'));
});

test('board add-on: lc-board.mjs runs from a bare copy of the plugin (no node_modules anywhere) and produces board.html and board.json', () => {
  const copy = path.join(tmp('lc-board-plugin-'), 'laneconductor-board');
  fs.cpSync(BOARD, copy, { recursive: true });
  assert.ok(!fs.existsSync(path.join(copy, 'node_modules')));
  // A node_modules above the copy would hide a missing dependency; the temp dir has none.
  let up = path.dirname(copy);
  for (let i = 0; i < 6 && up !== path.dirname(up); i += 1, up = path.dirname(up)) assert.ok(!fs.existsSync(path.join(up, 'node_modules')), `${up}/node_modules exists`);

  const repo = makeRepo({ prefix: 'lc-board-fixture-' });
  cleanup.push(repo);
  writeFile(repo, '.laneconductor.json', JSON.stringify({ project: { name: 'Board Add-on Fixture' } }));
  const t = (n, title, lane, status) => writeFile(repo, `conductor/tracks/AM-${n}-t${n}/index.md`, INDEX(n, title, { lane, status }));
  t(301, 'Planned thing', 'plan', 'queue');
  t(302, 'Being built', 'implement', 'running');
  t(303, 'Shipped', 'done', 'success');
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
  assert.equal(data.project, 'Board Add-on Fixture');
  const ids = JSON.stringify(data.tracks ?? data);
  for (const n of ['301', '302', '303']) assert.ok(ids.includes(n), `track ${n} is on the board`);
  assert.ok(readJson(path.join(site, 'docs/301.json')), 'a track document was written');
  // It is the same page the repository's own generator writes.
  assert.ok(fs.readFileSync(path.join(BOARD, 'server/src/board-page.html')).equals(fs.readFileSync(path.join(REPO, 'connector/src/board-page.html'))));
});

test('connector add-on: package files and .mcp.json belong here only, the board script does not', () => {
  const files = walk(CONN);
  for (const f of ['package.json', 'package-lock.json', '.mcp.json', 'server/bin/lc-connector.mjs']) assert.ok(files.includes(f), f);
  assert.ok(!files.includes('server/bin/lc-board.mjs') && !files.some((f) => /board/.test(f)), 'no board script or page in the connector');
  assert.ok(files.some((f) => f.startsWith('server/guides/')), 'the lane guides ship (read by path)');
  const lean = path.join(REPO, PLUGIN_REL);
  assert.ok(!fs.existsSync(path.join(lean, 'server')), 'the lean plugin has no server');
  const readme = fs.readFileSync(path.join(CONN, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(readme, /It is optional/);
  assert.match(readme, /remote connector/);
});
