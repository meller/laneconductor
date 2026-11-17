// Phase 5c: the generated LaneConductor plugin (plugins/laneconductor/) and its marketplace file.
// What is NOT covered here is HUMAN (plan 5c Task 5): installing from the marketplace, `/mcp`
// showing the server connected, and the `${CLAUDE_PROJECT_DIR}` substitution in a real Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll, diffAgainstDisk, REPO, PLUGIN_REL, MARKETPLACE_REL } from '../../scripts/build-plugin.mjs';
import { TOOLS } from '../src/tools/index.mjs';
import { makeRepo } from './helpers/repo.mjs';
import { spawnRaw } from './helpers/rawstdio.mjs';

const PLUGIN = path.join(REPO, PLUGIN_REL);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const listFiles = (root, rel = '') => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
  const r = rel ? `${rel}/${e.name}` : e.name;
  if (e.name === 'node_modules') return [];
  return e.isDirectory() ? listFiles(root, r) : [r];
});

function claudeAvailable() {
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

test('regenerating gives byte-identical output (no drift) and is deterministic', () => {
  assert.deepEqual(diffAgainstDisk(), [], 'run: node scripts/build-plugin.mjs');
  const a = buildAll();
  const b = buildAll();
  assert.deepEqual([...a.keys()], [...b.keys()]);
  for (const [k, v] of a) assert.ok(v.content.equals(b.get(k).content), k);
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts/build-plugin.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('--check exits 1 and names the file when the committed output has drifted', () => {
  // Build a scratch "repo" holding only what the generator reads, then edit one generated file.
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-plugin-drift-'));
  try {
    for (const rel of ['.claude/skills/laneconductor', 'connector/src', 'connector/guides']) {
      fs.cpSync(path.join(REPO, rel), path.join(tmp, rel), { recursive: true });
    }
    fs.mkdirSync(path.join(tmp, 'connector/bin'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'connector/bin/lc-connector.mjs'), path.join(tmp, 'connector/bin/lc-connector.mjs'));
    for (const rel of ['connector/package.json', 'connector/package-lock.json']) fs.copyFileSync(path.join(REPO, rel), path.join(tmp, rel));
    // The repo files the server imports from outside connector/ (the generator finds them by their imports).
    for (const rel of listFiles(path.join(PLUGIN, 'conductor'))) {
      fs.mkdirSync(path.dirname(path.join(tmp, 'conductor', rel)), { recursive: true });
      fs.copyFileSync(path.join(REPO, 'conductor', rel), path.join(tmp, 'conductor', rel));
    }
    fs.cpSync(PLUGIN, path.join(tmp, PLUGIN_REL), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(REPO, MARKETPLACE_REL), path.join(tmp, MARKETPLACE_REL));
    assert.deepEqual(diffAgainstDisk(tmp), [], 'the scratch copy starts clean');
    fs.appendFileSync(path.join(tmp, PLUGIN_REL, 'skills/laneconductor/SKILL.md'), '\nedited by hand\n');
    fs.writeFileSync(path.join(tmp, PLUGIN_REL, 'stray.txt'), 'x');
    const problems = diffAgainstDisk(tmp);
    assert.ok(problems.includes(`differs: ${PLUGIN_REL}/skills/laneconductor/SKILL.md`), problems.join('\n'));
    assert.ok(problems.includes(`extra file: ${PLUGIN_REL}/stray.txt`), problems.join('\n'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

for (const [label, target] of [['the plugin', PLUGIN], ['the marketplace', REPO]]) {
  test(`claude plugin validate passes on ${label} (--strict for the plugin)`, (t) => {
    if (!claudeAvailable()) return t.skip('the claude CLI is not on PATH; run `claude plugin validate` by hand');
    const args = ['plugin', 'validate', target, ...(target === PLUGIN ? ['--strict'] : [])];
    const r = spawnSync('claude', args, { encoding: 'utf8', cwd: os.tmpdir() });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /Validation passed/);
  });
}

test('manifest, marketplace and .mcp.json have the agreed shape', () => {
  const manifest = readJson(path.join(PLUGIN, '.claude-plugin/plugin.json'));
  const pkg = readJson(path.join(REPO, 'connector/package.json'));
  assert.equal(manifest.name, 'laneconductor');
  assert.equal(manifest.version, pkg.version, 'plugin version follows connector/package.json');
  const market = readJson(path.join(REPO, MARKETPLACE_REL));
  assert.equal(market.name, 'laneconductor');
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, manifest.name, 'marketplace entry name equals the manifest name');
  assert.equal(market.plugins[0].source, './plugins/laneconductor');
  assert.ok(!market.plugins[0].source.includes('..'));
  const mcp = readJson(path.join(PLUGIN, '.mcp.json'));
  assert.deepEqual(Object.keys(mcp.mcpServers), ['lc-connector']);
  const s = mcp.mcpServers['lc-connector'];
  assert.equal(s.command, 'node');
  assert.deepEqual(s.args, ['${CLAUDE_PLUGIN_ROOT}/server/bin/lc-connector.mjs', '--repo', '${CLAUDE_PROJECT_DIR}']);
  assert.equal(s.type, undefined, 'no remote (http) entry yet: plan 5c Task 6 waits for Phase 8');
  assert.equal(s.env, undefined);
});

test('no top-level bin/ in the plugin, no symlinks, no node_modules committed', () => {
  assert.ok(!fs.existsSync(path.join(PLUGIN, 'bin')), 'a top-level bin/ stops claude.ai and Cowork installing the plugin');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    assert.ok(!e.isSymbolicLink(), `${path.join(dir, e.name)} is a symlink`);
    if (e.isDirectory() && e.name !== 'node_modules') walk(path.join(dir, e.name));
  });
  walk(PLUGIN);
  const tracked = execFileSync('git', ['-C', REPO, 'ls-files', PLUGIN_REL], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(tracked.every((f) => !f.includes('/node_modules/')), 'node_modules must not be committed');
});

test('package.json and the lockfile: registry-only exact pins, lockfile v2/3, no scripts or overrides', () => {
  const pkg = readJson(path.join(PLUGIN, 'package.json'));
  assert.deepEqual(Object.keys(pkg).sort(), ['dependencies', 'name', 'type', 'version']);
  const exact = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
  for (const [n, v] of Object.entries(pkg.dependencies)) assert.match(v, exact, `${n} is not an exact pin`);
  const lock = readJson(path.join(PLUGIN, 'package-lock.json'));
  assert.ok([2, 3].includes(lock.lockfileVersion), `lockfileVersion ${lock.lockfileVersion}`);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.equal(lock.overrides, undefined);
  const entries = Object.entries(lock.packages).filter(([k]) => k !== '');
  assert.ok(entries.length > 0);
  for (const [k, e] of entries) {
    assert.match(e.version, exact, `${k} version`);
    assert.match(e.resolved ?? '', /^https:\/\/registry\.npmjs\.org\//, `${k} resolved from the registry only`);
    assert.match(e.integrity ?? '', /^sha\d+-/, `${k} integrity`);
    assert.ok(!e.hasInstallScript, `${k} has a lifecycle script`);
    assert.ok(!e.dev, `${k} is a dev dependency and must not ship`);
    assert.ok(!e.link, `${k} is a link`);
  }
  assert.ok(!lock.packages['node_modules/@modelcontextprotocol/client'], 'the test-only client is not shipped');
});

test('REQ-12-style secret scan over the plugin directory', () => {
  const patterns = {
    'GitHub token': /\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}/,
    'Anthropic or OpenAI key': /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/,
    'AWS access key': /\bAKIA[0-9A-Z]{16}\b/,
    'Slack token': /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
    'Google API key': /\bAIza[0-9A-Za-z_-]{30,}/,
    'private key block': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    'bearer credential': /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/,
    'credential assignment': /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
    'connection string with password': /\b[a-z]+:\/\/[^/\s:@]+:[^/\s@]{3,}@/,
  };
  const hits = [];
  for (const rel of listFiles(PLUGIN)) {
    const text = fs.readFileSync(path.join(PLUGIN, rel), 'utf8');
    for (const [label, re] of Object.entries(patterns)) if (re.test(text)) hits.push(`${rel}: ${label}`);
  }
  assert.deepEqual(hits, []);
  for (const name of ['.env', '.laneconductor.json', '.worker.tokens.json']) {
    assert.ok(!listFiles(PLUGIN).some((r) => path.basename(r).startsWith(name)), `${name} must not ship`);
  }
  const mcp = fs.readFileSync(path.join(PLUGIN, '.mcp.json'), 'utf8');
  assert.ok(!/"env"|"headers"|Authorization/i.test(mcp), 'no secrets or auth in .mcp.json');
});

test('skill: frontmatter fits the listing budget and every relative link resolves inside the plugin', () => {
  const skillDir = path.join(PLUGIN, 'skills/laneconductor');
  const md = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/)[1];
  const field = (k) => (fm.match(new RegExp(`^${k}: (.*)$`, 'm')) ?? [])[1] ?? '';
  assert.equal(field('name'), 'laneconductor');
  assert.ok(field('description').length > 0);
  assert.ok(field('description').length + field('when_to_use').length <= 1536, 'description + when_to_use must be <= 1,536 chars');
  const links = [...md.matchAll(/\]\(([^)#\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^[a-z]+:/.test(l));
  assert.ok(links.length >= 10, 'the command table links to the lane files');
  for (const l of links) {
    assert.ok(!path.isAbsolute(l) && !l.startsWith('..'), `${l} must stay relative and inside the skill`);
    assert.ok(fs.existsSync(path.join(skillDir, l)), `${l} (linked from SKILL.md) is missing from the plugin copy`);
  }
});

test('skill path audit: no hard-coded project or machine paths outside the setup docs', () => {
  const skillDir = path.join(PLUGIN, 'skills/laneconductor');
  const offenders = [];
  for (const rel of listFiles(skillDir)) {
    const text = fs.readFileSync(path.join(skillDir, rel), 'utf8');
    const inSetup = rel.startsWith('setup/') || rel.startsWith('legacy/');
    // Any machine-specific absolute path is out, everywhere.
    if (/\/home\/[a-z]+\//.test(text)) offenders.push(`${rel}: /home/<user>/ path`);
    // The author's checkout location and the repo-relative skill path are allowed only where the
    // setup docs deliberately talk about installing or linking the skill from a LaneConductor install.
    if (!inSetup && /\$HOME\/Code\/laneconductor/.test(text)) offenders.push(`${rel}: $HOME/Code/laneconductor`);
    if (!inSetup && rel !== 'SKILL.md' && /\.claude\/skills\/laneconductor/.test(text)) offenders.push(`${rel}: .claude/skills/laneconductor`);
  }
  assert.deepEqual(offenders, []);
  // SKILL.md names both locations, so a reader of the plugin copy knows where its own files are.
  const head = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.match(head, /Paths below are relative to this file's directory/);
  assert.match(head, /skills\/laneconductor\/` when installed as the LaneConductor plugin/);
});

test('generated server starts over stdio from a copy of the plugin dir and answers initialize + tools/list', async (t) => {
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
    // Use the committed .mcp.json entry with the two documented substitutions applied.
    const entry = readJson(path.join(copy, '.mcp.json')).mcpServers['lc-connector'];
    const sub = (s) => s.replaceAll('${CLAUDE_PLUGIN_ROOT}', copy).replaceAll('${CLAUDE_PROJECT_DIR}', project);
    assert.equal(entry.command, 'node');
    raw = spawnRaw(process.execPath, entry.args.map(sub), { cwd: tmp });
    const init = await raw.initialize();
    assert.ok(init.result, JSON.stringify(init));
    assert.equal(init.result.serverInfo.version, readJson(path.join(copy, 'package.json')).version, 'version read from the plugin root package.json');
    assert.ok((init.result.instructions ?? '').length > 0);
    const list = await raw.request('tools/list', {});
    const names = list.result.tools.map((x) => x.name).sort();
    assert.equal(names.length, TOOLS.length);
    assert.deepEqual(names, TOOLS.map((x) => x.name).sort());
    // A guide is read from server/guides and a tool imports conductor/ helpers from the plugin root.
    const call = await raw.request('tools/call', { name: 'list_tracks', arguments: {} });
    assert.ok(call.result && !call.result.isError, JSON.stringify(call));
    assert.ok(raw.stdoutLines.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), 'stdout is MCP-only');
    assert.ok(raw.stderr().includes('serving'), raw.stderr());
  } finally {
    if (raw) await raw.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});
