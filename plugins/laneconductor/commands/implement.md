---
description: Implement a track from its plan (recommends one sub-agent per track in its own worktree)
argument-hint: <track number or title>
---
Implement track `$ARGUMENTS`. The procedure is the implement lane guide (skill file `lanes/implement.md`); follow it and do not restate it here.

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

1. Find the track's folder under `conductor/tracks/` (Glob `conductor/tracks/*<number>*/`; both naming conventions exist, see "Finding a track" in the skill index) and read its `index.md`, `spec.md`, `plan.md`, `test.md` and `conversation.md`. Read the lane guide too. Read where a lane sends a finished track from `conductor/workflow.json` with the grammar of the skill file `ops/lanes-and-statuses.md` (a bare target is `queue` for another lane and `success` or `failure` for the same lane; a bare `done` is `done:queue`); never guess it from the raw file.
2. If the sub-agent `laneconductor-parallel:track-runner` is listed (the add-on is installed): RECOMMEND, do not start: one sub-agent per track, each in its own worktree, because that isolates the work from the primary checkout, lets several tracks run in parallel, and keeps them from colliding. Show the exact dispatch, with this prompt: "Work track N through its implement lane: read the lane guide, follow plan.md, commit in your worktree, report commits and test results; do not merge or push." Start nothing until I say yes; if I decline, do the lane yourself. If it is not listed: do the lane in this session following the guide. If I ask for parallel work or for isolation, explain the by-hand way (`git worktree add .worktrees/track-<number> -b track-<number>`, a separate session started in that folder, one track per worktree) and, once, what the laneconductor-parallel add-on adds (parallel work: isolated sub-agents, one per track in its own worktree, and safe shared state through conflict-checked track writes; It installs an MCP server (the connector, a Node.js program) and a scaffold script on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory. Show its install commands as written, from "The add-on's install commands" in the Reference below; never run them). Otherwise mention nothing.
3. Change state by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.

In Claude Code the add-on's sub-agent is `laneconductor-parallel:track-runner`. See "Plugin users" in the skill's `ops/working-a-track.md`.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__get_context`, `mcp__plugin_laneconductor-parallel_lc__get_track`, `mcp__plugin_laneconductor-parallel_lc__update_track`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `lanes/implement.md`

Execute the track's `plan.md`, phase by phase, communicating through files. A runner
normally has already started you in `.worktrees/NNN`; that is where the
commits go.

Before step 1, look at "Offer a missing skill" near the end of this guide: one check, usually silent.

0. **Claim the track first.** Write `**Lane**: implement` and `**Lane Status**: running` to the
   track's `index.md`. Set `**Lane**` explicitly: a human may run this right after planning, and
   this project's `workflow.json` keeps `plan.on_success: plan:success`, so the track does not
   land in the implement lane by itself. Without it the board shows the track running in the
   wrong column.
1. **Locate the track.** With the parallel add-on, `get_track` finds it. Otherwise Glob
   `conductor/tracks/*-<N>-*/` and `conductor/tracks/<N>-*/` (both naming conventions). Never
   scaffold a second folder for an existing number.
2. **Workspace.** If you were not started inside `.worktrees/NNN` and the track is branch-mode,
   make the worktree yourself: `git worktree add .worktrees/NNN -b track-NNN` (or reuse it if it
   exists), and work there; with the parallel add-on, the `track-runner` sub-agent does this for
   you. If another session is already working in that worktree, stop and report instead of
   working in the primary checkout.
3. **Read context.** On `FRESH_SESSION: false` skip what you already read this session, except
   `conversation.md` (create it if missing) and `last_run.log`, which you always check for anything new.
   - `plan.md` (phases), `spec.md` (details and `**Type**`), `test.md` (drives the order of work).
   - `conductor/deployment-stack.md`, `product-guidelines.md`, `design-language.md`,
     `tech-stack.md`, each if present.
   - `conversation.md`: human comments override the plan.
   - `last_run.log` if present: why the previous run failed.
   - **test.md self-healing:** if `test.md` is missing, empty or still the
     `(Test cases to be added)` stub, write concrete test cases and commands for each phase
     before any implementation code. Template:
     ```markdown
     # Tests: Track NNN - [Title]

     ## Test Commands
     (exact commands)

     ## Test Cases
     ### Phase 1: [Name]
     - [ ] TC-1: [Description] - expected: [outcome]

     ## Acceptance Criteria
     - [ ] All unit tests pass
     - [ ] No regressions in related features
     ```
   - TDD is recommended because `test.md` is written for it: per phase, write the test, watch it
     fail, write the minimal code, watch it pass.
4. **Non-dev tracks (`**Type**` is not `dev`): supervised implement.** Do not write code.
   - Look for the skills this Type works best with (marketing: `content-strategy`, `launch`,
     `copywriting`, `social`, `analytics`, `ab-testing`; sales: `sales-enablement`, `cold-email`,
     `prospecting`, `revops`; support: `ticket-triage`, `draft-response`, `kb-article`). A skill
     counts as installed when it is in the skills list this session shows you (that covers project,
     user and plugin skills), when `claude plugin list` shows its plugin, or when it is in
     `.claude/skills/` or `~/.claude/skills/`; an older name counts too (`social-content`,
     `launch-strategy`, `analytics-tracking`, `ab-test-setup`). For each one that is installed say
     "you have `<skill>` installed, use it before writing the content" and use it. Offer only the
     ones that are missing, as "Offer a missing skill" below says (at most two, plain text, never
     blocking, and not again if the person declined them).
   - Read `## Draft` from `spec.md`; output the publish-ready content and the
     `### Publish Instructions` to the user.
   - Set `**Waiting for reply**: yes` in `index.md`. That marker is itself the Inbox signal, so no
     completion comment is needed. The human's "done" reply moves the track on to the quality
     gate.
   - Stop. Do not transition the lane yourself.
4b. **Fundamentals conflict (dev tracks).** If what you must build conflicts with, or implies a
   change to, `product-guidelines.md`, `design-language.md`, `tech-stack.md` or `workflow.md`,
   do not write code that contradicts them and do not rewrite them silently. Append to
   `conversation.md`: `> **system**: ⚠️ FUNDAMENTALS CONFLICT - this track's [requirement] appears to
   require changing conductor/[doc].md ([specific conflict]). Continuing as specified; doc not
   modified - please review whether conductor/[doc].md should be updated.` (one comment, prefix
   each continuation line with `> `). It is non-blocking unless proceeding would be actively wrong; then treat it like
   any blocker and stop for human input instead of guessing.
5. **Dev tracks: per phase.**
   - Implement the tasks.
   - **Run the verification before you tick anything.** Do not mark a task `[x]` or write
     "Phase N complete" until you have executed whatever verifies it and read the real output.
     This holds even when `test.md` has no case for the phase: if there is a CLI flag, endpoint,
     UI flow or dispatch to exercise, exercise it. A written-but-unrun test file or a plausible
     diff is not verification. One run shipped a "complete" phase with two new test
     files that were never run (one had an import error) and a hardcoded `null` that broke the
     one path that mattered.
   - **Never end a turn on a command you just backgrounded.** The harness kills background
     children when the session exits, so the work is silently lost and the run exits 0
     mid-work (the run's exit handler now reports `ended_mid_work`, which is recovery,
     not prevention). Run long commands in the foreground and wait, or hand off explicitly with a
     note in `conversation.md` naming what is still running and what the next turn should check.
   - Update `plan.md` (tick the task) and the `**Progress**` marker in `index.md`.
   - Commit: `feat(track-NNN): Phase X - description`.
6. **Complete (dev tracks).** Apply the same verification bar to the track as a whole before
   writing `## ✅ COMPLETE`.
   - Set `**Progress**` to 100%.
   - **Transition.** Re-read `index.md`'s `**Lane**` first. If it is no longer `implement` (a
     human moved the card), leave `**Lane**` and `**Lane Status**` alone and say so in the
     completion comment. Otherwise apply the workflow's success move for this lane (this project:
     `review:queue`; only the quality gate moves a track to done): with the connector, call
     `update_track` with `outcome: "success"` (the target is `valid.next.success` in `get_track`);
     without it, read `lanes.implement.on_success` in `conductor/workflow.json` with the grammar in
     `ops/lanes-and-statuses.md`: set both `**Lane**` and
     `**Lane Status**` from it, a bare target is `queue`. If a deploy or post-deploy check is still
     to run, that is `quality-gate:running`, not `implement:running`.
   - Append `## ✅ COMPLETE` to `plan.md`.
   - Add the completion line to `history.md` (`- <YYYY-MM-DD HH:MMZ> <emoji> <text>`; status, commit hashes and
     incidents of this run go there as dated lines, never into `plan.md` or `spec.md`):
     `✅ Implementation complete - moved to <lane>.`
   - Final commit: `feat(track-NNN): Implementation complete`.
Boundaries: `workflow.json` is the only authority for target lanes; read it through `valid.next` or
`outcome`, or with the grammar in `ops/lanes-and-statuses.md`, never by feel. On exit, `**Lane Status**`
should end as `success` or `queue` according to the outcome.

#### Offer a missing skill

Before the work, look at what fits this lane and offer what is missing; `/laneconductor:suggest-skills` is the whole procedure. Usually this is silent: nothing missing means no message, and an offer never blocks the work.

The track is the one this command names, so its lane, `**Type**` and stack are known. At the start of this lane, and again when the track's situation changes (a failing test, a review comment to answer, a UI, a deploy), look at what fits and offer what is missing. Usually this is silent. The full command is `/laneconductor:suggest-skills`.

**How to offer.** Plain text in your reply: never a form, a menu or a question that blocks the work.

1. **Look first.** A skill counts as installed when any of these is true: it is in the skills list this session shows you (that list already covers project, user and plugin skills, and a plugin skill can appear as `plugin:skill`); `claude plugin list` (read only; run it once per session, and only when the list is not enough) shows its plugin as enabled; or a folder with its name exists in `.claude/skills/` of the project or in `~/.claude/skills/`. A skill listed under an older name counts too. When it is installed, say so in one line ("you have `<skill>` installed, use it before writing the content") and use it.
2. **Offer only what is missing**, from the candidates below that fit the lane, the track's `**Type**` (`dev` when it has none) and the project's stack: read `conductor/tech-stack.md` and look for the marker files named under "Stack tags". When nothing is missing, say nothing.
3. **Be quiet.** At most two items per offer: our own entries before third-party ones, `prerequisite` before `helps`. Never the same entry twice in a session, and never an entry on the project's declined list: the file `skill-advisor-declined.txt` inside the directory that `git rev-parse --git-common-dir` prints (one entry name per line; it is inside `.git`, so it is never committed). A trivial track gets at most the one-line tip, and a suggestion in the middle of a step (a failing test and `systematic-debugging`) is one line.
4. **Say it in one or two plain sentences**: what it is, why it helps here, where it comes from, and what it installs (use the note under its name: an entry that installs a program says so plainly; a Markdown-only one adds knowledge only). Then each install command alone in its own bash block, one command per block, no leading `$`, so the desktop app shows a Run button. In a session the person can type `/plugin install <plugin>@<marketplace>` instead (inline text, not a block); that opens the plugin's details for review.
5. **Level.** `prerequisite`: say the result will be better with it and ask, in the same sentence, whether to install it first or carry on. `helps`: a one-line tip. Either way the work is not blocked: with no answer, carry on.
6. **The answer.** *Install first*: show the commands, say nothing has been changed yet, say to run them and then `/reload-plugins`, and when the person is back start the step again from the top with the skill present. *Carry on*: start the step at once and do not repeat the offer this session. *Do not ask again*: show the line you would add and, after the yes, append the entry's name to the declined file; with no git directory, just do not offer it again this session.
7. **Never run an install yourself.** The commands are shown; the person runs them, or uses the client's own plugin browser. If one fails, report the command and its output, retry nothing silently and work around nothing by editing settings or permissions. To share a plugin with collaborators, offer to add it to `enabledPlugins` in the project's `.claude/settings.json` only when the person asks: show the exact change first, say it turns the plugin on for them but does not download it (each person runs the install once with `--scope project`), and write it only after a yes.

Candidates for the `implement` lane:

###### `laneconductor-parallel`

Parallel work: isolated sub-agents, one per track in its own worktree, and safe shared state through conflict-checked track writes. LaneConductor add-on, licence Elastic-2.0, from `meller/laneconductor`. Fits `implement`, `review` (lanes), Type `dev`, any stack. Level: `helps`. Mention it only when: the person mentions several sessions, people or sub-agents writing the same tracks, or worries about overwrites; or the person mentions worktrees or running tracks in parallel; or the person asks for automatic commits, a privacy scan or a health report.
It counts as installed when its connector tools exist (`mcp__plugin_laneconductor-parallel_lc__*`, for example `mcp__plugin_laneconductor-parallel_lc__get_track`), or its agent `laneconductor-parallel:track-runner` is listed. It installs an MCP server (the connector, a Node.js program) and a scaffold script on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-parallel@laneconductor
```

###### `frontend-design`

Design direction for a new or reshaped UI: typography, layout and choices that do not read as templated defaults. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `setup`, `plan`, `implement` (lanes), Type `dev`, only when the project has `ui`. Level: `prerequisite`.
Skills for this part: `frontend-design`.
It counts as installed when a skill named `frontend-design` is in the session's skills list (it may show as `frontend-design:frontend-design`), or `claude plugin list` shows `frontend-design@claude-plugins-official`. It is Markdown only: it adds knowledge and installs no program. It comes from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install frontend-design@claude-plugins-official
```

###### `marketing-skills`

Marketing and sales skills for content: strategy, launch plans, copywriting, social posts, sales enablement, prospecting, cold email, analytics and A/B tests (53 skills in all). Third-party, licence MIT, from `coreyhaines31/marketingskills`. Fits `setup`, `plan`, `implement`, `quality-gate` (lanes), Type `marketing`, `sales`, any stack. Level: `prerequisite`.
Skills for this part: `copywriting`, `social` (older installs list it as `social-content`), `sales-enablement`, `cold-email`.
It counts as installed when a skill from it (for example `copywriting` or `cold-email`) is in the session's skills list, in `.claude/skills` or `~/.claude/skills`, or `claude plugin list` shows `marketing-skills@marketingskills`. It is Markdown only: it adds knowledge and installs no program. It comes from `coreyhaines31/marketingskills`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add coreyhaines31/marketingskills
```

```bash
claude plugin install marketing-skills@marketingskills
```

###### `superpowers`

Process skills for the lanes: brainstorming and writing plans, test-first work, systematic debugging, sub-agent execution, worktrees, code review and verification before done. Third-party, licence MIT, from `anthropics/claude-plugins-official`. Fits `setup`, `brainstorm`, `plan`, `implement`, `review`, `quality-gate`, `merge` (lanes), Type `dev`, any stack. Level: `helps`.
Skills for this part: `test-driven-development`, `systematic-debugging`, `subagent-driven-development`, `using-git-worktrees`.
It counts as installed when one of its skills (for example `test-driven-development`) is in the session's skills list, or `claude plugin list` shows `superpowers@claude-plugins-official`. It installs a shell hook script that runs when each session starts, plus Markdown skills on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install superpowers@claude-plugins-official
```

###### `firebase`

Firebase tools for Claude: Firestore, auth, functions, hosting and storage, including the steps to deploy hosting. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `setup`, `implement`, `deploy` (lanes), Type `dev`, only when the project has `firebase`. Level: `helps`.
It counts as installed when its tools are among your tools (they start with `mcp__plugin_firebase_firebase__`), or `claude plugin list` shows `firebase@claude-plugins-official`. It installs an MCP server (the `firebase-tools` Node.js program from Google, fetched with npx) that can change your Firebase project when you ask on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install firebase@claude-plugins-official
```

###### `cloudflare`

Cloudflare platform skills and its hosted MCP server for edge functions, Durable Objects and deployments. Third-party, licence Apache-2.0, from `cloudflare/skills`. Fits `setup`, `implement`, `deploy` (lanes), Type `dev`, only when the project has `cloudflare`. Level: `helps`.
Skills for this part: `cloudflare`.
It counts as installed when a skill named `cloudflare` is in the session's skills list, or `claude plugin list` shows `cloudflare@cloudflare`. It installs a connection to Cloudflare's hosted MCP server (no local program; you sign in to use it), plus Markdown skills on your computer, from `cloudflare/skills`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add cloudflare/skills
```

```bash
claude plugin install cloudflare@cloudflare
```

###### `customer-support`

Support skills: ticket triage, draft replies, knowledge-base articles and escalations. Third-party, licence Apache-2.0, from `anthropics/knowledge-work-plugins`. Fits `plan`, `implement` (lanes), Type `support`, any stack. Level: `helps`.
Skills for this part: `ticket-triage`, `draft-response`, `kb-article`, `customer-escalation`.
It counts as installed when a skill from it (for example `ticket-triage`) is in the session's skills list, or `claude plugin list` shows `customer-support@knowledge-work-plugins`. It installs connection settings for hosted services (Slack, Intercom, HubSpot, Notion and others; no local program, each asks you to sign in before it connects), plus Markdown skills on your computer, from `anthropics/knowledge-work-plugins`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add anthropics/knowledge-work-plugins
```

```bash
claude plugin install customer-support@knowledge-work-plugins
```

###### `data`

Data skills for a dashboard or chart: build a dashboard, create a visualization, explore and validate the data. Third-party, licence Apache-2.0, from `anthropics/knowledge-work-plugins`. Fits `plan`, `implement` (lanes), Type `dev`, only when the project has `dashboard`. Level: `helps`.
Skills for this part: `build-dashboard`, `create-viz`, `data-visualization`.
It counts as installed when a skill from it (for example `build-dashboard`) is in the session's skills list, or `claude plugin list` shows `data@knowledge-work-plugins`. It installs connection settings for hosted data services (BigQuery, Amplitude, Hex and others; no local program, each asks you to sign in before it connects), plus Markdown skills on your computer, from `anthropics/knowledge-work-plugins`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add anthropics/knowledge-work-plugins
```

```bash
claude plugin install data@knowledge-work-plugins
```

Stack tags used above:

- `ui`: a front-end stack (React, Vue, Svelte, Next.js, a Vite config, .html, .css or .tsx files), or the track's plan names screens or pages.
- `firebase`: `firebase.json` or `.firebaserc`, or Firebase named in conductor/tech-stack.md.
- `cloudflare`: `wrangler.toml`, `wrangler.json` or `wrangler.jsonc`, or Cloudflare named in conductor/tech-stack.md.
- `dashboard`: the track or its plan is about a dashboard, charts or a data page.

#### Skills that help here

These are suggestions, in the same spirit as the rest of this guide: a second opinion, never an order. If a skill
named here is installed (for example from the Superpowers plugin), consider using it; if it is not, say so in one line
and carry on without it. `test-driven-development` fits the test-first order `test.md` is written for; `systematic-debugging` helps when a test fails and the cause is not obvious; `subagent-driven-development` helps when the plan has independent tasks that can be handed to subagents; `using-git-worktrees` helps when you need an isolated checkout for the track.

Also read `conductor/workflow.json`. If it has a top-level `skills` object with a list under `"implement"`, such as
`{ "skills": { "implement": ["my-skill"] } }`, use those skills in addition, the same way: if one is installed, use it; if
it is missing, say so and continue. The `skills` key is optional; when it is absent, nothing changes. Where a skill's
own steps or file locations differ from this guide or from the track files, the track files and this guide win; take the
skill's method, not its output paths.

### `ops/working-a-track.md`

For "run track N", "work on track N" or "take track N through its lanes". Do the work however you
normally would - use sub-agents and worktrees as you see fit. This is a second opinion, not a
rulebook: it says what exists here and what has gone wrong before. If you have a better reason to
do otherwise, do so and say why.

Find the folder as "Finding a track" in the index says. Lane definitions and
transitions are in `conductor/workflow.json`; what each lane means is in `lanes/`: read the lane
file for the lane you are about to run. Keep `**Lane**`, `**Lane Status**`, `**Progress**` and
`**Phase**` in the track's `index.md` true as you go.

#### Lessons (each came from a real incident - use judgment)
- Code work happens in a worktree `.worktrees/N` on branch `track-N`, not the primary checkout.
  Docs-only lanes (plan) need no worktree: work in the primary checkout.
- A new track folder is untracked, so a worktree off HEAD cannot see it: commit just that folder
  to main locally first (a worktree is the only reason this is needed; pushing is not).
- Before touching a dirty primary checkout, check for a live process using it as cwd.
- Do not open a track for a gap you find on the way until you have searched: list the tracks by the key words (every lane, backlog and done too), and if one fits ask "Update track N (title, lane) with this? [default: yes]" and extend it. Several small gaps go into one fitting track, an epic or one backlog track. See "Search first" in `ops/tracks.md`.
- One session per track. If something else also works the track (another session, an automatic runner), stop and ask.
- Do not run test suites that start background processes from inside a worktree: they can attach
  to the real primary checkout and leak processes. Check for leftovers after any test run.
- Ask before merging or pushing (it is the human's call). Never enter, echo or store secrets.
- Append to `conversation.md` as `> **author**: text` (every line prefixed `> `); anything else
  is silently ignored by sync.
- If a decision is the human's, ask in `conversation.md`, set `**Waiting for reply**: yes`, and stop.

#### Plugin users: one subagent per track in a worktree
With the optional laneconductor-parallel add-on installed (Claude Code or Cowork, not chat), its `laneconductor-parallel:track-runner`
subagent is the recommended way to work a track: one subagent per track, each in its own worktree,
so code stays off the primary checkout, tracks run in parallel and do not collide, and the add-on's
conflict-checked writes keep the shared track state safe. Recommend it and show the exact dispatch (agent name and
one-line prompt); start nothing until the human says yes. `/laneconductor:run N`, `:implement N` and `:review N` do this
when the agent is listed. It never merges or pushes.

Without the add-on, work the lane in this session, or by hand in a worktree: `git worktree add .worktrees/track-N -b track-N`,
a separate session started in that folder, one track per worktree, and never `git add -A` there. Say what the add-on adds
(isolated sub-agents, safe shared state) only if the person asks for parallel work; the install commands are under "The add-on's install commands" below.

### The add-on's install commands

Show these as written when the add-on is missing and I ask for parallel work or isolation; never run them.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-parallel@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-parallel@laneconductor` instead (that opens the plugin's details for review).

### `ops/lanes-and-statuses.md` (The five lane statuses; Transitions; Lane names; Manual moves win)

#### The five lane statuses

| Status | Meaning |
|--------|---------|
| `queue` | Waiting for the lane's action to start (or to be picked up). A track that just moved into a lane is `queue`. |
| `running` | An agent is executing this lane's action **right now**. |
| `success` | The lane's action finished well, and the track rests here (for example `plan:success`: the plan is written and parked). |
| `failure` | The lane's action failed or could not finish; a person or a retry decides next. |
| `waiting` | Parked on purpose until a human (or a named track) acts: a question, an approval, a dependency. |

**`running` belongs to the lane whose action is executing.** It is never used for work that belongs to another lane. A deploy
gate (the full suites, then the deploy) is `quality-gate:running`, not `implement:running` and not `in-progress:running`.

#### Transitions

Each lane in `conductor/workflow.json` may carry `on_success` and `on_failure`. A target is one of:

| Written | Means |
|---------|-------|
| `lane:status`, for example `review:queue`, `plan:success`, `implement:failure` | exactly that lane and status |
| `lane` alone, naming a **different** lane (`review`) | that lane with status `queue` |
| `lane` alone, naming the **same** lane the action ran in | `success` for `on_success`, `failure` for `on_failure` |
| a bare `done` from another lane | `done:queue`, never `done:success` |
| `null` | no automatic move: the lane's own action or a human decides |
| missing from the lane | the file's top-level `defaults.on_success` / `defaults.on_failure`, read the same way; no automatic move when the file has none (an explicit `null` never falls back) |
| `stay` or `stop` | no automatic move. Older files carry these words; they are read, never written, so do not put them in a file |

An unknown current lane is an error; do not guess. Names are compared ignoring case and spaces. These fields are leftovers of the older format and
are ignored: `auto_action`, `parallel_limit`, `max_retries`, `global`, `primary_model`, `hooks`.

Worked examples. This project's own file (current format):

| Lane | on_success | on_failure |
|------|-----------|-----------|
| plan | `plan:success` (stays, parked) | `backlog:queue` |
| implement | `review:queue` | `implement:failure` |
| review | `quality-gate:queue` | `implement:queue` |
| quality-gate | `done:queue` | `plan:queue` |
| done | none | `done:failure` |

An older file (the older format: bare targets, old lane names): `in-progress` with `"on_success": "review"` and `"on_failure": "in-progress"`
resolves to `review:queue` on success and `in-progress:failure` on failure (the failure target names the same lane); `planning` with
`"on_success": "backlog"` resolves to `backlog:queue`; `done` and `backlog` with `null` targets have no automatic move.

#### Lane names

A project names its own lanes in `conductor/workflow.json`; the guides and commands use the standard names. The standard names replaced the old ones:
`planning` to `plan` and `in-progress` to `implement`; older projects (and the older-format files they carry) keep the old names, and existing tracks
are never renamed. The lane guides stand for the project's lane that means the same thing: `plan` is `planning`, `implement` is `in-progress`.
The connector reports this mapping as `valid.guide_lanes` (and the project's lane names as `valid.lanes`); without it, match by meaning. Write
the project's own names into `**Lane**`.

#### Manual moves win

A human's move of a card always wins. Before writing any transition, re-read `**Lane**` in `index.md`; if it is no longer the lane you worked
in, leave `**Lane**` and `**Lane Status**` alone and say so in the completion comment. If you deliberately skip a lane (for example the
deploy gate stands in for review), note the skip in `conversation.md`; following the workflow strictly means taking `on_success`.

### `ops/tracks.md` (move; pulse; comment)

#### move `[track-number] [lane:status]`

Moving to a lane without a status means `queue`: `move NNN backlog`, `move NNN implement:queue`
(it waits in that lane), `move NNN plan:success` (parked as done planning). Set `**Lane**` and
`**Lane Status**` in `conductor/tracks/NNN-*/index.md` (with the add-on, `update_track` with those markers).
Prefer a `lane:status` that `workflow.json` defines for that lane. When the move is "this lane's action
finished", do not work the target out yourself: with the connector, call `update_track` with `outcome`
(`success` or `failure`) and the `base` from `get_track`, which applies the workflow's move; its answer to
"where does it go" is `valid.next` in `get_track`. Without the connector, read `workflow.json` with the
grammar in `ops/lanes-and-statuses.md` (a bare target is `queue` for another lane;
for the same lane it is `success` or `failure`).

#### pulse `[track-number] [status] [progress%] [summary?]`

Update the track's markers in `conductor/tracks/NNN-*/index.md`: `**Progress**: N%`, `**Phase**`
when the work entered a new phase, `**Step**` (the current activity; infer it if not given),
`**Summary**`, and `**Waiting for reply**: no` after every AI response. A `[status]` that names a lane is a move, so use `move` for that;
`pulse` does not write `**Status**` any more (it is a legacy marker the parser only reads when
`**Lane**` is missing).

#### comment `[track-number] [body]`

A comment from a person or an agent is a `> **author**: [body]` entry (format rules in SKILL.md) in
`conductor/tracks/NNN-*/conversation.md`; this is also how an agent answers a human comment. A note that records
an event (a run, a classification, a completion) is a dated line in `history.md` instead (see "What goes in each track file").
Use `⚠️` for something that needs a human and `ℹ️` for a note.

### `SKILL.md` (Finding a track; conversation.md format)

#### Finding a track

A track number maps to one folder under `conductor/tracks/`. With the parallel add-on, `get_track` finds it. Without
it, use Glob `conductor/tracks/*-<N>-*/` for the form `INITIALS-NNN-slug` (for example `AM-10023-my-feature`, the
current form) **and** `conductor/tracks/<N>-*/` for the older bare `NNN-slug`; scan for **both** (a scan for one
form silently misses every folder of the other). If neither finds it, `conductor/tracks-summary.md` (when it exists) lists the tracks.

If any folder exists for the number, use it. Scaffolding a second one is an error, not a
fallback: a scan that missed `AM-<number>-...` once created a duplicate `<number>-...` folder.

#### conversation.md format

`conversation.md` holds the dialogue. An entry that records an event (a lane completion, a classification) is a dated line
in `history.md` instead; with the connector, `append_conversation` with author `system` writes that line there. Every
entry in `conductor/tracks/NNN-*/conversation.md`, from an agent or a human, must look like:
```
> **author**: First line of the message
> second line, also prefixed with >
```
`author` is `human`, `claude`, `gemini` or `system`. The tools that read it recognize only
`> **author**: ...` lines plus `>`-prefixed continuations. Anything else (a markdown header, a plain
blockquote, loose prose) stays in the file but is silently never synced to the UI, with no error.
For long pasted material (an email, a contract, a redline) keep one opening `> **author**:` line and
prefix every following line, blank ones and markdown headers included, with `>`. Do not drop the
prefix partway because the content reads like a document.
