// The command catalog (track AM-10116, REQ-1): the single, agent-neutral source of every LaneConductor command.
// Two adapters read it: the stdio server (MCP prompts and the `help` tool, src/server.mjs) and the plugin generator
// (scripts/build-plugin.mjs writes commands/*.md for Claude Code). The pattern is FITI's (functions/src/mcp.js: one table, registered
// as MCP prompts, plus a help prompt with example phrases).
//
// NEUTRAL: nothing here may name a Claude tool prefix, a plugin path, a Claude sub-agent or Claude's frontmatter. Claude-only
// behaviour (frontmatter, sub-agent names, the fallback line, the Artifact tool) lives in the generator's profile.
//
// An entry: name, group, title, description (one line), example (one natural phrase), args [{ name, hint, description, required }],
// connector (the procedure uses connector tools: the Claude adapter adds the fallback line), needsLc (set when the command needs the
// `lc` command-line tool or the board script for a part of its work), procedure (text with {{arg}} placeholders), or `render: 'help'`.

export const GROUPS = ['plan and deliver', 'create and manage', 'board', 'setup and deploy'];

const TRACK = { name: 'track', hint: 'track number or title', description: 'The track number (10106 or AM-10106) or a part of its title.', required: true };
const ACTION = (hint, description) => ({ name: 'action', hint, description, required: false });

const STATE = 'Change state only with `update_track`, passing the `base` from `get_track`; on a CONFLICT, re-read and retry.';
const LANE = (lane, file, extra = '') => (
  `Work on track {{track}} in the ${lane} lane. The procedure is the ${lane} lane guide (skill file \`${file}\`); follow it and do not restate it here.\n\n`
  + `1. Call \`get_context\` with lane \`${lane}\`: it returns the guide, as advice. Then call \`get_track\` for the track (\`list_tracks\` first if I gave a title). ${STATE}\n`
  + `2. Work through the guide.${extra}`
);
const WORKTREE = 'RECOMMEND, do not start: suggest one sub-agent per track, each in its own worktree, because that isolates the work from the primary checkout, lets several tracks run in parallel, and keeps them from colliding.';
const LANE_WORK = (lane, dispatch) => (
  `1. Call \`get_context\` with lane \`${lane}\` and \`get_track\` for the track.\n`
  + `2. ${WORKTREE}\n`
  + `3. Show the exact dispatch you would make, with this prompt: "${dispatch}"\n`
  + `4. Start nothing until I say yes. If I decline, or sub-agents are unavailable (chat), do the lane yourself in this session following the guide.\n`
  + '5. Record state with `update_track` and the `base` from `get_track`.'
);
const SHOW_BOARD = (
  'Show the existing board. Read only: never regenerate or republish it.\n\n'
  + '1. Find the stored board URL (`board.artifact_url` in `.laneconductor.json`; step 2 of the skill file `ops/board.md`).\n'
  + '2. Open the stored board and give me the link, when the snapshot was generated (its read time) and the privacy note: the board is private, it is a snapshot, and sharing it shares the documents of the tracks that are not done.\n'
  + '3. If no board URL is stored, say so and suggest `refresh-board`; do not create one.'
);
const REFRESH_BOARD = (
  'Refresh the board: rebuild its page and data from the track files and republish them to the stored URL. The procedure is the skill file `ops/board.md`; follow it, including its privacy handling.\n\n'
  + '1. Generate the page and data (step 1): `lc board --site <dir> --json`, or the board script when `lc` is missing. If neither exists, say so and stop; do not build the page by hand.\n'
  + '2. Find the stored URL (step 2) and update that board in place (step 3a). If no URL is stored, ask me "Create a private board for this project?" and create nothing without my yes (step 3b).\n'
  + '3. Report the link, when it was generated, and anything the privacy scan withheld, by track number and file name.'
);

export const COMMANDS = [
  {
    name: 'plan', group: 'plan and deliver', title: 'Plan a track',
    description: 'Plan a track: write its spec, plan and test cases (the plan lane)',
    example: 'plan track 10106', args: [TRACK], connector: true,
    procedure: LANE('plan', 'lanes/plan.md'),
  },
  {
    name: 'brainstorm', group: 'plan and deliver', title: 'Brainstorm a track',
    description: 'Brainstorm a track: explore options and decisions before planning',
    example: 'brainstorm the export feature', args: [TRACK], connector: true,
    procedure: LANE('brainstorm', 'lanes/brainstorm.md'),
  },
  {
    name: 'implement', group: 'plan and deliver', title: 'Implement a track',
    description: 'Implement a track from its plan (recommends one sub-agent per track in its own worktree)',
    example: 'implement track 10106', args: [TRACK], connector: true,
    procedure: `Implement track {{track}}. The procedure is the implement lane guide (skill file \`lanes/implement.md\`); follow it and do not restate it here.\n\n`
      + LANE_WORK('implement', 'Work track N through its implement lane: read the lane guide, follow plan.md, commit in your worktree, report commits and test results; do not merge or push.'),
  },
  {
    name: 'review', group: 'plan and deliver', title: 'Review a track',
    description: 'Review a track\'s implementation (recommends one sub-agent per track in its own worktree)',
    example: 'review track 10106', args: [TRACK], connector: true,
    procedure: `Review track {{track}}. The procedure is the review lane guide (skill file \`lanes/review.md\`); follow it and do not restate it here.\n\n`
      + LANE_WORK('review', 'Review track N in the review lane: read the lane guide, evaluate the work, do not fix it, report a verdict with evidence; do not merge or push.'),
  },
  {
    name: 'quality-gate', group: 'plan and deliver', title: 'Run the quality gate',
    description: 'Run the quality gate on a track (evaluates, never fixes)',
    example: 'run the quality gate on 10106', args: [TRACK], connector: true,
    procedure: LANE('quality-gate', 'lanes/quality-gate.md'),
  },
  {
    name: 'merge', group: 'plan and deliver', title: 'Merge a track',
    description: 'Merge a finished track, or open its PR',
    example: 'merge track 10106', args: [TRACK], connector: true,
    procedure: LANE('merge', 'lanes/merge.md', '\n3. Ask me before any merge or push; do neither without my yes.'),
  },
  {
    name: 'run', group: 'plan and deliver', title: 'Run a track end to end',
    description: 'Take a track through its lanes (recommends one sub-agent per track, in its own worktree)',
    example: 'run track 10106 end to end', args: [TRACK], connector: true,
    procedure: 'Run track {{track}} end to end. The guardrails are the skill file `ops/working-a-track.md`; read it, and read the lane guide for each lane you run.\n\n'
      + '1. Call `get_track` for the track (`list_tracks` first if I gave a title) and `get_context` for the lane it is in; `get_context` also lists where each lane goes next.\n'
      + '2. RECOMMEND, do not start: suggest one sub-agent per track, each in its own worktree. Why: isolation from the primary checkout, several tracks in parallel, no collisions.\n'
      + '3. Show the exact dispatch you would make, with this prompt: "Work track N through its <current lane> lane: read the lane guide, do the work, commit in your worktree, report commits and test results; do not merge or push." One dispatch per lane, one agent per track.\n'
      + '4. Start nothing until I say yes. If I decline, or sub-agents are unavailable (chat), work the lane in this session following its lane guide.\n'
      + '5. Record state with `update_track` and the `base` from `get_track`. Ask me before any merge or push.\n'
      + '6. If I ask for the board along the way: building it needs the `lc` command-line tool or the board script; if neither exists, say so and stop that step.',
  },
  {
    name: 'review-plan', group: 'plan and deliver', title: 'Review a plan',
    description: 'Review a track\'s spec and plan for gaps with a read-only reviewer',
    example: 'review the plan of track 10106', args: [TRACK],
    procedure: 'Review the plan of track {{track}}. Read only; change no file and no marker.\n\n'
      + '1. Hand the review to a read-only sub-agent with the prompt "Review the spec and plan of track N and report gaps, missing tests, unclear tasks and risks." It reads the track files and returns advice.\n'
      + '2. Show me its answer as it is. Where sub-agents are unavailable (chat), read `spec.md` and `plan.md` of the track yourself and give the same four headings: gaps, missing tests, unclear tasks, risks.',
  },
  {
    name: 'new', group: 'create and manage', title: 'Create a track',
    description: 'Create a new track from a title and a problem statement',
    example: 'new track: export the report as CSV',
    args: [{ name: 'title', hint: 'title: what and why', description: 'The title and the problem, in your words.', required: true }], connector: true,
    procedure: 'Create a track for: {{title}}. The procedure is the skill file `ops/tracks.md` (`newTrack`).\n\n'
      + '1. Call `list_tracks` with a `query` from the title first, so you extend an existing track instead of duplicating it; if one matches, show it and ask whether to use it. Otherwise call `create_track` with a short `title` and a `problem` in my words (add `type` only if it is not dev); it returns the track number and a `base`.\n'
      + '2. Report the number and folder. Do not plan it unless I ask; `plan` is the next step.',
  },
  {
    name: 'bug', group: 'create and manage', title: 'File a bug',
    description: 'File a bug as a track (a bug form with a regression-test case)',
    example: 'flag a bug: the export button does nothing',
    args: [{ name: 'description', hint: 'what is broken, and how to reproduce it', description: 'What is broken, and how to reproduce it.', required: true }], connector: true,
    procedure: 'File a bug track for: {{description}}. The procedure is the skill file `ops/tracks.md` (`reportaBug`).\n\n'
      + '1. Call `list_tracks` with a `query` from the symptom first; if a track already covers it, show it and ask whether to add to it (`append_conversation`) instead. Otherwise call `create_track` with `track_kind` set to `bug`, a short `title` and a `problem` giving the symptom, the steps to reproduce and the expected result, in my words. The connector writes the bug form (Symptom, Steps to reproduce, Expected result, Actual result, Suspected area, Environment) and a regression-test case first in test.md.\n'
      + '2. Report the number and folder. Do not start fixing it unless I ask.',
  },
  {
    name: 'feature', group: 'create and manage', title: 'File a feature request',
    description: 'File a feature request as a track (a feature form)',
    example: 'feature request: let me export the report as CSV',
    args: [{ name: 'description', hint: 'the feature and why it is wanted', description: 'The feature and why it is wanted.', required: true }], connector: true,
    procedure: 'File a feature track for: {{description}}. The procedure is the skill file `ops/tracks.md` (`featureRequest`).\n\n'
      + '1. Call `list_tracks` with a `query` from the request first; if a track already covers it, show it and ask whether to add to it (`append_conversation`) instead. Otherwise call `create_track` with `track_kind` set to `feature`, a short `title` and a `problem` giving the need and the wanted outcome, in my words. The connector writes the feature form (The need, Who it is for, Wanted outcome, Acceptance criteria, Out of scope).\n'
      + '2. Report the number and folder. Do not start planning it unless I ask.',
  },
  {
    name: 'status', group: 'create and manage', title: 'Status',
    description: 'Show where one track, or all tracks, stand',
    example: 'status of 10106',
    args: [{ name: 'track', hint: 'track number', description: 'A track number or title; empty means every track that is not done.', required: false }], connector: true,
    procedure: 'Show status for: {{track}} (nothing given means every track not done). Read only; change nothing. The procedure is the skill file `ops/tracks.md` (`status`).\n\n'
      + '1. With a track number or title: call `get_track` and report lane, lane status, progress, phase, summary and the last conversation entries, and whether a human comment is waiting for a reply.\n'
      + '2. With nothing: call `list_tracks` and print the tracks grouped by lane, one line each (id, title, lane status, progress).\n'
      + '3. If a result says it is stale or possibly stale, say so before relying on it.',
  },
  {
    name: 'move', group: 'create and manage', title: 'Move a track',
    description: 'Move a track to another lane, or set its status markers',
    example: 'move 10106 to implement',
    args: [{ name: 'track', hint: 'track number', description: 'The track number.', required: true }, { name: 'lane', hint: 'lane[:status]', description: 'A lane or lane:status; a bare lane means queue.', required: true }], connector: true,
    procedure: 'Move track {{track}} to {{lane}} (a `lane` or `lane:status`; a bare lane means `queue`). The procedure is the skill file `ops/tracks.md` (`move`, `pulse`, `updateTrack`).\n\n'
      + '1. Check `conductor/workflow.json` (or `get_context`, which lists the lane transitions) for a `lane:status` that lane defines.\n'
      + '2. Call `get_track`, then `update_track` with the `base` from `get_track` and `markers` such as `{"Lane": "implement", "Lane Status": "queue"}`; a progress or phase update is the same call with `Progress` or `Phase`. On a CONFLICT, re-read with `get_track`, merge, and retry; never work around it.\n'
      + '3. Say what changed. Moving a track only sets markers; it starts no work.',
  },
  {
    name: 'comment', group: 'create and manage', title: 'Comment on a track',
    description: 'Add a comment to a track\'s conversation',
    example: 'comment on 10106: ship it after the review',
    args: [{ name: 'track', hint: 'track number', description: 'The track number.', required: true }, { name: 'text', hint: 'comment text', description: 'The comment, in your words.', required: true }], connector: true,
    procedure: 'Add a comment to track {{track}}: {{text}}. The procedure is the skill file `ops/tracks.md` (`comment`).\n\n'
      + '1. Resolve the track with `get_track` if the number is unclear, then call `append_conversation` with `author` `human` (this is my own text) and my words as `body`, without any `>` or `**author**` prefix; the connector formats the entry.\n'
      + '2. Confirm the entry was added. Do not answer it or change the track unless I ask.',
  },
  {
    name: 'workflow', group: 'create and manage', title: 'Workflow',
    description: 'Show the lane workflow, or change one lane setting',
    example: 'show the workflow',
    args: [{ name: 'change', hint: 'lane key value', description: 'A lane, a key and a value, e.g. review max_retries 3; empty means show.', required: false }],
    procedure: 'Workflow: {{change}} (nothing given means show). The procedure is the skill file `ops/tracks.md` (`workflow`, `workflow set`).\n\n'
      + '1. Read `conductor/workflow.json` and print a table: lane, auto action, `on_success`, `on_failure`, retries, model.\n'
      + '2. With `lane key value`, confirm the one field with me, change only that field in the file, and print `workflow.json updated: lanes.<lane>.<key> = <value>`. Edit nothing else.',
  },
  {
    name: 'recipes', group: 'create and manage', title: 'List recipes',
    description: 'List the recipes available (the shipped library and your own), optionally matching a stack',
    example: 'which recipes do I have for firebase hosting',
    args: [{ name: 'stack', hint: 'stack words', description: 'Words naming a stack or a need, e.g. "nodejs firebase-hosting"; empty lists everything.', required: false }],
    procedure: 'Recipes: {{stack}} (nothing given means list them all). Read only; change nothing. The procedure is the skill file `ops/recipes.md` ("Find and rank").\n\n'
      + '1. Read both libraries in the documented order: the shipped one inside the skill, then my own (`recipes.path` in `.laneconductor.json` or the `LC_RECIPES` environment variable). Use the `lc-recipe-match` script when it exists.\n'
      + '2. Show at most five matches (all of them when I gave no words), each with its name, one line on why, its `verified` date and any freshness warning. If neither library exists, say so; that is a normal answer.\n'
      + '3. Recommend, never order: apply nothing. Applying a recipe is `ops/apply-recipe.md`, and only when I choose one.',
  },
  {
    name: 'add-recipe', group: 'create and manage', title: 'Add a recipe',
    description: 'Turn something solved and verified into a recipe in your own library (runs only because you named it)',
    example: 'add a recipe for the deploy setup we just finished',
    args: [{ name: 'solved', hint: 'what was solved', description: 'What was solved and worked, in your words; empty means ask me.', required: false }],
    procedure: 'Add a recipe for: {{solved}} (nothing given means ask me what was solved). This runs only because I named it. The procedure is the skill file `ops/add-recipe.md`; read it in full first and follow it.\n\n'
      + '1. Check the criteria (reusable, verified in real use, not obvious from general knowledge, names a real incident or fact) and search both libraries first: update an existing recipe instead of duplicating it.\n'
      + '2. Draft in the recipe format, run the checker and show me its result.\n'
      + '3. Save nothing until I say yes. Then save to MY library as a local commit; never push.',
  },
  {
    name: 'new-project', group: 'setup and deploy', title: 'Start a new project',
    description: 'Start a project: a short interview, recipe recommendations, the conductor scaffold and the first tracks (runs only because you named it)',
    example: 'start a new project: a habit tracker', connector: true,
    args: [{ name: 'idea', hint: 'name or idea', description: 'The project name or a few words about the idea; empty means ask me.', required: false }],
    procedure: 'New project: {{idea}} (nothing given means ask me). This runs only because I named it. The procedure is the skill file `ops/new-project.md`; read it in full first and follow it.\n\n'
      + '1. Detect whether this is an empty folder or an existing repository (then offer only the `conductor/` scaffold).\n'
      + '2. Interview me in chat, one question at a time, short, stopping early when the answers are enough.\n'
      + '3. Recommend up to five recipes with a reason and a date each; I choose, and nothing is applied silently. If there are no recipes, say so and continue.\n'
      + '4. Show what the scaffold will create and ask before writing it, then create the first tracks in the plan lane.\n'
      + '5. Summarize, then ask before any commit. Never push.',
  },
  {
    name: 'help', group: 'create and manage', title: 'Help',
    description: 'List every LaneConductor command with an example phrase',
    example: 'what can LaneConductor do', args: [], render: 'help',
  },
  {
    name: 'board', group: 'board', title: 'Board',
    description: 'Show or refresh the project board (asks which when unclear)',
    example: 'show the board', needsLc: 'refreshing', args: [ACTION('show | update', '`show` opens the existing board, `update` refreshes it; empty means ask.')],
    procedure: 'Board: {{action}}. `show` means the existing board, `update` means refresh it. If that is empty or unclear, ask me which one I want before doing anything: showing the existing board (never regenerates) or refreshing it (rebuild and republish).\n\n'
      + `To show:\n${SHOW_BOARD}\n\nTo update:\n${REFRESH_BOARD}`,
  },
  {
    name: 'show-board', group: 'board', title: 'Show the board',
    description: 'Open the existing board and give its link (never regenerates it)',
    example: 'open the board', args: [], procedure: SHOW_BOARD,
  },
  {
    name: 'refresh-board', group: 'board', title: 'Refresh the board',
    description: 'Rebuild the board from the track files and republish it to its stored URL',
    example: 'refresh the board', needsLc: 'always', args: [], procedure: REFRESH_BOARD,
  },
  {
    name: 'setup', group: 'setup and deploy', title: 'Set up LaneConductor',
    description: 'Set up LaneConductor in this repository (runs only because you named it)',
    example: 'set up LaneConductor here',
    args: [ACTION('scaffold', '`scaffold` generates the project context files; empty runs the basic setup.')],
    procedure: 'Setup: {{action}}. This runs only because I named it; do nothing else with it.\n\n'
      + 'Follow the skill file `setup/setup.md`, or `setup/scaffold.md` (templates in `setup/templates.md`) when the action is `scaffold`. Read the file in full first and tell me what you are about to create or change before you write anything.',
  },
  {
    name: 'deploy', group: 'setup and deploy', title: 'Deploy',
    description: 'Set up or run deployment for this project (runs only because you named it)',
    example: 'deploy this project',
    args: [ACTION('setup', '`setup` generates the deploy configuration; empty runs the deployment.')],
    procedure: 'Deploy: {{action}}. This runs only because I named it; do nothing else with it.\n\n'
      + 'Follow the skill file `deploy/deploy.md`, or `deploy/setup-deploy.md` when the action is `setup`. Read the file in full first and show me each deploy command before you run it; never deploy without my yes.',
  },
];

export const COMMAND_NAMES = COMMANDS.map((c) => c.name);
export const byName = (name) => COMMANDS.find((c) => c.name === name);

/** `<track number or title>` for a required argument, `[show | update]` for an optional one; '' when there are none. */
export const argumentHint = (cmd) => cmd.args.map((a) => (a.required ? `<${a.hint ?? a.name}>` : `[${a.hint ?? a.name}]`)).join(' ');

const NONE = '(none given)';

/** Fills {{name}} with the values; a missing optional value reads "(none given)". A missing required one is an error naming it. */
export function fillProcedure(cmd, values = {}) {
  const missing = cmd.args.filter((a) => a.required && (values[a.name] === undefined || String(values[a.name]).trim() === ''));
  if (missing.length) throw new Error(`Missing required argument${missing.length > 1 ? 's' : ''}: ${missing.map((a) => a.name).join(', ')}`);
  return cmd.procedure.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = values[k];
    return v === undefined || String(v).trim() === '' ? NONE : String(v).trim();
  });
}

/** The list `help` returns, grouped, one example phrase per command, and the note on the `lc` command-line tool. */
export function helpText() {
  const lines = ['LaneConductor commands. Say one in your own words, or use it as a prompt.', ''];
  for (const g of GROUPS) {
    lines.push(`${g[0].toUpperCase()}${g.slice(1)}`);
    for (const c of COMMANDS.filter((x) => x.group === g)) {
      const args = argumentHint(c);
      lines.push(`- ${c.name}${args ? ` ${args}` : ''}: ${c.description}. Example: "${c.example}"`);
    }
    lines.push('');
  }
  const needs = COMMANDS.filter((c) => c.needsLc);
  lines.push(
    `Needs the \`lc\` command-line tool (or the board script) when it is missing: ${needs.map((c) => `${c.name}${c.needsLc === 'refreshing' ? ' (only to refresh)' : ''}`).join(', ')}. `
    + 'Without it they say so and stop; every other command works through the connector tools or by editing the track files.',
  );
  return lines.join('\n');
}

/** What `prompts/get` and the help tool return for a command. */
export const renderCommand = (cmd, values) => (cmd.render === 'help' ? helpText() : fillProcedure(cmd, values));

/** Machine-readable form for the `help` tool: grouped, one example each. */
export function helpData() {
  return {
    commands: COMMANDS.map((c) => ({ name: c.name, group: c.group, description: c.description, arguments: argumentHint(c), example: c.example, needs_lc: c.needsLc ?? null })),
  };
}
