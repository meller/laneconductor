// The command catalog (track AM-10116, REQ-1): the single, agent-neutral source of every LaneConductor command.
// Two adapters read it: the stdio server (MCP prompts and the `help` tool, src/server.mjs) and the plugin generator
// (scripts/build-plugin.mjs writes commands/*.md for Claude Code). The pattern is FITI's (functions/src/mcp.js: one table, registered
// as MCP prompts, plus a help prompt with example phrases).
//
// NEUTRAL: nothing here may name a Claude tool prefix, a plugin path, a Claude sub-agent or Claude's frontmatter. Claude-only
// behaviour (frontmatter, sub-agent names, the fallback line, the Artifact tool) lives in the generator's profile.
//
// An entry: name, group, title, description (one line), example (one natural phrase), args [{ name, hint, description, required }],
// connector (the procedure uses connector tools: the Claude adapter adds the fallback line), readOnly (the command writes nothing: the adapter says the tools are for reading), needsBoardScript (set when the command needs the
// board script of the optional board add-on for a part of its work), procedure (text with {{arg}} placeholders), or `render: 'help'`.

export const GROUPS = ['start here', 'plan and deliver', 'create and manage', 'board', 'setup and deploy'];

const TRACK = { name: 'track', hint: 'track number or title', description: 'The track number (10106 or AM-10106) or a part of its title.', required: true };
const ACTION = (hint, description) => ({ name: 'action', hint, description, required: false });

const STATE = 'Change state only with `update_track`, passing the `base` from `get_track`; on a CONFLICT, re-read and retry.';
// Track AM-10131: where a finished lane action sends the track is the workflow's decision, resolved by the connector; never worked out from the raw file.
const FINISH = 'When the lane action finishes, move the track with `update_track` and `outcome` (`success` or `failure`): it applies the workflow\'s transition, which `get_track` shows as `valid.next`. Never work the target out from workflow.json yourself.';
const LANE = (lane, file, extra = '') => (
  `Work on track {{track}} in the ${lane} lane. The procedure is the ${lane} lane guide (skill file \`${file}\`); follow it and do not restate it here.\n\n`
  + `1. Call \`get_context\` with lane \`${lane}\`: it returns the guide, as advice. Then call \`get_track\` for the track (\`list_tracks\` first if I gave a title). ${STATE}\n`
  + `2. Work through the guide.${extra}`
  + (['plan', 'quality-gate'].includes(lane) ? `\n3. ${FINISH}` : '')
);
// Track AM-10143 (owner rule): search first, the default is update, not create. One step shared by `new`, `bug` and `feature`.
const REUSE = (what) => (
  `Search first; update is the default, create is the fallback. Call \`list_tracks\` with \`include_done\` and a \`query\` of one key word of ${what} (repeat with two or three other words), so every lane is searched: the backlog and done too. Read the best matches. `
  + 'If one fits, say so and ask me "Update track N (title, lane) with this? [default: yes]". On yes, or no answer, extend that track (its spec or plan, through `update_track` with the `base` from `get_track`, and a comment) and do NOT create a track; a done track is reopened only on my explicit yes. '
  + 'Only if I say no, or nothing fits, call `create_track`, and say which tracks you looked at and why none fit. Several small gaps from one session go into one fitting track, an epic or one backlog track, not one track each. If `create_track` answers with `similar_tracks`, show them and offer to move the new content into one of them.'
);
const WORKTREE = 'RECOMMEND, do not start: suggest one sub-agent per track, each in its own worktree, because that isolates the work from the primary checkout, lets several tracks run in parallel, and keeps them from colliding.';
const LANE_WORK = (lane, dispatch) => (
  `1. Call \`get_context\` with lane \`${lane}\` and \`get_track\` for the track.\n`
  + `2. ${WORKTREE}\n`
  + `3. Show the exact dispatch you would make, with this prompt: "${dispatch}"\n`
  + `4. Start nothing until I say yes. If I decline, or sub-agents are unavailable (chat), do the lane yourself in this session following the guide.\n`
  + `5. Record state with \`update_track\` and the \`base\` from \`get_track\`. ${FINISH}`
);
const OPEN_BOARD = (
  'Open the existing board. Read only: never regenerate or republish it.\n\n'
  + '1. Find the stored board URL (`board.artifact_url` in the optional settings file `.laneconductor.json`, see the skill file `ops/settings.md`; step 2 of `ops/board.md`).\n'
  + '2. Open the stored board and give me the link, when the snapshot was generated (its read time) and the privacy note: the board is private, it is a snapshot, and sharing it shares the documents of the tracks that are not done. If it is more than an hour old, say so and suggest refreshing it (this command with the argument `refresh`; the page also has a Refresh board button that copies it).\n'
  + '3. If no board URL is stored, say so and ask me "Create a private board for this project?"; create nothing without my yes, and then follow the refresh procedure below, which builds and publishes it (step 3b of `ops/board.md`).'
);
const REFRESH_BOARD = (
  'Refresh the board: rebuild its page and data from the track files and republish them to the stored URL. The procedure is the skill file `ops/board.md`; follow it, including its privacy handling.\n\n'
  + '1. Generate the page and data (step 1) with the board script, found as step 1 of `ops/board.md` says. If it does not exist, say so and stop; do not build the page by hand.\n'
  + '2. Find the stored URL (step 2) and update that board in place (step 3a). If no URL is stored, ask me "Create a private board for this project?" and create nothing without my yes (step 3b).\n'
  + '3. Report the link, when it was generated, and anything the privacy scan withheld, by track number and file name.'
);

export const COMMANDS = [
  {
    name: 'next', group: 'start here', title: 'What\'s next',
    description: 'Name the one next step for this project and explain it (read only)',
    example: 'what\'s next', readOnly: true,
    args: [{ name: 'option', hint: 'explain | short | track number', description: '`explain` or `short` sets how much it explains; a track number limits it to that track; empty means the whole project.', required: false }],
    procedure: 'What\'s next: {{option}} (nothing given means the whole project). Read only: change no file and no marker, install nothing and push nothing. The procedure is the skill file `ops/next.md`; read it in full first and follow it.\n\n'
      + '1. Gather where the project stands as the file says: its own files and read-only git. With the connector, `list_tracks` and `get_track` give the same facts and say how fresh they are.\n'
      + '2. Name exactly one next step with the exact command to type, one sentence on what it does and one on why it comes next, the other candidates in one line, and the link to the reference. `explain` adds the primer, `short` gives one line, a track number limits the answer to that track.\n'
      + '3. Ask before writing anything (the only write is a saved level, only if I ask for it). Run the step only if I say go.',
  },
  {
    name: 'suggest-skills', group: 'start here', title: 'Suggest skills for this track',
    description: 'What could help with this track: skills you already have that apply, and ones worth installing',
    example: 'what skills help with this track', readOnly: true,
    args: [{ name: 'option', hint: 'all | dry-run | lane', description: '`all` lists the whole catalog; `dry-run` prints the offer and changes nothing; a lane name (plan, implement, review, quality-gate, merge, deploy) limits it to that lane; empty means what fits the work in front of you.', required: false }],
    procedure: 'Suggest skills: {{option}} (nothing given means what fits the work in front of you). Read only: change no track file, install nothing and push nothing. The procedure is the skill file `ops/suggest-skills.md`; read it in full first and follow it.\n\n'
      + '1. Detect which skills are installed (the skills list this session shows, the plugin list the client gives, the skills folder of the project and the skills folder of the user), read the stack from `conductor/tech-stack.md` and the marker files, and the lane and `**Type**` of the track in focus.\n'
      + '2. Compare with the catalog in the file for that lane, Type and stack and recommend only what is missing: at most two, each in one or two plain sentences with the reason and the source, each install command alone in its own bash block. Say plainly when an entry installs a local program.\n'
      + '3. Never run an install: show the commands and let me run them. `dry-run` prints the offer and writes nothing; `all` lists the whole catalog. An entry I decline is remembered per project outside the repository history, only when I say so.',
  },
  {
    name: 'help', group: 'start here', title: 'Help',
    description: 'List every LaneConductor command with an example phrase',
    example: 'what can LaneConductor do', args: [], render: 'help',
  },
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
      + `5. Record state with \`update_track\` and the \`base\` from \`get_track\`. ${FINISH} Ask me before any merge or push.\n`
      + '6. If I ask for the board along the way: building it needs the board script of the board add-on; if it does not exist, say so and stop that step.',
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
      + `1. ${REUSE('the title')} The track you create gets a short \`title\` and a \`problem\` in my words (add \`type\` only if it is not dev); \`create_track\` returns its number and a \`base\`.\n`
      + '2. Report the number and folder of the track you updated or created. Do not plan it unless I ask; `plan` is the next step.',
  },
  {
    name: 'bug', group: 'create and manage', title: 'File a bug',
    description: 'File a bug as a track (a bug form with a regression-test case)',
    example: 'flag a bug: the export button does nothing',
    args: [{ name: 'description', hint: 'what is broken, and how to reproduce it', description: 'What is broken, and how to reproduce it.', required: true }], connector: true,
    procedure: 'File a bug track for: {{description}}. The procedure is the skill file `ops/tracks.md` (`reportaBug`).\n\n'
      + `1. ${REUSE('the symptom')} If a track covers it, add the bug to that track (a comment with \`append_conversation\`, or its spec). The track you create gets \`track_kind\` set to \`bug\`, a short \`title\` and a \`problem\` giving the symptom, the steps to reproduce and the expected result, in my words. The connector writes the bug form (Symptom, Steps to reproduce, Expected result, Actual result, Suspected area, Environment) and a regression-test case first in test.md.\n`
      + '2. Report the number and folder of the track you updated or created. Do not start fixing it unless I ask.',
  },
  {
    name: 'feature', group: 'create and manage', title: 'File a feature request',
    description: 'File a feature request as a track (a feature form)',
    example: 'feature request: let me export the report as CSV',
    args: [{ name: 'description', hint: 'the feature and why it is wanted', description: 'The feature and why it is wanted.', required: true }], connector: true,
    procedure: 'File a feature track for: {{description}}. The procedure is the skill file `ops/tracks.md` (`featureRequest`).\n\n'
      + `1. ${REUSE('the request')} The track you create gets \`track_kind\` set to \`feature\`, a short \`title\` and a \`problem\` giving the need and the wanted outcome, in my words. The connector writes the feature form (The need, Who it is for, Wanted outcome, Acceptance criteria, Out of scope).\n`
      + '2. Report the number and folder of the track you updated or created. Do not start planning it unless I ask.',
  },
  {
    name: 'status', group: 'create and manage', title: 'Status',
    description: 'Show where one track, or all tracks, stand',
    example: 'status of 10106',
    args: [{ name: 'track', hint: 'track number', description: 'A track number or title; empty means every track that is not done.', required: false }], connector: true,
    procedure: 'Show status for: {{track}} (nothing given means every track not done). Read only; change nothing. The procedure is the skill file `ops/tracks.md` (`status`).\n\n'
      + '1. With a track number or title: call `get_track` and report lane, lane status, progress, phase, summary and the last conversation entries, and whether a human comment is waiting for a reply.\n'
      + '2. With nothing: call `list_tracks` and print the tracks grouped by lane, one line each (id, title, lane status, progress).\n'
      + '3. If a result says it is stale or possibly stale, say so before relying on it.\n'
    + '4. End by saying that `next` names the one step to take.',
  },
  {
    name: 'move', group: 'create and manage', title: 'Move a track',
    description: 'Move a track to another lane, or set its status markers',
    example: 'move 10106 to implement',
    args: [{ name: 'track', hint: 'track number', description: 'The track number.', required: true }, { name: 'lane', hint: 'lane[:status]', description: 'A lane or lane:status; a bare lane means queue.', required: true }], connector: true,
    procedure: 'Move track {{track}} to {{lane}} (a `lane` or `lane:status`; a bare lane means `queue`). The procedure is the skill file `ops/tracks.md` (`move`, `pulse`, `updateTrack`).\n\n'
      + '1. Check `conductor/workflow.json` (or `get_context`, which lists the lane transitions) for a `lane:status` that lane defines. If the move is "this lane\'s action finished", take it from `valid.next` of `get_track`, or pass `outcome` to `update_track`; never work that target out from the raw file.\n'
      + '2. Call `get_track`, then `update_track` with the `base` from `get_track` and `markers` such as `{"Lane": "implement", "Lane Status": "queue"}` (or `outcome`, instead of the Lane markers); a progress or phase update is the same call with `Progress` or `Phase`. On a CONFLICT, re-read with `get_track`, merge, and retry; never work around it.\n'
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
    name: 'repair-duplicates', group: 'create and manage', title: 'Repair duplicate track numbers',
    description: 'Find tracks that share a number and renumber the newer folder (asks first)',
    example: 'repair duplicate track numbers', args: [], connector: true,
    procedure: 'Repair duplicate track numbers: two folders under `conductor/tracks/` that start with the same number make `get_track` and `update_track` refuse that number as ambiguous. Nothing is renamed until I say yes. The folder and id formats are in the skill file `ops/tracks.md`.\n\n'
      + '1. Find them: call `list_tracks` and read its "Duplicate track number" warnings (a `create_track` warning names them too). Also check other branches: `git for-each-ref refs/heads refs/remotes` and `git ls-tree -d --name-only <ref> conductor/tracks/` show folders that exist only there. If there is no duplicate, say so and stop. '
      + 'A folder that exists only on another branch is reported by `create_track` as "also named differently on branch X" and becomes a duplicate when that branch is merged.\n'
      + '2. For each duplicate number, the older folder keeps it: find when each folder first appeared (`git log --diff-filter=A --format=%aI -- <folder>`, the oldest line) and treat the later one as the newer. The new number is the highest track number found on any branch plus one; the new name is the same prefix and slug with that number.\n'
      + '3. Show me the plan, one line per rename: "Rename <old folder> to <new folder>; update its `# Track` heading in index.md, plan.md, test.md, history.md and conversation.md? [default: yes]". Also say which other tracks mention the old number in `**Depends On**` (do not change those; they may mean either track, and I decide). Wait for my yes; on no, change nothing. '
      + 'When the second folder exists only on another branch, ask me which branch is the keeper (its folder keeps the number), then do steps 4 and 5 on the branch that carries the folder being renumbered: check that branch out in its own worktree (`git worktree add <dir> <branch>`), so a rename on the wrong branch leaves the duplicate in place.\n'
      + '4. On yes: `git mv` the folder, fix the id in the headings (the number only; keep the prefix and the title), and add one `append_conversation` comment on the renamed track saying it was renumbered from the old number. Commit only those paths (explicit paths, never `git add -A`). Never push.\n'
      + '5. Call `list_tracks` again: the duplicate warning must be gone, and if it reports the summary file stale, say that the next track write regenerates `conductor/tracks-summary.md`. Report what was renamed. The "also named differently on branch X" note stays until that branch is merged or deleted, or carries the same folder name; say so.',
  },
  {
    name: 'workflow', group: 'create and manage', title: 'Workflow',
    description: 'Show the lane workflow, or change one lane setting',
    example: 'show the workflow',
    args: [{ name: 'change', hint: 'lane key value', description: 'A lane, a key and a value, e.g. review max_retries 3; empty means show.', required: false }],
    procedure: 'Workflow: {{change}} (nothing given means show). The procedure is the skill file `ops/tracks.md` (`workflow`, `workflow set`).\n\n'
      + '1. Read `conductor/workflow.json` and print a table: lane, `on_success`, `on_failure` as the resolved `lane:status` (the reference is the skill file `ops/lanes-and-statuses.md`; a bare target is `queue` for another lane, `success` or `failure` for the same lane), retries, model.\n'
      + '2. If the file is still in the older format (bare targets, `auto_action`, the lane names `planning` and `in-progress`), say so and OFFER to rewrite the file to the current format: show the exact new file first, copy the old one to a backup next to it before anything is written, and write nothing until I say yes. Never rename lanes in existing tracks. It works as it is, so declining changes nothing.\n'
      + '3. With `lane key value`, confirm the one field with me, change only that field in the file, and print `workflow.json updated: lanes.<lane>.<key> = <value>`. Edit nothing else.',
  },
  {
    name: 'new-project', group: 'setup and deploy', title: 'Start a new project',
    description: 'Start a project: a short interview, the conductor scaffold and the first tracks (runs only because you named it)',
    example: 'start a new project: a habit tracker', connector: true,
    args: [{ name: 'idea', hint: 'name or idea', description: 'The project name or a few words about the idea; empty means ask me.', required: false }],
    procedure: 'New project: {{idea}} (nothing given means ask me). This runs only because I named it. The procedure is the skill file `ops/new-project.md`; read it in full first and follow it.\n\n'
      + '1. Detect whether this is an empty folder or an existing repository (then offer only the `conductor/` scaffold).\n'
      + '2. Interview me in chat, one question at a time, short, stopping early when the answers are enough.\n'
      + '3. Show what the scaffold will create and ask before writing it, then create the first tracks in the plan lane.\n'
      + '4. Summarize, then ask before any commit. Never push.',
  },
  {
    name: 'board', group: 'board', title: 'Board',
    description: 'Open the project board, or refresh it with the argument refresh',
    example: 'open the board', needsBoardScript: 'refreshing', args: [ACTION('refresh', '`refresh` rebuilds the board from the track files and republishes it to its stored URL; empty opens the existing board.')],
    procedure: 'Board: {{action}} (nothing given means open the existing board). This one command covers the board: no argument opens the existing board, `refresh` rebuilds and republishes it. If the argument is anything else, ask me which one I mean before doing anything.\n\n'
      + `If it is empty, open:\n${OPEN_BOARD}\n\nIf it is \`refresh\`, refresh:\n${REFRESH_BOARD}`,
  },
  {
    name: 'setup', group: 'setup and deploy', title: 'Add LaneConductor to this project',
    description: 'Add LaneConductor to this project: read what is there, confirm the stack and commands, write the conductor/ files (runs only because you named it)',
    example: 'add LaneConductor to this project',
    args: [ACTION('scaffold', '`scaffold` goes straight to the files with no interview; empty reads the project and asks only to confirm.')],
    procedure: 'Setup: {{action}} (nothing given means add LaneConductor to this project). This runs only because I named it; do nothing else with it.\n\n'
      + 'Setup means adding LaneConductor to the project I am in. Follow the skill file `ops/new-project.md`, its existing-repository path; read it in full first.\n'
      + '1. Read package.json (or the equivalent), the README, the CI files and the lint config; infer the project name, the stack and the test and lint commands, and ask only to confirm them: show all of it in ONE message already filled in (with the tracks folder and its "private" option for a public repository). End with "Reply ok, or tell me what differs" and write nothing until I reply.\n'
      + '1b. If the client asks "Allow this read outside the working directories?" for a file of this plugin, tell me in one line to choose the option that allows it this one time: the "keep allowing" and "block from now on" options change a permanent setting and are not needed. Never ask me to change my permission settings.\n'
      + '2. If `conductor/tracks` already exists from an older LaneConductor, say what you found and import nothing silently.\n'
      + '3. Tell me what you are about to create or change before you write anything. Never overwrite an existing file; the scaffold skips what exists. Ask before any commit; never push.\n'
      + '4. Setup needs no installed command-line tool and no settings file: look for no program other than `git` and the scripts the skill file names, and read no settings file. After reading the project, say which optional plugins fit it and show their install commands, as the skill file says (never run them).\n\n'
      + 'When the action is `scaffold`, go straight to `setup/scaffold.md` (templates in `setup/templates.md`) and skip the interview; the same rules hold. Read the file in full first and tell me what you are about to create or change before you write anything.',
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

/** The command lines of `help`, grouped, one example phrase per command (no closing note). Adapters add their own note. */
export const NOT_SURE = 'Not sure where to go? Use `next`: it reads this project and names the one step.';
export function helpLines(intro = 'LaneConductor commands. Say one in your own words, or use it as a prompt.') {
  const lines = [intro, NOT_SURE, ''];
  for (const g of GROUPS) {
    lines.push(`${g[0].toUpperCase()}${g.slice(1)}`);
    for (const c of COMMANDS.filter((x) => x.group === g)) {
      const args = argumentHint(c);
      lines.push(`- ${c.name}${args ? ` ${args}` : ''}: ${c.description}. Example: "${c.example}"`);
    }
    lines.push('');
  }
  return lines;
}

/** The list `help` returns, grouped, one example phrase per command, and the note on the board script. */
export function helpText() {
  const needs = COMMANDS.filter((c) => c.needsBoardScript);
  return [...helpLines(),
    `Needs the board add-on's script: ${needs.map((c) => `${c.name}${c.needsBoardScript === 'refreshing' ? ' (only to refresh)' : ''}`).join(', ')}. `
    + 'Without it they say so and stop; every other command works through the connector tools or by editing the track files.',
  ].join('\n');
}

/** What `prompts/get` and the help tool return for a command. */
export const renderCommand = (cmd, values) => (cmd.render === 'help' ? helpText() : fillProcedure(cmd, values));

/** Machine-readable form for the `help` tool: grouped, one example each. */
export function helpData() {
  return {
    commands: COMMANDS.map((c) => ({ name: c.name, group: c.group, description: c.description, arguments: argumentHint(c), example: c.example, needs_board_script: c.needsBoardScript ?? null })),
  };
}
