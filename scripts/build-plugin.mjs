#!/usr/bin/env node
// Builds the LaneConductor plugins from their sources (tracks AM-10106 Phase 5c, AM-10115, and the two-tier split).
// Deterministic: no timestamps, sorted file order, every byte comes from a source file or a fixed template.
//
//   node scripts/build-plugin.mjs           rewrite plugins/laneconductor/, plugins/laneconductor-board/, plugins/laneconductor-connector/ and .claude-plugin/marketplace.json
//   node scripts/build-plugin.mjs --check   write nothing; exit 1 when the committed output differs
//
// THREE PLUGINS, one set of sources. The directory (Anthropic's plugin directory) accepts only Markdown, text, JSON, YAML
// and a few image types from a publisher that is not a Verified organization, and blocks local MCP servers, package
// installs, scripts, hooks and any `allowed-tools` beyond Read, Grep, Glob, LS. So:
//
//   LEAN       plugins/laneconductor             the main plugin, directory-eligible, Markdown/JSON/PNG only: the skill, the
//                                                 commands, the agents.
//   BOARD      plugins/laneconductor-board       local add-on (depends on the lean plugin): the board generator script and
//                                                 exactly the source files it imports. No package files, no MCP server.
//   CONNECTOR  plugins/laneconductor-connector   local, OPTIONAL add-on (depends on the lean plugin): the safe-writes MCP
//                                                 connector, its npm lockfile, later the hooks that match its tool names.
//
// The add-ons ship no skill and no commands (they depend on the lean plugin for those); they are not for the directory.
//
// Design: "agent-neutral core, Claude adapter" (see connector/ARCHITECTURE.md). Everything specific to Claude's plugin system
// (manifests, frontmatter transforms, commands, agents, the marketplace file) lives in this generator's profiles and in
// connector/plugin-extras/; the neutral core (track files, lane guides, recipes, connector/src, the MCP tool contract) does not.
// Each plugin is one adapter of that core.
//
// Sources                                   LEAN output (plugins/laneconductor/)
//   .claude/skills/laneconductor/**         skills/laneconductor/** (without legacy/, the parked daemon and database tier;
//                                            SKILL.md has its `allowed-tools` key deleted so Claude Code applies its normal
//                                            permission check and a Habits section appended; SKILL.md, setup/setup.md and
//                                            ops/board.md get explicit edits, see SKILL_EDITS)
//   connector/plugin-extras/{commands,agents}/**  commands/**, agents/** (slash commands and subagents)
//   connector/plugin-extras/icon.png        .claude-plugin/icon.png (all three plugins)
//   connector/PLUGIN-README.md              README.md ({{VERSION}} filled in)
//   LICENSE                                 LICENSE (Elastic License 2.0; named by `license` in plugin.json; all three)
//
//                                           BOARD output (plugins/laneconductor-board/)
//   connector/bin/lc-board.mjs              server/bin/lc-board.mjs
//   its relative imports, transitively      connector/src/x.mjs -> server/src/x.mjs; repo files outside connector/ at their
//     (+ src/board-page.html, read by URL)    repo-relative path (server/ stands in for connector/, so `../../conductor/x.mjs`
//                                            keeps resolving). No npm dependency: no package.json, no lockfile.
//   connector/BOARD-README.md               README.md
//
//                                           CONNECTOR output (plugins/laneconductor-connector/)
//   connector/bin/lc-connector.mjs          server/bin/lc-connector.mjs (NOT lc-board.mjs)
//   its relative imports, transitively      as above; connector/guides/** -> server/guides/** (read by path)
//   connector/package.json + lockfile       package.json + package-lock.json at the plugin ROOT (Claude Code installs
//                                            registry deps only from a root lockfile)
//   connector/CONNECTOR-README.md           README.md
//   (generated)                             .mcp.json
//
// Each add-on's .claude-plugin/plugin.json carries "dependencies": ["laneconductor"].
// Why a copy: only the plugin directory is installed, and symlinks leading outside it are rejected.
// Why server/ and not bin/: a top-level bin/ stops claude.ai and Cowork installing the plugin.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN_REL = 'plugins/laneconductor'; // the LEAN main plugin, directory-eligible
export const BOARD_REL = 'plugins/laneconductor-board'; // local add-on: the board generator
export const CONNECTOR_REL = 'plugins/laneconductor-connector'; // local, optional add-on: the safe-writes MCP connector
export const PLUGIN_RELS = [PLUGIN_REL, BOARD_REL, CONNECTOR_REL];
export const BOARD_NAME = 'laneconductor-board';
export const CONNECTOR_NAME = 'laneconductor-connector';
export const MARKETPLACE_REL = '.claude-plugin/marketplace.json';
const SKILL_SRC = '.claude/skills/laneconductor';
const AUTHOR = 'Asaf Meller';
const AUTHOR_URL = 'https://github.com/meller';
const REPO_URL = 'https://github.com/meller/laneconductor';
export const ICON_SRC = 'connector/plugin-extras/icon.png'; // made by scripts/make-icon.mjs; the human may replace it
// Plugin extras (track AM-10115): connector/plugin-extras/<dir>/ is copied verbatim to plugins/laneconductor/<dir>/
// (LEAN only: commands and subagents are Markdown, so the directory accepts them).
export const EXTRAS_SRC = 'connector/plugin-extras';
export const EXTRAS_DIRS = ['commands', 'agents'];
// EXTENSION POINTS for the hooks (track AM-10115 Phase 1). Hooks run commands and scripts, which the directory blocks, so they
// go into an add-on, never the lean plugin. Hooks that concern tracks and the board go into the BOARD add-on; hooks that
// match the connector's tool names go into the CONNECTOR add-on. Put the sources under
// connector/plugin-extras-board/<dir>/ or connector/plugin-extras-connector/<dir>/ (hooks/hooks.json and the scripts it
// names), add the directory names below, and add any plugin.json wiring in buildBoard / buildConnector. Nothing else in the
// generator needs to change; the directory-lean test keeps proving the lean plugin has none of it.
export const BOARD_EXTRAS_SRC = 'connector/plugin-extras-board';
export const BOARD_EXTRAS_DIRS = [];
export const CONNECTOR_EXTRAS_SRC = 'connector/plugin-extras-connector';
export const CONNECTOR_EXTRAS_DIRS = [];
// Claude Code's tool names for the connector: `mcp__plugin_<plugin name>_<server key>__<tool>` (the server key is `lc`: the plugin name already says connector).
export const CONNECTOR_TOOL_PREFIX = `mcp__plugin_${CONNECTOR_NAME}_lc__`;

// The plugin's skill does not ship the parked daemon-era tier (worker, syncdb, remote-sync, Postgres
// schema); it stays in the LaneConductor repository's own skill. Everything else is copied as is,
// except the exact edits below, which remove the pointers into the excluded folder. Each edit names
// the source text it replaces and the build throws when that text is gone, so a source change cannot
// silently leave a dead link in the plugin.
export const SKILL_EXCLUDE_DIRS = ['legacy'];
export const LEGACY_NOTE = 'Not in the plugin: the daemon-era tier (the `start`, `activate`, `stop`, `deactivate`, `lock`, `unlock`, '
  + '`syncdb` and `remote-sync` commands and the Postgres schema) is parked legacy. Its files live in the skill of the '
  + 'LaneConductor repository, not here; if the user asks for one of those commands, say so and stop.';
export const SKILL_EDITS = {
  'SKILL.md': [
    [
      '| `start`, `activate`, `stop`, `deactivate`, `lock`, `unlock` | [legacy/worker.md](legacy/worker.md) (also retries and logging) | only when named |\n'
      + '| `syncdb` | [legacy/syncdb.md](legacy/syncdb.md) | only when named |\n'
      + '| `remote-sync` | [legacy/remote-sync.md](legacy/remote-sync.md) | only when named |\n',
      '',
    ],
    ['The Postgres schema is in [legacy/db-schema.md](legacy/db-schema.md); read it only when asked.', LEGACY_NOTE],
  ],
  // The lean plugin does not ship server/bin/lc-board.mjs (it lives in the laneconductor-board plugin), so the
  // pointer to ${CLAUDE_PLUGIN_ROOT}/server/... would be dead. The add-on's copy is found by searching for it.
  'ops/board.md': [
    [
      'No `lc` on PATH but the LaneConductor plugin is installed: `node ${CLAUDE_PLUGIN_ROOT}/server/bin/lc-board.mjs --repo . --site "$site" --json`.\nNeither exists: say so and stop.',
      'No `lc` on PATH but the `laneconductor-board` plugin is installed: find its `server/bin/lc-board.mjs` (Glob `**/laneconductor-board/**/server/bin/lc-board.mjs` under `~/.claude/plugins`) and run `node <that path> --repo . --site "$site" --json`.\nNeither exists (the main `laneconductor` plugin alone cannot generate the board; `laneconductor-board` can): say so and stop.',
    ],
  ],
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

// The lean plugin has no hooks (hooks run scripts, which the directory blocks), so the few habits a hook would
// enforce are written into SKILL.md as plain rules. The add-on adds the hooks later; the lean text stays the fallback.
export const HABITS = `
## Habits (this plugin has no hooks)

- First time in a session the user starts track work or mentions tracks, lanes or the board, in a project that has \`conductor/tracks\`: give a 3-line status first (tracks in flight, anything waiting for the human, unpushed commits from \`git status -sb\`), reading the files directly if the optional connector is not installed. Once per session; never on unrelated prompts.
- When a lane finishes, offer exactly one next step in one line (update the board if \`laneconductor-board\` or \`lc\` is there, review the plan, move on) and wait. Do not act on it.
- The connector is optional. Change track markers with its tools when they exist (the \`laneconductor-connector\` plugin). Without them, re-read the file right before editing and change only the marker lines; never rewrite the whole file.
- Before any \`git push\`, say what will be pushed (branch, commits, files) and ask. This plugin cannot scan for secrets without scripts, so the check is yours.
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

/** Applies the explicit SKILL_EDITS for one skill file (path relative to the skill folder). */
export function transformSkillFile(rel, text, edits = SKILL_EDITS) {
  let out = text;
  for (const [from, to] of edits[rel] ?? []) {
    if (!out.includes(from)) throw new Error(`skill transform for ${rel}: source text not found (update SKILL_EDITS): ${JSON.stringify(from.slice(0, 80))}`);
    out = out.replace(from, () => to);
  }
  return out;
}

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

function walk(root, rel = '') {
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

/** Copies connector/plugin-extras/<dir>/** (or another extras root) into the plugin under the same directory name. */
function addExtras(c, repo, srcRoot, dirs) {
  for (const dir of dirs) {
    if (!fs.existsSync(path.join(repo, srcRoot, dir))) continue;
    for (const r of walk(path.join(repo, srcRoot, dir))) c.addFrom(`${srcRoot}/${dir}/${r}`, `${dir}/${r}`);
  }
}

/**
 * LEAN profile (plugins/laneconductor): directory-eligible. Markdown, JSON and one PNG only: the skill (without
 * `allowed-tools`, with the Habits section), the commands, the agents, README, LICENSE, manifest, icon.
 * No MCP server, no package files, no scripts, no hooks.
 */
function buildLean(repo) {
  const c = collector(repo);
  const pkg = readPkg(repo);

  // Skill: everything under the skill folder except the parked tier, with the explicit edits applied.
  for (const r of walk(path.join(repo, SKILL_SRC))) {
    if (SKILL_EXCLUDE_DIRS.some((d) => r.startsWith(`${d}/`))) continue;
    const dest = `skills/laneconductor/${r}`;
    c.addFrom(`${SKILL_SRC}/${r}`, dest);
    const f = c.files.get(dest);
    let text = f.content.toString('utf8');
    if (SKILL_EDITS[r]) text = transformSkillFile(r, text);
    if (r === 'SKILL.md') {
      // The directory allows only Read, Grep, Glob and LS in allowed-tools; the skill needs more, so the key is
      // dropped and Claude Code applies its normal permission check instead.
      text = `${removeFrontmatterKey(text, 'allowed-tools').replace(/\n*$/, '\n')}${HABITS}`;
    }
    f.content = Buffer.from(text);
  }

  addExtras(c, repo, EXTRAS_SRC, EXTRAS_DIRS);
  c.addFrom(ICON_SRC, '.claude-plugin/icon.png');
  c.add('README.md', fs.readFileSync(path.join(repo, 'connector/PLUGIN-README.md'), 'utf8').replaceAll('{{VERSION}}', pkg.version));
  c.addFrom('LICENSE', 'LICENSE');
  c.add('.claude-plugin/plugin.json', json({
    name: 'laneconductor',
    version: pkg.version,
    description: 'LaneConductor: the planning and delivery workflow for tracks kept as files in git. A skill, slash commands and two subagents; the connector is an optional add-on.',
    author: { name: AUTHOR, url: AUTHOR_URL },
    homepage: 'https://laneconductor.com',
    repository: REPO_URL,
    license: 'Elastic-2.0',
    keywords: ['laneconductor', 'tracks', 'planning', 'git'],
    documentationUrl: `${REPO_URL}/blob/main/connector/PLUGIN-README.md`,
    supportUrl: `${REPO_URL}/issues`,
  }));
  return c.files;
}

/**
 * Copies a server entry point and everything it reaches with a relative import (transitively) into the plugin: files under
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

const addonManifest = (pkg, { name, description, keywords, doc }) => json({
  name,
  version: pkg.version,
  description,
  author: { name: AUTHOR, url: AUTHOR_URL },
  homepage: 'https://laneconductor.com',
  repository: REPO_URL,
  license: 'Elastic-2.0',
  keywords,
  documentationUrl: `${REPO_URL}/blob/main/connector/${doc}`,
  supportUrl: `${REPO_URL}/issues`,
  // The add-ons ship no skill and no commands: Claude Code installs the main plugin together with them.
  dependencies: ['laneconductor'],
});

/**
 * BOARD profile (plugins/laneconductor-board): a local add-on, not for the directory. The board generator script and exactly the
 * source files it imports (board, board-docs, scan, summary, markers, tracks, blob, state-branch, errors, the page HTML and the
 * conductor/ folder resolver). It needs no npm package, so there is no package.json, no lockfile and no .mcp.json.
 * EXTENSION POINT: hooks that concern tracks and the board are added here (BOARD_EXTRAS_DIRS), track AM-10115 Phase 1.
 */
function buildBoard(repo) {
  const c = collector(repo);
  const pkg = readPkg(repo);
  addServer(c, repo, { entries: ['bin/lc-board.mjs'], assets: ['src/board-page.html'] });
  addExtras(c, repo, BOARD_EXTRAS_SRC, BOARD_EXTRAS_DIRS);
  c.addFrom(ICON_SRC, '.claude-plugin/icon.png');
  c.add('README.md', fs.readFileSync(path.join(repo, 'connector/BOARD-README.md'), 'utf8').replaceAll('{{VERSION}}', pkg.version));
  c.addFrom('LICENSE', 'LICENSE');
  c.add('.claude-plugin/plugin.json', addonManifest(pkg, {
    name: BOARD_NAME,
    description: 'Local add-on for the LaneConductor plugin: the board generator, a static page and data showing every track by lane. Needs a script that runs on your computer.',
    keywords: ['laneconductor', 'tracks', 'board', 'dashboard'],
    doc: 'BOARD-README.md',
  }));
  return c.files;
}

/**
 * CONNECTOR profile (plugins/laneconductor-connector): the OPTIONAL safe-writes connector, a local add-on, not for the
 * directory. The MCP server (without lc-board.mjs), its guides, the conductor/ helpers it imports, package.json + lockfile and
 * .mcp.json. EXTENSION POINT: hooks that match the connector's tool names are added here (CONNECTOR_EXTRAS_DIRS).
 */
function buildConnector(repo) {
  const c = collector(repo);
  const { add } = c;
  const pkg = readPkg(repo);
  const lock = JSON.parse(fs.readFileSync(path.join(repo, 'connector/package-lock.json'), 'utf8'));
  addServer(c, repo, { entries: ['bin/lc-connector.mjs'], dirs: ['guides'] });
  addExtras(c, repo, CONNECTOR_EXTRAS_SRC, CONNECTOR_EXTRAS_DIRS);

  // package.json + lockfile at the plugin root, derived from the connector's (runtime deps only).
  add('package.json', json({ name: CONNECTOR_NAME, version: pkg.version, type: pkg.type, dependencies: pkg.dependencies }));
  const packages = {};
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === '') {
      packages[''] = { name: CONNECTOR_NAME, version: pkg.version, dependencies: pkg.dependencies, engines: entry.engines };
      if (!entry.engines) delete packages[''].engines;
    } else if (!entry.dev) packages[key] = entry;
  }
  add('package-lock.json', json({ name: CONNECTOR_NAME, version: pkg.version, lockfileVersion: lock.lockfileVersion, requires: true, packages }));

  c.addFrom(ICON_SRC, '.claude-plugin/icon.png');
  add('README.md', fs.readFileSync(path.join(repo, 'connector/CONNECTOR-README.md'), 'utf8').replaceAll('{{VERSION}}', pkg.version));
  c.addFrom('LICENSE', 'LICENSE');
  add('.claude-plugin/plugin.json', addonManifest(pkg, {
    name: CONNECTOR_NAME,
    description: 'Optional local add-on for the LaneConductor plugin: an MCP connector that reads and writes tracks safely as git commits (conflict-checked writes, automatic commits, freshness warnings).',
    keywords: ['laneconductor', 'tracks', 'git', 'mcp'],
    doc: 'CONNECTOR-README.md',
  }));
  add('.mcp.json', json({
    mcpServers: {
      lc: {
        command: 'node',
        args: ['${CLAUDE_PLUGIN_ROOT}/server/bin/lc-connector.mjs'], // the repo comes from CLAUDE_PROJECT_DIR (Claude Code exports it), else the cwd
      },
    },
  }));
  return c.files;
}

/** Returns Map<pluginRelPath, { content: Buffer, exec: boolean }> for one profile: 'lean' (default), 'board' or 'connector'. */
export function buildPlugin(repo = REPO, profile = 'lean') {
  if (profile === 'lean') return buildLean(repo);
  if (profile === 'board') return buildBoard(repo);
  if (profile === 'connector') return buildConnector(repo);
  throw new Error(`unknown profile ${profile}`);
}

export function buildMarketplace() {
  return json({
    name: 'laneconductor',
    owner: { name: AUTHOR },
    description: 'LaneConductor plugins: the planning and delivery workflow plugin, and two optional local add-ons (the board and the safe-writes connector).',
    plugins: [
      {
        name: 'laneconductor',
        source: `./${PLUGIN_REL}`,
        description: 'The LaneConductor skill, slash commands and subagents for tracks kept as files in git. Markdown only.',
        author: { name: AUTHOR },
      },
      {
        name: BOARD_NAME,
        source: `./${BOARD_REL}`,
        description: 'Local add-on: the board generator, a static page of every track by lane. Needs a script that runs on your computer. Requires laneconductor.',
        author: { name: AUTHOR },
      },
      {
        name: CONNECTOR_NAME,
        source: `./${CONNECTOR_REL}`,
        description: 'Optional local add-on: the git-backed MCP connector (conflict-checked writes, automatic commits, freshness warnings). Requires laneconductor.',
        author: { name: AUTHOR },
      },
    ],
  });
}

/** Everything the generator owns, keyed by repo-relative path. */
export function buildAll(repo = REPO) {
  const out = new Map();
  for (const [rel, profile] of [[PLUGIN_REL, 'lean'], [BOARD_REL, 'board'], [CONNECTOR_REL, 'connector']]) {
    for (const [r, f] of buildPlugin(repo, profile)) out.set(`${rel}/${r}`, f);
  }
  out.set(MARKETPLACE_REL, { content: Buffer.from(buildMarketplace()), exec: false });
  return out;
}

/** Differences between a fresh build and what is on disk. Empty array means no drift. */
export function diffAgainstDisk(repo = REPO) {
  const want = buildAll(repo);
  const problems = [];
  for (const pluginRel of PLUGIN_RELS) {
    const pluginAbs = path.join(repo, pluginRel);
    const have = fs.existsSync(pluginAbs) ? walk(pluginAbs).map((r) => `${pluginRel}/${r}`) : [];
    for (const rel of have) if (!want.has(rel)) problems.push(`extra file: ${rel}`);
  }
  for (const [rel, f] of want) {
    const abs = path.join(repo, rel);
    if (!fs.existsSync(abs)) { problems.push(`missing: ${rel}`); continue; }
    if (!fs.readFileSync(abs).equals(f.content)) problems.push(`differs: ${rel}`);
    else if (((fs.statSync(abs).mode & 0o111) !== 0) !== f.exec) problems.push(`exec bit differs: ${rel}`);
  }
  return problems;
}

export function writeAll(repo = REPO) {
  const want = buildAll(repo);
  for (const pluginRel of PLUGIN_RELS) fs.rmSync(path.join(repo, pluginRel), { recursive: true, force: true });
  for (const [rel, f] of want) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, { mode: f.exec ? 0o755 : 0o644 });
    fs.chmodSync(abs, f.exec ? 0o755 : 0o644);
  }
  return want.size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const problems = diffAgainstDisk();
    if (problems.length) {
      process.stderr.write(`plugin output is out of date (run: node scripts/build-plugin.mjs):\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
      process.exit(1);
    }
    console.log(`${PLUGIN_RELS.join(', ')} and ${MARKETPLACE_REL} are up to date.`);
  } else {
    console.log(`wrote ${writeAll()} files under ${PLUGIN_RELS.join('/, ')}/ and ${MARKETPLACE_REL}`);
  }
}
