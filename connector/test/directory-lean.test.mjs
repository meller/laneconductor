// Emulates the rules Anthropic's plugin directory applies to a plugin from a publisher that is NOT a Verified organization,
// against the LEAN profile of the generator (`node scripts/build-plugin.mjs --profile lean --out <dir>`), built here into a
// temp dir. The directory submission is PARKED until the remote connector exists (decision of 2026-11-17: the shipped plugin
// is the one full plugin installed locally); this test keeps the directory-eligible variant alive and tested. The rules come
// from running the directory's own validation on the old single plugin (8 blocking, 3 warnings, 7 policy holds, 2026-11-17):
//   - only Markdown, text, JSON, YAML and PNG/JPEG/GIF/WebP/ICO files (plus a LICENSE file); no script or program files
//     (any .mjs, anything starting with `#!`); no package.json or lockfile installs; no package-manager config files;
//   - no local (stdio) MCP server (.mcp.json), no hooks, no `.claude/skills` folder inside, no `.claude-plugin` folder other
//     than the plugin's own; `allowed-tools` entries only from Read, Grep, Glob, LS; plugin.json keys from a plain allowed list;
//   - warning: a missing icon (square PNG, 512 to 2048 px, under 2 MB, at .claude-plugin/icon.png or via `icon` in plugin.json).
// NOT emulated (portal-only, see the final notes of track AM-10106 plan 5e): the portal's policy holds (a reviewer reads the
// listing), whether it also inspects subagent `tools:` lists, and its content scanners beyond the patterns below.
// `checkLean(dir)` returns the list of problems; the first test asserts it is empty for the real plugin, the others prove each
// rule fires on a copy of the plugin that breaks it.
import { test, after } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { REPO, PLUGIN_REL, writeProfile } from '../../scripts/build-plugin.mjs';

const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-lean-build-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const LEAN = path.join(TMP, 'laneconductor');
writeProfile('lean', LEAN);
const KIB = 1024;
const TEXT_EXT = /\.(md|markdown|txt|json|ya?ml)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|ico)$/i;
const ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'LS'];
const MANIFEST_KEYS = ['name', 'displayName', 'version', 'description', 'author', 'license', 'homepage', 'repository', 'keywords', 'documentationUrl', 'supportUrl', 'icon'];
const PACKAGE_FILES = /^(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|\.npmrc|\.yarnrc(\.yml)?|\.pnpmrc|bunfig\.toml|pnpm-workspace\.yaml)$/;
// A line that points a package manager at another registry.
const REGISTRY_LINE = /^\s*(?:@[\w.-]+:)?registry\s*=|\bnpm\s+config\s+set\b|--registry[= ]|\bindex-url\b|\bextra-index-url\b|\bnpmRegistryServer\b/im;

function entries(root, rel = '') {
  return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) return [{ rel: r, link: true }];
    return e.isDirectory() ? [{ rel: r, dir: true }, ...entries(root, r)] : [{ rel: r }];
  });
}

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

export function checkLean(dir) {
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
    if (text.startsWith('#!')) problems.push(`${rel}: starts with #! (a script)`);
    if (REGISTRY_LINE.test(text)) problems.push(`${rel}: sets a package registry`);
  }

  // allowed-tools in skills, commands and agents: Read, Grep, Glob, LS only; the skill declares none at all.
  for (const rel of files.filter((r) => /^(skills|commands|agents)\/.*\.md$/.test(r))) {
    const text = fs.readFileSync(path.join(dir, rel), 'utf8');
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

test('the lean build passes every emulated directory rule', () => {
  assert.deepEqual(checkLean(LEAN), []);
});

test('the lean build holds exactly the Markdown variant, and nothing else', () => {
  const files = entries(LEAN).filter((e) => !e.dir).map((e) => e.rel);
  const top = new Set(files.map((r) => r.split('/')[0]));
  assert.deepEqual([...top].sort(), ['.claude-plugin', 'LICENSE', 'README.md', 'agents', 'commands', 'skills']);
  assert.ok(files.includes('skills/laneconductor/SKILL.md') && files.includes('.claude-plugin/icon.png'));
  const manifest = JSON.parse(fs.readFileSync(path.join(LEAN, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'laneconductor');
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.mcpServers, undefined);
  assert.ok(files.length <= 512);
  const info = pngInfo(fs.readFileSync(path.join(LEAN, '.claude-plugin/icon.png')));
  assert.ok(info.ok && info.width === 1024 && info.height === 1024, JSON.stringify(info));
});

test('each emulated rule fires on a copy of the plugin that breaks it', (t) => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-lean-rules-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  let n = 0;
  const broken = (mutate) => {
    const dir = path.join(tmp, `c${n++}`);
    fs.cpSync(LEAN, dir, { recursive: true });
    mutate(dir);
    return checkLean(dir).join('\n');
  };
  const put = (rel, content) => (dir) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
  const cases = [
    ['a .mjs file', put('server/x.mjs', 'export {}\n'), /server\/x\.mjs: file type not allowed/],
    ['a script file', put('scripts/run.sh', 'echo hi\n'), /run\.sh: script or program file/],
    ['a shebang in a text file', put('commands/x.md', '#!/usr/bin/env node\n'), /commands\/x\.md: starts with #!/],
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
    ['a manifest key off the list', (dir) => { const f = path.join(dir, '.claude-plugin/plugin.json'); fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), mcpServers: {} })); }, /key "mcpServers" is not on the allowed list/],
    ['dependencies in the manifest', (dir) => { const f = path.join(dir, '.claude-plugin/plugin.json'); fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), dependencies: ['x'] })); }, /key "dependencies"/],
    ['allowed-tools in the skill', (dir) => { const f = path.join(dir, 'skills/laneconductor/SKILL.md'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('argument-hint:', 'allowed-tools: Read, Grep\nargument-hint:')); }, /allowed-tools must be absent from the skill/],
    ['allowed-tools Bash in a command', put('commands/x.md', '---\ndescription: x\nallowed-tools: Read, Bash\n---\nbody\n'), /commands\/x\.md: allowed-tools names Bash/],
    ['allowedTools Edit in an agent', put('agents/x.md', '---\nname: x\nallowedTools:\n  - Read\n  - Edit\n---\nbody\n'), /agents\/x\.md: allowedTools names Edit/],
    ['no icon', (dir) => fs.rmSync(path.join(dir, '.claude-plugin/icon.png')), /icon: .*missing/],
    ['a non-square icon', (dir) => { const f = path.join(dir, '.claude-plugin/icon.png'); const b = fs.readFileSync(f); b.writeUInt32BE(900, 20); fs.writeFileSync(f, b); }, /not square/],
    ['a corrupt icon', put('.claude-plugin/icon.png', 'not a png'), /not a valid PNG/],
    ['a short README', put('README.md', 'Too short.\n'), /README\.md: \d+ words/],
    ['a NUL byte', put('commands/y.md', 'a\0b\n'), /commands\/y\.md: NUL byte/],
    ['invalid UTF-8', (dir) => fs.writeFileSync(path.join(dir, 'commands/z.md'), Buffer.from([0xff, 0xfe, 0x41])), /commands\/z\.md: not valid UTF-8/],
    ['a registry line', put('commands/r.md', 'registry=https://example.org/\n'), /commands\/r\.md: sets a package registry/],
    ['a pip index line', put('commands/p.md', 'pip install --index-url https://example.org/simple x\n'), /commands\/p\.md: sets a package registry/],
    ['a file over 256 KiB', put('commands/big.md', 'x'.repeat(257 * KIB)), /big\.md: \d+ bytes/],
    ['a symlink', (dir) => fs.symlinkSync('/etc/hostname', path.join(dir, 'link.md')), /link\.md: symlink/],
    ['a description over the budget', (dir) => { const f = path.join(dir, 'skills/laneconductor/SKILL.md'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^description: .*$/m, `description: ${'x'.repeat(1600)}`)); }, /over 1,536/],
  ];
  for (const [label, mutate, want] of cases) assert.match(broken(mutate), want, `rule "${label}" did not fire`);
  // And a copy with nothing broken is still clean (the copy itself introduces no problem).
  assert.equal(broken(() => {}), '');
});

test('more than 512 files is a problem', (t) => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lc-lean-many-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.cpSync(LEAN, tmp, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'many'));
  for (let i = 0; i < 500; i += 1) fs.writeFileSync(path.join(tmp, 'many', `f${i}.md`), 'x\n');
  assert.match(checkLean(tmp).join('\n'), /files \(limit 512\)/);
});

test('every text file of the lean plugin is Markdown, JSON or LICENSE, none starts with #!, and every size is under 256 KiB', () => {
  for (const rel of entries(LEAN).filter((e) => !e.dir).map((e) => e.rel)) {
    const abs = path.join(LEAN, rel);
    assert.ok(fs.statSync(abs).size < 256 * KIB, rel);
    if (IMAGE_EXT.test(rel)) continue;
    assert.ok(/\.(md|json)$/.test(rel) || path.basename(rel) === 'LICENSE', `${rel}: unexpected type`);
    assert.ok(!fs.readFileSync(abs, 'utf8').startsWith('#!'), `${rel} starts with #!`);
    assert.equal(fs.statSync(abs).mode & 0o111, 0, `${rel} is executable`);
  }
});

test('lean build: agents name no connector tools, README and skill do not claim the connector or board script, the profile never touches plugins/', () => {
  for (const a of ['plan-reviewer', 'track-runner']) {
    const fm = fs.readFileSync(path.join(LEAN, `agents/${a}.md`), 'utf8').match(/^---\n([\s\S]*?)\n---\n/)[1];
    assert.ok(!/^tools:.*mcp__/m.test(fm), `${a}: lean tools list names a connector tool`);
    assert.match(fm, /^tools: Read/m);
  }
  const readme = fs.readFileSync(path.join(LEAN, 'README.md'), 'utf8');
  assert.match(readme, /no connector and no board script/);
  const habits = fs.readFileSync(path.join(LEAN, 'skills/laneconductor/SKILL.md'), 'utf8');
  assert.match(habits, /## Habits \(this variant has no hooks and no connector\)/);
  assert.ok(!fs.readFileSync(path.join(LEAN, 'skills/laneconductor/ops/board.md'), 'utf8').includes('${CLAUDE_PLUGIN_ROOT}/server'), 'no dead pointer to server/ in the lean skill');
  // The CLI refuses a lean build without --out, inside plugins/, or into a non-empty folder.
  const run = (...args) => spawnSync(process.execPath, [path.join(REPO, 'scripts/build-plugin.mjs'), ...args], { encoding: 'utf8' });
  assert.equal(run('--profile', 'lean').status, 1);
  assert.match(run('--profile', 'lean', '--out', path.join(REPO, PLUGIN_REL, 'x')).stderr, /refusing to write inside/);
  assert.match(run('--profile', 'lean', '--out', LEAN).stderr, /is not empty/);
  assert.match(run('--profile', 'lean', '--check').stderr, /--check checks only the default build/);
  const fresh = path.join(TMP, 'second');
  assert.equal(run('--profile', 'lean', '--out', fresh).status, 0);
  assert.deepEqual(checkLean(fresh), []);
});
