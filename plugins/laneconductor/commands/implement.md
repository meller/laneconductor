---
description: "Implement a track from its plan (code tracks: one sub-agent in its own worktree)"
argument-hint: <track number or title>
---
Implement track `$ARGUMENTS`. The procedure is the implement lane guide (skill file `lanes/implement.md`); follow it and do not restate it here.

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

1. Find the track's folder under `conductor/tracks/` (Glob `conductor/tracks/*<number>*/`; both naming conventions exist, see "Finding a track" in the skill index) and read its `index.md`, `spec.md`, `plan.md`, `test.md` and `conversation.md`. Read the lane guide too. Read where a lane sends a finished track from `conductor/workflow.json` with the grammar of the skill file `ops/lanes-and-statuses.md` (a bare target is `queue` for another lane and `success` or `failure` for the same lane; a bare `done` is `done:queue`); never guess it from the raw file.
2. If `**Type**` is not `dev` (marketing, sales, support, other) the track has no code: recommend no sub-agent and no worktree, ask no question about one, and do the lane in this session. A code track: if the sub-agent `laneconductor-parallel:track-runner` is listed (the add-on is installed): DISPATCH it now (typing this command is my yes): one sub-agent per track, each in its own worktree, off the primary checkout and without collisions; independent phases of one track may each get their own, dependent ones run in order. Show the dispatch first, with this prompt: "Work track N through its implement lane: read the lane guide, follow plan.md, commit in your worktree, report commits and test results; do not merge or push." If I say to do the lane here, do it yourself. If it is not listed: do the lane in this session following the guide. If I ask for parallel work or for isolation, explain the by-hand way (`git worktree add .worktrees/track-<number> -b track-<number>`, a separate session started in that folder, one track per worktree) and, once, what the laneconductor-parallel add-on adds (parallel work: sub-agents per track in worktrees, conflict-checked track writes; It installs an MCP server (a Node.js program) and a scaffold script on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory. Show its install commands as written, from "The add-on's install commands" in the Reference below; never run them). Otherwise mention nothing.
3. Change state by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.

In Claude Code the add-on's sub-agent is `laneconductor-parallel:track-runner`. See "Plugin users" in the skill's `ops/working-a-track.md`.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__get_context`, `mcp__plugin_laneconductor-parallel_lc__get_track`, `mcp__plugin_laneconductor-parallel_lc__update_track`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `lanes/implement.md`

Execute the track's `plan.md`, phase by phase, communicating through files. A runner
normally has already started you in `.worktrees/NNN`; that is where the
commits go.

0. **Claim the track first.** Write `**Lane**: implement` and `**Lane Status**: running` to the
   track's `index.md`. Set `**Lane**` explicitly: a track just planned may still sit in `plan:success`,
   and the board would show it running in the wrong column.
1. **Locate the track.** With the parallel add-on, `get_track` finds it. Otherwise Glob
   `conductor/tracks/*-<N>-*/` and `conductor/tracks/<N>-*/`. Never scaffold a second folder for an existing number.
2. **Workspace (dev tracks; a non-dev track needs no worktree).** If you were not started inside `.worktrees/NNN` and the track is branch-mode,
   make the worktree yourself: `git worktree add .worktrees/NNN -b track-NNN` (or reuse it if it
   exists), and work there; with the parallel add-on, the `track-runner` sub-agent does this for
   you. If another session is already working in that worktree, stop and report instead of
   working in the primary checkout.
3. **Read context.** On `FRESH_SESSION: false` skip what you already read this session, except
   `conversation.md` (create it if missing) and `last_run.log`, which you always check for anything new.
   - `plan.md` (phases), `spec.md` (details and `**Type**`), `test.md` (drives the order of work).
   - `conductor/deployment-stack.md`, `product-guidelines.md`, `design-language.md`,
     `tech-stack.md`, each if present.
   - `conversation.md` (human comments override the plan) and `last_run.log` (why the last run failed).
   - **test.md self-healing:** if `test.md` is missing, empty or still the
     `(Test cases to be added)` stub, write concrete test cases and commands for each phase
     before any implementation code: `# Tests: Track NNN - [Title]`, then `## Test Commands` (exact commands),
     `## Test Cases` (`### Phase 1: [Name]`, `- [ ] TC-1: [Description] - expected: [outcome]`) and `## Acceptance Criteria`.
   - TDD is recommended, `test.md` is written for it: per phase, write the test, watch it fail, then the minimal code.
4. **Non-dev tracks (`**Type**` is not `dev`): supervised implement.** Do not write code.
   - Look for the skills this Type works best with (marketing: `content-strategy`, `launch`, `copywriting`, `social`, `analytics`,
     `ab-testing`; sales: `sales-enablement`, `cold-email`, `prospecting`, `revops`; support: `ticket-triage`, `draft-response`,
     `kb-article`). A skill is installed when it is in the session's skills list, in `claude plugin list`, or in `.claude/skills/` or
     `~/.claude/skills/` (an older name counts: `social-content`, `launch-strategy`, `analytics-tracking`, `ab-test-setup`). For each one
     installed, say "you have `<skill>` installed, use it before writing the content". Offer the missing ones as "Offer a missing skill" says.
   - Read `## Draft` from `spec.md`; output the publish-ready content and the
     `### Publish Instructions` to the user. Nothing is posted, sent or spent for the owner: they do it.
   - Write `**Owner Action**` (one line, up to 200 characters: exactly what the owner must do) and
     `**Owner Action Due**` (`YYYY-MM-DD`) to `index.md`, taking the day from the plan; when the plan has
     none, ask the owner for one, never invent it. Then set `**Waiting for reply**: yes` and `**Lane Status**: waiting`
     (the Owner Action is the reason: no Waiting Reason; `**Lane**` stays `implement`; with the connector one `update_track` writes all four).
     The Inbox signal is that marker, so no completion comment is needed.
   - Stop. Do not move the lane yourself.
   - **The owner's reply** ("posted", "done", or a move): nothing moves the track by itself, so you do it.
     Clear `Owner Action`, `Owner Action Due` and `Waiting for reply`; set `**KPI Check After**` to now plus
     the KPI `Window` (a UTC timestamp `YYYY-MM-DDTHH:MM:SSZ`); park the track in the quality-gate lane as
     `waiting`, with a `**Waiting Reason**` naming that date. With the connector, one `update_track` makes
     this change and checks for conflicts; lane and status names are the ones in `conductor/workflow.json`.
     With no KPI block there is no window: ask the owner where the track goes next.
4b. **Fundamentals conflict (dev tracks).** If what you must build conflicts with, or implies a
   change to, `product-guidelines.md`, `design-language.md`, `tech-stack.md` or `workflow.md`,
   do not write code that contradicts them or rewrite them silently. Append to
   `conversation.md`: `> **system**: ⚠️ FUNDAMENTALS CONFLICT - this track's [requirement] appears to
   require changing conductor/[doc].md ([specific conflict]). Continuing as specified; doc not
   modified - please review whether conductor/[doc].md should be updated.` (one comment, prefix
   each continuation line with `> `). It is non-blocking unless proceeding would be actively wrong; then stop for human input.
5. **Dev tracks: per phase.**
   - Implement the tasks.
   - **Run the verification before you tick anything.** Do not mark a task `[x]` or write
     "Phase N complete" until you have executed whatever verifies it and read the real output.
     This holds even when `test.md` has no case for the phase: exercise any CLI flag, endpoint,
     UI flow or dispatch there is. A written-but-unrun test or a plausible diff is not verification.
   - **Never end a turn on a command you just backgrounded:** the harness kills background
     children when the session exits. Run long commands in the foreground, or note in `conversation.md` what is still running.
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
   - Write the closing message of a lane and stop.
Boundaries: `workflow.json` is the only authority for target lanes, never feel. On exit, `**Lane Status**` ends as `success` or `queue` by the outcome.

#### Offer a missing skill

Before the work, look at what fits this lane and offer what is missing; usually this is silent. The track is the one this command names.

**Offer rule** (full procedure: `/laneconductor:suggest-skills`). Plain text, never a form, never blocking.
- Look first: a skill is installed when it is in the session's skills list, `claude plugin list` (read only), `.claude/skills/` or `~/.claude/skills/`; an older name counts. Then say "you have `<skill>` installed, use it before writing the content" and use it.
- Offer only what is missing and fits this lane, the track's `**Type**` (dev if none) and the stack; else say nothing. At most two, ours first, never twice in a session, never one in `skills.declined` of `.laneconductor.json` (or older `.git/skill-advisor-declined.txt`).
- One or two plain sentences (what, why here, program or only knowledge), each install command alone in its own bash block, no leading `$`.
- `prerequisite`: ask, in the same sentence, whether to install first or carry on; otherwise a one-line tip. No answer: carry on.
- Never run an install yourself: the person runs it, then `/reload-plugins`. "Do not ask again": show the change; on a yes add it there (`.gitignore` first, asked).

Candidates for the `implement` lane (stack tags: ui, firebase, postgres, gemini, cloudflare, dashboard):

- `laneconductor-parallel`: parallel work: sub-agents per track in worktrees, conflict-checked track writes. Installs an MCP server (a Node.js program) and a scaffold script. It counts as installed when its connector tools exist (`mcp__plugin_laneconductor-parallel_lc__*`), or its agent `laneconductor-parallel:track-runner` is listed. Mention only when several sessions, people or sub-agents write the same tracks, or overwrites are a worry. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-parallel@laneconductor`
- `laneconductor-nodejs-frontend` (stack ui), `laneconductor-firebase` (stack firebase), `laneconductor-node-postgres` (stack postgres), `laneconductor-gemini` (stack gemini): our stack skill packs, advice for one stack each. Markdown only. `claude plugin marketplace add meller/laneconductor`, `claude plugin install <pack>@laneconductor`
- `frontend-design` (prerequisite; stack ui): skills frontend-design. Markdown only. `claude plugin install frontend-design@claude-plugins-official`
- `marketing-skills` (prerequisite; Type marketing/sales): skills copywriting, social (was social-content), sales-enablement, cold-email. Markdown only. `claude plugin marketplace add coreyhaines31/marketingskills`, `claude plugin install marketing-skills@marketingskills`
- `superpowers`: skills test-driven-development, systematic-debugging, subagent-driven-development, using-git-worktrees. Installs a session-start hook script, plus Markdown skills. `claude plugin install superpowers@claude-plugins-official`
- `firebase` (stack firebase): Firebase tools: Firestore, auth, functions, hosting, and hosting deploys. Installs an MCP server (firebase-tools, via npx) that can change your Firebase project. `claude plugin install firebase@claude-plugins-official`
- `cloudflare` (stack cloudflare): skills cloudflare. Installs a connection to Cloudflare's hosted MCP server, plus skills. `claude plugin marketplace add cloudflare/skills`, `claude plugin install cloudflare@cloudflare`
- `customer-support` (Type support): skills ticket-triage, draft-response, kb-article, customer-escalation. Installs connections to hosted services (Slack, Intercom and more), plus skills. `claude plugin marketplace add anthropics/knowledge-work-plugins`, `claude plugin install customer-support@knowledge-work-plugins`
- `data` (stack dashboard): skills build-dashboard, create-viz, data-visualization. Installs connections to hosted data services, plus skills. `claude plugin marketplace add anthropics/knowledge-work-plugins`, `claude plugin install data@knowledge-work-plugins`

#### Skills that help here

Suggestions, a second opinion, never an order: if a skill named here is installed (for example from the Superpowers
plugin), consider using it; if not, say so in one line and carry on without it. `test-driven-development` fits the test-first order `test.md` is written for; `systematic-debugging` helps when a test fails and the cause is not obvious; `subagent-driven-development` helps when the plan has independent tasks that can be handed to subagents; `using-git-worktrees` helps when you need an isolated checkout for the track.

An optional top-level `skills` object in `conductor/workflow.json` may list more under `"implement"` (`{ "skills": { "implement": ["my-skill"] } }`): use them the same way (if one is missing, say so and continue). Absent, nothing changes. Where a skill's steps or file locations differ from this guide or the track files, those win; take the skill's method, not its output paths.

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
- Search the tracks (every lane, backlog and done too) before opening one for a gap you find on the way; if one fits, ask "Update track N (title, lane) with this? [default: yes]" and extend it. See "Search first" in `ops/tracks.md`.
- One session per track. If something else also works the track (another session, an automatic runner), stop and ask.
- Do not run test suites that start background processes from inside a worktree: they can attach
  to the real primary checkout and leak processes. Check for leftovers after any test run.
- Ask before merging or pushing (it is the human's call). Never enter, echo or store secrets.
- Append to `conversation.md` as `> **author**: text` (every line prefixed `> `); anything else
  is silently ignored by sync.
- If a decision is the human's, ask in `conversation.md`, set `**Waiting for reply**: yes`, and stop.

#### Plugin users: one subagent per track in a worktree (code tracks)
Only for a code track (`**Type**` `dev`). A non-dev track (marketing, sales, support, other) writes no code: no sub-agent, no
worktree, no question about one; work its lane in this session.

With the laneconductor-parallel add-on installed (Claude Code or Cowork, not chat), dispatch its `laneconductor-parallel:track-runner`
subagent for a code track: one per track, each in its own worktree, so code stays off the primary checkout and tracks do not collide.
Show the agent and one-line prompt first; typing the command is the yes, and "do it here" declines. Independent phases of one track
(different files, no shared output) may each get one; run dependent phases in order. `/laneconductor:run N`, `:implement N` and
`:review N` do this. It never merges or pushes.

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
| `stay` or `stop` | no automatic move (older files; read, never written) |

An unknown current lane is an error; do not guess. Names are compared ignoring case and spaces. Fields of the older format
are ignored: `auto_action`, `parallel_limit`, `max_retries`, `global`, `primary_model`, `hooks`.

Worked examples. This project's own file:

| Lane | on_success | on_failure |
|------|-----------|-----------|
| plan | `plan:success` (stays, parked) | `backlog:queue` |
| implement | `review:queue` | `implement:failure` |
| review | `quality-gate:queue` | `implement:queue` |
| quality-gate | `done:queue` | `plan:queue` |
| done | none | `done:failure` |

An older file (bare targets, old lane names) resolves by the table above: `in-progress` with `"on_success": "review"` and `"on_failure": "in-progress"` gives `review:queue` and `in-progress:failure`; a `null` target has no automatic move.

#### Lane names

A project names its own lanes in `conductor/workflow.json`; the guides use the standard names, which replaced the old ones: `planning` to `plan` and `in-progress` to `implement` (older projects keep the old names; tracks are never renamed). The connector reports the mapping as `valid.guide_lanes` (the project's names as `valid.lanes`); without it, match by meaning. Write the project's own names into `**Lane**`.

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
(`success` or `failure`) and the `base` from `get_track` (it applies the workflow's move; `valid.next` says
where it goes); without it, read `workflow.json` with the grammar in `ops/lanes-and-statuses.md`.

#### pulse `[track-number] [status] [progress%] [summary?]`

Update the track's markers in `conductor/tracks/NNN-*/index.md`: `**Progress**: N%`, `**Phase**`
when the work entered a new phase, `**Step**` (the current activity),
`**Summary**`, and `**Waiting for reply**: no` after every AI response. A `[status]` that names a lane is a move, so use `move` for that;
`pulse` no longer writes the legacy `**Status**`.

#### comment `[track-number] [body]`

A comment from a person or an agent (an agent's answer to a human comment too) is a `> **author**: [body]` entry (format rules in SKILL.md) in
`conductor/tracks/NNN-*/conversation.md`. A note that records an event (a run, a classification, a completion) is a dated line
in `history.md` instead. Use `⚠️` for something that needs a human and `ℹ️` for a note.

### `SKILL.md` (Finding a track; conversation.md format)

#### Finding a track

A track number maps to one folder under `conductor/tracks/`. With the parallel add-on, `get_track` finds it. Without
it, use Glob `conductor/tracks/*-<N>-*/` for the form `INITIALS-NNN-slug` (for example `AM-10023-my-feature`) **and** `conductor/tracks/<N>-*/` for the older bare `NNN-slug`; scan for **both**. If neither finds it, `conductor/tracks-summary.md` (when it exists) lists the tracks.

If a folder exists for the number, use it: scaffolding a second is an error (a scan that missed `AM-<number>-...` once created a duplicate).

#### conversation.md format

`conversation.md` holds the dialogue. An entry that records an event (a lane completion, a classification) is a dated line
in `history.md` instead; with the connector, `append_conversation` with author `system` writes that line there. Every
entry in `conductor/tracks/NNN-*/conversation.md`, from an agent or a human, must look like:
```
> **author**: First line of the message
> second line, also prefixed with >
```
`author` is `human`, `claude`, `gemini` or `system`. The tools that read it recognize only
`> **author**: ...` lines plus `>`-prefixed continuations. Anything else (a header, a plain
blockquote, loose prose) stays in the file but is never read, with no error.
For long pasted material (an email, a contract) keep one opening `> **author**:` line and
prefix every following line, blank ones and headers included, with `>`.

### `SKILL.md` (The closing message of a lane)

#### The closing message of a lane

The last chat message of a lane command (and of an owner-step reply) is six lines at most, with no heading:

1. **Outcome**, one line: what was done and where the track sits now, with its title and a gist: `Planned AM-1 "Title" (6 phases, 12 tests): <one clause on the approach>; parked at plan:success.`
2. **Needed from the person**: what blocks the next step, three lines at most, one each (a supervised track: its Owner Action; a plan item marked unverified or open that blocks building). None: leave it out.
3. **Next**: the command alone, for the lane the track now sits in (`/laneconductor:implement N`; after a merge, `/laneconductor:next`).
4. **More**, word for word: ``More: `/laneconductor:board` (the track's card shows the next step with a Copy button), or say "show the plan".``

Findings, phase and test-case lists, risks and caveats go into the track's files and its one completion comment, not the chat; give them on "show the plan". Say nothing of commits or ignored tracks unless unusual.
