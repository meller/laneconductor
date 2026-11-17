// Local pre-checks for Anthropic's plugin directory submission (track AM-10106, Phase 5e), run over ALL THREE plugins (the lean
// plugins/laneconductor and the add-ons plugins/laneconductor-board and plugins/laneconductor-connector); the stricter rules for the lean one, which is the only
// one submitted, are in directory-lean.test.mjs. They mirror the automated checks of the directory's pre-submission checklist
// that can be run offline. The portal's own
// Validate (claude.ai/directory/manage) is HUMAN; findings it marks "held for a reviewer" (lockfile install,
// local Node server) are expected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, PLUGIN_REL, BOARD_REL, CONNECTOR_REL } from '../../scripts/build-plugin.mjs';
import { SECRET_PATTERNS } from './helpers/secret-patterns.mjs';

const PLUGIN = path.join(REPO, PLUGIN_REL);
const BOARD = path.join(REPO, BOARD_REL);
const CONN = path.join(REPO, CONNECTOR_REL);
const PLUGINS = [['lean plugin', PLUGIN], ['board add-on', BOARD], ['connector add-on', CONN]];
const KIB = 1024;
const MIB = KIB * KIB;

// Every entry, files and links, with lstat (so symlinks are seen, not followed).
function entries(root, rel = '') {
  return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? [{ rel: r, dir: true }, ...entries(root, r)] : [{ rel: r, link: e.isSymbolicLink() }];
  });
}
const all = (root) => entries(root);
const files = (root) => all(root).filter((e) => !e.dir).map((e) => e.rel);

function claudeAvailable() {
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

for (const [label, target] of [['the lean plugin folder', PLUGIN], ['the board add-on folder (dependencies on the lean plugin)', BOARD], ['the connector add-on folder (dependencies on the lean plugin)', CONN], ['the marketplace (repo root)', REPO]]) {
  test(`claude plugin validate --strict passes on ${label}`, (t) => {
    if (!claudeAvailable()) return t.skip('the claude CLI is not on PATH: run `claude plugin validate <path> --strict` by hand');
    const r = spawnSync('claude', ['plugin', 'validate', target, '--strict'], { encoding: 'utf8', cwd: os.tmpdir() });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /Validation passed/);
  });
}

for (const [label, PLUGIN] of PLUGINS) test(`${label}: at most 512 files, each under 256 KiB, no links, no junk files, no package-manager config (the connector's package.json and lockfile are its own)`, () => {
  const list = files(PLUGIN);
  assert.ok(list.length <= 512, `${list.length} files (limit 512)`);
  const junk = /(^|\/)(\.DS_Store|Thumbs\.db|__MACOSX|\.npmrc|\.yarnrc(\.yml)?|\.pnpmrc|bunfig\.toml)$|(^|\/)__MACOSX\//;
  for (const e of all(PLUGIN)) {
    assert.ok(!e.link, `${e.rel} is a symlink`);
    assert.ok(!junk.test(e.rel), `${e.rel} must not ship`);
    assert.ok(!/(^|\/)node_modules(\/|$)/.test(e.rel), `${e.rel}: node_modules must not ship`);
  }
  for (const rel of list) {
    const size = fs.statSync(path.join(PLUGIN, rel)).size;
    assert.ok(size < 256 * KIB, `${rel} is ${size} bytes (limit 256 KiB)`);
  }
  const bytes = list.reduce((n, rel) => n + fs.statSync(path.join(PLUGIN, rel)).size, 0);
  assert.ok(bytes < 4 * MIB, `plugin folder is ${bytes} bytes`);
});

for (const [label, PLUGIN] of PLUGINS) test(`${label}: only text files (UTF-8, no NUL bytes) or images and fonts`, () => {
  const binaryOk = /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf)$/i;
  for (const rel of files(PLUGIN)) {
    if (binaryOk.test(rel)) continue;
    const buf = fs.readFileSync(path.join(PLUGIN, rel));
    assert.ok(!buf.includes(0), `${rel} contains NUL bytes: not a text file`);
    assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(buf), `${rel} is not valid UTF-8`);
  }
});

for (const [label, PLUGIN] of PLUGINS) test(`${label}: no minified code (every source line is readable)`, () => {
  for (const rel of files(PLUGIN).filter((r) => /\.(mjs|js|json)$/.test(r) && !/package-lock\.json$/.test(r))) {
    const longest = Math.max(...fs.readFileSync(path.join(PLUGIN, rel), 'utf8').split('\n').map((l) => l.length));
    assert.ok(longest <= 600, `${rel} has a ${longest}-character line: minified or generated code?`);
  }
});

for (const [label, PLUGIN] of PLUGINS) test(`${label}: the secret scan is clean`, () => {
  const hits = [];
  for (const rel of files(PLUGIN).filter((r) => !/\.png$/.test(r))) {
    const text = fs.readFileSync(path.join(PLUGIN, rel), 'utf8');
    for (const [label, re] of Object.entries(SECRET_PATTERNS)) if (re.test(text)) hits.push(`${rel}: ${label}`);
  }
  assert.deepEqual(hits, []);
});

test('connector .mcp.json: a local server started with node on a file inside the plugin, using only ${CLAUDE_PLUGIN_ROOT}', () => {
  for (const dir of [PLUGIN, BOARD]) assert.ok(!fs.existsSync(path.join(dir, '.mcp.json')), 'only the connector has a .mcp.json');
  const mcp = JSON.parse(fs.readFileSync(path.join(CONN, '.mcp.json'), 'utf8'));
  const [name, s] = Object.entries(mcp.mcpServers)[0];
  assert.equal(name, 'lc', 'server key is lc');
  assert.equal(s.command, 'node');
  const text = JSON.stringify(s);
  const vars = [...text.matchAll(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(vars)], ['${CLAUDE_PLUGIN_ROOT}'], 'no other variable');
  assert.ok(!/[*?`]|\$\(/.test(text), 'no wildcard or command substitution');
  const target = s.args[0].replace('${CLAUDE_PLUGIN_ROOT}/', '');
  assert.ok(fs.existsSync(path.join(CONN, target)), `${target} exists inside the plugin`);
  assert.ok(s.args.every((a) => !a.startsWith('--') || a.length > 2), 'plain arguments');
});

test('.gitattributes: nothing that rewrites file contents (filter, LFS, export-ignore, export-subst, text/eol)', () => {
  const tracked = execFileSync('git', ['-C', REPO, 'ls-files', '--', '.gitattributes', '**/.gitattributes'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(tracked.includes('.gitattributes'));
  for (const rel of tracked) {
    const lines = fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
    for (const l of lines) assert.ok(!/\b(filter|export-ignore|export-subst|eol|text|ident|working-tree-encoding)\b|\blfs\b/i.test(l.replace(/\s\bbinary\b/, '')), `${rel}: "${l}" rewrites or hides content`);
  }
  for (const dir of [PLUGIN, BOARD, CONN]) assert.ok(!fs.existsSync(path.join(dir, '.gitattributes')));
});

test('the repository as GitHub archives it is under 50 MiB and 10,000 files', async (t) => {
  const child = spawn('git', ['-C', REPO, 'archive', 'HEAD'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let bytes = 0;
  child.stdout.on('data', (d) => { bytes += d.length; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0, 'git archive HEAD failed');
  t.diagnostic(`git archive HEAD: ${bytes} bytes = ${(bytes / MIB).toFixed(2)} MiB`);
  assert.ok(bytes < 48 * MIB, `archive is ${(bytes / MIB).toFixed(1)} MiB (we assert < 48, the directory's limit is 50)`);
  const count = execFileSync('git', ['-C', REPO, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8', maxBuffer: 64 * MIB }).split('\n').filter(Boolean).length;
  t.diagnostic(`files in HEAD: ${count}`);
  assert.ok(count < 10_000, `${count} files in the archive (limit 10,000)`);
});
