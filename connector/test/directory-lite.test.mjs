// Emulates what Anthropic's plugin directory portal blocks for a plugin from a publisher that is NOT a Verified organization,
// against LaneConductor Lite (plugins/laneconductor-lite, the Markdown-only plugin built by `node scripts/build-plugin.mjs`).
// Track AM-10127. The rules come from the portal's own Validate report on the full plugin, run 2026-11-18, which BLOCKED:
//   - the local MCP server (.mcp.json);
//   - package.json and the lockfile, and the `dependencies` field of package.json;
//   - every file that is not Markdown, text, JSON, YAML or PNG/JPEG/GIF/WebP/ICO (it named conductor/providers.mjs);
//   - the agent frontmatter key `isolation` (agents/track-runner.md); the portal accepts only plain `key: value` lines between
//     `---` lines in frontmatter, and keys outside its allowed list are blocked;
// and WARNED about 2 unrecognized fields in plugin.json (documentationUrl, supportUrl; the listing field privacyPolicyUrl IS
// allowed). A reviewer hold about the publisher name needs no action. Older rules from the 2026-11-17 run are kept: no hooks,
// no `.claude/skills` folder inside, `allowed-tools` entries only from Read, Grep, Glob, LS, a square icon, a README of 40 words,
// each file under 256 KiB and at most 512 files.
// NOT emulated (portal-only): the policy holds a reviewer reads, whether the portal also inspects subagent `tools:` lists (Lite's
// track-runner lists Bash and Edit), and its content scanners beyond the patterns below. The agent keys we ship besides the
// documented ones (`maxTurns`, `color`) were present in the report's input and were not flagged.
// `checkLite(dir)` returns the list of problems; the first test asserts it is empty for the committed plugin, the others prove
// each rule fires on a copy of the plugin that breaks it, and that Lite says what it should (and nothing it must not).
import { test, after } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { REPO, LITE_REL, PLUGIN_REL, MARKETPLACE_REL, FULL_INSTALL_COMMANDS, LITE_UNINSTALL_COMMAND, PRIVACY_URL, writeProfile, buildPlugin } from '../../scripts/build-plugin.mjs';
import { COMMANDS as CATALOG } from '../src/commands.mjs';
import { TOOLS } from '../src/tools/index.mjs';

const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-lite-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const LITE = path.join(REPO, LITE_REL);
const KIB = 1024;
const TEXT_EXT = /\.(md|markdown|txt|json|ya?ml)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|ico)$/i;
const ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'LS'];
// plugin.json keys the portal knows. documentationUrl and supportUrl are NOT on it (warned 2026-11-18); privacyPolicyUrl is.
const MANIFEST_KEYS = ['name', 'displayName', 'version', 'description', 'author', 'license', 'homepage', 'repository', 'keywords', 'privacyPolicyUrl', 'icon'];
// Frontmatter keys we ship, per kind of file. `isolation` is blocked by the portal; the others are standard documented keys.
const AGENT_KEYS = ['name', 'description', 'tools', 'maxTurns', 'color'];
const COMMAND_KEYS = ['description', 'argument-hint'];
const SKILL_KEYS = ['name', 'description', 'when_to_use', 'argument-hint'];
const PACKAGE_FILES = /^(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|\.npmrc|\.yarnrc(\.yml)?|\.pnpmrc|bunfig\.toml|pnpm-workspace\.yaml)$/;
// A line that points a package manager at another registry.
const REGISTRY_LINE = /^\s*(?:@[\w.-]+:)?registry\s*=|\bnpm\s+config\s+set\b|--registry[= ]|\bindex-url\b|\bextra-index-url\b|\bnpmRegistryServer\b/im;
// What the connector and the board script are called: Lite must not name them as if they were present.
const CONNECTOR_NAMES = new RegExp(`\\b(${TOOLS.map((t) => t.name).filter((n) => n.includes('_')).join('|')})\\b|mcp__|lc-connector|lc-board|lc-scaffold|server/bin|CLAUDE_PLUGIN_ROOT|\\bArtifact tool\\b`);

function entries(root, rel = '') {
  return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) return [{ rel: r, link: true }];
    return e.isDirectory() ? [{ rel: r, dir: true }, ...entries(root, r)] : [{ rel: r }];
  });
}
const filesOf = (root) => entries(root).filter((e) => !e.dir).map((e) => e.rel);
const read = (rel) => fs.readFileSync(path.join(LITE, rel), 'utf8');

/** Header of a PNG: { width, height, ok } where ok means signature, IHDR, readable zlib data and IEND. */
export function pngInfo(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(sig) || buf.toString('ascii', 12, 16) !== 'IHDR') return { ok: false };
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const idat = [];
  let sawEnd = false;
  for (let o = 8; o + 12 <= buf.length;) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    if (type === 'IEND') { sawEnd = true; break; }
    o += 12 + len;
  }
  let inflates = false;
  try { zlib.inflateSync(Buffer.concat(idat)); inflates = true; } catch { /* corrupt */ }
  return { ok: sawEnd && inflates, width, height };
}

/** The frontmatter lines of a markdown file, or null. */
const frontmatter = (text) => (text.match(/^---\n([\s\S]*?)\n---\n/) ?? [])[1] ?? null;

/** Tools named by `allowed-tools` / `allowedTools` in a frontmatter block (inline list or YAML list). */
function allowedToolsOf(fm) {
  const found = [];
  const lines = fm.split('\n');
  lines.forEach((l, i) => {
    const m = l.match(/^(allowed-tools|allowedTools):\s*(.*)$/);
    if (!m) return;
    let value = m[2];
    for (let j = i + 1; j < lines.length && /^\s+(-\s*)?\S/.test(lines[j]); j += 1) value += `,${lines[j].replace(/^\s*-\s*/, '')}`;
    found.push({ key: m[1], tools: value.replace(/[[\]]/g, '').split(',').map((t) => t.trim().replace(/\(.*$/, '')).filter(Boolean) });
  });
  return found;
}

/** Frontmatter of a command, agent or skill file: only plain `key: value` lines, keys from the list. */
function checkFrontmatter(rel, text, keys, problems) {
  if (!text.startsWith('---\n')) { problems.push(`${rel}: no frontmatter`); return; }
  const fm = frontmatter(text);
  if (fm === null) { problems.push(`${rel}: frontmatter is not closed by a --- line`); return; }
  for (const line of fm.split('\n')) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*): (.*)$/);
    if (!m) { problems.push(`${rel}: frontmatter line is not a plain "key: value" line: ${line.slice(0, 60)}`); continue; }
    if (m[1] === 'isolation') problems.push(`${rel}: frontmatter key "isolation" is blocked`);
    else if (!keys.includes(m[1])) problems.push(`${rel}: frontmatter key "${m[1]}" is not on the allowed list (${keys.join(', ')})`);
  }
}

export function checkLite(dir) {
  const problems = [];
  const all = entries(dir);
  const files = all.filter((e) => !e.dir && !e.link).map((e) => e.rel);
  for (const e of all.filter((x) => x.link)) problems.push(`${e.rel}: symlink`);

  // Counts and sizes.
  if (files.length > 512) problems.push(`${files.length} files (limit 512)`);
  for (const rel of files) {
    const size = fs.statSync(path.join(dir, rel)).size;
    if (size >= 256 * KIB) problems.push(`${rel}: ${size} bytes (limit 256 KiB)`);
  }

  // File types: Markdown, text, JSON, YAML, LICENSE and images only.
  for (const rel of files) {
    const base = path.basename(rel);
    const ok = TEXT_EXT.test(base) || IMAGE_EXT.test(base) || /^LICENSE(\.(md|txt))?$/.test(base);
    if (!ok) problems.push(`${rel}: file type not allowed (only Markdown, text, JSON, YAML, LICENSE and PNG/JPEG/GIF/WebP/ICO)`);
    if (/\.(mjs|cjs|js|ts|sh|bash|zsh|py|rb|ps1|bat|cmd|exe|node|wasm)$/i.test(base)) problems.push(`${rel}: script or program file`);
    if (PACKAGE_FILES.test(base)) problems.push(`${rel}: package installs and package-manager config are blocked`);
    if (base === '.mcp.json') problems.push(`${rel}: .mcp.json (local MCP server) is blocked`);
  }
  // Folders.
  for (const e of all.filter((x) => x.dir)) {
    const parts = e.rel.split('/');
    if (parts.includes('hooks')) problems.push(`${e.rel}: hooks are blocked`);
    if (parts.includes('node_modules')) problems.push(`${e.rel}: node_modules`);
    if (parts.includes('.claude')) problems.push(`${e.rel}: a .claude folder (for example .claude/skills) inside the plugin`);
    if (parts.includes('.claude-plugin') && e.rel !== '.claude-plugin') problems.push(`${e.rel}: a .claude-plugin folder other than the plugin's own`);
    if (['server', 'conductor', 'bin', 'scripts'].includes(e.rel)) problems.push(`${e.rel}: a program folder (server/, conductor/, bin/ and scripts/ do not belong in Lite)`);
  }
  const own = files.filter((r) => r.startsWith('.claude-plugin/')).sort();
  if (JSON.stringify(own) !== JSON.stringify(['.claude-plugin/icon.png', '.claude-plugin/plugin.json'])) problems.push(`.claude-plugin holds ${JSON.stringify(own)}; expected exactly plugin.json and icon.png`);

  // Manifest.
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin/plugin.json'), 'utf8')); } catch (e) { problems.push(`plugin.json: ${e.message}`); }
  for (const k of Object.keys(manifest)) if (!MANIFEST_KEYS.includes(k)) problems.push(`plugin.json: key "${k}" is not on the allowed list (${MANIFEST_KEYS.join(', ')})`);

  // Icon: a square PNG of 512 to 2048 px under 2 MB.
  const iconRel = manifest.icon ? String(manifest.icon).replace(/^\.\//, '') : '.claude-plugin/icon.png';
  const iconAbs = path.join(dir, iconRel);
  if (!fs.existsSync(iconAbs)) problems.push(`icon: ${iconRel} is missing`);
  else {
    const buf = fs.readFileSync(iconAbs);
    const info = pngInfo(buf);
    if (!info.ok) problems.push(`icon: ${iconRel} is not a valid PNG`);
    else {
      if (info.width !== info.height) problems.push(`icon: ${info.width}x${info.height} is not square`);
      if (info.width < 512 || info.width > 2048) problems.push(`icon: ${info.width} px is outside 512 to 2048`);
    }
    if (buf.length >= 2 * KIB * KIB) problems.push(`icon: ${buf.length} bytes (limit 2 MB)`);
  }

  // README: at least 40 words outside code blocks.
  const readmePath = path.join(dir, 'README.md');
  if (!fs.existsSync(readmePath)) problems.push('README.md is missing');
  else {
    const words = fs.readFileSync(readmePath, 'utf8').replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
    if (words < 40) problems.push(`README.md: ${words} words outside code blocks (need 40)`);
  }
  if (!files.includes('LICENSE')) problems.push('LICENSE is missing');

  // Text files: UTF-8, no NUL bytes, no shebang, no package registry setting.
  for (const rel of files.filter((r) => !IMAGE_EXT.test(r))) {
    const buf = fs.readFileSync(path.join(dir, rel));
    if (buf.includes(0)) { problems.push(`${rel}: NUL byte (not a text file)`); continue; }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { problems.push(`${rel}: not valid UTF-8`); continue; }
    if (text.startsWith('#!') || /^#!\/(usr\/)?bin\//m.test(text)) problems.push(`${rel}: has a #! line (a script)`);
    if (REGISTRY_LINE.test(text)) problems.push(`${rel}: sets a package registry`);
  }

  // Frontmatter: plain key: value lines, keys from the lists; allowed-tools only Read, Grep, Glob, LS, and never in the skill.
  for (const rel of files.filter((r) => /^(skills|commands|agents)\/.*\.md$/.test(r))) {
    const text = fs.readFileSync(path.join(dir, rel), 'utf8');
    const isSkill = rel === 'skills/laneconductor/SKILL.md';
    const isEntry = /^(commands|agents)\//.test(rel);
    if (isSkill || isEntry) checkFrontmatter(rel, text, isSkill ? SKILL_KEYS : rel.startsWith('agents/') ? AGENT_KEYS : COMMAND_KEYS, problems);
    const fm = frontmatter(text);
    if (!fm) continue;
    for (const { key, tools } of allowedToolsOf(fm)) {
      if (rel.startsWith('skills/')) problems.push(`${rel}: ${key} must be absent from the skill`);
      for (const t of tools) if (!ALLOWED_TOOLS.includes(t)) problems.push(`${rel}: ${key} names ${t} (allowed: ${ALLOWED_TOOLS.join(', ')})`);
    }
  }
  // Skill listing budget (a Claude Code limit the directory shows as a warning).
  const skill = path.join(dir, 'skills/laneconductor/SKILL.md');
  if (fs.existsSync(skill)) {
    const fm = frontmatter(fs.readFileSync(skill, 'utf8')) ?? '';
    const field = (k) => (fm.match(new RegExp(`^${k}: (.*)$`, 'm')) ?? [])[1] ?? '';
    if (field('description').length + field('when_to_use').length > 1536) problems.push('SKILL.md: description + when_to_use over 1,536 characters');
  }
  return problems;
}

test('LaneConductor Lite passes every emulated directory rule', () => {
  assert.deepEqual(checkLite(LITE), []);
});

test('the committed Lite folder is exactly what the generator builds, also from the CLI', () => {
  const built = buildPlugin(REPO, 'lite');
  assert.deepEqual(filesOf(LITE).sort(), [...built.keys()].sort());
  for (const [rel, f] of built) assert.ok(fs.readFileSync(path.join(LITE, rel)).equals(f.content), `${rel} differs from the build`);
  const out = path.join(TMP, 'cli');
  assert.equal(writeProfile('lite', out), built.size);
  assert.deepEqual(filesOf(out).sort(), [...built.keys()].sort());
  const run = (...args) => spawnSync(process.execPath, [path.join(REPO, 'scripts/build-plugin.mjs'), ...args], { encoding: 'utf8' });
  assert.equal(run('--profile', 'lite').status, 1, '--out is required');
  assert.match(run('--profile', 'lite', '--out', path.join(REPO, PLUGIN_REL, 'x')).stderr, /refusing to write inside/);
  assert.match(run('--profile', 'lite', '--out', out).stderr, /is not empty/);
  assert.match(run('--profile', 'lite', '--check').stderr, /--check checks only the default build/);
  assert.match(run('--profile', 'lean', '--out', path.join(TMP, 'x')).stderr, /unknown profile lean/);
  const fresh = path.join(TMP, 'second');
  assert.equal(run('--profile', 'lite', '--out', fresh).status, 0);
  assert.deepEqual(checkLite(fresh), []);
});

test('Lite holds only the Markdown variant: files, manifest fields, identity and the marketplace', () => {
  const files = filesOf(LITE);
  const top = new Set(files.map((r) => r.split('/')[0]));
  assert.deepEqual([...top].sort(), ['.claude-plugin', 'LICENSE', 'README.md', 'agents', 'commands', 'skills']);
  assert.ok(files.includes('skills/laneconductor/SKILL.md') && files.includes('skills/laneconductor/FULL-PLUGIN.md') && files.includes('.claude-plugin/icon.png'));
  for (const f of files) assert.ok(TEXT_EXT.test(f) || IMAGE_EXT.test(f) || f === 'LICENSE', `${f}: unexpected type`);
  assert.ok(files.length <= 512);
  const manifest = JSON.parse(read('.claude-plugin/plugin.json'));
  const version = JSON.parse(fs.readFileSync(path.join(REPO, 'connector/package.json'), 'utf8')).version;
  assert.equal(manifest.name, 'laneconductor-lite');
  assert.equal(manifest.displayName, 'LaneConductor Lite');
  assert.equal(manifest.version, version, 'the same version as connector/package.json');
  assert.deepEqual(Object.keys(manifest).sort(), ['author', 'description', 'displayName', 'homepage', 'keywords', 'license', 'name', 'privacyPolicyUrl', 'repository', 'version']);
  assert.equal(manifest.documentationUrl, undefined);
  assert.equal(manifest.supportUrl, undefined);
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.mcpServers, undefined);
  assert.equal(manifest.privacyPolicyUrl, 'https://github.com/meller/laneconductor/blob/main/docs/privacy.md');
  assert.equal(PRIVACY_URL, manifest.privacyPolicyUrl);
  assert.match(manifest.description, /full/i, 'the description says the full plugin adds more');
  const info = pngInfo(fs.readFileSync(path.join(LITE, '.claude-plugin/icon.png')));
  assert.ok(info.ok && info.width === 1024 && info.height === 1024, JSON.stringify(info));
  assert.ok(fs.readFileSync(path.join(LITE, 'LICENSE')).equals(fs.readFileSync(path.join(REPO, 'LICENSE'))), 'LICENSE is the repository LICENSE');
  // The marketplace lists the full plugin only.
  const market = JSON.parse(fs.readFileSync(path.join(REPO, MARKETPLACE_REL), 'utf8'));
  assert.deepEqual(market.plugins.map((p) => p.name), ['laneconductor']);
  // The privacy page the manifest points at exists in this repository and says the true things.
  const privacy = fs.readFileSync(path.join(REPO, 'docs/privacy.md'), 'utf8');
  for (const must of ['laneconductor-lite', 'network requests', 'analytics', 'private by default']) assert.ok(privacy.toLowerCase().includes(must), `docs/privacy.md must mention ${must}`);
});

test('each emulated rule fires on a copy of Lite that breaks it', (t) => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-lite-rules-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  let n = 0;
  const broken = (mutate) => {
    const dir = path.join(tmp, `c${n++}`);
    fs.cpSync(LITE, dir, { recursive: true });
    mutate(dir);
    return checkLite(dir).join('\n');
  };
  const put = (rel, content) => (dir) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
  const edit = (rel, fn) => (dir) => { const f = path.join(dir, rel); fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8'))); };
  const manifestWith = (extra) => edit('.claude-plugin/plugin.json', (x) => JSON.stringify({ ...JSON.parse(x), ...extra }));
  const cases = [
    ['a .mjs file (conductor/providers.mjs was named by the portal)', put('conductor/providers.mjs', 'export {}\n'), /conductor\/providers\.mjs: file type not allowed/],
    ['a conductor/ folder', put('conductor/x.md', 'x\n'), /conductor: a program folder/],
    ['a server/ folder', put('server/x.md', 'x\n'), /server: a program folder/],
    ['a script file', put('scripts/run.sh', 'echo hi\n'), /run\.sh: script or program file/],
    ['a shebang in a text file', put('commands/x.md', '#!/usr/bin/env node\n'), /commands\/x\.md: has a #! line/],
    ['a shebang line inside a file', put('commands/x.md', '---\ndescription: x\n---\nbody\n#!/bin/sh\n'), /commands\/x\.md: has a #! line/],
    ['package.json', put('package.json', '{}\n'), /package\.json: package installs/],
    ['a lockfile', put('package-lock.json', '{}\n'), /package-lock\.json: package installs/],
    ['.npmrc', put('.npmrc', 'x=1\n'), /\.npmrc/],
    ['bunfig.toml', put('bunfig.toml', 'x=1\n'), /bunfig\.toml/],
    ['pnpm-workspace.yaml', put('pnpm-workspace.yaml', 'packages: []\n'), /pnpm-workspace\.yaml: package installs/],
    ['.mcp.json', put('.mcp.json', '{}\n'), /\.mcp\.json \(local MCP server\) is blocked/],
    ['a hooks folder', put('hooks/hooks.json', '{}\n'), /hooks are blocked/],
    ['.claude/skills inside', put('.claude/skills/x/SKILL.md', 'x\n'), /a \.claude folder/],
    ['another .claude-plugin folder', put('skills/laneconductor/.claude-plugin/plugin.json', '{}\n'), /a \.claude-plugin folder other than the plugin's own/],
    ['an extra file in .claude-plugin', put('.claude-plugin/marketplace.json', '{}\n'), /\.claude-plugin holds/],
    ['a manifest key off the list', manifestWith({ mcpServers: {} }), /key "mcpServers" is not on the allowed list/],
    ['dependencies in the manifest', manifestWith({ dependencies: ['x'] }), /key "dependencies"/],
    ['documentationUrl in the manifest (warned 2026-11-18)', manifestWith({ documentationUrl: 'https://example.org/' }), /key "documentationUrl"/],
    ['supportUrl in the manifest (warned 2026-11-18)', manifestWith({ supportUrl: 'https://example.org/' }), /key "supportUrl"/],
    ['isolation in an agent (blocked 2026-11-18)', edit('agents/track-runner.md', (x) => x.replace('color: green', 'isolation: worktree\ncolor: green')), /agents\/track-runner\.md: frontmatter key "isolation" is blocked/],
    ['another agent key off the list', edit('agents/plan-reviewer.md', (x) => x.replace('color: blue', 'color: blue\nmemory: project')), /agents\/plan-reviewer\.md: frontmatter key "memory" is not on the allowed list/],
    ['a frontmatter line that is not plain key: value', edit('agents/plan-reviewer.md', (x) => x.replace('color: blue', 'color: blue\n  tools:\n    - Read')), /frontmatter line is not a plain "key: value" line/],
    ['a command key off the list', edit('commands/plan.md', (x) => x.replace('description:', 'model: opus\ndescription:')), /commands\/plan\.md: frontmatter key "model"/],
    ['allowed-tools in the skill', edit('skills/laneconductor/SKILL.md', (x) => x.replace('argument-hint:', 'allowed-tools: Read, Grep\nargument-hint:')), /allowed-tools must be absent from the skill|frontmatter key "allowed-tools"/],
    ['allowed-tools Bash in a command', put('commands/x.md', '---\ndescription: x\nallowed-tools: Read, Bash\n---\nbody\n'), /commands\/x\.md: allowed-tools names Bash/],
    ['allowedTools Edit in an agent', put('agents/x.md', '---\nname: x\nallowedTools:\n  - Read\n  - Edit\n---\nbody\n'), /agents\/x\.md: allowedTools names Edit/],
    ['no icon', (dir) => fs.rmSync(path.join(dir, '.claude-plugin/icon.png')), /icon: .*missing/],
    ['a non-square icon', (dir) => { const f = path.join(dir, '.claude-plugin/icon.png'); const b = fs.readFileSync(f); b.writeUInt32BE(900, 20); fs.writeFileSync(f, b); }, /not square/],
    ['a corrupt icon', put('.claude-plugin/icon.png', 'not a png'), /not a valid PNG/],
    ['a short README', put('README.md', 'Too short.\n'), /README\.md: \d+ words/],
    ['no README', (dir) => fs.rmSync(path.join(dir, 'README.md')), /README\.md is missing/],
    ['no LICENSE', (dir) => fs.rmSync(path.join(dir, 'LICENSE')), /LICENSE is missing/],
    ['a NUL byte', put('commands/y.md', 'a\0b\n'), /commands\/y\.md: NUL byte/],
    ['invalid UTF-8', (dir) => fs.writeFileSync(path.join(dir, 'commands/z.md'), Buffer.from([0xff, 0xfe, 0x41])), /commands\/z\.md: not valid UTF-8/],
    ['a registry line', put('commands/r.md', 'registry=https://example.org/\n'), /commands\/r\.md: sets a package registry/],
    ['a pip index line', put('commands/p.md', 'pip install --index-url https://example.org/simple x\n'), /commands\/p\.md: sets a package registry/],
    ['a file over 256 KiB', put('commands/big.md', 'x'.repeat(257 * KIB)), /big\.md: \d+ bytes/],
    ['a symlink', (dir) => fs.symlinkSync('/etc/hostname', path.join(dir, 'link.md')), /link\.md: symlink/],
    ['a description over the budget', edit('skills/laneconductor/SKILL.md', (x) => x.replace(/^description: .*$/m, `description: ${'x'.repeat(1600)}`)), /over 1,536/],
  ];
  for (const [label, mutate, want] of cases) assert.match(broken(mutate), want, `rule "${label}" did not fire`);
  // And a copy with nothing broken is still clean (the copy itself introduces no problem).
  assert.equal(broken(() => {}), '');
});

test('more than 512 files is a problem', (t) => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-lite-many-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.cpSync(LITE, tmp, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'many'));
  for (let i = 0; i < 500; i += 1) fs.writeFileSync(path.join(tmp, 'many', `f${i}.md`), 'x\n');
  assert.match(checkLite(tmp).join('\n'), /files \(limit 512\)/);
});

test('no file of Lite is executable, starts with #!, or is over 256 KiB', () => {
  for (const rel of filesOf(LITE)) {
    const abs = path.join(LITE, rel);
    assert.ok(fs.statSync(abs).size < 256 * KIB, rel);
    assert.equal(fs.statSync(abs).mode & 0o111, 0, `${rel} is executable`);
    if (!IMAGE_EXT.test(rel)) assert.ok(!fs.readFileSync(abs, 'utf8').startsWith('#!'), `${rel} starts with #!`);
  }
});

test('Lite commands: the same set as the catalog, written for file editing, no connector tools and no board script', () => {
  const have = fs.readdirSync(path.join(LITE, 'commands')).map((f) => f.replace(/\.md$/, '')).sort();
  assert.deepEqual(have, CATALOG.map((c) => c.name).sort(), 'Lite has exactly the catalog commands');
  const offenders = [];
  for (const rel of filesOf(LITE).filter((r) => !IMAGE_EXT.test(r))) {
    const m = read(rel).match(CONNECTOR_NAMES);
    if (m) offenders.push(`${rel}: ${m[0]}`);
  }
  assert.deepEqual(offenders, [], 'no connector tool, connector or board script name anywhere in Lite');
  for (const a of ['plan-reviewer', 'track-runner']) {
    const fm = frontmatter(read(`agents/${a}.md`));
    assert.ok(!/^tools:.*mcp__/m.test(fm) && !/^isolation:/m.test(fm), `${a}: no connector tool in tools, no isolation`);
    assert.match(fm, /^tools: Read/m);
  }
  const runner = read('agents/track-runner.md');
  assert.match(runner, /git worktree add/, 'track-runner creates its own worktree');
  assert.match(runner, /Never merge\. Never push\./);
  assert.ok(runner.indexOf('git worktree add') < runner.indexOf('Read the laneconductor skill'), 'the worktree comes first');
  assert.match(read('commands/implement.md'), /laneconductor-lite:track-runner/);
  assert.ok(!/`\/?laneconductor:/.test(filesOf(LITE).map(read).join('\n')) , 'every slash command and subagent name is in the laneconductor-lite namespace');
});

test('the install commands: in FULL-PLUGIN.md, the README and the three board commands, exactly; people run them, Claude never does', () => {
  assert.deepEqual(FULL_INSTALL_COMMANDS, ['claude plugin marketplace add meller/laneconductor', 'claude plugin install laneconductor@laneconductor', '/reload-plugins']);
  assert.equal(LITE_UNINSTALL_COMMAND, 'claude plugin uninstall laneconductor-lite');
  const block = FULL_INSTALL_COMMANDS.join('\n');
  for (const rel of ['skills/laneconductor/FULL-PLUGIN.md', 'skills/laneconductor/ops/board.md', 'README.md', 'commands/board.md', 'commands/show-board.md', 'commands/refresh-board.md']) {
    const text = read(rel);
    assert.ok(text.includes(block), `${rel} holds the install commands exactly`);
    assert.ok(text.includes('https://github.com/meller/laneconductor'), `${rel} links the repository`);
    assert.ok(text.includes(LITE_UNINSTALL_COMMAND), `${rel} says to uninstall Lite first`);
  }
  for (const rel of ['commands/board.md', 'commands/show-board.md', 'commands/refresh-board.md']) {
    const text = read(rel);
    assert.match(text, /Do nothing else/);
    assert.match(text, /never run an install command yourself/i);
    assert.equal(text.split('\n---\n')[1].split('\n').length < 14, true, `${rel} stays short`);
  }
  const full = read('skills/laneconductor/FULL-PLUGIN.md');
  for (const must of ['board', 'conflict-checked writes', 'automatic commits', 'summary', 'secret and personal-data scan', 'advice log', 'health report', 'scaffold script', 'same skill', 'compatible']) {
    assert.ok(full.toLowerCase().includes(must), `FULL-PLUGIN.md must mention ${must}`);
  }
  assert.match(full, /never run them yourself/i);
  // Every install command Lite shows sits in a file that says who runs it; the skill's rules for mentioning it.
  const skill = read('skills/laneconductor/SKILL.md');
  const section = skill.slice(skill.indexOf('## The full plugin (mention it rarely)'));
  assert.ok(section.length > 0 && skill.indexOf('## The full plugin') > skill.indexOf('## Habits'));
  for (const must of ['board or dashboard', 'several sessions or people', 'overwrites', 'automatic commits', 'privacy scan', 'health report', 'Once per session', 'never nagging', 'NEVER run an install command yourself', 'FULL-PLUGIN.md']) {
    assert.ok(section.includes(must), `SKILL.md section must mention ${must}`);
  }
  assert.ok(section.split('\n').length < 12, 'the pointer section stays short');
  assert.ok(!/claude plugin install|marketplace add/.test(skill), 'SKILL.md itself holds no install command: FULL-PLUGIN.md is the one source');
  // Advice, not an instruction to run: no Lite file says to run an install command itself.
  for (const rel of filesOf(LITE).filter((r) => /\.md$/.test(r))) {
    assert.ok(!/\b(now|then|please)\s+run\s+`?claude plugin/i.test(read(rel)), `${rel} tells Claude to run an install command`);
  }
});

test('README: honest, over 40 words, says what it is and is not; no hard-coded command count; no claim of being in the directory', () => {
  const readme = read('README.md');
  const words = readme.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  assert.ok(words > 40 && words < 600, `${words} words`);
  assert.ok(!readme.includes('{{'), 'a template placeholder was left');
  const version = JSON.parse(fs.readFileSync(path.join(REPO, 'connector/package.json'), 'utf8')).version;
  assert.ok(readme.includes(`Version ${version}`));
  for (const must of ['Markdown only', 'makes no network requests', 'installs nothing', 'runs no scripts', 'no board', 'conflict-checked writes', 'Node.js', 'Elastic License 2.0', PRIVACY_URL]) {
    assert.ok(readme.includes(must), `README must mention ${must}`);
  }
  // No public text hard-codes how many commands there are (the number changes; the catalog is the source).
  for (const rel of filesOf(LITE).filter((r) => /\.md$/.test(r))) {
    assert.ok(!/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenty-\w+)\s+(slash\s+)?commands\b/i.test(read(rel)), `${rel} hard-codes a command count`);
  }
  // Never claim to be in the directory, or to be advertising: the listing must stand on its own.
  for (const rel of filesOf(LITE).filter((r) => /\.md$/.test(r))) {
    assert.ok(!/\b(listed|available|published|found)\s+(in|on)\s+(the\s+)?(anthropic|official|claude)[\w' ]*(directory|marketplace)/i.test(read(rel)), `${rel} claims a listing`);
  }
});
