// The texts and names of the three LaneConductor plugins that are not copied from a source file (track AM-10128). One source for
// each, imported by scripts/build-plugin.mjs, so a command name, a tool prefix or an install command is written once.
//
//   laneconductor           the BASE: Markdown only; the skill, every slash command, the read-only plan-reviewer subagent. It is the one
//                           plugin submitted to Anthropic's directory, so it carries no program, no .mcp.json, no package files and no
//                           `isolation` key. It does the whole plan-first process by editing the track files.
//   laneconductor-parallel  add-on, our marketplace only: the local connector (conflict-checked writes, automatic commits, summary,
//                           scan, advice log, health report, MCP prompts), the scaffold script and the track-runner subagent with
//                           `isolation: worktree`. MCP server key `lc`.
//   laneconductor-board     add-on, our marketplace only: the board script and its page. Needs no connector.
//
// DETECTION (the one rule of the split): there is no dependency between the plugins (the base comes from the directory, the add-ons
// from our marketplace). The base looks at what exists: the connector tools by their prefix, the sub-agent by its name, the board script
// by Glob. When they exist it uses them and recommends nothing; when they do not, it mentions the add-on once per session and only when
// relevant, shows the install commands and never runs them. The pointers stay short: the directory bans listings that exist mainly as
// advertising, so the base is useful alone.
import fs from 'node:fs';

export const AUTHOR = 'Asaf Meller';
export const AUTHOR_URL = 'https://github.com/meller';
export const REPO_URL = 'https://github.com/meller/laneconductor';
export const PRIVACY_URL = `${REPO_URL}/blob/main/docs/privacy.md`;
export const MARKETPLACE = 'laneconductor'; // the marketplace name (.claude-plugin/marketplace.json)
export const MARKETPLACE_SOURCE = 'meller/laneconductor';

export const PROFILES = ['base', 'parallel', 'board'];
export const NAMES = { base: 'laneconductor', parallel: 'laneconductor-parallel', board: 'laneconductor-board' };
export const RELS = Object.fromEntries(PROFILES.map((p) => [p, `plugins/${NAMES[p]}`]));
export const DISPLAY = { base: 'LaneConductor', parallel: 'LaneConductor Parallel', board: 'LaneConductor Board' };

// The interface between the plugins, written down in connector/ARCHITECTURE.md: the connector's MCP server key, the tool prefix Claude
// Code derives from plugin name + server key, the sub-agent name, and where the board script lives.
export const SERVER_KEY = 'lc';
export const CONNECTOR_TOOL_PREFIX = `mcp__plugin_${NAMES.parallel}_${SERVER_KEY}__`;
export const TRACK_RUNNER_AGENT = `${NAMES.parallel}:track-runner`;
export const BOARD_SCRIPT_REL = 'server/bin/lc-board.mjs'; // inside the board add-on
export const BOARD_SCRIPT_GLOB = `**/${NAMES.board}/**/bin/lc-board.mjs`; // under PLUGINS_CACHE
export const PLUGINS_CACHE = '~/.claude/plugins/cache'; // installed plugins live in cache/<marketplace>/<plugin>/<version>/; the marketplaces/ clone holds plugins that are only added, not installed
export const SCAFFOLD_SCRIPT_GLOB = `**/${NAMES.parallel}/**/server/bin/lc-scaffold.mjs`;
export const toolRef = (tool) => `${CONNECTOR_TOOL_PREFIX}${tool}`;

// ONE SOURCE for every recommendation: connector/plugin-extras/recommended-plugins.json (one entry per recommended plugin: name, kind,
// source, installs_code, triggers, why, adds, detect). Everything below that names an add-on, how to detect it, when to mention it, what it
// installs and how to get it is generated from that file, so the skill advisor (track AM-10124) can add skill packs and third-party skills as
// entries without rewriting text.
export const CATALOG_REL = 'connector/plugin-extras/recommended-plugins.json';
export const CATALOG = JSON.parse(fs.readFileSync(new URL(`../${CATALOG_REL}`, import.meta.url), 'utf8'));
export const RECOMMENDED = CATALOG.entries;
export const ADDONS = RECOMMENDED.filter((e) => e.kind === 'addon');
export const entryOf = (name) => {
  const e = RECOMMENDED.find((x) => x.name === name);
  if (!e) throw new Error(`recommended-plugins.json has no entry ${name}`);
  return e;
};
const entryFor = (profileOrName) => entryOf(NAMES[profileOrName] ?? profileOrName);

// ONE SOURCE for the way to get a plugin. These commands are shown to the person, who runs them; no plugin tells Claude to run them.
export const RELOAD_COMMAND = '/reload-plugins';
export const MARKETPLACE_ADD_COMMAND = `claude plugin marketplace add ${MARKETPLACE_SOURCE}`;
/** The two shell commands that install a recommended plugin, in order. Each is shown alone in its own bash block (the desktop app adds a Run button to bash blocks; the person clicks it, Claude runs nothing). */
export const installCommands = (profileOrName) => { const e = entryFor(profileOrName); return [`claude plugin marketplace add ${e.source.add}`, `claude plugin install ${e.source.plugin}@${e.source.marketplace}`]; };
/** The same two steps typed inside a session (slash commands, so inline code, not a shell block). */
export const sessionInstallCommands = (profileOrName) => { const e = entryFor(profileOrName); return [`/plugin marketplace add ${e.source.add}`, `/plugin install ${e.source.plugin}@${e.source.marketplace}`]; };
export const installBlock = (profileOrName) => `${installCommands(profileOrName).map((c) => `\`\`\`bash\n${c}\n\`\`\``).join('\n\n')}\n\nThen run \`${RELOAD_COMMAND}\` in the session. Inside a session you can type \`${sessionInstallCommands(profileOrName)[0]}\` and \`${sessionInstallCommands(profileOrName)[1]}\` instead (that opens the plugin's details for review).`;
/** The one visible difference between entries: a plugin that installs code says so plainly. */
export const installsNote = (profileOrName) => {
  const e = entryFor(profileOrName);
  return e.installs_code
    ? `It installs ${e.installs} on your computer, from the owner's marketplace (\`${e.source.add}\`), not from Anthropic's directory.`
    : 'It is Markdown only: it installs no program.';
};
export const MIGRATION_UNINSTALL_COMMAND = `claude plugin uninstall ${NAMES.base}`;

/** Connector tools a catalog procedure names (plain names in backticks), in order of first use. */
export const toolsUsedBy = (procedure) => [...new Set([...(procedure ?? '').matchAll(/`(get_context|get_track|list_tracks|create_track|update_track|append_conversation)`/g)].map((m) => m[1]))];

// ---- The skill's edits for the base ----
const BOARD_SOURCE_LINE = 'No `lc` on PATH but the LaneConductor plugin is installed: `node ${CLAUDE_PLUGIN_ROOT}/server/bin/lc-board.mjs --repo . --site "$site" --json`.\nNeither exists: say so and stop.';
const BOARD_EDIT = `No \`lc\` on PATH: use the board script of the optional ${NAMES.board} add-on. Find it with Glob \`${BOARD_SCRIPT_GLOB}\` under \`${PLUGINS_CACHE}\` and run \`node <that path> --repo . --site "$site" --json\`.\nNeither exists: the add-on is not installed. Say so in a sentence, show the commands in "If the board script is missing" at the end of this file, and stop.`;
const BOARD_LAST_RULE = '- If a step fails, report which step and the error; do not publish a partial board.';
const BOARD_MISSING = `${BOARD_LAST_RULE}

## If the board script is missing

The board page is built by a small script from the ${NAMES.board} add-on, which is optional and not part of this plugin. Without it,
say that in a sentence or two, then show these commands as written. The person runs them; never run an install command yourself.
${installsNote('board')} Do not look for another way to build the board, do not write the page by hand, and do not publish anything.

${installBlock('board')}

Everything else in LaneConductor works without it. More: ${REPO_URL}`;

export const LEGACY_NOTE = 'Not in the plugin: the daemon-era tier (the `start`, `activate`, `stop`, `deactivate`, `lock`, `unlock`, '
  + '`syncdb` and `remote-sync` commands and the Postgres schema) is parked legacy. Its files live in the skill of the '
  + 'LaneConductor repository, not here; if the user asks for one of those commands, say so and stop.';

export function skillEdits() {
  return {
    'SKILL.md': [
      [
        '| `start`, `activate`, `stop`, `deactivate`, `lock`, `unlock` | [legacy/worker.md](legacy/worker.md) (also retries and logging) | only when named |\n'
        + '| `syncdb` | [legacy/syncdb.md](legacy/syncdb.md) | only when named |\n'
        + '| `remote-sync` | [legacy/remote-sync.md](legacy/remote-sync.md) | only when named |\n',
        '',
      ],
      ['The Postgres schema is in [legacy/db-schema.md](legacy/db-schema.md); read it only when asked.', LEGACY_NOTE],
      [
        '[ops/board.md](ops/board.md) (a private artifact showing every track by lane; Claude creates and refreshes it) | yes |',
        `[ops/board.md](ops/board.md) (a private artifact showing every track by lane; Claude creates and refreshes it; building the page needs the optional ${NAMES.board} add-on) | yes |`,
      ],
      [
        'Steps are in\n[ops/board.md](ops/board.md).',
        `Steps are in\n[ops/board.md](ops/board.md); building the page needs the optional ${NAMES.board} add-on, and that file says what to show when it is missing.`,
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
    'ops/board.md': [[BOARD_SOURCE_LINE, BOARD_EDIT], [BOARD_LAST_RULE, BOARD_MISSING]],
    'ops/tracks.md': [[
      '("Track spec forms"); the\nconnector\'s `create_track` with `track_kind` writes the same forms.',
      `("Track spec forms"); the\n${NAMES.parallel} add-on's \`${toolRef('create_track')}\` with \`track_kind\` writes the same forms when it is present.`,
    ]],
    'setup/templates.md': [[
      "; used by `ops/tracks.md`, and written by the connector's `create_track` with `track_kind`)",
      `; used by \`ops/tracks.md\`, and written by \`${toolRef('create_track')}\` of the ${NAMES.parallel} add-on when it is present)`,
    ]],
    'ops/working-a-track.md': [[
      'With the LaneConductor plugin (Claude Code or Cowork, not chat), the `laneconductor:track-runner`\n'
      + 'subagent is the recommended way to work a track: one subagent per track, each in its own worktree,\n'
      + 'so code stays off the primary checkout, tracks run in parallel and do not collide. Recommend it and\n'
      + 'show the exact dispatch (agent name and one-line prompt); start nothing until the human says yes.\n'
      + '`/laneconductor:run N`, `:implement N` and `:review N` do this. It never merges or pushes.',
      `With the optional ${NAMES.parallel} add-on installed (Claude Code or Cowork, not chat), its \`${TRACK_RUNNER_AGENT}\`\n`
      + 'subagent is the recommended way to work a track: one subagent per track, each in its own worktree,\n'
      + 'so code stays off the primary checkout, tracks run in parallel and do not collide, and the add-on\'s\n'
      + 'conflict-checked writes keep the shared track state safe. Recommend it and show the exact dispatch (agent name and\n'
      + 'one-line prompt); start nothing until the human says yes. `/laneconductor:run N`, `:implement N` and `:review N` do this\n'
      + 'when the agent is listed. It never merges or pushes.\n\n'
      + 'Without the add-on, work the lane in this session, or by hand in a worktree: `git worktree add .worktrees/track-N -b track-N`,\n'
      + 'a separate session started in that folder, one track per worktree, and never `git add -A` there. Say what the add-on adds\n'
      + `(isolated sub-agents, safe shared state) only if the person asks for parallel work; the commands are in [../ADD-ONS.md](../ADD-ONS.md).`,
    ]],
    'ops/new-project.md': [
      [
        'Scripts named below live in the plugin under `server/bin/` (find them with Glob `**/laneconductor/**/server/bin/<name>`\n'
        + 'under `~/.claude/plugins`; `${CLAUDE_PLUGIN_ROOT}` may not be substituted in command text) or in the LaneConductor\n'
        + 'repository under `connector/bin/`. If a script does not exist (the Markdown-only variant has none), do that step by hand\n'
        + 'exactly as described; the result is the same, only slower.',
        `The scaffold script named below, \`lc-scaffold.mjs\`, belongs to the optional ${NAMES.parallel} add-on. Find it with Glob\n`
        + `\`${SCAFFOLD_SCRIPT_GLOB}\` under \`${PLUGINS_CACHE}\`, or in the LaneConductor repository under \`connector/bin/\`.\n`
        + 'If it does not exist, do that step by hand exactly as described; the result is the same, only slower. Do not recommend the\n'
        + 'add-on for this.',
      ],
      [
        '`lc-scaffold` writes it.\nWhen the connector is present and the project already has its `conductor/` files, create further tracks with\n'
        + '`create_track`; otherwise write the files as `ops/tracks.md` describes.',
        '`lc-scaffold` writes it.\nWhen the add-on\'s connector tools are present and the project already has its `conductor/` files, create further tracks with\n'
        + `\`${toolRef('create_track')}\`; otherwise write the files as \`ops/tracks.md\` describes.`,
      ],
    ],
  };
}

// ---- SKILL.md: habits and the add-on pointer ----
export const BASE_HABITS = `
## Habits (this plugin has no hooks)

- First time in a session the user starts track work or mentions tracks, lanes or the board, in a project that has \`conductor/tracks\`: give a 3-line status first (tracks in flight, anything waiting for the human, unpushed commits from \`git status -sb\`), reading the files directly. Once per session; never on unrelated prompts.
- When a lane finishes, offer exactly one next step in one line (review the plan, move on) and wait. Do not act on it.
- Re-read a track file right before editing it and change only the marker lines; never rewrite the whole file. If the connector tools \`${CONNECTOR_TOOL_PREFIX}*\` are present, change markers with them instead (they refuse a stale write).
- Before any \`git push\`, say what will be pushed (branch, commits, files) and ask. Nothing here scans for secrets, so the check is yours.

## Add-ons (mention rarely)

LaneConductor is complete on its own. Optional add-ons exist (read [ADD-ONS.md](ADD-ONS.md)). Tell what is installed from what you can see: ${ADDONS.map((e) => `\`${e.name}\` (${e.why}) is there when ${e.detect}`).join('; ')}. When one is there, use it and recommend nothing. When it is missing, mention it only when its trigger applies: ${ADDONS.map((e) => `for \`${e.name}\`, ${e.triggers.join('; or ')}`).join('; ')}. Then say in one or two sentences what it adds${ADDONS.some((e) => e.installs_code) ? ' and that it installs a local program' : ''}, and show its install commands from ADD-ONS.md as written. Once per session, as an option, never nagging; if the person declines, do not bring it up again. NEVER run an install command yourself.
`;

/** The README block of the base that lists the add-ons: one entry each, what it adds, the plain note on whether it installs a program, the install commands. */
export const addonsReadmeBlock = () => ADDONS.map((e) => `### \`${e.name}\`\n\n${e.why[0].toUpperCase()}${e.why.slice(1)}. ${installsNote(e.name)}\n\n${installBlock(e.name)}`).join('\n\n');

/** One section of ADD-ONS.md for a catalog entry. */
const addOnSection = (e) => `## ${e.name}

${e.why[0].toUpperCase()}${e.why.slice(1)}.

- **Installed when**: ${e.detect}.
- **Adds**: ${e.adds.join('; ')}.
- **Installs**: ${installsNote(e.name)}
- **Relevant when**: ${e.triggers.join('; or ')}.

${installBlock(e.name)}
`;

/** skills/laneconductor/ADD-ONS.md: what each add-on adds, how to tell it is installed, when to mention it and how to get it. Generated from recommended-plugins.json. */
export const ADD_ONS_MD = `# Add-ons

LaneConductor works on its own: every command edits the track files directly. Optional add-ons exist, from the owner's marketplace
(\`${MARKETPLACE_SOURCE}\`), not from Anthropic's directory. Mention one only when it is relevant (see "Add-ons (mention rarely)" at the
end of SKILL.md), at most once per session, in a sentence or two, as an option. When it is installed, use it and recommend nothing.

${ADDONS.map(addOnSection).join('\n')}
## Rules

- The person runs the commands above, in their own terminal or session. NEVER run an install command yourself.
- After installing, the person types \`${RELOAD_COMMAND}\`; a running session keeps the connector version it started with, so restart it
  after an update.
- Track files written with or without an add-on are the same files: nothing in \`conductor/\` needs to change.
- If the person declines, do not bring it up again. More: ${REPO_URL}
`;

// ---- The slash commands of the base ----
// Same command set as the catalog (a test compares the names), written for file editing. The commands that use connector tools in the
// catalog get a procedure that edits the track files directly, following the skill's \`ops/tracks.md\`, plus ONE line that names the
// add-on's tools (generated from the catalog's own procedure) to use when they are present. The board commands find the board script by Glob
// and show the install commands when it is missing. No command runs an install.
const FIND = 'Find the track\'s folder under `conductor/tracks/` (Glob `conductor/tracks/*<number>*/`; both naming conventions exist, see "Finding a track" in the skill index) and read its `index.md`, `spec.md`, `plan.md`, `test.md` and `conversation.md`.';
const EDIT_RULE = 'Change state by editing the track files directly, following the skill\'s `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.';
const LANE = (lane, file, extra = '') => (
  `Work on track {{track}} in the ${lane} lane. The procedure is the ${lane} lane guide (skill file \`${file}\`); follow it and do not restate it here.\n\n`
  + `1. ${FIND} Read the lane guide, and \`conductor/workflow.json\` for where each lane goes next. The guide is advice.\n`
  + `2. Work through the guide. ${EDIT_RULE}${extra}`
);
const PARALLEL_STEP = (dispatch) => (
  `If the sub-agent \`${TRACK_RUNNER_AGENT}\` is listed (the add-on is installed): RECOMMEND, do not start: one sub-agent per track, each in its own worktree, because that isolates the work from the primary checkout, lets several tracks run in parallel, and keeps them from colliding. `
  + `Show the exact dispatch, with this prompt: "${dispatch}" Start nothing until I say yes; if I decline, do the lane yourself. `
  + 'If it is not listed: do the lane in this session following the guide. If I ask for parallel work or for isolation, explain the by-hand way (`git worktree add .worktrees/track-<number> -b track-<number>`, a separate session started in that folder, one track per worktree) '
  + `and, once, what the ${NAMES.parallel} add-on adds (${entryOf(NAMES.parallel).why}; ${installsNote('parallel')} Read the skill's \`ADD-ONS.md\` and show its install commands as written; never run them). Otherwise mention nothing.`
);
const LANE_WORK = (lane, dispatch) => `1. ${FIND} Read the lane guide too.\n2. ${PARALLEL_STEP(dispatch)}\n3. ${EDIT_RULE}`;
const BOARD_MISSING_TEXT = `If neither exists, the ${NAMES.board} add-on is not installed: say so in one sentence, then show me these commands as written (I run them myself; never run an install command yourself), and do nothing else: do not build the page by hand and do not publish anything. ${installsNote('board')}\n\n${installBlock('board')}\n\nMore: ${REPO_URL}`;
const BOARD_SCRIPT_NOTE = `Generating the board needs the board script of the optional ${NAMES.board} add-on: find it with Glob \`${BOARD_SCRIPT_GLOB}\` under \`${PLUGINS_CACHE}\` and run \`node <that path> --repo . --site "$site" --json\`, or use \`lc board --site "$site" --json\` when \`lc\` is on PATH. ${BOARD_MISSING_TEXT}`;
const PUBLISH_NOTE = 'Only Claude can publish an artifact (the Artifact tool, actions `read`, `list`, `publish`); no script does it, so this is your job.';
const OPEN_NOTE = 'Open it with the Artifact tool, action `open`, with the stored URL, and give me the link. Never call `publish` or regenerate anything here.';

/** Procedures of the base by command name; a command not listed here keeps the catalog's procedure. */
export const BASE_PROCEDURES = {
  plan: LANE('plan', 'lanes/plan.md'),
  brainstorm: LANE('brainstorm', 'lanes/brainstorm.md'),
  implement: 'Implement track {{track}}. The procedure is the implement lane guide (skill file `lanes/implement.md`); follow it and do not restate it here.\n\n'
    + LANE_WORK('implement', 'Work track N through its implement lane: read the lane guide, follow plan.md, commit in your worktree, report commits and test results; do not merge or push.'),
  review: 'Review track {{track}}. The procedure is the review lane guide (skill file `lanes/review.md`); follow it and do not restate it here.\n\n'
    + LANE_WORK('review', 'Review track N in the review lane: read the lane guide, evaluate the work, do not fix it, report a verdict with evidence; do not merge or push.'),
  'quality-gate': LANE('quality-gate', 'lanes/quality-gate.md'),
  merge: LANE('merge', 'lanes/merge.md', '\n3. Ask me before any merge or push; do neither without my yes.'),
  run: 'Run track {{track}} end to end. The guardrails are the skill file `ops/working-a-track.md`; read it, and read the lane guide for each lane you run.\n\n'
    + `1. ${FIND} Read \`conductor/workflow.json\` too: it says where each lane goes next.\n`
    + `2. ${PARALLEL_STEP('Work track N through its <current lane> lane: read the lane guide, do the work, commit in your worktree, report commits and test results; do not merge or push.')} One dispatch per lane, one agent per track.\n`
    + `3. ${EDIT_RULE} Ask me before any merge or push.\n`
    + '4. If I ask for the board along the way, follow the `board` command; building it needs the board add-on.',
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
    + '1. Check `conductor/workflow.json` for a `lane:status` that lane defines; use the lane names of that file (a project may call a lane `planning` or `in-progress`).\n'
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
};
/** Lines added after the body of a base command (Claude-only wording: sub-agent names, the Artifact tool, the board script). */
export const BASE_EXTRAS = {
  implement: [`In Claude Code the add-on's sub-agent is \`${TRACK_RUNNER_AGENT}\`. See "Plugin users" in the skill's \`ops/working-a-track.md\`.`],
  review: [`In Claude Code the add-on's sub-agent is \`${TRACK_RUNNER_AGENT}\`. See "Plugin users" in the skill's \`ops/working-a-track.md\`.`],
  run: [`In Claude Code the add-on's sub-agent is \`${TRACK_RUNNER_AGENT}\`. See "Plugin users" in the skill's \`ops/working-a-track.md\`.`],
  'review-plan': [`Dispatch the \`${NAMES.base}:plan-reviewer\` subagent (read only) with that prompt.`],
  help: [`In Claude Code, type a command as \`/${NAMES.base}:<name>\`, for example \`/${NAMES.base}:plan 10106\`; typing \`/${NAMES.base}:\` lists them all.`],
  'show-board': [OPEN_NOTE],
  'refresh-board': [PUBLISH_NOTE, BOARD_SCRIPT_NOTE],
  board: [PUBLISH_NOTE, OPEN_NOTE, BOARD_SCRIPT_NOTE],
};

/** The one line that names the add-on's tools for a command whose catalog procedure uses them; generated, never hand-written. */
export function connectorLine(cmd) {
  const tools = toolsUsedBy(cmd.procedure);
  if (!tools.length) return null;
  return `If the ${NAMES.parallel} add-on's tools are present (${tools.map((t) => `\`${toolRef(t)}\``).join(', ')}), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass \`update_track\` the \`base\` from \`get_track\` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.`;
}

export const BASE_HELP_FOOTER = `Works on its own: every command edits the track files directly. Needs the ${NAMES.board} add-on: board (only to refresh) and refresh-board; without it they say so and show how to get it. With the ${NAMES.parallel} add-on installed, the commands use its conflict-checked tools and dispatch its track-runner sub-agent.`;
