// Builds the LaneConductor plugin from its sources (tracks AM-10106 Phase 5c, AM-10115).
// Deterministic: no timestamps, sorted file order, every byte comes from a source file or a fixed template.
//
//   node scripts/build-plugin.mjs           rewrite plugins/laneconductor/ and .claude-plugin/marketplace.json (profile `full`)
//   node scripts/build-plugin.mjs --check   write nothing; exit 1 when the committed output differs
//   node scripts/build-plugin.mjs --profile lean --out <dir>
//                                           write the directory-eligible Markdown-only variant into <dir> (never inside plugins/)
//
// ONE PLUGIN, `laneconductor`, installed locally from the owner's marketplace (meller/laneconductor) or by uploading a zip
// (scripts/make-zip.mjs). Decision of the human, 2026-11-17: the connector is the main LaneConductor, so the plugin holds
// everything: the skill, the commands, the subagents, the local MCP connector, the board script and page, later the hooks.
// Anthropic's plugin directory is NOT being submitted: it accepts only Markdown, text, JSON, YAML and a few image types from a
// publisher that is not a Verified organization, and blocks local MCP servers, package installs, scripts, hooks and any
// `allowed-tools` beyond Read, Grep, Glob, LS. The directory-eligible variant is kept as an on-demand profile for when the
// remote connector exists:
//
//   FULL   (default, plugins/laneconductor)  everything below.
//   LEAN   (--profile lean --out <dir>)      Markdown, JSON and one PNG only: the skill, commands and agents (their `tools`
//                                            lists without connector tools), a fixed README, LICENSE, manifest, icon. Not in the
//                                            marketplace, not under plugins/; a test builds it into a temp dir and runs the
//                                            directory-emulation checks on it so that path stays alive.
//
// Design: "agent-neutral core, Claude adapter" (see connector/ARCHITECTURE.md). Everything specific to Claude's plugin system
// (manifests, frontmatter transforms, commands, agents, the marketplace file) lives in this generator's profiles and in
// connector/plugin-extras/; the neutral core (track files, lane guides, recipes, connector/src, the MCP tool contract) does not.
//
// Sources                                   FULL output (plugins/laneconductor/)
//   .claude/skills/laneconductor/**         skills/laneconductor/** (without legacy/, the parked daemon and database tier;
//                                            SKILL.md has its `allowed-tools` key deleted so Claude Code applies its normal
//                                            permission check and a Habits section appended; SKILL.md, setup/setup.md and
//                                            ops/board.md get explicit edits, see skillEdits)
//   connector/plugin-extras/{commands,agents}/**  commands/**, agents/** (slash commands and subagents)
//   connector/plugin-extras/icon.png        .claude-plugin/icon.png
//   connector/PLUGIN-README.md              README.md ({{VERSION}} filled in)
//   LICENSE                                 LICENSE (Elastic License 2.0; named by `license` in plugin.json)
//   connector/bin/lc-connector.mjs,         server/bin/lc-connector.mjs, server/bin/lc-board.mjs
//     connector/bin/lc-board.mjs
//   their relative imports, transitively    connector/src/x.mjs -> server/src/x.mjs; repo files outside connector/ at their
//     (+ src/board-page.html, guides/**)     repo-relative path (server/ stands in for connector/, so `../../conductor/x.mjs`
//                                            keeps resolving)
//   connector/package.json + lockfile       package.json + package-lock.json at the plugin ROOT (Claude Code installs
//                                            registry deps only from a root lockfile), runtime dependencies only
//   (generated)                             .mcp.json (stdio, server key `lc`), .claude-plugin/plugin.json
//
// Why a copy: only the plugin directory is installed, and symlinks leading outside it are rejected.
// Why server/ and not bin/: a top-level bin/ stops claude.ai and Cowork installing the plugin.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN_NAME = 'laneconductor';
export const PLUGIN_REL = 'plugins/laneconductor'; // the one plugin (profile `full`)
export const PLUGIN_RELS = [PLUGIN_REL];
export const PROFILES = ['full', 'lean'];
export const MARKETPLACE_REL = '.claude-plugin/marketplace.json';
const SKILL_SRC = '.claude/skills/laneconductor';
const AUTHOR = 'Asaf Meller';
const AUTHOR_URL = 'https://github.com/meller';
const REPO_URL = 'https://github.com/meller/laneconductor';
export const ICON_SRC = 'connector/plugin-extras/icon.png'; // made by scripts/make-icon.mjs; the human may replace it
// Plugin extras (track AM-10115): connector/plugin-extras/<dir>/ is copied verbatim to plugins/laneconductor/<dir>/
// (both profiles: commands and subagents are Markdown).
export const EXTRAS_SRC = 'connector/plugin-extras';
export const EXTRAS_DIRS = ['commands', 'agents'];
// EXTENSION POINT for the hooks (track AM-10115 Phase 1). Hooks run commands and scripts, so they are FULL-only: put the
// sources under connector/plugin-extras-full/<dir>/ (hooks/hooks.json and the scripts it names), add the directory names to
// FULL_EXTRAS_DIRS and any plugin.json wiring in buildFull. Nothing else in the generator needs to change; the lean profile
// (and its directory-emulation test) keeps proving the directory variant has none of it.
export const FULL_EXTRAS_SRC = 'connector/plugin-extras-full';
export const FULL_EXTRAS_DIRS = [];
// Claude Code's tool names for the connector: `mcp__plugin_<plugin name>_<server key>__<tool>` (the server key is `lc`).
export const CONNECTOR_TOOL_PREFIX = `mcp__plugin_${PLUGIN_NAME}_lc__`;

// The plugin's skill does not ship the parked daemon-era tier (worker, syncdb, remote-sync, Postgres
// schema); it stays in the LaneConductor repository's own skill. Everything else is copied as is,
// except the exact edits below, which remove the pointers into the excluded folder. Each edit names
// the source text it replaces and the build throws when that text is gone, so a source change cannot
// silently leave a dead link in the plugin.
export const SKILL_EXCLUDE_DIRS = ['legacy'];
export const LEGACY_NOTE = 'Not in the plugin: the daemon-era tier (the `start`, `activate`, `stop`, `deactivate`, `lock`, `unlock`, '
  + '`syncdb` and `remote-sync` commands and the Postgres schema) is parked legacy. Its files live in the skill of the '
  + 'LaneConductor repository, not here; if the user asks for one of those commands, say so and stop.';
const BOARD_SOURCE_LINE = 'No `lc` on PATH but the LaneConductor plugin is installed: `node ${CLAUDE_PLUGIN_ROOT}/server/bin/lc-board.mjs --repo . --site "$site" --json`.\nNeither exists: say so and stop.';
const BOARD_EDITS = {
  // FULL: the plugin ships its own board script. `${CLAUDE_PLUGIN_ROOT}` is substituted in skill text, but a command that
  // repeats this may not get it, so the search under ~/.claude/plugins is the fallback.
  full: 'No `lc` on PATH but the LaneConductor plugin is installed: run its own board script, `node ${CLAUDE_PLUGIN_ROOT}/server/bin/lc-board.mjs --repo . --site "$site" --json`. If that variable is not substituted, find the script (Glob `**/laneconductor/**/server/bin/lc-board.mjs` under `~/.claude/plugins`) and run `node <that path> --repo . --site "$site" --json`.\nNeither exists: say so and stop.',
  // LEAN: no scripts at all, so no board script; the pointer into server/ would be dead.
  lean: 'No `lc` on PATH: this variant of the plugin has no board script (it contains only Markdown). Say so and stop.',
};
export function skillEdits(profile = 'full') {
  return {
    'SKILL.md': [
      [
        '| `start`, `activate`, `stop`, `deactivate`, `lock`, `unlock` | [legacy/worker.md](legacy/worker.md) (also retries and logging) | only when named |\n'
        + '| `syncdb` | [legacy/syncdb.md](legacy/syncdb.md) | only when named |\n'
        + '| `remote-sync` | [legacy/remote-sync.md](legacy/remote-sync.md) | only when named |\n',
        '',
      ],
      ['The Postgres schema is in [legacy/db-schema.md](legacy/db-schema.md); read it only when asked.', LEGACY_NOTE],
    ],
    'ops/board.md': [[BOARD_SOURCE_LINE, BOARD_EDITS[profile]]],
    'setup/setup.md': [
      ["`setup/`, `deploy/` and\n`legacy/` subfolders travel with it.", '`setup/` and `deploy/`\nsubfolders travel with it.'],
      ['## Operating modes\n', '## Operating modes (`local-api` and `remote-api` belong to the parked database tier)\n'],
      ['## setup collection\n', '## setup collection (steps 2 and 3 apply only to the parked database tier)\n'],
      [
        'Create the schema with the SQL in `legacy/db-schema.md`\n   (`psql',
        'Create the schema with the SQL of the parked tier (`db-schema.md` in the LaneConductor repository\'s skill, not shipped in this plugin)\n   (`psql',
      ],
    ],
  };
}
export const SKILL_EDITS = skillEdits('full');

// No hooks ship yet (hooks run scripts, which the lean variant may never hold), so the few habits a hook would enforce are
// written into SKILL.md as plain rules. When the hooks ship, the hooks do this work and the section goes.
export const HABITS = `
## Habits (until hooks ship)

- First time in a session the user starts track work or mentions tracks, lanes or the board, in a project that has \`conductor/tracks\`: give a 3-line status first (tracks in flight, anything waiting for the human, unpushed commits from \`git status -sb\`), using the connector's tools or reading the files directly. Once per session; never on unrelated prompts.
- When a lane finishes, offer exactly one next step in one line (update the board, review the plan, move on) and wait. Do not act on it.
- The connector is included: change track markers with its tools (\`mcp__plugin_laneconductor_lc__*\`). If they are unavailable (its MCP server failed to start), re-read the file right before editing and change only the marker lines; never rewrite the whole file.
- Before any \`git push\`, say what will be pushed (branch, commits, files) and ask. Until hooks ship nothing scans for secrets automatically, so the check is yours.
`;
export const HABITS_LEAN = `
## Habits (this variant has no hooks and no connector)

- First time in a session the user starts track work or mentions tracks, lanes or the board, in a project that has \`conductor/tracks\`: give a 3-line status first (tracks in flight, anything waiting for the human, unpushed commits from \`git status -sb\`), reading the files directly. Once per session; never on unrelated prompts.
- When a lane finishes, offer exactly one next step in one line (review the plan, move on) and wait. Do not act on it.
- Re-read a track file right before editing it and change only the marker lines; never rewrite the whole file.
- Before any \`git push\`, say what will be pushed (branch, commits, files) and ask. Nothing here can scan for secrets, so the check is yours.
`;
export const HABITS_BY_PROFILE = { full: HABITS, lean: HABITS_LEAN };

// The README of the lean variant is a fixed text (the one source README, connector/PLUGIN-README.md, describes the full plugin).
const LEAN_README = `# LaneConductor (lean variant)

LaneConductor keeps a project's plans as plain files in git: one folder per track under
\`conductor/tracks/\`, holding \`index.md\` (state markers), \`spec.md\`, \`plan.md\`, \`test.md\` and
\`conversation.md\`. This variant teaches Claude the workflow for them: how to plan, implement, review,
quality-gate and merge a track, how to set LaneConductor up in a new project, and how to deploy.
It contains only Markdown, JSON and one icon: no program, no server, no hook, no connector and no board script.

Version {{VERSION}}.

It holds the skill, the slash commands (\`/laneconductor:<name>\`) and two subagents, \`track-runner\` and
\`plan-reviewer\`. Without the connector, Claude edits the track files directly, following the skill's file formats,
and asks before any merge or push. The skill declares no pre-approved tools, so nothing is allowed without your say.
The full plugin, with the local connector and the board generator, is built from the same sources.

## License and support

Elastic License 2.0; see [LICENSE](LICENSE). Questions and bugs: https://github.com/meller/laneconductor/issues
`;

/** Deletes one top-level key (a single line, or a line plus its indented continuation) from the leading YAML frontmatter. */
export function removeFrontmatterKey(text, key) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error('skill file has no frontmatter');
  const lines = m[1].split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i < 0) throw new Error(`frontmatter key ${key} not found (update the generator)`);
  let end = i + 1;
  while (end < lines.length && /^[ \t]/.test(lines[end])) end += 1;
  lines.splice(i, end - i);
  return `---\n${lines.join('\n')}\n---\n${text.slice(m[0].length)}`;
}

/** Applies the explicit edits for one skill file (path relative to the skill folder). */
export function transformSkillFile(rel, text, edits = SKILL_EDITS) {
  let out = text;
  for (const [from, to] of edits[rel] ?? []) {
    if (!out.includes(from)) throw new Error(`skill transform for ${rel}: source text not found (update the skill edits): ${JSON.stringify(from.slice(0, 80))}`);
    out = out.replace(from, () => to);
  }
  return out;
}

/** The lean variant holds no connector, so a subagent's `tools` list loses its `mcp__...` entries. */
export function stripMcpTools(text) {
  return text.replace(/^(tools:\s*)(.*)$/m, (_, k, v) => `${k}${v.split(',').map((t) => t.trim()).filter((t) => t && !t.startsWith('mcp__')).join(', ')}`);
}

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

export function walk(root, rel = '') {
  const out = [];
  for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.name === 'node_modules' || ent.name === '.DS_Store') continue;
    if (ent.isSymbolicLink()) throw new Error(`${path.join(root, r)} is a symlink; the plugin must hold real files`);
    if (ent.isDirectory()) out.push(...walk(root, r));
    else if (ent.isFile()) out.push(r);
  }
  return out;
}

/** Relative import specifiers (static `from '...'`, `import '...'`, `import('...')`) of a source file. */
function relativeImports(source) {
  const specs = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;
  for (let m; (m = re.exec(source));) specs.push(m[2]);
  return specs;
}

/** Collects generated files: Map<pluginRelPath, { content: Buffer, exec: boolean }>, plus where each one came from. */
function collector(repo) {
  const files = new Map();
  const srcOf = new Map(); // plugin-relative path -> repo-relative source path
  return {
    files,
    srcOf,
    addFrom(srcRel, destRel) {
      const abs = path.join(repo, srcRel);
      files.set(destRel, { content: fs.readFileSync(abs), exec: (fs.statSync(abs).mode & 0o111) !== 0 });
      srcOf.set(destRel, srcRel);
    },
    add: (rel, content) => files.set(rel, { content: Buffer.from(content), exec: false }),
  };
}

const readPkg = (repo) => JSON.parse(fs.readFileSync(path.join(repo, 'connector/package.json'), 'utf8'));

/** Copies connector/plugin-extras/<dir>/** (or another extras root) into the plugin under the same directory name; `transform(rel, text)` may rewrite text files. */
function addExtras(c, repo, srcRoot, dirs, transform = (_, t) => t) {
  for (const dir of dirs) {
    if (!fs.existsSync(path.join(repo, srcRoot, dir))) continue;
    for (const r of walk(path.join(repo, srcRoot, dir))) {
      c.addFrom(`${srcRoot}/${dir}/${r}`, `${dir}/${r}`);
      const f = c.files.get(`${dir}/${r}`);
      if (/\.md$/.test(r)) f.content = Buffer.from(transform(`${dir}/${r}`, f.content.toString('utf8')));
    }
  }
}

/** The parts both profiles share: the skill (edited per profile), commands, agents, icon, LICENSE and the manifest. */
function buildCommon(repo, profile) {
  const c = collector(repo);
  const pkg = readPkg(repo);
  const edits = skillEdits(profile);

  // Skill: everything under the skill folder except the parked tier, with the explicit edits applied.
  for (const r of walk(path.join(repo, SKILL_SRC))) {
    if (SKILL_EXCLUDE_DIRS.some((d) => r.startsWith(`${d}/`))) continue;
    const dest = `skills/laneconductor/${r}`;
    c.addFrom(`${SKILL_SRC}/${r}`, dest);
    const f = c.files.get(dest);
    let text = f.content.toString('utf8');
    if (edits[r]) text = transformSkillFile(r, text, edits);
    if (r === 'SKILL.md') {
      // The directory allows only Read, Grep, Glob and LS in allowed-tools; the skill needs more, so the key is
      // dropped and Claude Code applies its normal permission check instead (the same in both profiles).
      text = `${removeFrontmatterKey(text, 'allowed-tools').replace(/\n*$/, '\n')}${HABITS_BY_PROFILE[profile]}`;
    }
    f.content = Buffer.from(text);
  }

  addExtras(c, repo, EXTRAS_SRC, EXTRAS_DIRS, profile === 'lean' ? (rel, t) => (rel.startsWith('agents/') ? stripMcpTools(t) : t) : undefined);
  c.addFrom(ICON_SRC, '.claude-plugin/icon.png');
  c.addFrom('LICENSE', 'LICENSE');
  c.add('.claude-plugin/plugin.json', json({
    name: PLUGIN_NAME,
    version: pkg.version,
    description: profile === 'full'
      ? 'LaneConductor: the planning and delivery workflow for tracks kept as files in git. A skill, slash commands, subagents, a local MCP connector for safe track writes, and a board generator.'
      : 'LaneConductor: the planning and delivery workflow for tracks kept as files in git. A skill, slash commands and two subagents. Markdown only.',
    author: { name: AUTHOR, url: AUTHOR_URL },
    homepage: 'https://laneconductor.com',
    repository: REPO_URL,
    license: 'Elastic-2.0',
    keywords: ['laneconductor', 'tracks', 'planning', 'git'],
    documentationUrl: `${REPO_URL}/blob/main/connector/PLUGIN-README.md`,
    supportUrl: `${REPO_URL}/issues`,
  }));
  return { c, pkg };
}

/**
 * LEAN profile (built on demand, parked until the remote connector exists): directory-eligible. Markdown, JSON and one PNG only:
 * the skill, the commands, the agents (no connector tools in `tools`), a fixed README, LICENSE, manifest, icon.
 * No MCP server, no package files, no scripts, no hooks.
 */
function buildLean(repo) {
  const { c, pkg } = buildCommon(repo, 'lean');
  c.add('README.md', LEAN_README.replaceAll('{{VERSION}}', pkg.version));
  return c.files;
}

/**
 * Copies server entry points and everything they reach with a relative import (transitively) into the plugin: files under
 * connector/ land under server/ (server/ is connector/'s stand-in), repo files outside connector/ land at their repo-relative
 * path under the plugin root, which is what `../../` from server/src resolves to. `assets` are files read by path or URL
 * rather than imported (src/board-page.html, guides/), copied as they are.
 */
function addServer(c, repo, { entries, assets = [], dirs = [] }) {
  const { files, srcOf, addFrom } = c;
  const queue = [];
  for (const bin of entries) { addFrom(`connector/${bin}`, `server/${bin}`); queue.push(`server/${bin}`); }
  for (const a of assets) addFrom(`connector/${a}`, `server/${a}`);
  for (const dir of dirs) for (const r of walk(path.join(repo, 'connector', dir))) addFrom(`connector/${dir}/${r}`, `server/${dir}/${r}`);
  while (queue.length) {
    const rel = queue.shift();
    const srcRel = srcOf.get(rel);
    for (const spec of relativeImports(files.get(rel).content.toString('utf8'))) {
      const targetRel = path.relative(repo, path.resolve(repo, path.dirname(srcRel), spec)).split(path.sep).join('/');
      if (targetRel.startsWith('..')) throw new Error(`${srcRel} imports ${spec}, which leaves the repo`);
      if (!fs.existsSync(path.join(repo, targetRel))) throw new Error(`${srcRel} imports ${spec}, but ${targetRel} does not exist`);
      const destRel = targetRel.startsWith('connector/') ? `server/${targetRel.slice('connector/'.length)}` : targetRel;
      if (files.has(destRel)) continue;
      addFrom(targetRel, destRel);
      if (destRel.endsWith('.mjs')) queue.push(destRel);
    }
  }
}

/**
 * FULL profile (plugins/laneconductor, the default): everything in the lean plugin plus the local MCP connector and the board
 * script (server/bin/lc-connector.mjs, server/bin/lc-board.mjs, the files they import, the guides and the board page), the
 * conductor/ helpers they import, package.json + lockfile at the root, and .mcp.json.
 * EXTENSION POINT: the hooks are added here (FULL_EXTRAS_DIRS), track AM-10115 Phase 1.
 */
function buildFull(repo) {
  const { c, pkg } = buildCommon(repo, 'full');
  const lock = JSON.parse(fs.readFileSync(path.join(repo, 'connector/package-lock.json'), 'utf8'));
  addServer(c, repo, { entries: ['bin/lc-connector.mjs', 'bin/lc-board.mjs'], assets: ['src/board-page.html'], dirs: ['guides'] });
  addExtras(c, repo, FULL_EXTRAS_SRC, FULL_EXTRAS_DIRS);

  // package.json + lockfile at the plugin root, derived from the connector's (runtime deps only).
  c.add('package.json', json({ name: PLUGIN_NAME, version: pkg.version, type: pkg.type, dependencies: pkg.dependencies }));
  const packages = {};
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === '') {
      packages[''] = { name: PLUGIN_NAME, version: pkg.version, dependencies: pkg.dependencies, engines: entry.engines };
      if (!entry.engines) delete packages[''].engines;
    } else if (!entry.dev) packages[key] = entry;
  }
  c.add('package-lock.json', json({ name: PLUGIN_NAME, version: pkg.version, lockfileVersion: lock.lockfileVersion, requires: true, packages }));
  c.add('README.md', fs.readFileSync(path.join(repo, 'connector/PLUGIN-README.md'), 'utf8').replaceAll('{{VERSION}}', pkg.version));
  c.add('.mcp.json', json({
    mcpServers: {
      lc: {
        command: 'node',
        args: ['${CLAUDE_PLUGIN_ROOT}/server/bin/lc-connector.mjs'], // the repo comes from CLAUDE_PROJECT_DIR (Claude Code exports it), else the cwd
      },
    },
  }));
  return c.files;
}

/** Returns Map<pluginRelPath, { content: Buffer, exec: boolean }> for one profile: 'full' (default) or 'lean'. */
export function buildPlugin(repo = REPO, profile = 'full') {
  if (profile === 'full') return buildFull(repo);
  if (profile === 'lean') return buildLean(repo);
  throw new Error(`unknown profile ${profile} (expected one of ${PROFILES.join(', ')})`);
}

export function buildMarketplace() {
  return json({
    name: 'laneconductor',
    owner: { name: AUTHOR },
    description: 'LaneConductor: the planning and delivery workflow plugin, with its local connector and board.',
    plugins: [
      {
        name: PLUGIN_NAME,
        source: `./${PLUGIN_REL}`,
        description: 'The LaneConductor skill, slash commands and subagents, a local MCP connector for safe track writes, and the board generator, for tracks kept as files in git.',
        author: { name: AUTHOR },
      },
    ],
  });
}

/** Everything the generator owns, keyed by repo-relative path. */
export function buildAll(repo = REPO) {
  const out = new Map();
  for (const [r, f] of buildPlugin(repo, 'full')) out.set(`${PLUGIN_REL}/${r}`, f);
  out.set(MARKETPLACE_REL, { content: Buffer.from(buildMarketplace()), exec: false });
  return out;
}

/** Differences between a fresh build and what is on disk (everything under plugins/ is the generator's). Empty array means no drift. */
export function diffAgainstDisk(repo = REPO) {
  const want = buildAll(repo);
  const problems = [];
  const pluginsAbs = path.join(repo, 'plugins');
  const have = fs.existsSync(pluginsAbs) ? walk(pluginsAbs).map((r) => `plugins/${r}`) : [];
  for (const rel of have) if (!want.has(rel)) problems.push(`extra file: ${rel}`);
  for (const [rel, f] of want) {
    const abs = path.join(repo, rel);
    if (!fs.existsSync(abs)) { problems.push(`missing: ${rel}`); continue; }
    if (!fs.readFileSync(abs).equals(f.content)) problems.push(`differs: ${rel}`);
    else if (((fs.statSync(abs).mode & 0o111) !== 0) !== f.exec) problems.push(`exec bit differs: ${rel}`);
  }
  return problems;
}

function writeFiles(root, files) {
  for (const [rel, f] of files) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, { mode: f.exec ? 0o755 : 0o644 });
    fs.chmodSync(abs, f.exec ? 0o755 : 0o644);
  }
}

export function writeAll(repo = REPO) {
  const want = buildAll(repo);
  fs.rmSync(path.join(repo, 'plugins'), { recursive: true, force: true });
  writeFiles(repo, want);
  return want.size;
}

/** Writes one profile into an EMPTY or missing directory that is not inside the repo's plugins/ folder. Returns the file count. */
export function writeProfile(profile, outDir, repo = REPO) {
  const out = path.resolve(outDir);
  const rel = path.relative(path.join(repo, 'plugins'), out);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error(`refusing to write inside ${path.join(repo, 'plugins')}: that folder is the default build only`);
  if (fs.existsSync(out) && fs.readdirSync(out).length > 0) throw new Error(`${out} is not empty`);
  const files = buildPlugin(repo, profile);
  writeFiles(out, files);
  return files.size;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profile = arg('--profile') ?? 'full';
  const out = arg('--out');
  try {
    if (!PROFILES.includes(profile)) throw new Error(`unknown profile ${profile} (expected one of ${PROFILES.join(', ')})`);
    if (process.argv.includes('--check')) {
      if (profile !== 'full' || out) throw new Error('--check checks only the default build (profile full, no --out)');
      const problems = diffAgainstDisk();
      if (problems.length) {
        process.stderr.write(`plugin output is out of date (run: node scripts/build-plugin.mjs):\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
        process.exit(1);
      }
      console.log(`${PLUGIN_REL} and ${MARKETPLACE_REL} are up to date.`);
    } else if (profile !== 'full' || out) {
      if (!out) throw new Error(`profile ${profile} is not part of the default build: pass --out <dir> (outside plugins/)`);
      console.log(`wrote ${writeProfile(profile, out)} files (profile ${profile}) into ${path.resolve(out)}`);
    } else {
      console.log(`wrote ${writeAll()} files under ${PLUGIN_REL}/ and ${MARKETPLACE_REL}`);
    }
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}
