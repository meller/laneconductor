// Local pre-checks of the one plugin (plugins/laneconductor, profile `full`), track AM-10106 Phase 5e. Anthropic's directory
// submission is PARKED (the portal accepts only Markdown from a publisher that is not Verified; this plugin runs a local
// program), so what is checked here is what a local install needs and what stays good practice: `claude plugin validate
// --strict` on the plugin and the marketplace, the version/manifest/size limits (512 files, 256 KiB per file), a secrets scan,
// no top-level bin/, and the connector starting over stdio from a temp copy and answering tools/list. The directory's own rules
// (Markdown only, no scripts, no .mcp.json, ...) are emulated against the LEAN profile in directory-lean.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, PLUGIN_REL } from '../../scripts/build-plugin.mjs';
import { TOOLS } from '../src/tools/index.mjs';
import { makeRepo } from './helpers/repo.mjs';
import { spawnRaw } from './helpers/rawstdio.mjs';
import { SECRET_PATTERNS } from './helpers/secret-patterns.mjs';

const PLUGIN = path.join(REPO, PLUGIN_REL);
const PLUGINS = [['the plugin', PLUGIN]];
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
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

for (const [label, target] of [['the plugin folder', PLUGIN], ['the marketplace (repo root)', REPO]]) {
  test(`claude plugin validate --strict passes on ${label}`, (t) => {
    if (!claudeAvailable()) return t.skip('the claude CLI is not on PATH: run `claude plugin validate <path> --strict` by hand');
    const r = spawnSync('claude', ['plugin', 'validate', target, '--strict'], { encoding: 'utf8', cwd: os.tmpdir() });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /Validation passed/);
  });
}

for (const [label, PLUGIN] of PLUGINS) test(`${label}: at most 512 files, each under 256 KiB, no links, no junk files, no package-manager config (the package.json and lockfile are the connector's)`, () => {
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

test('.mcp.json: a local server started with node on a file inside the plugin, using only ${CLAUDE_PLUGIN_ROOT}', () => {
  const mcp = readJson(path.join(PLUGIN, '.mcp.json'));
  const [name, s] = Object.entries(mcp.mcpServers)[0];
  assert.equal(Object.keys(mcp.mcpServers).length, 1);
  assert.equal(name, 'lc', 'server key is lc');
  assert.equal(s.command, 'node');
  const text = JSON.stringify(s);
  const vars = [...text.matchAll(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(vars)], ['${CLAUDE_PLUGIN_ROOT}'], 'no other variable');
  assert.ok(!/[*?`]|\$\(/.test(text), 'no wildcard or command substitution');
  const target = s.args[0].replace('${CLAUDE_PLUGIN_ROOT}/', '');
  assert.ok(fs.existsSync(path.join(PLUGIN, target)), `${target} exists inside the plugin`);
  assert.ok(s.args.every((a) => !a.startsWith('--') || a.length > 2), 'plain arguments');
});

test('version and manifest limits: semver version equal to connector/package.json, valid name, no top-level bin/, no hooks directory', () => {
  const m = readJson(path.join(PLUGIN, '.claude-plugin/plugin.json'));
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
  assert.equal(m.version, readJson(path.join(REPO, 'connector/package.json')).version);
  assert.equal(readJson(path.join(PLUGIN, 'package.json')).version, m.version);
  assert.match(m.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(m.name.length <= 64 && m.description.length <= 1024);
  assert.ok(!fs.existsSync(path.join(PLUGIN, 'bin')), 'a top-level bin/ stops claude.ai and Cowork installing the plugin');
  assert.ok(!fs.existsSync(path.join(PLUGIN, 'hooks')));
});

test('the connector starts over stdio from a temp copy of the plugin and answers initialize + tools/list (and a call that reads guides and conductor/ helpers)', async (t) => {
  const real = fs.realpathSync(os.tmpdir());
  const tmp = fs.mkdtempSync(path.join(real, 'lc-plugin-run-'));
  const copy = path.join(tmp, 'plugin');
  const project = makeRepo({ prefix: 'lc-plugin-project-' });
  let raw;
  try {
    fs.cpSync(PLUGIN, copy, { recursive: true });
    // Dependencies as Claude Code installs them: `npm ci` from the root lockfile. The offline cache
    // may be cold on a fresh machine; then fall back to the repo's already-installed modules.
    const ci = spawnSync('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: copy, encoding: 'utf8' });
    let via = 'npm ci --offline';
    if (ci.status !== 0) {
      fs.rmSync(path.join(copy, 'node_modules'), { recursive: true, force: true });
      fs.symlinkSync(path.join(REPO, 'connector/node_modules'), path.join(copy, 'node_modules'), 'dir');
      via = 'symlink to connector/node_modules (offline npm cache was cold)';
    }
    t.diagnostic(`dependencies installed via ${via}`);
    // Use the committed .mcp.json entry with ${CLAUDE_PLUGIN_ROOT} applied; Claude Code exports CLAUDE_PROJECT_DIR to the process.
    const entry = readJson(path.join(copy, '.mcp.json')).mcpServers.lc;
    const sub = (s) => s.replaceAll('${CLAUDE_PLUGIN_ROOT}', copy);
    assert.ok(!entry.args.some((a) => a.includes('${CLAUDE_PROJECT_DIR}')), 'no project variable in args');
    assert.equal(entry.command, 'node');
    raw = spawnRaw(process.execPath, entry.args.map(sub), { cwd: tmp, env: { ...process.env, CLAUDE_PROJECT_DIR: project } });
    const init = await raw.initialize();
    assert.ok(init.result, JSON.stringify(init));
    assert.equal(init.result.serverInfo.version, readJson(path.join(copy, 'package.json')).version, 'version read from the plugin root package.json');
    assert.ok((init.result.instructions ?? '').length > 0);
    const list = await raw.request('tools/list', {});
    const names = list.result.tools.map((x) => x.name).sort();
    assert.equal(names.length, TOOLS.length);
    assert.deepEqual(names, TOOLS.map((x) => x.name).sort());
    const call = await raw.request('tools/call', { name: 'list_tracks', arguments: {} });
    assert.ok(call.result && !call.result.isError, JSON.stringify(call));
    const ctx = await raw.request('tools/call', { name: 'get_context', arguments: { lane: 'plan' } });
    assert.ok(ctx.result && !ctx.result.isError, JSON.stringify(ctx));
    assert.ok(raw.stdoutLines.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), 'stdout is MCP-only');
    assert.ok(raw.stderr().includes('serving'), raw.stderr());
  } finally {
    if (raw) await raw.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('.gitattributes: nothing that rewrites file contents (filter, LFS, export-ignore, export-subst, text/eol)', () => {
  const tracked = execFileSync('git', ['-C', REPO, 'ls-files', '--', '.gitattributes', '**/.gitattributes'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(tracked.includes('.gitattributes'));
  for (const rel of tracked) {
    const lines = fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
    for (const l of lines) assert.ok(!/\b(filter|export-ignore|export-subst|eol|text|ident|working-tree-encoding)\b|\blfs\b/i.test(l.replace(/\s\bbinary\b/, '')), `${rel}: "${l}" rewrites or hides content`);
  }
  assert.ok(!fs.existsSync(path.join(PLUGIN, '.gitattributes')));
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
