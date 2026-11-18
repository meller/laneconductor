// Builds the LaneConductor plugin from its sources (tracks AM-10106 Phase 5c, AM-10115).
// Deterministic: no timestamps, sorted file order, every byte comes from a source file or a fixed template.
//
//   node scripts/build-plugin.mjs           rewrite plugins/laneconductor/ (profile `full`), plugins/laneconductor-lite/ (profile `lite`)
//                                           and .claude-plugin/marketplace.json
//   node scripts/build-plugin.mjs --check   write nothing; exit 1 when the committed output differs (both plugins)
//   node scripts/build-plugin.mjs --profile lite --out <dir>
//                                           write the Lite plugin into <dir> (never inside plugins/; the normal run already writes it there)
//
// THE FULL PLUGIN, `laneconductor`, installed locally from the owner's marketplace (meller/laneconductor) or by uploading a zip
// (scripts/make-zip.mjs). Decision of the human, 2026-11-17: the connector is the main LaneConductor, so the plugin holds
// everything: the skill, the commands, the subagents, the local MCP connector, the board script and page. The hooks will be a
// second, separate plugin (`laneconductor-hooks`, not built yet, track AM-10115 Phase 1).
// Anthropic's plugin directory accepts only Markdown, text, JSON, YAML and a few image types from a publisher that is not a
// Verified organization. Its Validate report of 2026-11-18 on the full plugin blocked: the local MCP server (.mcp.json),
// package.json and the lockfile, every non-text file (conductor/providers.mjs was named), the `dependencies` field of
// package.json and the agent frontmatter key `isolation`; it warned about 2 unrecognized fields in plugin.json
// (documentationUrl, supportUrl). Decision of the human, 2026-11-18 (track AM-10127): the full plugin is not changed; a second,
// Markdown-only plugin, LaneConductor Lite, is built for the directory as a funnel, and points to the full plugin when
// something needs it (FULL-PLUGIN.md in its skill is the one source of that text).
//
//   FULL   (default, plugins/laneconductor)       everything below.
//   LITE   (plugins/laneconductor-lite, written by the normal run; `--profile lite --out <dir>` builds it elsewhere)
//                                                 Markdown, JSON and one PNG only: the skill (edited to work by editing the track
//                                                 files), commands written for file editing, agents without connector tools or
//                                                 `isolation`, README, FULL-PLUGIN.md, LICENSE, a manifest of known fields only,
//                                                 icon. NOT in the marketplace file, which lists the full plugin only.
//
// Design: "agent-neutral core, Claude adapter" (see connector/ARCHITECTURE.md). Everything specific to Claude's plugin system
// (manifests, frontmatter transforms, commands, agents, the marketplace file) lives in this generator's profiles and in
// connector/plugin-extras/; the neutral core (track files, lane guides, connector/src, the MCP tool contract) does not.
//
// Sources                                   FULL output (plugins/laneconductor/)
//   .claude/skills/laneconductor/**         skills/laneconductor/** (without legacy/, the parked daemon and database tier;
//                                            SKILL.md has its `allowed-tools` key deleted so Claude Code applies its normal
//                                            permission check and a Habits section appended; SKILL.md, setup/setup.md and
//                                            ops/board.md get explicit edits, see skillEdits)
//   connector/src/commands.mjs (the catalog)  commands/*.md, one per catalog entry (generated, see renderCommand; Claude's frontmatter,
//                                            sub-agent names, the Artifact tool and the fallback line are added here, the catalog is neutral)
//   connector/plugin-extras/agents/**       agents/** (subagents)
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
import { COMMANDS, GROUPS, argumentHint, helpText } from '../connector/src/commands.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN_NAME = 'laneconductor';
export const PLUGIN_REL = 'plugins/laneconductor'; // the full plugin (profile `full`), the only one in the marketplace
export const LITE_NAME = 'laneconductor-lite';
export const LITE_REL = 'plugins/laneconductor-lite'; // the Markdown-only plugin for the directory (profile `lite`)
export const PLUGIN_RELS = [PLUGIN_REL, LITE_REL];
export const PROFILES = ['full', 'lite'];
const NAMES = { full: PLUGIN_NAME, lite: LITE_NAME };
const RELS = { full: PLUGIN_REL, lite: LITE_REL };
export const MARKETPLACE_REL = '.claude-plugin/marketplace.json';
const SKILL_SRC = '.claude/skills/laneconductor';
const AUTHOR = 'Asaf Meller';
const AUTHOR_URL = 'https://github.com/meller';
const REPO_URL = 'https://github.com/meller/laneconductor';
export const ICON_SRC = 'connector/plugin-extras/icon.png'; // made by scripts/make-icon.mjs; the human may replace it
// Plugin extras (track AM-10115): connector/plugin-extras/<dir>/ is copied verbatim to plugins/laneconductor/<dir>/
// (both profiles: subagents are Markdown). The slash commands are NOT extras any more (track AM-10116): they are generated from
// the command catalog, connector/src/commands.mjs, which the connector also serves as MCP prompts.
export const EXTRAS_SRC = 'connector/plugin-extras';
export const EXTRAS_DIRS = ['agents'];
// EXTENSION POINT for anything that must stay inside the main plugin (nothing today): put sources under
// connector/plugin-extras-full/<dir>/, add the directory names to FULL_EXTRAS_DIRS and any plugin.json wiring in buildFull.
// The HOOKS do not go here: they will be a separate, opt-in extension plugin, `laneconductor-hooks` (dependencies:
// ["laneconductor"], scripts only, no package.json), because hooks run on every session and tool call and must be removable by
// uninstalling them. It is not built yet (track AM-10115 Phase 1); the marketplace has one entry until then.
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
// Server entry points of the full plugin (their relative imports follow): the connector, the board and the scaffold script.
export const SERVER_ENTRIES = [
  'bin/lc-connector.mjs', 'bin/lc-board.mjs', 'bin/lc-scaffold.mjs',
];
export const LEGACY_NOTE = 'Not in the plugin: the daemon-era tier (the `start`, `activate`, `stop`, `deactivate`, `lock`, `unlock`, '
  + '`syncdb` and `remote-sync` commands and the Postgres schema) is parked legacy. Its files live in the skill of the '
  + 'LaneConductor repository, not here; if the user asks for one of those commands, say so and stop.';
const BOARD_SOURCE_LINE = 'No `lc` on PATH but the LaneConductor plugin is installed: `node ${CLAUDE_PLUGIN_ROOT}/server/bin/lc-board.mjs --repo . --site "$site" --json`.\nNeither exists: say so and stop.';
const BOARD_EDITS = {
  // FULL: the plugin ships its own board script. `${CLAUDE_PLUGIN_ROOT}` is substituted in skill text, but a command that
  // repeats this may not get it, so the search under ~/.claude/plugins is the fallback.
  full: 'No `lc` on PATH but the LaneConductor plugin is installed: run its own board script, `node ${CLAUDE_PLUGIN_ROOT}/server/bin/lc-board.mjs --repo . --site "$site" --json`. If that variable is not substituted, find the script (Glob `**/laneconductor/**/server/bin/lc-board.mjs` under `~/.claude/plugins`) and run `node <that path> --repo . --site "$site" --json`.\nNeither exists: say so and stop.',
};
export function skillEdits(profile = 'full') {
  const shared = {
    'SKILL.md': [
      [
        '| `start`, `activate`, `stop`, `deactivate`, `lock`, `unlock` | [legacy/worker.md](legacy/worker.md) (also retries and logging) | only when named |\n'
        + '| `syncdb` | [legacy/syncdb.md](legacy/syncdb.md) | only when named |\n'
        + '| `remote-sync` | [legacy/remote-sync.md](legacy/remote-sync.md) | only when named |\n',
        '',
      ],
      ['The Postgres schema is in [legacy/db-schema.md](legacy/db-schema.md); read it only when asked.', LEGACY_NOTE],
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
  if (profile === 'full') return { ...shared, 'ops/board.md': [[BOARD_SOURCE_LINE, BOARD_EDITS.full]] };
  // LITE: no connector, no board script, no scripts at all. The skill points at nothing that is not in the plugin.
  shared['SKILL.md'].push(
    [
      '[ops/board.md](ops/board.md) (a private artifact showing every track by lane; Claude creates and refreshes it) | yes |',
      '[ops/board.md](ops/board.md) (needs the full plugin: say so and show how to get it) | yes |',
    ],
    [
      '**The board.** `board` (or "show the board", "update the board") gives the project one private page that\n'
      + 'shows every track by lane, with a needs-attention list. `lc board --site <dir>` writes the page and its\n'
      + 'data (and the documents of the tracks that are not done, shown when a track is opened); Claude then\n'
      + 'publishes them as an artifact and keeps its URL in `.laneconductor.json` (`board.artifact_url`). It is\n'
      + 'a snapshot: it changes only when Claude refreshes it. Sharing it shares those documents. Steps are in\n'
      + '[ops/board.md](ops/board.md).',
      '**The board.** The board (one private page showing every track by lane) is part of the full LaneConductor plugin, not of\n'
      + 'LaneConductor Lite. For `board`, `show the board` or `update the board`, follow [ops/board.md](ops/board.md): it says so,\n'
      + 'shows how to get the full plugin, and does nothing else.',
    ],
  );
  return {
    ...shared,
    'ops/tracks.md': [[
      '("Track spec forms"); the\nconnector\'s `create_track` with `track_kind` writes the same forms.',
      '("Track spec forms").',
    ]],
    'setup/templates.md': [[
      "; used by `ops/tracks.md`, and written by the connector's `create_track` with `track_kind`)",
      '; used by `ops/tracks.md`)',
    ]],
    'ops/working-a-track.md': [
      ['the `laneconductor:track-runner`', 'the `laneconductor-lite:track-runner`'],
      ['`/laneconductor:run N`, `:implement N` and `:review N` do this.', '`/laneconductor-lite:run N`, `:implement N` and `:review N` do this.'],
    ],
    'ops/new-project.md': [
      ['# new-project: `/laneconductor:new-project [name or idea]`', '# new-project: `/laneconductor-lite:new-project [name or idea]`'],
      [
        'Scripts named below live in the plugin under `server/bin/` (find them with Glob `**/laneconductor/**/server/bin/<name>`\n'
        + 'under `~/.claude/plugins`; `${CLAUDE_PLUGIN_ROOT}` may not be substituted in command text) or in the LaneConductor\n'
        + 'repository under `connector/bin/`. If a script does not exist (the Markdown-only variant has none), do that step by hand\n'
        + 'exactly as described; the result is the same, only slower.',
        'This plugin has no scripts: do every step below by hand, exactly as described.',
      ],
      ['as the JSON that\n`lc-scaffold` reads:', 'as a short list with these fields:'],
      [
        'Run `node <path>/lc-scaffold.mjs --answers <answers.json> --dir . --dry-run`, show what it would create and skip, and ask\n'
        + 'for a yes; after the yes run it again without `--dry-run`. By hand, the same result: the files and templates are in',
        'Show what you would create and what you would skip, and ask for a yes; after the yes create the files. The files and templates are in',
      ],
      [
        '`lc-scaffold` writes it.\nWhen the connector is present and the project already has its `conductor/` files, create further tracks with\n'
        + '`create_track`; otherwise write the files as `ops/tracks.md` describes.',
        'Write its files as `ops/tracks.md` describes; create any further tracks the same way.',
      ],
    ],
  };
}
export const SKILL_EDITS = skillEdits('full');

// No hooks ship yet (they will be the separate `laneconductor-hooks` extension), so the few habits a hook would enforce are
// written into SKILL.md as plain rules. When the hooks extension ships, the hooks do this work and the section goes.
export const HABITS = `
## Habits (until the hooks extension ships)

- First time in a session the user starts track work or mentions tracks, lanes or the board, in a project that has \`conductor/tracks\`: give a 3-line status first (tracks in flight, anything waiting for the human, unpushed commits from \`git status -sb\`), using the connector's tools or reading the files directly. Once per session; never on unrelated prompts.
- When a lane finishes, offer exactly one next step in one line (update the board, review the plan, move on) and wait. Do not act on it.
- The connector is included: change track markers with its tools (\`mcp__plugin_laneconductor_lc__*\`). If they are unavailable (its MCP server failed to start), re-read the file right before editing and change only the marker lines; never rewrite the whole file.
- Before any \`git push\`, say what will be pushed (branch, commits, files) and ask. Until the hooks extension ships nothing scans for secrets automatically, so the check is yours.
`;
// ---- LaneConductor Lite: the texts that are not copied from a source file ----
// ONE SOURCE for the way to get the full plugin: these commands appear in FULL-PLUGIN.md, the README, the board commands and
// ops/board.md of Lite. They are shown to the person, who runs them; Lite never tells Claude to run them.
export const FULL_INSTALL_COMMANDS = ['claude plugin marketplace add meller/laneconductor', 'claude plugin install laneconductor@laneconductor', '/reload-plugins'];
export const LITE_UNINSTALL_COMMAND = 'claude plugin uninstall laneconductor-lite';
export const FULL_PLUGIN_URL = REPO_URL; // https://github.com/meller/laneconductor
export const PRIVACY_URL = `${REPO_URL}/blob/main/docs/privacy.md`;
const INSTALL_BLOCK = `\`\`\`\n${FULL_INSTALL_COMMANDS.join('\n')}\n\`\`\``;

export const LITE_HABITS = `
## Habits (this plugin has no hooks and no connector)

- First time in a session the user starts track work or mentions tracks, lanes or the board, in a project that has \`conductor/tracks\`: give a 3-line status first (tracks in flight, anything waiting for the human, unpushed commits from \`git status -sb\`), reading the files directly. Once per session; never on unrelated prompts.
- When a lane finishes, offer exactly one next step in one line (review the plan, move on) and wait. Do not act on it.
- Re-read a track file right before editing it and change only the marker lines; never rewrite the whole file.
- Before any \`git push\`, say what will be pushed (branch, commits, files) and ask. Nothing here can scan for secrets, so the check is yours.

## The full plugin (mention it rarely)

LaneConductor Lite is complete on its own. Only when the person asks for a board or dashboard, says that several sessions or people edit the same tracks or worries about overwrites, or asks for automatic commits, a privacy scan or a health report, say in one or two sentences that the full plugin adds that, and read [FULL-PLUGIN.md](FULL-PLUGIN.md) for what it adds and how to get it. Once per session, as an option, never nagging; if the person declines, do not bring it up again. NEVER run an install command yourself: show it and let the person run it.
`;
export const HABITS_BY_PROFILE = { full: HABITS, lite: LITE_HABITS };

/** skills/laneconductor/FULL-PLUGIN.md of Lite: what the full plugin adds and how to get it. The single source for those words. */
export const FULL_PLUGIN_MD = `# The full LaneConductor plugin

LaneConductor Lite is the whole plan-first process in Markdown, and it works on its own. The full plugin, \`laneconductor\`, is an
optional upgrade for people who want more than Markdown can do. Mention it only when it is relevant (see "The full plugin" at the
end of SKILL.md), at most once per session, in a sentence or two, as an option.

## What the full plugin adds

- A board: one private dashboard of every track by lane, with a needs-attention list. Claude publishes it as a snapshot only with the
  person's approval; it is private by default.
- Conflict-checked writes: a local connector changes track files only against the commit it last read, so two sessions or two people
  cannot silently overwrite each other.
- Automatic commits of the track changes it makes.
- A generated summary of all tracks.
- A secret and personal-data scan of what the board would publish.
- An advice log and a health report that show whether the lane guides are earning their place.
- A scaffold script for starting a new project.

It runs a local Node.js program (the connector), which LaneConductor Lite does not. Track files written by one work with the other.

## How to get it

Show these commands to the person. The person runs them; never run them yourself.

First uninstall LaneConductor Lite, because both plugins contain the same skill:

\`\`\`
${LITE_UNINSTALL_COMMAND}
\`\`\`

Then install the full plugin:

${INSTALL_BLOCK}

The track files stay compatible: nothing in \`conductor/\` needs to change. More: ${FULL_PLUGIN_URL}
`;

/** skills/laneconductor/ops/board.md of Lite: the board needs the full plugin; this file does nothing else. */
export const LITE_BOARD_MD = `# board: needs the full plugin

For "board", "show the board", "update the board", "refresh the board" or \`/laneconductor-lite:board\`.

The board, a private dashboard of every track by lane, is part of the full LaneConductor plugin. LaneConductor Lite does not
include it. Say that in a sentence or two, then show the person how to get the full plugin (the commands are in
[../FULL-PLUGIN.md](../FULL-PLUGIN.md); show them as written):

${INSTALL_BLOCK}

The person runs these, after \`${LITE_UNINSTALL_COMMAND}\`. Do nothing else: do not look for a board, do not generate or build one,
do not publish anything, and never run an install command yourself. If the person only wants an overview, offer to list the tracks
by lane from their \`index.md\` files instead. More: ${FULL_PLUGIN_URL}
`;

// The README of Lite is a fixed text (the one source README, connector/PLUGIN-README.md, describes the full plugin).
const LITE_README = `# LaneConductor Lite

LaneConductor Lite teaches Claude a plan-first way of working on a project whose plans are plain files in git: one folder per track
under \`conductor/tracks/\`, holding \`index.md\` (state markers), \`spec.md\`, \`plan.md\`, \`test.md\` and \`conversation.md\`. It
covers how to plan, implement, review, quality-gate and merge a track, how to set LaneConductor up in a new project, and how to deploy.

Version {{VERSION}}.

## What it is, and what it is not

It is Markdown only: a skill, slash commands (\`/laneconductor-lite:<name>\`) and two subagents, \`track-runner\` and \`plan-reviewer\`.
Claude edits the track files directly, following the skill's file formats, and asks before any merge or push. It declares no
pre-approved tools, so nothing is allowed without your say.

LaneConductor Lite makes no network requests, installs nothing and runs no scripts. It contains no program, no server and no hook. It has no board.

## The full plugin

The full plugin, \`laneconductor\`, adds a board (a private dashboard of every track by lane), conflict-checked writes so two sessions or
people cannot overwrite each other, automatic commits, a generated track summary, a secret and personal-data scan, an advice log and
a health report, and a scaffold script. It runs a local Node.js program. Lite is complete without it.

To get it, uninstall Lite first (both contain the same skill; your track files stay compatible), then run these yourself:

\`\`\`
${LITE_UNINSTALL_COMMAND}
${FULL_INSTALL_COMMANDS.join('\n')}
\`\`\`

More: ${FULL_PLUGIN_URL}

## License, privacy and support

Elastic License 2.0; see [LICENSE](LICENSE). Privacy: ${PRIVACY_URL}. Questions and bugs: ${FULL_PLUGIN_URL}/issues
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

/** Lite holds no connector, so a subagent's `tools` list loses its `mcp__...` entries. */
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

// ---- Slash commands, generated from the catalog (track AM-10116, REQ-3) ----
// What is Claude-only about a command lives here, not in the catalog: frontmatter, the sub-agent names, the Artifact tool, the
// board script lookup, and the fallback line for when the connector's tools are unavailable.
export const FALLBACK_LINE = `Use the connector's tools (\`${CONNECTOR_TOOL_PREFIX}*\`) when they are present. If the connector's tools are unavailable (its MCP server failed to start), do the same by editing the track files directly, following the skill's \`ops/tracks.md\` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.`;
const SUBAGENT_NOTE = 'In Claude Code the sub-agent is `laneconductor:track-runner`, one per track, each in its own worktree. See "Plugin users" in the skill\'s `ops/working-a-track.md`.';
const BOARD_SCRIPT_NOTE = 'Generating the board needs the plugin\'s own board script or the `lc` command on PATH. The script is `server/bin/lc-board.mjs` in this plugin: find it with Glob `**/laneconductor/**/server/bin/lc-board.mjs` under `~/.claude/plugins` (the `${CLAUDE_PLUGIN_ROOT}` variable may not be substituted in command text) and run `node <that path> --repo . --site "$site" --json`, or use `lc board --site "$site" --json` when `lc` is on PATH. If neither exists, say so plainly and stop; do not try to build the page by hand.';
const PUBLISH_NOTE = 'Only Claude can publish an artifact (the Artifact tool, actions `read`, `list`, `publish`); no connector tool does it, so this is your job.';
const OPEN_NOTE = 'Open it with the Artifact tool, action `open`, with the stored URL, and give me the link. Never call `publish` or regenerate anything here.';
export const CLAUDE_EXTRAS = {
  implement: [SUBAGENT_NOTE],
  review: [SUBAGENT_NOTE],
  run: [SUBAGENT_NOTE, BOARD_SCRIPT_NOTE],
  'review-plan': ['Dispatch the `laneconductor:plan-reviewer` subagent (read only) with that prompt.'],
  help: ['In Claude Code, type a command as `/laneconductor:<name>`, for example `/laneconductor:plan 10106`; typing `/laneconductor:` lists them all.'],
  'show-board': [OPEN_NOTE],
  'refresh-board': [PUBLISH_NOTE, BOARD_SCRIPT_NOTE],
  board: [PUBLISH_NOTE, OPEN_NOTE, BOARD_SCRIPT_NOTE],
};

/** A frontmatter value, double-quoted when plain YAML would misread it. */
function yamlValue(v) {
  return /^[\[{*&!|>'"%@`#-]|: | #/.test(v) ? JSON.stringify(v) : v;
}

/** The Claude Code command file for one catalog entry. Deterministic. */
export function renderCommand(cmd) {
  const hint = argumentHint(cmd);
  const front = ['---', `description: ${yamlValue(cmd.description)}`, ...(hint ? [`argument-hint: ${yamlValue(hint)}`] : []), '---'];
  let body;
  if (cmd.render === 'help') {
    body = `Show me this list as it is; run nothing else.\n\n${helpText()}`;
  } else if (cmd.args.length <= 1) {
    body = cmd.procedure.replace(/\{\{\w+\}\}/g, '`$ARGUMENTS`');
  } else {
    // Several arguments arrive as one string: name them in order and refer to them by name.
    const names = cmd.args.map((a) => a.hint ?? a.name).join(', then ');
    body = `Arguments: \`$ARGUMENTS\` (${names}).\n\n${cmd.procedure.replace(/\{\{(\w+)\}\}/g, '<$1>')}`;
  }
  const parts = [body, ...(CLAUDE_EXTRAS[cmd.name] ?? []), ...(cmd.connector ? [FALLBACK_LINE] : [])];
  return `${front.join('\n')}\n${parts.join('\n\n')}\n`;
}

// ---- LaneConductor Lite: commands written for file editing, and the two subagents ----
// Same command set as the catalog (a test compares the names). The commands that use connector tools in the catalog get a procedure
// that edits the track files directly, following the skill's `ops/tracks.md`; the board commands explain that the board needs the
// full plugin and show how to get it, and do nothing else. Nothing here names a connector tool or the board script.
const LITE_NS = LITE_NAME; // slash commands are `/laneconductor-lite:<name>`
const LITE_SUBAGENT_NOTE = `In Claude Code the sub-agent is \`${LITE_NS}:track-runner\`, one per track, each in its own worktree (it creates the worktree itself). See "Plugin users" in the skill's \`ops/working-a-track.md\`.`;
const LITE_EDIT_RULE = 'Change state by editing the track files directly, following the skill\'s `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.';
const LITE_FIND = 'Find the track\'s folder under `conductor/tracks/` (Glob `conductor/tracks/*<number>*/`; both naming conventions exist, see "Finding a track" in the skill index) and read its `index.md`, `spec.md`, `plan.md`, `test.md` and `conversation.md`.';
const LITE_LANE = (lane, file, extra = '') => (
  `Work on track {{track}} in the ${lane} lane. The procedure is the ${lane} lane guide (skill file \`${file}\`); follow it and do not restate it here.\n\n`
  + `1. ${LITE_FIND} Read the lane guide, and \`conductor/workflow.json\` for where each lane goes next. The guide is advice.\n`
  + `2. Work through the guide. ${LITE_EDIT_RULE}${extra}`
);
const LITE_LANE_WORK = (lane, dispatch) => (
  `1. ${LITE_FIND} Read the lane guide too.\n`
  + `2. ${WORKTREE_ADVICE}\n`
  + `3. Show the exact dispatch you would make, with this prompt: "${dispatch}"\n`
  + '4. Start nothing until I say yes. If I decline, or sub-agents are unavailable (chat), do the lane yourself in this session following the guide.\n'
  + `5. ${LITE_EDIT_RULE}`
);
const WORKTREE_ADVICE = 'RECOMMEND, do not start: suggest one sub-agent per track, each in its own worktree, because that isolates the work from the primary checkout, lets several tracks run in parallel, and keeps them from colliding.';
const LITE_BOARD = (
  'The board (a private dashboard of every track by lane) is part of the full LaneConductor plugin; LaneConductor Lite does not include it. '
  + 'Do nothing else: do not look for a board, do not generate or publish anything, and never run an install command yourself.\n\n'
  + 'Tell me that in a sentence or two, then show me these commands as written (I run them myself, after `' + LITE_UNINSTALL_COMMAND + '`, because both plugins contain the same skill; my track files stay compatible):\n\n'
  + `${INSTALL_BLOCK}\n\n`
  + `More: ${FULL_PLUGIN_URL}`
);

/** Lite procedures by command name; a command not listed here keeps the catalog's procedure. */
export const LITE_PROCEDURES = {
  plan: LITE_LANE('plan', 'lanes/plan.md'),
  brainstorm: LITE_LANE('brainstorm', 'lanes/brainstorm.md'),
  implement: 'Implement track {{track}}. The procedure is the implement lane guide (skill file `lanes/implement.md`); follow it and do not restate it here.\n\n'
    + LITE_LANE_WORK('implement', 'Work track N through its implement lane: read the lane guide, follow plan.md, commit in your worktree, report commits and test results; do not merge or push.'),
  review: 'Review track {{track}}. The procedure is the review lane guide (skill file `lanes/review.md`); follow it and do not restate it here.\n\n'
    + LITE_LANE_WORK('review', 'Review track N in the review lane: read the lane guide, evaluate the work, do not fix it, report a verdict with evidence; do not merge or push.'),
  'quality-gate': LITE_LANE('quality-gate', 'lanes/quality-gate.md'),
  merge: LITE_LANE('merge', 'lanes/merge.md', '\n3. Ask me before any merge or push; do neither without my yes.'),
  run: 'Run track {{track}} end to end. The guardrails are the skill file `ops/working-a-track.md`; read it, and read the lane guide for each lane you run.\n\n'
    + `1. ${LITE_FIND} Read \`conductor/workflow.json\` too: it says where each lane goes next.\n`
    + `2. ${WORKTREE_ADVICE}\n`
    + '3. Show the exact dispatch you would make, with this prompt: "Work track N through its <current lane> lane: read the lane guide, do the work, commit in your worktree, report commits and test results; do not merge or push." One dispatch per lane, one agent per track.\n'
    + '4. Start nothing until I say yes. If I decline, or sub-agents are unavailable (chat), work the lane in this session following its lane guide.\n'
    + `5. ${LITE_EDIT_RULE} Ask me before any merge or push.`,
  new: 'Create a track for: {{title}}. The procedure is the skill file `ops/tracks.md` (`newTrack`).\n\n'
    + '1. Look through `conductor/tracks/` first (Glob, then the titles in the `index.md` files) so you extend an existing track instead of duplicating it; if one matches, show it and ask whether to use it. Otherwise create the track\'s folder and files by hand as `newTrack` describes, with a short title and the problem in my words (set `**Type**` only if it is not dev).\n'
    + '2. Report the number and folder. Do not plan it unless I ask; `plan` is the next step.',
  bug: 'File a bug track for: {{description}}. The procedure is the skill file `ops/tracks.md` (`reportaBug`).\n\n'
    + '1. Look through `conductor/tracks/` for a track that already covers the symptom; if one does, show it and ask whether to add a comment to it instead. Otherwise create the track by hand as `newTrack` describes, with `**Track Kind**: bug`, a short title and the problem in my words (the symptom, the steps to reproduce and the expected result), using the bug form in `ops/tracks.md` and `setup/templates.md` (Symptom, Steps to reproduce, Expected result, Actual result, Suspected area, Environment) and a regression-test case first in `test.md`.\n'
    + '2. Report the number and folder. Do not start fixing it unless I ask.',
  feature: 'File a feature track for: {{description}}. The procedure is the skill file `ops/tracks.md` (`featureRequest`).\n\n'
    + '1. Look through `conductor/tracks/` for a track that already covers the request; if one does, show it and ask whether to add a comment to it instead. Otherwise create the track by hand as `newTrack` describes, with `**Track Kind**: feature`, a short title and the need and the wanted outcome in my words, using the feature form in `ops/tracks.md` and `setup/templates.md` (The need, Who it is for, Wanted outcome, Acceptance criteria, Out of scope).\n'
    + '2. Report the number and folder. Do not start planning it unless I ask.',
  status: 'Show status for: {{track}} (nothing given means every track not done). Read only; change nothing. The procedure is the skill file `ops/tracks.md` (`status`).\n\n'
    + '1. With a track number or title: read its `index.md` and the end of `conversation.md`, and report lane, lane status, progress, phase, summary and the last conversation entries, and whether a human comment is waiting for a reply.\n'
    + '2. With nothing: read every track\'s `index.md` under `conductor/tracks/` and print the tracks grouped by lane, one line each (id, title, lane status, progress).',
  move: 'Move track {{track}} to {{lane}} (a `lane` or `lane:status`; a bare lane means `queue`). The procedure is the skill file `ops/tracks.md` (`move`, `pulse`, `updateTrack`).\n\n'
    + '1. Check `conductor/workflow.json` for a `lane:status` that lane defines.\n'
    + '2. Re-read the track\'s `index.md` right before editing, then change only the marker lines: `**Lane**` and `**Lane Status**` (a progress or phase update is `**Progress**` or `**Phase**`).\n'
    + '3. Say what changed. Moving a track only sets markers; it starts no work.',
  comment: 'Add a comment to track {{track}}: {{text}}. The procedure is the skill file `ops/tracks.md` (`comment`).\n\n'
    + '1. Find the track\'s folder if the number is unclear, then append my words to its `conversation.md` as `> **human**: <my words>` (every further line also starts with `> `); create the file if it is missing.\n'
    + '2. Confirm the entry was added. Do not answer it or change the track unless I ask.',
  'new-project': 'New project: {{idea}} (nothing given means ask me). This runs only because I named it. The procedure is the skill file `ops/new-project.md`; read it in full first and follow it.\n\n'
    + '1. Detect whether this is an empty folder or an existing repository (then offer only the `conductor/` scaffold).\n'
    + '2. Interview me in chat, one question at a time, short, stopping early when the answers are enough.\n'
    + '3. Show what you will create and ask before writing it, then create the first tracks in the plan lane.\n'
    + '4. Summarize, then ask before any commit. Never push.',
  board: LITE_BOARD,
  'show-board': LITE_BOARD,
  'refresh-board': LITE_BOARD,
};
export const LITE_DESCRIPTIONS = {
  board: 'The board needs the full LaneConductor plugin: shows how to get it',
  'show-board': 'The board needs the full LaneConductor plugin: shows how to get it',
  'refresh-board': 'The board needs the full LaneConductor plugin: shows how to get it',
};
const LITE_EXTRAS = {
  implement: [LITE_SUBAGENT_NOTE],
  review: [LITE_SUBAGENT_NOTE],
  run: [LITE_SUBAGENT_NOTE],
  'review-plan': [`Dispatch the \`${LITE_NS}:plan-reviewer\` subagent (read only) with that prompt.`],
  help: [`In Claude Code, type a command as \`/${LITE_NS}:<name>\`, for example \`/${LITE_NS}:plan 10106\`; typing \`/${LITE_NS}:\` lists them all.`],
};

/** The catalog entries as Lite offers them: same names and arguments, Lite descriptions and procedures. */
export function liteCommands() {
  return COMMANDS.map((c) => ({ ...c, description: LITE_DESCRIPTIONS[c.name] ?? c.description, procedure: LITE_PROCEDURES[c.name] ?? c.procedure, connector: false, needsLc: undefined }));
}

/** The command list `help` shows in Lite: grouped, one example phrase each, no count. */
export function liteHelpText() {
  const cmds = liteCommands();
  const lines = ['LaneConductor Lite commands. Say one in your own words, or use it as a slash command.', ''];
  for (const g of GROUPS) {
    lines.push(`${g[0].toUpperCase()}${g.slice(1)}`);
    for (const c of cmds.filter((x) => x.group === g)) {
      const args = argumentHint(c);
      lines.push(`- ${c.name}${args ? ` ${args}` : ''}: ${c.description}. Example: "${c.example}"`);
    }
    lines.push('');
  }
  lines.push('Every command works by editing the track files directly. The board commands only explain that the board is part of the full LaneConductor plugin and show how to get it.');
  return lines.join('\n');
}

/** The Lite command file for one catalog entry. Deterministic. */
export function renderLiteCommand(cmd) {
  const hint = argumentHint(cmd);
  const front = ['---', `description: ${yamlValue(cmd.description)}`, ...(hint ? [`argument-hint: ${yamlValue(hint)}`] : []), '---'];
  let body;
  if (cmd.render === 'help') {
    body = `Show me this list as it is; run nothing else.\n\n${liteHelpText()}`;
  } else if (cmd.args.length <= 1) {
    body = cmd.procedure.replace(/\{\{\w+\}\}/g, '`$ARGUMENTS`');
  } else {
    const names = cmd.args.map((a) => a.hint ?? a.name).join(', then ');
    body = `Arguments: \`$ARGUMENTS\` (${names}).\n\n${cmd.procedure.replace(/\{\{(\w+)\}\}/g, '<$1>')}`;
  }
  return `${front.join('\n')}\n${[body, ...(LITE_EXTRAS[cmd.name] ?? [])].join('\n\n')}\n`;
}

const LITE_TRACK_RUNNER_BODY = `You work one track through one lane, in a git worktree of your own, and report back. The prompt that started you names the track and the lane.

1. Workspace first. Work in a worktree of your own, never in the primary checkout. If you were not started inside one (compare \`git rev-parse --show-toplevel\` with \`git worktree list\`), create it before anything else, from the repository root: \`git worktree add .worktrees/track-<number> -b track-<number>\`, and work there. You were started because the person agreed to this run; if you doubt that, stop and ask. If the project's \`.gitignore\` does not list \`.worktrees/\`, say so in your report instead of editing it. Never touch another checkout or worktree.
2. If the track's files are not in the worktree (a new track folder is untracked, so a worktree cut from HEAD cannot see it), stop and report that; do not copy files in from elsewhere.
3. Read the laneconductor skill's lane file for that lane (Glob \`**/lanes/<lane>.md\` under \`~/.claude/plugins\`, or \`.claude/skills/laneconductor/lanes/<lane>.md\` in the project) and the track's \`index.md\`, \`spec.md\`, \`plan.md\` and \`conversation.md\` under \`conductor/tracks/\`. A human comment in \`conversation.md\` overrides the plan. The lane file is advice; if you decide against a step, say why in your report.
4. Do the lane's work in the worktree, nowhere else.
5. Run only the project's own test command, and only the tests the lane needs. Do not run worker-spawning or mock-CLI suites from a worktree. After tests, check for leaked processes (\`ps aux\`, and \`/proc/<pid>/cwd\` to see whose they are) and stop only the ones you started.
6. Record state by editing the track files in the worktree, following the skill's \`ops/tracks.md\`: re-read \`index.md\` right before editing and change only the marker lines, and append the completion comment to \`conversation.md\` in the format the skill gives. Re-read the lane first: if a human moved the track, leave the markers alone and say so.
7. Commit in the worktree with explicit paths (\`git add <paths>\`, never \`git add -A\` or \`git add .\`).
8. Never merge. Never push. Never enter or echo a secret. If a decision is the human's, say so in your report and stop.

Lessons from past incidents are in the laneconductor skill's \`ops/working-a-track.md\`; Glob for it and read it once if anything above is unclear.

Finish with ONE paragraph: track, lane, what changed, commit shas, test command and result, leaked-process check, and anything the human must decide.
`;

/** The Lite subagent: no connector tools in `tools`, no `isolation` key (the portal blocks it), no pointers to the connector. */
export function liteAgent(rel, text) {
  let out = stripMcpTools(text);
  if (/^isolation:/m.test(out)) out = removeFrontmatterKey(out, 'isolation');
  if (rel === 'agents/track-runner.md') {
    const m = out.match(/^---\n[\s\S]*?\n---\n/);
    return `${m[0]}${LITE_TRACK_RUNNER_BODY}`;
  }
  return transformSkillFile(rel, out, {
    'agents/plan-reviewer.md': [[
      ': with the connector\'s read-only tools (`get_track`, `get_context`) or, if they are unavailable, by Glob',
      ' by Glob',
    ]],
  });
}

/** The parts both profiles share: the skill (edited per profile), commands, agents, icon, LICENSE and the manifest. */
function buildCommon(repo, profile) {
  const c = collector(repo);
  const pkg = readPkg(repo);
  const edits = skillEdits(profile);
  const lite = profile === 'lite';

  // Skill: everything under the skill folder except the parked tier, with the explicit edits applied.
  for (const r of walk(path.join(repo, SKILL_SRC))) {
    if (SKILL_EXCLUDE_DIRS.some((d) => r.startsWith(`${d}/`))) continue;
    const dest = `skills/laneconductor/${r}`;
    c.addFrom(`${SKILL_SRC}/${r}`, dest);
    const f = c.files.get(dest);
    let text = f.content.toString('utf8');
    if (edits[r]) text = transformSkillFile(r, text, edits);
    if (lite && r === 'ops/board.md') text = LITE_BOARD_MD; // the board is the full plugin's: this file only says so
    if (r === 'SKILL.md') {
      // The directory allows only Read, Grep, Glob and LS in allowed-tools; the skill needs more, so the key is
      // dropped and Claude Code applies its normal permission check instead (the same in both profiles).
      text = `${removeFrontmatterKey(text, 'allowed-tools').replace(/\n*$/, '\n')}${HABITS_BY_PROFILE[profile]}`;
    }
    f.content = Buffer.from(text);
  }
  if (lite) c.add('skills/laneconductor/FULL-PLUGIN.md', FULL_PLUGIN_MD);

  if (lite) for (const cmd of liteCommands()) c.add(`commands/${cmd.name}.md`, renderLiteCommand(cmd));
  else for (const cmd of COMMANDS) c.add(`commands/${cmd.name}.md`, renderCommand(cmd));
  addExtras(c, repo, EXTRAS_SRC, EXTRAS_DIRS, lite ? (rel, t) => (rel.startsWith('agents/') ? liteAgent(rel, t) : t) : undefined);
  c.addFrom(ICON_SRC, '.claude-plugin/icon.png');
  c.addFrom('LICENSE', 'LICENSE');
  c.add('.claude-plugin/plugin.json', json(lite ? {
    // Only fields the directory portal knows (its Validate of 2026-11-18 warned about documentationUrl and supportUrl), plus
    // the listing field privacyPolicyUrl.
    name: LITE_NAME,
    displayName: 'LaneConductor Lite',
    version: pkg.version,
    description: 'LaneConductor Lite: the plan-first process for tracks kept as files in git, in Markdown only: a skill, slash commands and two subagents. The full LaneConductor plugin adds a board and safe writes.',
    author: { name: AUTHOR, url: AUTHOR_URL },
    homepage: 'https://laneconductor.com',
    repository: REPO_URL,
    license: 'Elastic-2.0',
    keywords: ['laneconductor', 'tracks', 'planning', 'git'],
    privacyPolicyUrl: PRIVACY_URL,
  } : {
    name: PLUGIN_NAME,
    version: pkg.version,
    description: 'LaneConductor: the planning and delivery workflow for tracks kept as files in git. A skill, slash commands, subagents, a local MCP connector for safe track writes, and a board generator.',
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
 * LITE profile: directory-eligible, built into plugins/laneconductor-lite by the normal run. Markdown, JSON and one PNG only:
 * the skill (with FULL-PLUGIN.md), the commands, the agents (no connector tools, no `isolation`), README, LICENSE, manifest, icon.
 * No MCP server, no package files, no scripts, no hooks.
 */
function buildLite(repo) {
  const { c, pkg } = buildCommon(repo, 'lite');
  c.add('README.md', LITE_README.replaceAll('{{VERSION}}', pkg.version));
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
 * FULL profile (plugins/laneconductor, the default): everything in the Lite plugin's kind (but with the connector's commands) plus the local MCP connector and the board
 * script (server/bin/lc-connector.mjs, server/bin/lc-board.mjs, the files they import, the guides and the board page), the
 * conductor/ helpers they import, package.json + lockfile at the root, and .mcp.json.
 * EXTENSION POINT (FULL_EXTRAS_DIRS): only for things that must stay in this plugin; the hooks are a separate extension plugin.
 */
function buildFull(repo) {
  const { c, pkg } = buildCommon(repo, 'full');
  const lock = JSON.parse(fs.readFileSync(path.join(repo, 'connector/package-lock.json'), 'utf8'));
  addServer(c, repo, { entries: SERVER_ENTRIES, assets: ['src/board-page.html'], dirs: ['guides'] });
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

/** Returns Map<pluginRelPath, { content: Buffer, exec: boolean }> for one profile: 'full' (default) or 'lite'. */
export function buildPlugin(repo = REPO, profile = 'full') {
  if (profile === 'full') return buildFull(repo);
  if (profile === 'lite') return buildLite(repo);
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
  for (const profile of PROFILES) for (const [r, f] of buildPlugin(repo, profile)) out.set(`${RELS[profile]}/${r}`, f);
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
      console.log(`${PLUGIN_REL}, ${LITE_REL} and ${MARKETPLACE_REL} are up to date.`);
    } else if (profile !== 'full' || out) {
      if (!out) throw new Error(`profile ${profile} is not part of the default build: pass --out <dir> (outside plugins/)`);
      console.log(`wrote ${writeProfile(profile, out)} files (profile ${profile}) into ${path.resolve(out)}`);
    } else {
      console.log(`wrote ${writeAll()} files under ${PLUGIN_REL}/, ${LITE_REL}/ and ${MARKETPLACE_REL}`);
    }
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}
