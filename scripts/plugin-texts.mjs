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
const entryFor = (profileOrName) => (typeof profileOrName === 'object' ? profileOrName : entryOf(NAMES[profileOrName] ?? profileOrName)); // an entry object passes through (a test builds the block from a copy of the catalog)

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
const BOARD_LAST_RULE = '- If a step fails, report which step and the error; do not publish a partial board.';
const BOARD_MISSING = `${BOARD_LAST_RULE}

## If the board script is missing

The board page is built by a small script from the ${NAMES.board} add-on, which is optional and not part of this plugin. Without it,
say that in a sentence or two, then show these commands as written. The person runs them; never run an install command yourself.
${installsNote('board')} Do not look for another way to build the board, do not write the page by hand, and do not publish anything.

${installBlock('board')}

Everything else in LaneConductor works without it. More: ${REPO_URL}`;

/**
 * The source skill (`.claude/skills/laneconductor`) is written in the plugin way (track AM-10133), so the base copy needs only the parts
 * that depend on the catalog: the install commands of the board add-on at the end of `ops/board.md`, and the "what else fits this project"
 * step of setup. A missing anchor throws, so a half-done change fails the build.
 */
export const RECOMMEND_MARKER = '<!-- generated: recommended plugins -->';
export const BOARD_MISSING_ANCHOR = 'If the script is not found, the add-on is not installed: say so in a sentence and stop.';

/**
 * The "what else fits this project" step of setup, generated from the catalog (one entry each, so the skill advisor, track AM-10124, adds
 * entries and they flow in). It only shows: no command is run and nothing is installed without a yes.
 */
export const setupRecommendBlock = (entries = RECOMMENDED) => {
  const list = entries.map((e) => {
    const fit = e.setup_fit ? ` It fits when ${e.setup_fit[0].toLowerCase()}${e.setup_fit.slice(1).replace(/\.$/, '')}.` : '';
    return `**\`${e.name}\`**: ${e.why[0].toUpperCase()}${e.why.slice(1)}.${fit} ${installsNote(e)} It counts as installed when ${e.detect}.\n\n${installBlock(e)}`;
  }).join('\n\n');
  return `After the project is read, say which of these optional plugins would help THIS project, so the person does not have to find them in
the README. Look at what you read (the git history, the CI files, how big the project is, what the person told you), pick only the entries
that fit and are not installed, and say for each, in one short paragraph, why it fits this project. If one is already installed, say
nothing about it. If nothing fits, say nothing and go on.

How to offer one:

- Show its two install commands exactly as written below, each alone in its own bash block, then the reload step. You only show them:
  never run an install command yourself, and install nothing unless the person says yes (and then still show the commands for them to run).
- Say plainly what it installs, from the note under its name.
- Mention each plugin once in this session. If the person declines, do not bring it up again.

${list}`;
};

export function skillEdits() {
  const recommend = [RECOMMEND_MARKER, setupRecommendBlock()];
  return {
    'ops/board.md': [
      [BOARD_MISSING_ANCHOR, `If the script is not found, the ${NAMES.board} add-on is not installed: say so in a sentence, show the commands in "If the board script is missing" at the end of this file, and stop.`],
      [BOARD_LAST_RULE, BOARD_MISSING],
    ],
    'ops/new-project.md': [recommend],
    'setup/setup.md': [recommend],
    'ops/next.md': [recommend],
  };
}

// ---- SKILL.md: habits and the add-on pointer ----
export const BASE_HABITS = `
## Habits (this plugin has no hooks)

- First time in a session the user starts track work or mentions tracks, lanes or the board, in a project that has \`conductor/tracks\`: give a 3-line status first (tracks in flight, anything waiting for the human, unpushed commits from \`git status -sb\`), reading the files directly, and end it with "say \`next\` for the one step". Once per session; never on unrelated prompts.
- When a lane finishes, give the one-line card \`next\` would give for this track (the rows for that track in the skill's \`ops/next.md\`) and wait. Do not act on it.
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
${e.setup_fit ? `- **Offered at setup when**: ${e.setup_fit}.\n` : ''}
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
// Track AM-10131: without the add-on's tools, where a finished lane goes is read with track 1020's grammar (one reference), never guessed.
const TARGETS = 'Read where a lane sends a finished track from `conductor/workflow.json` with the grammar of the skill file `ops/lanes-and-statuses.md` (a bare target is `queue` for another lane and `success` or `failure` for the same lane; a bare `done` is `done:queue`); never guess it from the raw file.';
const LANE = (lane, file, extra = '') => (
  `Work on track {{track}} in the ${lane} lane. The procedure is the ${lane} lane guide (skill file \`${file}\`); follow it and do not restate it here.\n\n`
  + `1. ${FIND} Read the lane guide too. ${TARGETS} The guide is advice.\n`
  + `2. Work through the guide. ${EDIT_RULE}${extra}`
);
const PARALLEL_STEP = (dispatch) => (
  `If the sub-agent \`${TRACK_RUNNER_AGENT}\` is listed (the add-on is installed): RECOMMEND, do not start: one sub-agent per track, each in its own worktree, because that isolates the work from the primary checkout, lets several tracks run in parallel, and keeps them from colliding. `
  + `Show the exact dispatch, with this prompt: "${dispatch}" Start nothing until I say yes; if I decline, do the lane yourself. `
  + 'If it is not listed: do the lane in this session following the guide. If I ask for parallel work or for isolation, explain the by-hand way (`git worktree add .worktrees/track-<number> -b track-<number>`, a separate session started in that folder, one track per worktree) '
  + `and, once, what the ${NAMES.parallel} add-on adds (${entryOf(NAMES.parallel).why}; ${installsNote('parallel')} Show its install commands as written, from "The add-on's install commands" in the Reference below; never run them). Otherwise mention nothing.`
);
const LANE_WORK = (lane, dispatch) => `1. ${FIND} Read the lane guide too. ${TARGETS}\n2. ${PARALLEL_STEP(dispatch)}\n3. ${EDIT_RULE}`;
const BOARD_MISSING_TEXT = `If neither exists, the ${NAMES.board} add-on is not installed: say so in one sentence, then show me these commands as written (I run them myself; never run an install command yourself), and do nothing else: do not build the page by hand and do not publish anything. ${installsNote('board')}\n\n${installBlock('board')}\n\nMore: ${REPO_URL}`;
const BOARD_SCRIPT_NOTE = `Generating the board needs the board script of the optional ${NAMES.board} add-on: find it with Glob \`${BOARD_SCRIPT_GLOB}\` under \`${PLUGINS_CACHE}\` and run \`node <that path> --repo . --site "$site" --json\`. ${BOARD_MISSING_TEXT}`;
const PUBLISH_NOTE = 'Only Claude can publish an artifact (the Artifact tool, actions `read`, `list`, `publish`); no script does it, so this is your job.';
const OPEN_NOTE = 'Open it with the Artifact tool, action `open`, with the stored URL, and give me the link. Never call `publish` or regenerate anything here.';

// Track AM-10143 (owner rule): search first, the default is update, not create. The base lists tracks by reading the files, so it
// works with no add-on.
const REUSE = (what) => (
  `Search first; update is the default, create is the fallback. Read \`conductor/tracks-summary.md\` if it exists (every track, every lane, the backlog and done too), otherwise Glob \`conductor/tracks/*/index.md\` and read the titles, lanes and summaries; look for the key words of ${what} (several words, one at a time). Read the best matches. `
  + 'If one fits, say so and ask me "Update track N (title, lane) with this? [default: yes]". On yes, or no answer, extend that track (its `spec.md` or `plan.md`, and a comment in `conversation.md`) and do NOT create a track; a done track is reopened only on my explicit yes. '
  + 'Only if I say no, or nothing fits, create the track by hand as `newTrack` describes, and say which tracks you looked at and why none fit. Several small gaps from one session go into one fitting track, an epic or one backlog track, not one track each.'
);

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
    + `1. ${FIND} ${TARGETS}\n`
    + `2. ${PARALLEL_STEP('Work track N through its <current lane> lane: read the lane guide, do the work, commit in your worktree, report commits and test results; do not merge or push.')} One dispatch per lane, one agent per track.\n`
    + `3. ${EDIT_RULE} Ask me before any merge or push.\n`
    + '4. If I ask for the board along the way, follow the `board` command; building it needs the board add-on.',
  new: 'Create a track for: {{title}}. The procedure is the skill file `ops/tracks.md` (`newTrack`).\n\n'
    + `1. ${REUSE('the title')} The track you create gets its folder and files by hand as \`newTrack\` describes, a short title and the problem in my words (set \`**Type**\` only if it is not dev).\n`
    + '2. Report the number and folder of the track you updated or created. Do not plan it unless I ask; `plan` is the next step.',
  bug: 'File a bug track for: {{description}}. The procedure is the skill file `ops/tracks.md` (`reportaBug`).\n\n'
    + `1. ${REUSE('the symptom')} If a track covers it, add the bug to that track. The track you create is made by hand as \`newTrack\` describes, with \`**Track Kind**: bug\`, a short title and the problem in my words (the symptom, the steps to reproduce and the expected result), using the bug form in \`ops/tracks.md\` and \`setup/templates.md\` (Symptom, Steps to reproduce, Expected result, Actual result, Suspected area, Environment) and a regression-test case first in \`test.md\`.\n`
    + '2. Report the number and folder of the track you updated or created. Do not start fixing it unless I ask.',
  feature: 'File a feature track for: {{description}}. The procedure is the skill file `ops/tracks.md` (`featureRequest`).\n\n'
    + `1. ${REUSE('the request')} The track you create is made by hand as \`newTrack\` describes, with \`**Track Kind**: feature\`, a short title and the need and the wanted outcome in my words, using the feature form in \`ops/tracks.md\` and \`setup/templates.md\` (The need, Who it is for, Wanted outcome, Acceptance criteria, Out of scope).\n`
    + '2. Report the number and folder of the track you updated or created. Do not start planning it unless I ask.',
  status: 'Show status for: {{track}} (nothing given means every track not done). Read only; change nothing. The procedure is the skill file `ops/tracks.md` (`status`).\n\n'
    + '1. With a track number or title: read its `index.md` and the end of `conversation.md`, and report lane, lane status, progress, phase, summary and the last conversation entries, and whether a human comment is waiting for a reply.\n'
    + '2. With nothing: read every track\'s `index.md` under `conductor/tracks/` and print the tracks grouped by lane, one line each (id, title, lane status, progress).\n'
    + '3. End by saying that `next` names the one step to take.',
  move: 'Move track {{track}} to {{lane}} (a `lane` or `lane:status`; a bare lane means `queue`). The procedure is the skill file `ops/tracks.md` (`move`, `pulse`, `updateTrack`).\n\n'
    + '1. Check `conductor/workflow.json` for a `lane:status` that lane defines; use the lane names of that file (a project may call a lane `planning` or `in-progress`). If the move is "this lane\'s action finished", read the target with the grammar of the skill file `ops/lanes-and-statuses.md` (a bare target is `queue` for another lane and `success` or `failure` for the same lane), never from the raw file by guess.\n'
    + '2. Re-read the track\'s `index.md` right before editing, then change only the marker lines: `**Lane**` and `**Lane Status**` (a progress or phase update is `**Progress**` or `**Phase**`).\n'
    + '3. Say what changed. Moving a track only sets markers; it starts no work.',
  comment: 'Add a comment to track {{track}}: {{text}}. The procedure is the skill file `ops/tracks.md` (`comment`).\n\n'
    + '1. Find the track\'s folder if the number is unclear, then append my words to its `conversation.md` as `> **human**: <my words>` (every further line also starts with `> `); create the file if it is missing.\n'
    + '2. Confirm the entry was added. Do not answer it or change the track unless I ask.',
  next: 'What\'s next: {{option}} (nothing given means the whole project). Read only: change no file and no marker, install nothing and push nothing. The procedure is the skill file `ops/next.md`; read it in full first and follow it.\n\n'
    + '1. Gather where the project stands as the file says, with Glob, Grep, Read and read-only git (`git branch --list`, `git merge-base --is-ancestor`, `git log`); nothing else.\n'
    + '2. Name exactly one next step with the exact command to type, one sentence on what it does and one on why it comes next, the other candidates in one line, and the link to the reference. `explain` adds the primer, `short` gives one line, a track number limits the answer to that track.\n'
    + '3. Ask before writing anything (the only write is a saved level, only if I ask for it). Run the step only if I say go.',
  deploy: 'Deploy: {{action}}. This runs only because I named it; do nothing else with it.\n\n'
    + 'Follow `deploy/deploy.md`, or `deploy/setup-deploy.md` when the action is `setup`; both are under "Reference" below. Show me each deploy command before you run it; never deploy without my yes.',
  'repair-duplicates': 'Repair duplicate track numbers: two folders under `conductor/tracks/` that start with the same number are ambiguous. Nothing is renamed until I say yes. The folder and id formats are in the skill file `ops/tracks.md`.\n\n'
    + '1. Find them: list the folder names under `conductor/tracks/` and group them by number (both naming conventions exist, see "Finding a track" in the skill index). Also check other branches: `git for-each-ref refs/heads refs/remotes` and `git ls-tree -d --name-only <ref> conductor/tracks/` show folders that exist only there. If there is no duplicate, say so and stop.\n'
    + '2. For each duplicate number, the older folder keeps it: find when each folder first appeared (`git log --diff-filter=A --format=%aI -- <folder>`, the oldest line) and treat the later one as the newer. The new number is the highest track number found on any branch plus one; the new name is the same prefix and slug with that number.\n'
    + '3. Show me the plan, one line per rename: "Rename <old folder> to <new folder>; update its `# Track` heading in index.md, plan.md, test.md and conversation.md? [default: yes]". Also say which other tracks mention the old number in `**Depends On**` (do not change those; they may mean either track, and I decide). Wait for my yes; on no, change nothing.\n'
    + '4. On yes: `git mv` the folder, fix the id in the headings (the number only; keep the prefix and the title), and append a comment to the renamed track\'s `conversation.md` saying it was renumbered from the old number. Commit only those paths (explicit paths, never `git add -A`). Never push.\n'
    + '5. Regenerate `conductor/tracks-summary.md` if the project keeps one (by hand: the same rows, the renamed folder under its new number), then report what was renamed.',
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
  next: [`In Claude Code, type it as \`/${NAMES.base}:next\`; the commands in the card are written in that form.`],
  help: [`In Claude Code, type a command as \`/${NAMES.base}:<name>\`, for example \`/${NAMES.base}:plan 10106\`; typing \`/${NAMES.base}:\` lists them all.`],
  'show-board': [OPEN_NOTE],
  'refresh-board': [PUBLISH_NOTE, BOARD_SCRIPT_NOTE],
  board: [PUBLISH_NOTE, OPEN_NOTE, BOARD_SCRIPT_NOTE],
};

/** The one line that names the add-on's tools for a command whose catalog procedure uses them; generated, never hand-written. */
export function connectorLine(cmd) {
  const tools = toolsUsedBy(cmd.procedure);
  if (!tools.length) return null;
  if (cmd.readOnly) return `If the ${NAMES.parallel} add-on's tools are present (${tools.map((t) => `\`${toolRef(t)}\``).join(', ')}), use them to read: they report how fresh the state is. This command writes nothing. If they are not present, the steps above are the whole job.`;
  return `If the ${NAMES.parallel} add-on's tools are present (${tools.map((t) => `\`${toolRef(t)}\``).join(', ')}), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass \`update_track\` the \`base\` from \`get_track\` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.`;
}

export const BASE_HELP_FOOTER = `Works on its own: every command edits the track files directly. Needs the ${NAMES.board} add-on: board (only to refresh) and refresh-board; without it they say so and show how to get it. With the ${NAMES.parallel} add-on installed, the commands use its conflict-checked tools and dispatch its track-runner sub-agent.`;

/**
 * The journey in four lines (install, type next, follow the step, what appears at the start), generated from the catalog so the README and
 * the website use one text. It says nothing about anything that is not shipped.
 */
export const NEXT_JOURNEY_START = '<!-- generated: next journey (scripts/plugin-texts.mjs) -->';
export const NEXT_JOURNEY_END = '<!-- end generated: next journey -->';
export const NEXT_JOURNEY = `${NEXT_JOURNEY_START}
1. Install the base plugin (see "Install" below).
2. Type \`/${NAMES.base}:next\`.
3. Do the one step it names, then type it again.
4. With no \`conductor/\` yet it offers three paths and the add-ons that fit (${ADDONS.map((e) => `\`${e.name}\``).join(' and ')}); you run their install commands yourself.
${NEXT_JOURNEY_END}`;
