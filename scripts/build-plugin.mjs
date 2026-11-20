// Builds the three LaneConductor plugins from one set of sources (tracks AM-10106 Phase 5c, AM-10115, AM-10127, AM-10128).
// Deterministic: no timestamps, sorted file order, every byte comes from a source file or a fixed template.
//
//   node scripts/build-plugin.mjs           rewrite plugins/, .claude-plugin/marketplace.json and docs/plugin-map.md
//   node scripts/build-plugin.mjs --check   write nothing; exit 1 when the committed output differs (all three plugins, the marketplace
//                                           file and the plugin map)
//   node scripts/build-plugin.mjs --profile <base|parallel|board> --out <dir>
//                                           write one plugin into <dir> (never inside plugins/; the normal run already writes it there)
//
// THE THREE PLUGINS (decision of the human, 2026-11-18). Anthropic's plugin directory accepts only Markdown, text, JSON, YAML and a few
// image types from a publisher that is not a Verified organization; its Validate report on the old all-in-one plugin blocked the local MCP
// server (.mcp.json), package.json and the lockfile, every non-text file, the package.json `dependencies` field and the agent key
// `isolation`. So the product is three plugins from one generator, installed from the owner's marketplace (meller/laneconductor); only
// the first is submitted to the directory:
//
//   base      plugins/laneconductor           Markdown, JSON and one PNG only: the skill (edited to work by editing the track files), every
//                                             slash command, the read-only plan-reviewer subagent, README, ADD-ONS.md, LICENSE, a manifest
//                                             of fields the portal knows. No program, no .mcp.json, no package files, no `isolation`.
//   parallel  plugins/laneconductor-parallel  add-on: the connector (MCP server key `lc`), the scaffold script, package.json + lockfile at
//                                             the root, the track-runner subagent WITH `isolation: worktree`.
//   board     plugins/laneconductor-board     add-on: the board script and its page.
//
// No dependency between them: the base DETECTS the add-ons (the tools by their prefix, the agent by name, the board script by Glob), uses
// them when present and recommends nothing, and otherwise mentions an add-on once, only when relevant, showing the install commands and
// never running them. The interface (tool prefix, server key, script path, agent name) is in scripts/plugin-texts.mjs and
// connector/ARCHITECTURE.md. All slash commands live in the base (a plugin's slash prefix is its name); the add-ons ship no commands/.
//
// Design: "agent-neutral core, Claude adapter" (see connector/ARCHITECTURE.md). Everything specific to Claude's plugin system
// (manifests, frontmatter transforms, commands, agents, the marketplace file) lives here and in connector/plugin-extras/; the neutral core
// (track files, lane guides, connector/src, the MCP tool contract) does not.
//
// Sources                                   Output
//   .claude/skills/laneconductor/**         base: skills/laneconductor/** (without legacy/; SKILL.md has its `allowed-tools` key deleted,
//                                            Habits and Add-ons sections appended; explicit edits, see skillEdits in plugin-texts.mjs)
//   connector/src/commands.mjs (catalog)    base: commands/*.md, one per catalog entry (see renderBaseCommand)
//   connector/plugin-extras/agents/**       base: agents/plan-reviewer.md (connector tools stripped); parallel: agents/track-runner.md
//   connector/plugin-extras/readme/*.md     README.md of each plugin ({{VERSION}}, {{PLUGIN_MAP}}, install blocks filled in)
//   connector/plugin-extras/icon.png        .claude-plugin/icon.png (all three)
//   LICENSE                                 LICENSE (Elastic License 2.0; named by `license` in plugin.json)
//   connector/bin/lc-connector.mjs, lc-scaffold.mjs  parallel: server/bin/*; connector/bin/lc-board.mjs  board: server/bin/lc-board.mjs
//   their relative imports, transitively    connector/src/x.mjs -> server/src/x.mjs; repo files outside connector/ at their repo-relative
//     (+ board-page.html, guides/**)         path (server/ stands in for connector/, so `../../conductor/x.mjs` keeps resolving)
//   connector/package.json + lockfile       parallel: package.json + package-lock.json at the plugin ROOT, runtime dependencies only
//   (generated)                             parallel: .mcp.json; every plugin: .claude-plugin/plugin.json; docs/plugin-map.md
//
// Why a copy: only the plugin directory is installed, and symlinks leading outside it are rejected.
// Why server/ and not bin/: a top-level bin/ stops claude.ai and Cowork installing the plugin.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS, argumentHint, helpLines } from '../connector/src/commands.mjs';
import { INLINED_COMMANDS, inlineBody } from './plugin-inline.mjs';
import { buildSkillPacks, packMarketplaceEntries, packsMapSection, readPacks } from './build-skill-packs.mjs'; // the five skill packs (track AM-10129)
import { REFERENCES, REFERENCE_COMMANDS, BOARD_SCRIPT_COMMANDS, referenceBlock, withNotice } from './plugin-references.mjs';
import {
  ADD_ONS_MD, ADDONS, CATALOG_REL, RECOMMENDED, addonsReadmeBlock, installsNote, fullInstallBlock, AUTHOR, AUTHOR_URL, BASE_EXTRAS, BASE_HABITS, BASE_HELP_FOOTER, BASE_PROCEDURES, BOARD_SCRIPT_GLOB, BOARD_SCRIPT_REL, PLUGINS_CACHE, CONNECTOR_TOOL_PREFIX,
  DISPLAY, MARKETPLACE, MARKETPLACE_ADD_COMMAND, MARKETPLACE_SOURCE, MIGRATION_UNINSTALL_COMMAND, NAMES, PRIVACY_URL, PROFILES, RELOAD_COMMAND,
  RELS, REPO_URL, SCAFFOLD_SCRIPT_GLOB, SERVER_KEY, TRACK_RUNNER_AGENT, connectorLine, installBlock, installCommands, sessionInstallCommands, skillEdits, toolRef, toolsUsedBy,
  RECOMMEND_MARKER, setupRecommendBlock, frontDoorBlock, NEXT_JOURNEY, skillAdvisorReadmeBlock,
} from './plugin-texts.mjs';

export {
  ADD_ONS_MD, PLUGINS_CACHE, ADDONS, CATALOG_REL, RECOMMENDED, addonsReadmeBlock, installsNote, BASE_HABITS, BASE_PROCEDURES, BOARD_SCRIPT_GLOB, BOARD_SCRIPT_REL, CONNECTOR_TOOL_PREFIX, MARKETPLACE_ADD_COMMAND, MIGRATION_UNINSTALL_COMMAND,
  NAMES, PRIVACY_URL, PROFILES, RELOAD_COMMAND, RELS, REPO_URL, SCAFFOLD_SCRIPT_GLOB, SERVER_KEY, TRACK_RUNNER_AGENT, connectorLine, installBlock, installCommands, sessionInstallCommands, skillEdits,
  toolRef, toolsUsedBy, RECOMMEND_MARKER, setupRecommendBlock, frontDoorBlock, NEXT_JOURNEY,
};

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN_NAME = NAMES.base;
export const PLUGIN_REL = RELS.base; // the base: the plugin submitted to the directory
export const PARALLEL_REL = RELS.parallel;
export const BOARD_REL = RELS.board;
export const PLUGIN_RELS = PROFILES.map((p) => RELS[p]);
export const MARKETPLACE_REL = '.claude-plugin/marketplace.json';
export const PLUGIN_MAP_REL = 'docs/plugin-map.md'; // generated from the three folders and the command catalog
export const VERSIONS_REL = 'docs/plugin-versions.json'; // generated: every plugin's version, read live by the landing page so a release needs no site deploy
const SKILL_SRC = '.claude/skills/laneconductor';
export const ICON_SRC = 'connector/plugin-extras/icon.png'; // made by scripts/make-icon.mjs; the human may replace it
export const EXTRAS_SRC = 'connector/plugin-extras';
export const README_SRC = 'connector/plugin-extras/readme';
// The experimental, currently unmaintained daemon-era tier does not ship; it stays in the LaneConductor repository's own skill.
export const SKILL_EXCLUDE_DIRS = ['legacy'];
// Server entry points per plugin (their relative imports follow).
export const SERVER_ENTRIES = { parallel: ['bin/lc-connector.mjs', 'bin/lc-scaffold.mjs'], board: ['bin/lc-board.mjs'] };
export const SERVER_ASSETS = { parallel: [], board: ['src/board-page.html'] };
export const SERVER_DIRS = { parallel: ['guides'], board: [] };
// The board add-on's own command and hooks (track AM-10115 Phase 0): the base stays Markdown only, with no hooks.
export const BOARD_EXTRAS_SRC = 'connector/plugin-extras-board';
export const BOARD_EXTRAS = ['hooks/hooks.json', 'hooks/lc-board-hook.mjs'];
const AGENTS = { base: ['agents/plan-reviewer.md'], parallel: ['agents/track-runner.md'], board: [] };
const KEYWORDS = {
  base: ['laneconductor', 'tracks', 'planning', 'git'],
  parallel: ['laneconductor', 'tracks', 'worktrees', 'git', 'mcp'],
  board: ['laneconductor', 'tracks', 'board', 'git'],
};
const DESCRIPTIONS = {
  base: 'LaneConductor: the plan-first process for tracks kept as files in git, in Markdown only: a skill, slash commands and a read-only plan reviewer. Optional add-ons add parallel work in worktrees and a board.',
  parallel: 'LaneConductor Parallel: an add-on for LaneConductor. A local connector with conflict-checked track writes and automatic commits, and a track-runner subagent that works one track in its own git worktree.',
  board: 'LaneConductor Board: an add-on for LaneConductor. A script and page that build a board of every track by lane, which Claude publishes as a private artifact.',
};

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

/** Applies the explicit edits for one skill file (path relative to the skill folder). A missing anchor throws, so no edit is silently lost. */
export function transformSkillFile(rel, text, edits = skillEdits()) {
  let out = text;
  for (const [from, to] of edits[rel] ?? []) {
    const found = from instanceof RegExp ? from.test(out) : out.includes(from);
    if (!found) throw new Error(`skill transform for ${rel}: source text not found (update the skill edits): ${JSON.stringify(String(from).slice(0, 80))}`);
    out = out.replace(from, () => to);
  }
  return out;
}

/** The base holds no connector, so a subagent's `tools` list loses its `mcp__...` entries. */
export function stripMcpTools(text) {
  return text.replace(/^(tools:\s*)(.*)$/m, (_, k, v) => `${k}${v.split(',').map((t) => t.trim()).filter((t) => t && !t.startsWith('mcp__')).join(', ')}`);
}

/** The base's subagent: no connector tools in `tools`, no `isolation` key (the portal blocks it), no pointer to the connector. */
export function baseAgent(rel, text) {
  let out = stripMcpTools(text);
  if (/^isolation:/m.test(out)) out = removeFrontmatterKey(out, 'isolation');
  return transformSkillFile(rel, out, {
    'agents/plan-reviewer.md': [[
      ': with the connector\'s read-only tools (`get_track`, `get_context`) or, if they are unavailable, by Glob',
      ' by Glob',
    ]],
  });
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

// Per-plugin versions. Every plugin follows connector/package.json (the connector's version) unless connector/plugin-extras/versions.json
// names a version for its profile ({ "board": "1.10.0" }): then only that plugin, its README line and its marketplace entry take it. The base
// can stay byte-identical while an add-on is released on its own.
export const VERSIONS_SRC = `${EXTRAS_SRC}/versions.json`;
function versionOverrides(repo) {
  const abs = path.join(repo, VERSIONS_SRC);
  if (!fs.existsSync(abs)) return {};
  const v = JSON.parse(fs.readFileSync(abs, 'utf8'));
  for (const [k, x] of Object.entries(v)) {
    if (!PROFILES.includes(k) || !/^\d+\.\d+\.\d+$/.test(x)) throw new Error(`${VERSIONS_SRC}: ${JSON.stringify(k)}: ${JSON.stringify(x)} (keys are ${PROFILES.join(', ')}; values are semver)`);
  }
  return v;
}
/** The version of one plugin: its entry in versions.json, else connector/package.json. */
export const pluginVersion = (profile, repo = REPO) => versionOverrides(repo)[profile] ?? readPkg(repo).version;

/** Copies the named files of connector/plugin-extras/ (e.g. agents/plan-reviewer.md) into the plugin; `transform(rel, text)` rewrites Markdown. */
function addExtras(c, repo, rels, transform = (_, t) => t, src = EXTRAS_SRC) {
  for (const rel of rels) {
    c.addFrom(`${src}/${rel}`, rel);
    const f = c.files.get(rel);
    f.content = Buffer.from(transform(rel, f.content.toString('utf8')));
  }
}

// ---- The slash commands of the base, generated from the catalog ----
// What is Claude-only about a command lives here and in plugin-texts.mjs, not in the catalog: frontmatter, the sub-agent names, the
// Artifact tool, the board script lookup and the one line that names the add-on's tools. The procedures are written for file editing.

/** A frontmatter value, double-quoted when plain YAML would misread it. */
function yamlValue(v) {
  return /^[\[{*&!|>'"%@`#-]|: | #/.test(v) ? JSON.stringify(v) : v;
}

export { INLINED_COMMANDS, REFERENCES, REFERENCE_COMMANDS, BOARD_SCRIPT_COMMANDS };

/**
 * The base's command file for one catalog entry. Deterministic. `readSkill` (the shipped text of a skill file, by path inside the skill)
 * makes the front-door commands (INLINED_COMMANDS, track AM-10132) carry their whole procedure instead of pointing at a skill file.
 */
export function renderBaseCommand(cmd, readSkill = null) {
  const hint = argumentHint(cmd);
  const front = ['---', `description: ${yamlValue(cmd.description)}`, ...(hint ? [`argument-hint: ${yamlValue(hint)}`] : []), '---'];
  const procedure = BASE_PROCEDURES[cmd.name] ?? cmd.procedure;
  let body;
  if (readSkill && INLINED_COMMANDS.includes(cmd.name)) {
    body = inlineBody(cmd.name, readSkill);
  } else if (cmd.render === 'help') {
    body = `Show me this list as it is; run nothing else.\n\n${helpLines('LaneConductor commands. Say one in your own words, or use it as a slash command.').join('\n')}\n${BASE_HELP_FOOTER}`;
  } else if (cmd.args.length <= 1) {
    body = procedure.replace(/\{\{\w+\}\}/g, '`$ARGUMENTS`');
  } else {
    // Several arguments arrive as one string: name them in order and refer to them by name.
    const names = cmd.args.map((a) => a.hint ?? a.name).join(', then ');
    body = `Arguments: \`$ARGUMENTS\` (${names}).\n\n${procedure.replace(/\{\{(\w+)\}\}/g, '<$1>')}`;
  }
  const ref = readSkill ? referenceBlock(cmd.name, readSkill) : null;
  if (ref && !INLINED_COMMANDS.includes(cmd.name)) body = withNotice(body);
  const line = connectorLine(readSkill && INLINED_COMMANDS.includes(cmd.name) ? { ...cmd, procedure: `${cmd.procedure ?? ''}\n${[...body.matchAll(new RegExp(`${CONNECTOR_TOOL_PREFIX}(\\w+)`, 'g'))].map((m) => `\`${m[1]}\``).join(' ')}` } : cmd);
  const parts = [body, ...(BASE_EXTRAS[cmd.name] ?? []), ...(line ? [line] : []), ...(ref ? [ref] : [])];
  return `${front.join('\n')}\n${parts.join('\n\n')}\n`;
}

function manifest(profile, version) {
  // Only fields the directory portal knows (its Validate of 2026-11-18 warned about documentationUrl and supportUrl), plus the listing
  // field privacyPolicyUrl. The same shape for the add-ons, so one test emulates the portal for all three.
  return json({
    name: NAMES[profile],
    displayName: DISPLAY[profile],
    version,
    description: DESCRIPTIONS[profile],
    author: { name: AUTHOR, url: AUTHOR_URL },
    homepage: 'https://laneconductor.com',
    repository: REPO_URL,
    license: 'Elastic-2.0',
    keywords: KEYWORDS[profile],
    privacyPolicyUrl: PRIVACY_URL,
  });
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

/** The parts every plugin has: icon, LICENSE, manifest. */
function commonFiles(c, repo, profile, pkg) {
  c.addFrom(ICON_SRC, '.claude-plugin/icon.png');
  c.addFrom('LICENSE', 'LICENSE');
  c.add('.claude-plugin/plugin.json', manifest(profile, pluginVersion(profile, repo)));
}

/** BASE: Markdown, JSON and one PNG only. The README is added later (it embeds the plugin map, which is derived from these files). */
function buildBase(repo) {
  const c = collector(repo);
  const pkg = readPkg(repo);
  const edits = skillEdits();
  for (const r of walk(path.join(repo, SKILL_SRC))) {
    if (SKILL_EXCLUDE_DIRS.some((d) => r.startsWith(`${d}/`))) continue;
    const dest = `skills/laneconductor/${r}`;
    c.addFrom(`${SKILL_SRC}/${r}`, dest);
    const f = c.files.get(dest);
    let text = f.content.toString('utf8');
    if (edits[r]) text = transformSkillFile(r, text, edits);
    if (r === 'SKILL.md') {
      // The directory allows only Read, Grep, Glob and LS in allowed-tools; the skill needs more, so the key is dropped and Claude Code
      // applies its normal permission check instead.
      text = `${removeFrontmatterKey(text, 'allowed-tools').replace(/\n*$/, '\n')}${BASE_HABITS}`;
    }
    f.content = Buffer.from(text);
  }
  c.add('skills/laneconductor/ADD-ONS.md', ADD_ONS_MD);
  const readSkill = (r) => c.files.get(`skills/laneconductor/${r}`).content.toString('utf8');
  for (const cmd of COMMANDS) c.add(`commands/${cmd.name}.md`, renderBaseCommand(cmd, readSkill));
  addExtras(c, repo, AGENTS.base, baseAgent);
  commonFiles(c, repo, 'base', pkg);
  return c;
}

/** PARALLEL: the connector, the scaffold script, package.json + lockfile at the root, .mcp.json and the track-runner subagent. */
function buildParallel(repo) {
  const c = collector(repo);
  const pkg = readPkg(repo);
  const version = pluginVersion('parallel', repo);
  const lock = JSON.parse(fs.readFileSync(path.join(repo, 'connector/package-lock.json'), 'utf8'));
  addServer(c, repo, { entries: SERVER_ENTRIES.parallel, assets: SERVER_ASSETS.parallel, dirs: SERVER_DIRS.parallel });
  addExtras(c, repo, AGENTS.parallel);
  // package.json + lockfile at the plugin root, derived from the connector's (runtime deps only).
  const name = NAMES.parallel;
  c.add('package.json', json({ name, version, type: pkg.type, dependencies: pkg.dependencies }));
  const packages = {};
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === '') {
      packages[''] = { name, version, dependencies: pkg.dependencies, engines: entry.engines };
      if (!entry.engines) delete packages[''].engines;
    } else if (!entry.dev) packages[key] = entry;
  }
  c.add('package-lock.json', json({ name, version, lockfileVersion: lock.lockfileVersion, requires: true, packages }));
  c.add('.mcp.json', json({
    mcpServers: {
      [SERVER_KEY]: {
        command: 'node',
        args: ['${CLAUDE_PLUGIN_ROOT}/server/bin/lc-connector.mjs'], // the repo comes from CLAUDE_PROJECT_DIR (Claude Code exports it), else the cwd
      },
    },
  }));
  commonFiles(c, repo, 'parallel', pkg);
  return c;
}

/** BOARD: the board script and its page. No connector, no package files. */
function buildBoard(repo) {
  const c = collector(repo);
  const pkg = readPkg(repo);
  addServer(c, repo, { entries: SERVER_ENTRIES.board, assets: SERVER_ASSETS.board, dirs: SERVER_DIRS.board });
  addExtras(c, repo, BOARD_EXTRAS, undefined, BOARD_EXTRAS_SRC);
  commonFiles(c, repo, 'board', pkg);
  return c;
}

const BUILDERS = { base: buildBase, parallel: buildParallel, board: buildBoard };

// ---- The plugin map: what each plugin provides, derived from the generated folders and the catalog ----
const namesIn = (files, dir, ext = '.md') => [...files.keys()].filter((r) => r.startsWith(`${dir}/`) && r.endsWith(ext) && !r.slice(dir.length + 1).includes('/')).map((r) => r.slice(dir.length + 1, -ext.length)).sort();

/** Facts about one built plugin (Map of files, README not yet added). */
export function pluginFacts(profile, files) {
  const text = (r) => files.get(r)?.content.toString('utf8') ?? '';
  const agents = namesIn(files, 'agents').map((n) => ({ name: n, isolation: (text(`agents/${n}.md`).match(/^isolation: (.*)$/m) ?? [])[1] ?? null }));
  const hasConnector = files.has('server/bin/lc-connector.mjs');
  const tools = hasConnector
    ? [...files.keys()].filter((r) => /^server\/src\/tools\/[^/]+\.mjs$/.test(r)).flatMap((r) => [...text(r).matchAll(/^\s{2}name: '([a-z_]+)',$/gm)].map((m) => m[1])).sort()
    : [];
  return {
    profile,
    name: NAMES[profile],
    commands: namesIn(files, 'commands'),
    skills: [...new Set([...files.keys()].filter((r) => /^skills\/[^/]+\/SKILL\.md$/.test(r)).map((r) => r.split('/')[1]))].sort(),
    agents,
    tools,
    prompts: hasConnector ? COMMANDS.map((c) => c.name) : [],
    scripts: [...files.keys()].filter((r) => /^server\/bin\/[^/]+\.mjs$/.test(r)).map((r) => r.slice('server/bin/'.length)).sort(),
    hooks: files.has('hooks/hooks.json') ? Object.keys(JSON.parse(text('hooks/hooks.json')).hooks).sort() : [],
    program: files.has('.mcp.json') || [...files.keys()].some((r) => r.endsWith('.mjs')),
  };
}

const list = (names, fmt = (n) => `\`${n}\``) => (names.length ? names.map(fmt).join(', ') : 'none');

/** docs/plugin-map.md */
export function buildPluginMap(facts) {
  const [base, parallel, board] = PROFILES.map((p) => facts[p]);
  const L = [];
  L.push('# Plugin map', '');
  L.push('What each LaneConductor plugin provides, and which commands depend on which add-on. This file is generated by `node scripts/build-plugin.mjs` from the three generated plugin folders and the command catalog (`connector/src/commands.mjs`); do not edit it by hand.', '');
  L.push('## What each plugin provides', '');
  L.push(`| | \`${base.name}\` (base) | \`${parallel.name}\` (add-on) | \`${board.name}\` (add-on) |`, '| :--- | :--- | :--- | :--- |');
  const row = (label, f) => L.push(`| ${label} | ${PROFILES.map((p) => f(facts[p])).join(' | ')} |`);
  row('Slash commands', (f) => {
    if (f.profile === 'base') return `all of them, as \`/${f.name}:<name>\` (${f.commands.map((c) => `\`${c}\``).join(', ')})`;
    return f.commands.length ? `${f.commands.map((c) => `\`/${f.name}:${c}\``).join(', ')} only (the base commands detect the add-ons)` : 'none (the base commands detect the add-ons)';
  });
  row('Hooks', (f) => (f.hooks.length ? f.hooks.map((h) => `\`${h}\``).join(', ') : 'none'));
  row('Skills', (f) => list(f.skills));
  row('Agents', (f) => list(f.agents, (a) => `\`${a.name}\`${a.isolation ? ` (isolation: ${a.isolation})` : ''}`));
  row('MCP tools', (f) => (f.tools.length ? `${f.tools.map((t) => `\`${t}\``).join(', ')}; named \`${toolRef('<tool>')}\`` : 'none'));
  row('MCP prompts', (f) => (f.prompts.length ? `${f.prompts.map((p) => `\`${p}\``).join(', ')} (the command catalog, served by the connector)` : 'none'));
  row('Scripts', (f) => list(f.scripts, (s) => `\`server/bin/${s}\``));
  row('Files', (f) => (f.program ? 'Markdown, JSON, PNG and the program files above (not accepted by the directory portal)' : 'Markdown, JSON and one PNG only (what the directory portal accepts)'));
  row('Installs code', (f) => { const e = RECOMMENDED.find((x) => x.name === f.name); return e?.installs_code ? `yes: ${e.installs}` : 'no'; });
  row('Needs the others', () => 'no: each works alone');
  L.push('', 'The base is the plugin prepared for Anthropic\'s directory; the add-ons are installed from the marketplace `' + MARKETPLACE_SOURCE + '` only. No plugin depends on another: the base looks at what is installed (the tools by their prefix, the agent by name, the board script by Glob), uses it when present and recommends nothing; when it is missing it mentions the add-on once, only when relevant, shows the install commands and never runs them.', '');
  L.push('## Base commands and the add-ons', '');
  L.push(`| Command | Works alone | Uses \`${parallel.name}\` when present | Needs \`${board.name}\` |`, '| :--- | :---: | :--- | :--- |');
  for (const cmd of COMMANDS) {
    const tools = toolsUsedBy(cmd.procedure);
    const uses = [
      ...(tools.length ? [`its tools (${tools.map((t) => `\`${t}\``).join(', ')})`] : []),
      ...(['implement', 'review', 'run'].includes(cmd.name) ? [`the \`${parallel.agents[0]?.name ?? 'track-runner'}\` sub-agent`] : []),
      ...(cmd.name === 'new-project' ? ['its scaffold script'] : []),
    ].join(', ');
    const needs = cmd.needsBoardScript === 'always' ? 'yes' : cmd.needsBoardScript === 'refreshing' ? 'only to refresh' : '';
    L.push(`| \`${cmd.name}\` | ${needs === 'yes' ? 'no (shows how to get the add-on)' : 'yes'} | ${uses || 'nothing'} | ${needs || 'no'} |`);
  }
  L.push('');
  return L.join('\n');
}

/** The short version of the map embedded in every plugin README. */
export function shortMap(facts, profile = 'base') {
  const b = facts.base;
  const p = facts.parallel;
  const d = facts.board;
  return [
    '| Plugin | Provides |',
    '| :--- | :--- |',
    `| \`${b.name}\` (base) | the ${list(b.skills, (s) => `\`${s}\``)} skill, every slash command (\`/${b.name}:<name>\`), the ${list(b.agents.map((a) => a.name), (a) => `\`${a}\``)} subagent. Markdown only. |`,
    `| \`${p.name}\` (add-on) | the connector's tools (\`${CONNECTOR_TOOL_PREFIX}*\`) and MCP prompts, the ${list(p.agents.map((a) => a.name), (a) => `\`${a}\``)} subagent (one per track, in its own worktree), ${list(p.scripts.filter((s) => s !== 'lc-connector.mjs'), (s) => `\`${s}\``)}. No slash commands. |`,
    `| \`${d.name}\` (add-on) | ${list(d.scripts, (s) => `\`${s}\``)} and its page and hooks. No slash commands; refresh with \`/${b.name}:board refresh\`. |`,
  ].join('\n');
}

const fill = (text, vars) => text.replace(/\{\{(\w+)\}\}/g, (m, k) => { if (!(k in vars)) throw new Error(`README placeholder ${m} has no value`); return vars[k]; });

/** Builds the three plugins, the plugin map and the marketplace file. Returns { plugins: {profile: Map}, facts, map }. */
function buildEverything(repo) {
  const built = Object.fromEntries(PROFILES.map((p) => [p, BUILDERS[p](repo)]));
  const facts = Object.fromEntries(PROFILES.map((p) => [p, pluginFacts(p, built[p].files)]));
  const common = { PRIVACY_URL, ADDONS: addonsReadmeBlock(), FULL_INSTALL: fullInstallBlock(), NEXT_JOURNEY, SKILL_ADVISOR: skillAdvisorReadmeBlock() };
  for (const p of PROFILES) {
    const own = RECOMMENDED.find((e) => e.name === NAMES[p]);
    const vars = { ...common, PLUGIN_MAP: shortMap(facts, p), VERSION: pluginVersion(p, repo), INSTALL_SELF: own ? installBlock(p) : '', SELF_NOTE: own ? installsNote(p) : '' };
    built[p].add('README.md', fill(fs.readFileSync(path.join(repo, README_SRC, `${p}.md`), 'utf8'), vars));
  }
  return { plugins: Object.fromEntries(PROFILES.map((p) => [p, built[p].files])), facts, map: buildPluginMap(facts) };
}

/** Returns Map<pluginRelPath, { content: Buffer, exec: boolean }> for one profile: 'base', 'parallel' or 'board'. */
export function buildPlugin(repo = REPO, profile = 'base') {
  if (!PROFILES.includes(profile)) throw new Error(`unknown profile ${profile} (expected one of ${PROFILES.join(', ')})`);
  return buildEverything(repo).plugins[profile];
}

export function buildMarketplace(repo = REPO) {
  // A plugin with its own version (versions.json) carries it in its marketplace entry too (the manifest's version wins; the two are kept equal).
  const own = versionOverrides(repo);
  const ver = (profile) => (own[profile] ? { version: own[profile] } : {});
  return json({
    name: MARKETPLACE,
    owner: { name: AUTHOR },
    description: 'LaneConductor: the plan-first workflow for tracks kept as files in git, as a Markdown-only base plugin, two optional add-ons (parallel work and a board) and five skill packs.',
    plugins: [
      {
        name: NAMES.base,
        source: `./${RELS.base}`,
        description: 'LaneConductor: the skill, slash commands and a read-only plan reviewer for tracks kept as files in git. Markdown only; works on its own.',
        author: { name: AUTHOR },
      },
      {
        name: NAMES.parallel,
        source: `./${RELS.parallel}`,
        description: 'Add-on: parallel work in git worktrees with conflict-checked track writes (a local connector) and a track-runner subagent.',
        author: { name: AUTHOR },
        ...ver('parallel'),
      },
      {
        name: NAMES.board,
        source: `./${RELS.board}`,
        description: 'Add-on: the board script and page, a private snapshot of every track by lane; and opt-in hooks that keep it current. No commands: it is refreshed with /laneconductor:board refresh.',
        author: { name: AUTHOR },
        ...ver('board'),
      },
      ...packMarketplaceEntries(readPacks(repo)), // the skill packs, each with its own version
    ],
  });
}

/** Everything the generator owns, keyed by repo-relative path: the three plugins, the marketplace file and the plugin map. */
export function buildAll(repo = REPO) {
  const { plugins, map } = buildEverything(repo);
  const out = new Map();
  for (const p of PROFILES) for (const [r, f] of plugins[p]) out.set(`${RELS[p]}/${r}`, f);
  const packs = buildSkillPacks(repo);
  for (const [r, f] of packs.files) out.set(r, f);
  out.set(MARKETPLACE_REL, { content: Buffer.from(buildMarketplace(repo)), exec: false });
  out.set(PLUGIN_MAP_REL, { content: Buffer.from(map + packsMapSection(packs.packs)), exec: false });
  // The version of every plugin and skill pack, read from the manifests just built (the manifest is the truth), sorted by name.
  const versions = {};
  for (const [r, f] of out) {
    if (!/(^|\/)\.claude-plugin\/plugin\.json$/.test(r)) continue;
    const m = JSON.parse(f.content.toString());
    if (typeof m.name === 'string' && typeof m.version === 'string') versions[m.name] = m.version;
  }
  out.set(VERSIONS_REL, { content: Buffer.from(`${JSON.stringify({ note: 'Generated by scripts/build-plugin.mjs from the plugin manifests; do not edit.', versions: Object.fromEntries(Object.entries(versions).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`), exec: false });
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
  const profile = arg('--profile');
  const out = arg('--out');
  try {
    if (profile !== undefined && !PROFILES.includes(profile)) throw new Error(`unknown profile ${profile} (expected one of ${PROFILES.join(', ')})`);
    if (process.argv.includes('--check')) {
      if (profile !== undefined || out) throw new Error('--check checks only the default build (all three plugins, the marketplace file and the plugin map)');
      const problems = diffAgainstDisk();
      if (problems.length) {
        process.stderr.write(`plugin output is out of date (run: node scripts/build-plugin.mjs):\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
        process.exit(1);
      }
      console.log(`${PLUGIN_RELS.join(', ')}, ${MARKETPLACE_REL} and ${PLUGIN_MAP_REL} are up to date.`);
      console.log(`${readPacks().length} skill packs (scripts/skill-packs.json) are covered by the same check.`);
    } else if (profile !== undefined || out) {
      if (!profile) throw new Error('--out needs --profile <base|parallel|board>');
      if (!out) throw new Error(`profile ${profile}: pass --out <dir> (outside plugins/)`);
      console.log(`wrote ${writeProfile(profile, out)} files (profile ${profile}) into ${path.resolve(out)}`);
    } else {
      console.log(`wrote ${writeAll()} files under ${PLUGIN_RELS.join('/, ')}/, ${readPacks().length} skill packs under plugins/, ${MARKETPLACE_REL} and ${PLUGIN_MAP_REL}`);
    }
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}
