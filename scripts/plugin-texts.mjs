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
import { derivedInstall, OFFICIAL_MARKETPLACE } from './check-catalog.mjs';

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
/** The starter set candidates (track AM-10124): the entries that say when they fit a project at setup. */
export const STARTER = RECOMMENDED.filter((e) => e.setup_fit);
export const STACK_TAGS = CATALOG.stack_tags;
export const FALLBACK = CATALOG.fallback;
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
export const installCommands = (profileOrName) => derivedInstall(entryFor(profileOrName)); // the official marketplace needs no `marketplace add`
/** The same two steps typed inside a session (slash commands, so inline code, not a shell block). */
export const sessionInstallCommands = (profileOrName) => installCommands(profileOrName).map((c) => c.replace(/^claude plugin /, '/plugin '));
export const installBlock = (profileOrName) => `${installCommands(profileOrName).map((c) => `\`\`\`bash\n${c}\n\`\`\``).join('\n\n')}\n\nThen run \`${RELOAD_COMMAND}\` in the session. Inside a session you can type ${sessionInstallCommands(profileOrName).map((c) => `\`${c}\``).join(' and ')} instead (that opens the plugin's details for review).`;
/** The one visible difference between entries: a plugin that installs code says so plainly. */
export const installsNote = (profileOrName) => {
  const e = entryFor(profileOrName);
  const own = e.source.add === MARKETPLACE_SOURCE;
  const from = own ? `from the owner's marketplace (\`${e.source.add}\`), not from Anthropic's directory` : e.source.add === OFFICIAL_MARKETPLACE.add ? `from \`${e.source.add}\`, Anthropic's official marketplace` : `from \`${e.source.add}\`, a third-party source, not LaneConductor`;
  if (e.installs_code) return `It installs ${e.installs} on your computer, ${from}.`;
  return own ? 'It is Markdown only: it installs no program.' : `It is Markdown only: it adds knowledge and installs no program. It comes ${from}.`;
};
/**
 * The one-line installs (track AM-10128, owner decision 2026-11-18), derived from the catalog's `bundles` (plugin names) and the marketplace
 * of each entry: one `claude plugin marketplace add` per distinct source, then one `claude plugin install <plugin>@<marketplace>` per plugin,
 * joined by `&&`. The base is not an entry (it is the plugin everything else is added to), so it resolves from NAMES.base and MARKETPLACE.
 */
const sourceOfPlugin = (name) => (name === NAMES.base ? { marketplace: MARKETPLACE, add: MARKETPLACE_SOURCE, plugin: name } : entryOf(name).source);
export const oneLineInstall = (names) => {
  const sources = names.map(sourceOfPlugin);
  const adds = [...new Set(sources.map((s) => `claude plugin marketplace add ${s.add}`))];
  return [...adds, ...sources.map((s) => `claude plugin install ${s.plugin}@${s.marketplace}`)].join(' && ');
};
export const BUNDLES = CATALOG.bundles;
/** For use OUTSIDE Claude (website, READMEs): the base and both add-ons. */
export const FULL_INSTALL = oneLineInstall(BUNDLES.full_install);
/** The one-line UPDATE for the same plugins: one `claude plugin marketplace update` per distinct marketplace, then one `claude plugin update` per plugin. */
export const oneLineUpdate = (names) => {
  const sources = names.map(sourceOfPlugin);
  const marketplaces = [...new Set(sources.map((s) => `claude plugin marketplace update ${s.marketplace}`))];
  return [...marketplaces, ...sources.map((s) => `claude plugin update ${s.plugin}@${s.marketplace}`)].join(' && ');
};
export const FULL_UPDATE = oneLineUpdate(BUNDLES.full_install);
/** For use INSIDE a Claude session where the base is already installed: both add-ons. */
export const ADDONS_INSTALL = oneLineInstall(BUNDLES.addons_install);
/** The README paragraph "The full version in one line", with the line alone in its bash fence. */
export const fullInstallBlock = () => `The full version in one line:\n\n\`\`\`bash\n${FULL_INSTALL}\n\`\`\``;

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

// ---- The skill advisor (track AM-10124): offers generated from the catalog, never typed by hand ----
// One catalog (recommended-plugins.json), four places that use it: the lane guides (the entries that fit the lane), `ops/suggest-skills.md` (the
// whole catalog and the command /laneconductor:suggest-skills), the starter set at the end of setup and new-project, and a one-line tip in `next`.
// The rules of an offer are one text (OFFER_RULES), so every place says the same. The base only shows commands; nothing here runs one.
export const LANE_OFFER_MARKER = '<!-- generated: skill offers for this lane -->';
export const TYPE_OFFER_MARKER = '<!-- generated: skill offers for non-dev types -->';
export const SKILLS_MARKER = '<!-- generated: skill catalog -->';
export const RULES_MARKER = '<!-- generated: skill offer rules -->';
export const TIPS_MARKER = '<!-- generated: skill tips -->';
export const DECLINED_FILE = 'skill-advisor-declined.txt';

// Track AM-10124, REQ-12 (owner, 2026-11-18): the advisor works on the current track, and real work with no track in play gets one soft offer.
// The lookup of the current track is written once here and used by the base skill, suggest-skills and next; the lane guides are given a track.
// Track AM-10144 Phase 10: the first-track card (ops/next.md) shows the add-ons one-line install alone in its own bash block, from the catalog.
export const ONE_LINE_MARKER = '<!-- generated: add-ons one-line install -->';
export const oneLineBlock = () => `\`\`\`bash\n${ADDONS_INSTALL}\n\`\`\``;
export const CURRENT_TRACK_MARKER = '<!-- generated: current track -->';
export const TRACK_CONTEXT_MARKER = '<!-- generated: track context -->';
export const CURRENT_TRACK = `**The current track** is, in this order: the track named in the prompt (a number or a title); the track a branch is named after (\`git branch --show-current\`, matched to its folder under \`conductor/tracks/\`); the track this session has running (\`**Lane Status**: running\`, and with the connector \`**Run By**\` names this client). With one in play, its lane, \`**Type**\` and stack apply; with none, no track is in play and skill offers go by the stack only (a KPI block belongs to a marketing or sales track, so there is none to write).`;
export const TRACK_CONTEXT = `When the person asks for real work (it changes files, or takes more than a quick answer) and no track is in play, say so in one sentence and offer three ways in, in plain text: update the nearest existing track (search first: \`list_tracks\` when the connector tools are there, else the folders under \`conductor/tracks/\`; the default wording is "Update track N?"), create a new track, or go on without a track. Never block: when the work is clearly small, go ahead without asking. Create or change a track only after a yes. A question, reading, a one-line or typo fix gets no offer, and "no track" once, or a choice to go on without one, means no more track offers this session.

${CURRENT_TRACK}`;

const KIND_ORDER = { addon: 0, skillpack: 1, thirdparty: 2 };
const LEVEL_ORDER = { prerequisite: 0, helps: 1 };
const skillsOf = (e, lanes) => (e.skills ?? []).filter((k) => !lanes || (k.lanes ?? e.lanes).some((l) => lanes.includes(l)));
/** The order of an offer: our own entries first, then third-party ones; a prerequisite before a helper; otherwise the catalog's order. */
export const offerOrder = (entries) => entries.map((e, i) => [e, i]).sort(([a, i], [b, j]) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || (i - j)).map(([e]) => e);
/** The entries that apply to a set of lanes (an entry with skills applies when one of them does). */
export const entriesForLanes = (lanes, { types = null, entries = RECOMMENDED } = {}) => offerOrder(entries.filter((e) => (skillsOf(e, lanes).length || (!e.skills?.length && e.lanes.some((l) => lanes.includes(l)))) && (!types || e.types.some((t) => types.includes(t)))));

export const OFFER_RULES = `**How to offer.** Plain text in your reply: never a form, a menu or a question that blocks the work.

1. **Look first.** A skill counts as installed when any of these is true: it is in the skills list this session shows you (that list already covers project, user and plugin skills, and a plugin skill can appear as \`plugin:skill\`); \`claude plugin list\` (read only; run it once per session, only when the list is not enough, as a command of its own and never chained with other commands, which makes the client ask for permission) shows its plugin as enabled; or a folder with its name exists in \`.claude/skills/\` of the project or in \`~/.claude/skills/\`. A skill listed under an older name counts too. When it is installed, say so in one line ("you have \`<skill>\` installed, use it before writing the content") and use it.
2. **Offer only what is missing**, from the candidates below that fit the lane, the track's \`**Type**\` (\`dev\` when it has none) and the project's stack: read \`conductor/tech-stack.md\` and look for the marker files named under "Stack tags". When nothing is missing, say nothing.
3. **Be quiet.** At most two items per offer: our own entries before third-party ones, \`prerequisite\` before \`helps\`. Never the same entry twice in a session, and never an entry on the project's declined list: the file \`${DECLINED_FILE}\` inside the directory that \`git rev-parse --git-common-dir\` prints (one entry name per line; it is inside \`.git\`, so it is never committed). A trivial track gets at most the one-line tip, and a suggestion in the middle of a step (a failing test and \`systematic-debugging\`) is one line.
4. **Say it in one or two plain sentences**: what it is, why it helps here, where it comes from, and what it installs (use the note under its name: an entry that installs a program says so plainly; a Markdown-only one adds knowledge only). Then each install command alone in its own bash block, one command per block, no leading \`$\`, so the desktop app shows a Run button. In a session the person can type \`/plugin install <plugin>@<marketplace>\` instead (inline text, not a block); that opens the plugin's details for review.
5. **Level.** \`prerequisite\`: say the result will be better with it and ask, in the same sentence, whether to install it first or carry on. \`helps\`: a one-line tip. Either way the work is not blocked: with no answer, carry on.
6. **The answer.** *Install first*: show the commands, say nothing has been changed yet, say to run them and then \`${RELOAD_COMMAND}\`, and when the person is back start the step again from the top with the skill present. *Carry on*: start the step at once and do not repeat the offer this session. *Do not ask again*: show the line you would add and, after the yes, append the entry's name to the declined file; with no git directory, just do not offer it again this session.
7. **Never run an install yourself.** The commands are shown; the person runs them, or uses the client's own plugin browser. If one fails, report the command and its output, retry nothing silently and work around nothing by editing settings or permissions. To share a plugin with collaborators, offer to add it to \`enabledPlugins\` in the project's \`.claude/settings.json\` only when the person asks: show the exact change first, say it turns the plugin on for them but does not download it (each person runs the install once with \`--scope project\`), and write it only after a yes.`;

// The short rule every lane command carries (once; `run` carries it once for all its lane guides). The long procedure is OFFER_RULES, in suggest-skills.
export const SHORT_RULE = `**Offer rule** (full procedure: \`/${NAMES.base}:suggest-skills\`). Plain text, never a form, never blocking.
- Look first: a skill is installed when it is in the session's skills list, \`claude plugin list\` (read only), \`.claude/skills/\` or \`~/.claude/skills/\`; an older name counts. Then say "you have \`<skill>\` installed, use it before writing the content" and use it.
- Offer only what is missing and fits this lane, the track's \`**Type**\` (dev if none) and the stack; else say nothing. At most two, ours first, never twice in a session, never one on the declined list (\`${DECLINED_FILE}\` in the directory \`git rev-parse --git-common-dir\` prints).
- One or two plain sentences (what, why here, program or only knowledge), each install command alone in its own bash block, no leading \`$\`.
- \`prerequisite\`: ask, in the same sentence, whether to install first or carry on; otherwise a one-line tip. No answer: carry on.
- Never run an install yourself: the person runs it, then \`${RELOAD_COMMAND}\`. "Do not ask again": after a yes, add the entry name to the declined file.`;
const MINI_RULE = 'Look first (the session skills list, `claude plugin list`, `.claude/skills/`, `~/.claude/skills/`; an older name counts) and offer only what is missing: at most two, plain text, each install command alone in its own bash block, never run an install, never block, nothing twice in a session or on the declined list.';

/** One catalog entry as one line: why (short), what it installs, the commands in inline code (Claude puts each into its own bash block when it offers). */
export function entryLine(e, { lanes = null, full = false, brief = false } = {}) {
  const sk = skillsOf(e, lanes);
  const meta = [e.level === 'prerequisite' ? 'prerequisite' : null, e.types.join() !== 'dev' ? `Type ${e.types.join('/')}` : null, e.stack.length ? `stack ${e.stack.join('/')}` : null, full ? e.licence : null].filter(Boolean);
  const names = sk.map((k) => `${k.name}${k.aliases?.length ? ` (was ${k.aliases.join('/')})` : ''}`).join(', ');
  const blurb = !full && !brief && sk.length ? `skills ${names}` : e.why + (full && sk.length ? `. Skills: ${names}` : '');
  const when = e.kind === 'addon' ? ` Mention only when ${full ? e.triggers.join('; or ') : e.triggers[0]}.` : '';
  const detect = e.skills?.length || (!full && e.kind !== 'addon') ? '' : ` It counts as installed when ${e.detect}.`;
  const what = e.installs_code ? ` Installs ${e.installs}.` : ' Markdown only.';
  return `- \`${e.name}\`${meta.length ? ` (${meta.join('; ')})` : ''}: ${blurb}.${what}${detect}${when} ${installCommands(e).map((c) => `\`${c}\``).join(', ')}`;
}

const stackTagLines = (tags) => tags.map((t) => `- \`${t}\`: ${STACK_TAGS[t]}.`).join('\n');
const tagsNote = (entries) => { const t = [...new Set(entries.flatMap((e) => e.stack))]; return t.length ? ` (stack tags: ${t.join(', ')})` : ''; };

/** The block at the end of a lane guide: the short rule and one line per entry of that lane (generated, so it follows the catalog). */
export function laneOfferBlock(lane) {
  const entries = entriesForLanes([lane]);
  return `${SHORT_RULE}

Candidates for the \`${lane}\` lane${tagsNote(entries)}:

${entries.map((e) => entryLine(e, { lanes: [lane] })).join('\n')}`;
}

/** The offer for a new non-dev track (marketing, sales, support): at creation, at plan and at implement. */
export function typeOfferBlock() {
  const types = ['marketing', 'sales', 'support'];
  const entries = entriesForLanes(['plan', 'implement'], { types }).filter((e) => e.types.some((t) => types.includes(t)));
  return `${MINI_RULE} Offer when the track is created, planned and implemented.

Candidates for these Types:

${entries.map((e) => entryLine(e, { lanes: ['plan', 'implement'] })).join('\n')}`;
}

/** ops/suggest-skills.md: the whole catalog, the stack tags and the fallback. */
export function skillsCatalogBlock() {
  const fb = FALLBACK;
  const fallback = `### If nothing in the catalog fits

Say so in one line. Then you may name one generic finder, \`${fb.name}\` (\`${fb.source}\`, licence ${fb.licence}): ${fb.note}. Show its command alone in its own bash block, never run it, and say it is third-party:

${fb.install.map((c) => `\`\`\`bash\n${c}\n\`\`\``).join('\n\n')}`;
  return `### Stack tags

${stackTagLines(Object.keys(STACK_TAGS))}

### The entries (checked ${CATALOG.checked})

One line each: the entry, when it applies, its licence, what it installs and the commands (show each command alone in its own bash block when you offer it).

${offerOrder(RECOMMENDED).map((e) => entryLine(e, { full: true })).join('\n')}

${fallback}`;
}

/** The tip table for `next`: per lane, which entries could be missing. No commands: the tip points at /laneconductor:suggest-skills. */
export function skillTipsBlock() {
  const lanes = ['brainstorm', 'plan', 'implement', 'review', 'quality-gate', 'merge', 'deploy'];
  return `Skills that fit each step's lane:\n\n${lanes.map((l) => `- ${l}: ${entriesForLanes([l]).map((e) => `\`${e.name}\``).join(', ')}`).join('\n')}`;
}

/**
 * The starter set at the end of setup and new-project (REQ-9), generated from the catalog entries that say when they fit a project
 * (`setup_fit`): one line each, so a new entry flows in. It only shows: no command is run and nothing is installed without a yes.
 */
const recommendParts = (entries, { fits = true } = {}) => {
  const list = offerOrder(entries).map((e) => `${entryLine(e, { brief: true })}${fits ? ` It fits when ${e.setup_fit[0].toLowerCase()}${e.setup_fit.slice(1).replace(/\.$/, '')}.` : ''}`).join('\n');
  const addons = entries.filter((e) => e.kind === 'addon');
  const both = addons.length >= 2 // both add-ons of the live catalog; one add-on alone keeps only its own offer
    ? `

When BOTH add-ons (${addons.map((e) => `\`${e.name}\``).join(' and ')}) are missing and you offer both, also show "Both add-ons in one line:" and this block, then the reload step. When only one of them is missing, keep its offer above and add nothing.

Both add-ons in one line:

\`\`\`bash
${ADDONS_INSTALL}
\`\`\``
    : '';
  return { list, both };
};
export const setupRecommendBlock = (entries = STARTER) => {
  const { list, both } = recommendParts(entries);
  return `After the project is read, offer a STARTER SET: say which optional plugins would help THIS project, three or four at most, once. Look at what you read (the stack from \`package.json\`, the marker files and \`conductor/tech-stack.md\`, the git history, the CI files, what the person told you and the Type of the tracks) and pick only the entries below that fit and are not installed; say in a sentence why each fits.
Order them: the core process skills first, a design skill when the project has a UI, the stack's pack, then the rest. Never more than four. If one is already installed, say
nothing about it. If nothing fits, say nothing and go on. End the offer with the statement: "Install them whenever you like; otherwise I will offer each one when it comes up (when you plan a screen, deploy, and so on)."
If the person says later, record nothing: each item is offered again at its own moment, as \`/${NAMES.base}:suggest-skills\` describes.

How to offer: show an entry's install commands, each alone in its own bash block (no leading \`$\`), then the reload step (\`${RELOAD_COMMAND}\`), and say plainly what it installs. You only show them: never run an install command yourself, and install nothing unless the person says yes. Mention each plugin once in this session; if the person declines, do not bring it up again. Detect what is installed from the session's skills list and \`claude plugin list\`; if you cannot tell, take the person's word.

${list}${both}`;
};

/**
 * The add-ons offer of the front door of `next` (explain level): the same entries and the same one-line install as the starter set, without its
 * setup-time prose, which `ops/next.md` ("The front door") already says in its own words. Keeps `next` from growing (track AM-10144, Phase 10).
 */
export const frontDoorBlock = (entries = ADDONS) => {
  const { list, both } = recommendParts(entries, { fits: false }); // the triggers ("Mention only when") already say when an add-on fits
  // the one line for both add-ons is in the first-track card of the same file: written once there, not twice
  const pointer = both ? '\n\nWhen BOTH add-ons are missing and you offer both, show the "one line" of the first-track card above instead of two blocks, then the reload step.' : '';
  return `Show each entry's commands alone in its own bash block (no leading \`$\`), then the reload step (\`${RELOAD_COMMAND}\`), and say plainly what it installs.

${list}${pointer}`;
};

/**
 * The README block on skill suggestions (REQ-7): nothing is installed without the person's yes, from which sources, and what it runs.
 * The directory's security scan reads this, so it is plain and generated from the catalog (the sources cannot drift from the entries).
 */
export function skillAdvisorReadmeBlock() {
  const sources = [...new Set(RECOMMENDED.map((e) => e.source.add))].map((a) => `\`${a}\``).join(', ');
  return `## Skill suggestions: nothing is installed without your yes

\`/${NAMES.base}:suggest-skills\` and the start of each lane may suggest a skill. **It installs nothing without your yes and never runs an install itself**: it shows the commands for you to run. To look, it runs only \`claude plugin list\` and \`git rev-parse --git-common-dir\` and reads \`.claude/skills/\` and \`~/.claude/skills/\`. Sources, all public: ${sources}. A plugin that installs a program or a hosted connection says so first.`;
}

export function skillEdits() {
  const recommend = [RECOMMEND_MARKER, setupRecommendBlock()];
  return {
    'ops/board.md': [
      [BOARD_MISSING_ANCHOR, `If the script is not found, the ${NAMES.board} add-on is not installed: say so in a sentence, show the commands in "If the board script is missing" at the end of this file, and stop.`],
      [BOARD_LAST_RULE, BOARD_MISSING],
    ],
    'ops/new-project.md': [recommend],
    'ops/next.md': [[RECOMMEND_MARKER, frontDoorBlock(ADDONS)], [TIPS_MARKER, skillTipsBlock()], [CURRENT_TRACK_MARKER, CURRENT_TRACK], [ONE_LINE_MARKER, oneLineBlock()]],
    'SKILL.md': [[TRACK_CONTEXT_MARKER, TRACK_CONTEXT]],
    'ops/suggest-skills.md': [[CURRENT_TRACK_MARKER, CURRENT_TRACK], [RULES_MARKER, OFFER_RULES], [SKILLS_MARKER, skillsCatalogBlock()]],
    'ops/tracks.md': [[TYPE_OFFER_MARKER, typeOfferBlock()]],
    ...Object.fromEntries(['brainstorm', 'plan', 'implement', 'review', 'quality-gate', 'merge'].map((lane) => [`lanes/${lane}.md`, [[LANE_OFFER_MARKER, laneOfferBlock(lane)]]])),
    'deploy/deploy.md': [[LANE_OFFER_MARKER, laneOfferBlock('deploy')]],
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
// Track AM-10131: without the add-on's tools, where a finished lane goes is read with the workflow grammar (one reference), never guessed.
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
const OPEN_NOTE = 'To open it, use the Artifact tool, action `open`, with the stored URL, and give me the link. Opening never calls `publish` or regenerates anything; only `refresh` does.';

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
    + '2. Re-read the track\'s `index.md` right before editing, then change only the marker lines: `**Lane**` and `**Lane Status**` (a progress or phase update is `**Progress**` or `**Phase**`). A move out of `waiting` also clears `Owner Action`, `Owner Action Due` and `Waiting for reply`.\n'
    + '3. Say what changed. Moving a track only sets markers; it starts no work.',
  comment: 'Add a comment to track {{track}}: {{text}}. The procedure is the skill file `ops/tracks.md` (`comment`).\n\n'
    + '1. Find the track\'s folder if the number is unclear, then append my words to its `conversation.md` as `> **human**: <my words>` (every further line also starts with `> `); create the file if it is missing.\n'
    + '2. Confirm the entry was added. If the track has an `**Owner Action**` and my comment says it is done, also do what "The owner\'s reply" says in the skill file `lanes/implement.md` (under "Reference"). Otherwise do not answer it or change the track unless I ask.',
  next: 'What\'s next: {{option}} (nothing given means the whole project). Read only: change no file and no marker, install nothing and push nothing. The procedure is the skill file `ops/next.md`; read it in full first and follow it.\n\n'
    + '1. Gather where the project stands as the file says, with Glob, Grep, Read and read-only git (`git branch --list`, `git merge-base --is-ancestor`, `git log`); nothing else.\n'
    + '2. Name exactly one next step with the exact command to type, one sentence on what it does and one on why it comes next, the other candidates in one line, and the link to the reference. `explain` adds the primer, `short` gives one line, a track number limits the answer to that track. With no `conductor/` folder the default is a card with what the analysis found and ONE reply, `go`, which runs `setup` (or `new-project` for a new project): the card names the command and `go` is the consent.\n'
    + '3. Ask before writing anything (the only write is a saved level, only if I ask for it). Run the step only if I say go; a command that asks for confirmation itself (`merge`, `deploy`) is named without that offer.',
  deploy: 'Deploy: {{action}}. This runs only because I named it; do nothing else with it.\n\n'
    + 'Follow `deploy/deploy.md`, or `deploy/setup-deploy.md` when the action is `setup`; both are under "Reference" below. Show me each deploy command before you run it; never deploy without my yes.',
  'repair-duplicates': 'Repair duplicate track numbers: two folders under `conductor/tracks/` that start with the same number are ambiguous. Nothing is renamed until I say yes. The folder and id formats are in the skill file `ops/tracks.md`.\n\n'
    + '1. Find them: list the folder names under `conductor/tracks/` and group them by number (both naming conventions exist, see "Finding a track" in the skill index). Also check other branches: `git for-each-ref refs/heads refs/remotes` and `git ls-tree -d --name-only <ref> conductor/tracks/` show folders that exist only there. If there is no duplicate, say so and stop. A folder that exists only on another branch is not a duplicate yet; it becomes one when that branch is merged.\n'
    + '2. For each duplicate number, the older folder keeps it: find when each folder first appeared (`git log --diff-filter=A --format=%aI -- <folder>`, the oldest line) and treat the later one as the newer. The new number is the highest track number found on any branch plus one; the new name is the same prefix and slug with that number.\n'
    + '3. Show me the plan, one line per rename: "Rename <old folder> to <new folder>; update its `# Track` heading in index.md, plan.md, test.md, history.md and conversation.md? [default: yes]". Also say which other tracks mention the old number in `**Depends On**` (do not change those; they may mean either track, and I decide). Wait for my yes; on no, change nothing.\n'
    + '   When the second folder exists only on another branch, ask me which branch is the keeper (its folder keeps the number), then do steps 4 and 5 on the branch that carries the folder being renumbered: check that branch out in its own worktree (`git worktree add <dir> <branch>`), so a rename on the wrong branch leaves the duplicate in place.\n'
    + '4. On yes: `git mv` the folder, fix the id in the headings (the number only; keep the prefix and the title), and append a comment to the renamed track\'s `conversation.md` saying it was renumbered from the old number. Commit only those paths (explicit paths, never `git add -A`). Never push.\n'
    + '5. Regenerate `conductor/tracks-summary.md` if the project keeps one (by hand: the same rows, the renamed folder under its new number), then report what was renamed.\n'
    + '   A note that a folder is also named differently on another branch stays until that branch is merged or deleted, or carries the same folder name; say so.',
  'new-project': 'New project: {{idea}} (nothing given means ask me). This runs when I named it, or said go to a `next` card that named it. The procedure is the skill file `ops/new-project.md`; read it in full first and follow it.\n\n'
    + '1. Detect whether this is an empty folder (an existing repository is for `setup`: say so and stop).\n'
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
  board: [`In Claude Code, type the refresh as \`/${NAMES.base}:board refresh\`.`, PUBLISH_NOTE, OPEN_NOTE, BOARD_SCRIPT_NOTE],
};

/** The one line that names the add-on's tools for a command whose catalog procedure uses them; generated, never hand-written. */
export function connectorLine(cmd) {
  const tools = toolsUsedBy(cmd.procedure);
  if (!tools.length) return null;
  if (cmd.readOnly) return `If the ${NAMES.parallel} add-on's tools are present (${tools.map((t) => `\`${toolRef(t)}\``).join(', ')}), use them to read: they report how fresh the state is. This command writes nothing. If they are not present, the steps above are the whole job.`;
  return `If the ${NAMES.parallel} add-on's tools are present (${tools.map((t) => `\`${toolRef(t)}\``).join(', ')}), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass \`update_track\` the \`base\` from \`get_track\` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.`;
}

export const BASE_HELP_FOOTER = `Works on its own: every command edits the track files directly. Needs the ${NAMES.board} add-on: board (only to refresh); without it it says so and shows how to get it. With the ${NAMES.parallel} add-on installed, the commands use its conflict-checked tools and dispatch its track-runner sub-agent.`;

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
4. With no \`conductor/\` yet it offers \`go\`: set up and file your plan as tracks. Add-ons (${ADDONS.map((e) => `\`${e.name}\``).join(', ')}) are yours to install.
${NEXT_JOURNEY_END}`;
