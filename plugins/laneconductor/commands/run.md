---
description: Take a track through its lanes (recommends one sub-agent per track, in its own worktree)
argument-hint: <track number or title>
---
Run track `$ARGUMENTS` end to end. The guardrails are the skill file `ops/working-a-track.md`; read it, and read the lane guide for each lane you run.

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

1. Find the track's folder under `conductor/tracks/` (Glob `conductor/tracks/*<number>*/`; both naming conventions exist, see "Finding a track" in the skill index) and read its `index.md`, `spec.md`, `plan.md`, `test.md` and `conversation.md`. Read where a lane sends a finished track from `conductor/workflow.json` with the grammar of the skill file `ops/lanes-and-statuses.md` (a bare target is `queue` for another lane and `success` or `failure` for the same lane; a bare `done` is `done:queue`); never guess it from the raw file.
2. If the sub-agent `laneconductor-parallel:track-runner` is listed (the add-on is installed): RECOMMEND, do not start: one sub-agent per track, each in its own worktree, because that isolates the work from the primary checkout, lets several tracks run in parallel, and keeps them from colliding. Show the exact dispatch, with this prompt: "Work track N through its <current lane> lane: read the lane guide, do the work, commit in your worktree, report commits and test results; do not merge or push." Start nothing until I say yes; if I decline, do the lane yourself. If it is not listed: do the lane in this session following the guide. If I ask for parallel work or for isolation, explain the by-hand way (`git worktree add .worktrees/track-<number> -b track-<number>`, a separate session started in that folder, one track per worktree) and, once, what the laneconductor-parallel add-on adds (parallel work: isolated sub-agents, one per track in its own worktree, and safe shared state through conflict-checked track writes; It installs an MCP server (the connector, a Node.js program) and a scaffold script on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory. Show its install commands as written, from "The add-on's install commands" in the Reference below; never run them). Otherwise mention nothing. One dispatch per lane, one agent per track.
3. Change state by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change. Ask me before any merge or push.
4. If I ask for the board along the way, follow the `board` command; building it needs the board add-on.

In Claude Code the add-on's sub-agent is `laneconductor-parallel:track-runner`. See "Plugin users" in the skill's `ops/working-a-track.md`.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__get_track`, `mcp__plugin_laneconductor-parallel_lc__list_tracks`, `mcp__plugin_laneconductor-parallel_lc__get_context`, `mcp__plugin_laneconductor-parallel_lc__update_track`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

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

### `ops/tracks.md` (What goes in each track file; Splitting a plan that holds a log)

#### What goes in each track file

A track is a folder of six files. Each has one job; put a thing in the file whose job it is, and keep logs out of the design files.

| File | Role | Holds | Never holds |
|------|------|-------|-------------|
| `index.md` | Overview (the project-manager view) | What and why in a few lines, the markers, one line on where the track stands | Logs, long text, status history |
| `spec.md` | Detailed design (the architect view) | Requirements, dated decisions, data model and APIs, acceptance criteria, risks | Status, release notes, incident reports |
| `plan.md` | Task tracker: the work breakdown | Phases and the individual tasks as checkboxes, as detailed as the work needs, ticked as work proceeds | Dated status, releases, incidents, a run log; design detail, decisions, requirements, acceptance criteria (they go to `spec.md`) |
| `test.md` | Test plan | Test cases and the commands that run them | Status of a run |
| `history.md` | Run log: tracked in git, append-only | One dated line per event: what ran, commit hashes, deploys, incidents | Design, decisions, dialogue |
| `conversation.md` | Dialogue between people and agents: untracked, may be private | Questions, answers, comments, a long write-up | The run log |

**Who ticks what.** The acceptance criteria in `spec.md` are ticked by the review and the quality gate, after they saw the criterion hold. The tasks in `plan.md` are ticked by the implementing agent, as it finishes them. A plan task may name the requirement it serves (`REQ-3`), so a reader can trace the plan to the spec.

**Where a status goes.** Status, a release, an incident or any other dated entry never goes into `plan.md` or `spec.md`. It is one line in `history.md`, newest last:

```
- <YYYY-MM-DD HH:MMZ> <emoji> <one line>
```

The emoji is the first character after the date: `✅` success, `⚠️` a human should look, `❌` failed, `ℹ️` a note. Put a hash, a URL or the name of a deploy in the line; put long text in `spec.md` (a decision, with its date and its reason) or `conversation.md` (a discussion) and link to it from the line. The plan only gets ticked.

With the add-on, `append_conversation` with author `system` writes that dated line into `history.md` (the answer says which file got it); the authors `human`, `claude` and `gemini` write `conversation.md`. By hand, append the line to `history.md` and commit it with the track. `create_track` makes `history.md` with a one-line header; an older track without the file gets it with its first `system` entry, or by hand.

#### Splitting a plan that holds a log

A plan has become a log when two or more of its headings are dated (`## 2026-11-18`, `### 18 Nov`) or start with STATUS, RELEASE, INCIDENT, UPDATE or LOG, or when it is over 60 KB. (With the add-on, `get_track` warns with `plan_has_log`, `list_tracks` and the track summary name the tracks.) A plan with many task checkboxes is not a log: never split a plan for having many tasks.

1. **Ask first.** Say which plan, how many dated sections and how large it is, and ask "Split it now? [default: yes]". Change nothing without the answer.
2. **Dated sections go to `history.md`.** Each status, release or incident section becomes one dated line, `- <YYYY-MM-DD HH:MMZ> <emoji> <one line>`, oldest first, keeping its hashes, URLs and numbers. Use the section's own date; when it has none, use the date of the commit that added it (`git log -S`). A long section's detail is not thrown away: it stays under its line in `history.md` as indented continuation lines (two spaces), so the log stays in git.
3. **Decisions go to `spec.md`.** A design decision, a requirement or an acceptance criterion found in the plan moves to `spec.md` with its date and its reason.
4. **The plan keeps the work breakdown.** Phases and the checkbox tasks stay in `plan.md`, their ticks unchanged.
5. **Never delete.** Everything removed from the plan exists in `history.md`, `spec.md` or `conversation.md` afterwards; the old text stays in git. Commit the files together with explicit paths, and add one `history.md` line saying the plan was split.

### `lanes/plan.md`

Produce or refine `spec.md`, `plan.md` and `test.md` for track N. This lane writes documentation
only. Application code written here gets in the way: the implement lane works from what you
planned, and `plan` always runs in the primary checkout whatever `**Workspace**` says.

Before step 1, look at "Offer a missing skill" near the end of this guide: one check, usually silent.

0. **Claim the track first.** Write `**Lane**: plan` and `**Lane Status**: running` to the track's
   `index.md`. Set `**Lane**` explicitly, not just `**Lane Status**`: when plan is run directly
   (a KPI-miss replan, a manual re-run) the track may not sit in the plan lane, and the board
   would show it running in the wrong column. The claim also stops a second session starting the same track.
0b. **Classify bug or feature** - only if `index.md` has neither a `**Workspace**` nor a
   `**Track Kind**` marker (an explicit `**Workspace**` always wins; skip this step). Decide from the
   title, description, `conversation.md` (create it if missing) and a quick look at the code area. Write
   `**Track Kind**: bug` or `**Track Kind**: feature`, never `**Workspace**`. The reason:
   `**Workspace**` is a deliberate human override (`main` or `branch`), while `**Track Kind**` only
   feeds the default (bug -> `main`, feature -> `branch`). If plan wrote `**Workspace**`, an
   inferred guess would look like a human choice and defeat the auto-queue check that keeps an
   unconfirmed bug classification from running unattended on main. Record it so a wrong guess is
   visible and overridable: add one dated line to `history.md`:
   `- <YYYY-MM-DD HH:MMZ> ℹ️ Classified as **Track Kind**: <bug|feature> - <one-line reasoning>.`
1. **Locate the track.** With the parallel add-on, `get_track` finds it. Otherwise Glob
   `conductor/tracks/*-<N>-*/` and `conductor/tracks/<N>-*/` (both naming conventions,
   `INITIALS-NNN-slug` and bare `NNN-slug`). If a folder exists, that is the track: go to Refine.
   Go to Scaffold only when neither form finds a folder anywhere.
2. **Scaffold (only when step 1 found nothing).** Before scaffolding a track for new work, follow
   "Search first: the default is update, not create" in `ops/tracks.md`: list the tracks by the key
   words (every lane, the backlog and done too) and, if one fits, ask "Update track N (title, lane) with
   this? [default: yes]" and extend it instead. Scaffolding over an existing track number
   creates a duplicate folder beside the real one. This has happened when a
   legacy-only scan missed `AM-<number>-...`.
   - Create `conductor/tracks/INITIALS-NNN-slug/`. Initials are the first letter of each word of
     `git config user.name`, up to 3, `XX` if unset. Never use the bare `NNN-slug` form for a new
     track.
   - Create `index.md` with `**Lane**: plan`, `**Lane Status**: running`, `**Progress**: 0%`,
     `**Phase**: New`, `**Type**`, `**Merge Mode**: direct`, `**Auto Run**: yes`, `**Author**`
     and a `**Summary**`.
   - Create `spec.md`, `plan.md`, `test.md` from the templates below.
3. **Refine (folder exists).**
   - Read `spec.md`, `plan.md`, `test.md`. On `FRESH_SESSION: false` you can skip files you
     already read this session (a replan right after a brainstorm), but re-read them if anything
     may have changed on disk: the on-disk version wins over your memory. Always re-read
     `conversation.md`.
   - If `conversation.md` holds a brainstorm thread (lines starting `> **system**: Brainstorm`),
     treat the Q&A as requirements and fold the answers into all three files.
   - Fill in missing requirements and phase detail from the current code.
   - **test.md must be real.** If it is missing, empty or still the `(Test cases to be added)`
     stub, write concrete test cases and commands for every phase in `plan.md`. The implement
     lane is test-driven and works from this file; a stub leaves it nothing to start with.
   - **Acceptance criteria describe what a user can observe, never the scaffolding.** A criterion
     such as "the service logs the expected 'not yet implemented' message" is satisfied by a stub,
     so a track can pass its own gate while the feature does not exist (this happened). Write
     "a service actually starts on the target machine" instead.
   - **Deferring scope is fine; calling the track complete is not.** A capability left out of
     this pass (FFU) must not appear as a satisfiable acceptance criterion, and `plan.md` needs an
     explicit unchecked phase for it, so the track cannot reach `done` at 100%.
   - Add test cases to `test.md` for any new phase or requirement.
   - If `plan.md` contains `## ❌ KPI MISS`, this is a replan after a KPI failure. Read target,
     actual, delta and snapshot, and try a different hypothesis (new angle, channel or CTA).
     Print `♻️ Replanning with KPI data: target=X, actual=Y, delta=Z` and append a new
     `## ❌ KPI MISS` entry; never overwrite an old one.
4. **KPI block (marketing and sales tracks).** Read `**Type**` from `index.md`. For `marketing` or
   `sales`, `spec.md` needs a `## KPI` block. If it is missing, print
   `⚠️ KPI block required for marketing/sales tracks` and write a stub with TODOs. Do not
   transition until Target, Metric, Source and Threshold are filled in:
   ```markdown
   ## KPI
   **Target**: <number>
   **Metric**: <label>
   **Source**: hn-api | reddit-api | manual | custom-url
   **Source Config**: <item_id=NNN or URL>
   **Threshold**: <number>
   **Window**: <e.g. 48h or 7d>
   **Maps To**: <metric name from conductor/kpis.md>   (optional)
   ```
5. **Draft (non-dev tracks).** Once planned, write a `## Draft` section in `spec.md` next to KPI and
   Requirements: the publish-ready content the human will execute (post text, email copy), with a
   `### Publish Instructions` subsection of numbered steps. No separate `draft.md`. Moving the
   track to implement is the approval; there is no extra gate.
5b. **Fundamentals conflict.** If the requirements conflict with, or need a change to,
   `product-guidelines.md`, `design-language.md`, `tech-stack.md` or `workflow.md` (a UI that
   contradicts the design tokens, a dependency that conflicts with the stack), do not edit that
   doc as part of this plan. Append
   ```
   > **system**: ⚠️ FUNDAMENTALS CONFLICT - this track's [requirement] appears to require
   > changing conductor/[doc].md ([specific conflict]). Continuing as specified; doc not
   > modified - please review whether conductor/[doc].md should be updated.
   ```
   to `conversation.md` and note it in `spec.md`'s Requirements as an open item. It does not
   block planning; a human decides whether the doc or the track changes.
6. **Transition.** First re-read `index.md`'s `**Lane**`. If it is no longer `plan` (a human
   dragged the card elsewhere while you worked), leave `**Lane**` and `**Lane Status**` exactly as
   they are and add the history line
   `ℹ️ Plan finished, but the track had already been moved to <current lane> - leaving it there.`
   instead of the completion line: a manual move always wins over this run's stale intent.
   Otherwise apply the workflow's success move for the plan lane: with the connector, call
   `update_track` with `outcome: "success"` (the target is `valid.next.success` in `get_track`);
   without it, read `lanes.plan.on_success` in `conductor/workflow.json` with the grammar in
   `ops/lanes-and-statuses.md`. This project's `plan:success`
   means `**Lane**: plan` and `**Lane Status**: success`; do not assume the next lane is implement.
   Then add the completion line to `history.md` (one dated line, `- <YYYY-MM-DD HH:MMZ> <emoji> <text>`; with the connector,
   `append_conversation` with author `system` writes it):
   `✅ Plan complete - track now at <lane>:<status>.`, or, if step 5b
   fired, `⚠️ Plan complete with a fundamentals conflict - see conversation above.`
   (the guardrail's own comment plus this line is enough; do not post a third).

Your job ends here. The track waits in its new lane for the next step.

#### Where things go

`spec.md` is the detailed design, `plan.md` the task tracker (phases and the tasks as checkboxes, ticked as work proceeds), `test.md` the test
plan, `history.md` the tracked run log, `conversation.md` the dialogue. When you write or refine a plan, keep it that
way: status, releases, incidents and any dated entry never go into `plan.md` or `spec.md`; they are one dated line in
`history.md` (`- <YYYY-MM-DD HH:MMZ> <emoji> <one line>`), and a design decision goes into `spec.md` with its date and its
reason. Write the acceptance criteria in `spec.md` as checkboxes (review and the quality gate tick them), and give each plan task the requirement it serves when it helps (`REQ-3`); the implementing agent ticks the tasks. If the plan you refine already holds a dated log, move it out first (ask before moving; the procedure is
"Splitting a plan that holds a log" in `ops/tracks.md`). The full table is "What goes in each
track file" in the same file.

#### Templates

`plan.md`
```markdown
# Track NNN: [Title]

## Phase 1: [Phase Name]

**Problem**: What issue does this solve?
**Solution**: How will it be solved?

- [ ] Task 1: Description
    - [ ] Sub-task: Details
- [ ] Task 2: Description

**Impact**: What will change?
```
The track's progress is derived from these checkboxes, so keep them accurate.

`spec.md`
```markdown
# Spec: [Feature Name]

## Problem Statement
## Requirements
- REQ-1: ...
## Acceptance Criteria
- [ ] Criterion 1
## API Contracts / Data Models   (if applicable; add Data Model Changes when relevant)
```

`test.md`
```markdown
# Tests: Track NNN - [Title]

## Test Commands
(the exact commands, e.g. `npm test`, `npm test -- path/to/file.spec.js`)

## Test Cases
### Phase 1: [Name]
- [ ] TC-1: [Description] - expected: [outcome]

## Acceptance Criteria
- [ ] All unit tests pass
- [ ] No regressions in related features
```

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

Candidates for the `plan` lane:

###### `frontend-design`

Design direction for a new or reshaped UI: typography, layout and choices that do not read as templated defaults. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `setup`, `plan`, `implement` (lanes), Type `dev`, only when the project has `ui`. Level: `prerequisite`.
Skills for this part: `frontend-design`.
It counts as installed when a skill named `frontend-design` is in the session's skills list (it may show as `frontend-design:frontend-design`), or `claude plugin list` shows `frontend-design@claude-plugins-official`. It is Markdown only: it adds knowledge and installs no program. It comes from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install frontend-design@claude-plugins-official
```

###### `marketing-skills`

Marketing and sales skills for content: strategy, launch plans, copywriting, social posts, sales enablement, prospecting, cold email, analytics and A/B tests (53 skills in all). Third-party, licence MIT, from `coreyhaines31/marketingskills`. Fits `setup`, `plan`, `implement`, `quality-gate` (lanes), Type `marketing`, `sales`, any stack. Level: `prerequisite`.
Skills for this part: `content-strategy`, `launch` (older installs list it as `launch-strategy`), `prospecting`, `revops`, `analytics` (older installs list it as `analytics-tracking`), `ab-testing` (older installs list it as `ab-test-setup`).
It counts as installed when a skill from it (for example `copywriting` or `cold-email`) is in the session's skills list, in `.claude/skills` or `~/.claude/skills`, or `claude plugin list` shows `marketing-skills@marketingskills`. It is Markdown only: it adds knowledge and installs no program. It comes from `coreyhaines31/marketingskills`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add coreyhaines31/marketingskills
```

```bash
claude plugin install marketing-skills@marketingskills
```

###### `superpowers`

Process skills for the lanes: brainstorming and writing plans, test-first work, systematic debugging, sub-agent execution, worktrees, code review and verification before done. Third-party, licence MIT, from `anthropics/claude-plugins-official`. Fits `setup`, `brainstorm`, `plan`, `implement`, `review`, `quality-gate`, `merge` (lanes), Type `dev`, any stack. Level: `helps`.
Skills for this part: `brainstorming`, `writing-plans`.
It counts as installed when one of its skills (for example `test-driven-development`) is in the session's skills list, or `claude plugin list` shows `superpowers@claude-plugins-official`. It installs a shell hook script that runs when each session starts, plus Markdown skills on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install superpowers@claude-plugins-official
```

###### `customer-support`

Support skills: ticket triage, draft replies, knowledge-base articles and escalations. Third-party, licence Apache-2.0, from `anthropics/knowledge-work-plugins`. Fits `plan`, `implement` (lanes), Type `support`, any stack. Level: `helps`.
Skills for this part: `ticket-triage`, `customer-research`.
It counts as installed when a skill from it (for example `ticket-triage`) is in the session's skills list, or `claude plugin list` shows `customer-support@knowledge-work-plugins`. It installs connection settings for hosted services (Slack, Intercom, HubSpot, Notion and others; no local program, each asks you to sign in before it connects), plus Markdown skills on your computer, from `anthropics/knowledge-work-plugins`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add anthropics/knowledge-work-plugins
```

```bash
claude plugin install customer-support@knowledge-work-plugins
```

###### `data`

Data skills for a dashboard or chart: build a dashboard, create a visualization, explore and validate the data. Third-party, licence Apache-2.0, from `anthropics/knowledge-work-plugins`. Fits `plan`, `implement` (lanes), Type `dev`, only when the project has `dashboard`. Level: `helps`.
Skills for this part: `build-dashboard`, `data-visualization`.
It counts as installed when a skill from it (for example `build-dashboard`) is in the session's skills list, or `claude plugin list` shows `data@knowledge-work-plugins`. It installs connection settings for hosted data services (BigQuery, Amplitude, Hex and others; no local program, each asks you to sign in before it connects), plus Markdown skills on your computer, from `anthropics/knowledge-work-plugins`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add anthropics/knowledge-work-plugins
```

```bash
claude plugin install data@knowledge-work-plugins
```

Stack tags used above:

- `ui`: a front-end stack (React, Vue, Svelte, Next.js, a Vite config, .html, .css or .tsx files), or the track's plan names screens or pages.
- `dashboard`: the track or its plan is about a dashboard, charts or a data page.

#### Skills that help here

These are suggestions, in the same spirit as the rest of this guide: a second opinion, never an order. If a skill
named here is installed (for example from the Superpowers plugin), consider using it; if it is not, say so in one line
and carry on without it. `brainstorming` helps settle unclear requirements before the spec is written; `writing-plans` helps break the work into phases with small, checkable tasks for `plan.md`.

Also read `conductor/workflow.json`. If it has a top-level `skills` object with a list under `"plan"`, such as
`{ "skills": { "plan": ["my-skill"] } }`, use those skills in addition, the same way: if one is installed, use it; if
it is missing, say so and continue. The `skills` key is optional; when it is absent, nothing changes. Where a skill's
own steps or file locations differ from this guide or from the track files, the track files and this guide win; take the
skill's method, not its output paths.

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

### `lanes/review.md`

Evaluate the implementation against the plan and the product guidelines, post the verdict as a
comment, and route the track. This lane only evaluates: fixing the bugs it finds hides them from
the implement lane's retry loop, so write them up as gaps instead.

Before step 1, look at "Offer a missing skill" near the end of this guide: one check, usually silent.

0. **Claim the track first.** Write `**Lane**: review` and `**Lane Status**: running` to the
   track's `index.md`. Set `**Lane**` explicitly: when the command is run directly the track may
   not sit in this lane, and the board would show it running in the wrong column. In the same
   edit, clear any existing `**Verdict**` marker, so a run that is cut short never leaves a stale
   value for a later run's exit handler to misread.
1. **Load context.**
   - Unless `FRESH_SESSION: false` (review often resumes the session implement used), read
     `plan.md`, `spec.md`, `test.md`, and `product-guidelines.md`, `design-language.md`,
     `deployment-stack.md` where present.
   - Always read `conversation.md` (create it if missing): it shows whether earlier review gaps were addressed and
     whether the human gave specific instructions.
2. **Evaluate** the implementation against the requirements and guidelines.
   - Secrets: no hardcoded secrets or secrets in logs; ADC / Secret Manager used as
     `deployment-stack.md` specifies.
   - If `test.md` exists, run its test commands. A failing test case makes the verdict FAIL.
3. **Post the review** as one dated verdict line in `history.md`, emoji first:
   `- <YYYY-MM-DD HH:MMZ> ✅ REVIEW PASSED` or `- <YYYY-MM-DD HH:MMZ> ⚠️ REVIEW FAILED`. Put the write-up (test summary,
   gaps) in one comment in `conversation.md` (authored `claude`, `>`-prefixed continuation lines), not a second one;
   the history line stays one line, and no status goes into `plan.md` or `spec.md`.
4. **Transition.**
   - Re-read `index.md`'s `**Lane**`. If it is no longer `review` (a human moved the card), leave
     `**Lane**` and `**Lane Status**` alone, keep the step 3 comment (the review is still valid),
     and note in it that the transition was skipped.
   - Otherwise take the move from the workflow: with the connector, `update_track` with
     `outcome: "success"` (PASS) or `"failure"` (FAIL), the target being `valid.next` in
     `get_track`; without it, read `conductor/workflow.json` with the grammar in
     `ops/lanes-and-statuses.md` and set `**Lane**` and
     `**Lane Status**` from `lanes.review.on_success` or `on_failure`.
   - **PASS:** apply the success move (this project: `quality-gate:queue`),
     append `## ✅ REVIEWED` to `plan.md`, and in the same edit write `**Verdict**: pass`.
   - **FAIL:** apply the failure move (this project: `implement:queue`), add
     `⚠️ Gaps` to `plan.md`, and in the same edit write `**Verdict**: fail`.
   - Write `**Verdict**` every time, PASS or FAIL. The harness can tag the same
     turn `blocked` (for example a question surfaced mid-review) although step 4 already reached
     a routable outcome; the run's exit handler reads `**Verdict**` before that tag, so
     a resolved review is routed instead of parked indefinitely.

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

Candidates for the `review` lane:

###### `laneconductor-parallel`

Parallel work: isolated sub-agents, one per track in its own worktree, and safe shared state through conflict-checked track writes. LaneConductor add-on, licence Elastic-2.0, from `meller/laneconductor`. Fits `implement`, `review` (lanes), Type `dev`, any stack. Level: `helps`. Mention it only when: the person mentions several sessions, people or sub-agents writing the same tracks, or worries about overwrites; or the person mentions worktrees or running tracks in parallel; or the person asks for automatic commits, a privacy scan or a health report.
It counts as installed when its connector tools exist (`mcp__plugin_laneconductor-parallel_lc__*`, for example `mcp__plugin_laneconductor-parallel_lc__get_track`), or its agent `laneconductor-parallel:track-runner` is listed. It installs an MCP server (the connector, a Node.js program) and a scaffold script on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-parallel@laneconductor
```

###### `superpowers`

Process skills for the lanes: brainstorming and writing plans, test-first work, systematic debugging, sub-agent execution, worktrees, code review and verification before done. Third-party, licence MIT, from `anthropics/claude-plugins-official`. Fits `setup`, `brainstorm`, `plan`, `implement`, `review`, `quality-gate`, `merge` (lanes), Type `dev`, any stack. Level: `helps`.
Skills for this part: `requesting-code-review`, `receiving-code-review`.
It counts as installed when one of its skills (for example `test-driven-development`) is in the session's skills list, or `claude plugin list` shows `superpowers@claude-plugins-official`. It installs a shell hook script that runs when each session starts, plus Markdown skills on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install superpowers@claude-plugins-official
```

###### `pr-review-toolkit`

Review agents for a change: comments, tests, error handling, type design and simplification. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `review` (lanes), Type `dev`, any stack. Level: `helps`.
Skills for this part: `review-pr`.
It counts as installed when the command `/pr-review-toolkit:review-pr` exists, or `claude plugin list` shows `pr-review-toolkit@claude-plugins-official`. It is Markdown only: it adds knowledge and installs no program. It comes from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install pr-review-toolkit@claude-plugins-official
```

#### Skills that help here

These are suggestions, in the same spirit as the rest of this guide: a second opinion, never an order. If a skill
named here is installed (for example from the Superpowers plugin), consider using it; if it is not, say so in one line
and carry on without it. `requesting-code-review` helps frame what to check and how to report it; `receiving-code-review` helps when feedback arrives and each point needs to be checked before acting on it.

Also read `conductor/workflow.json`. If it has a top-level `skills` object with a list under `"review"`, such as
`{ "skills": { "review": ["my-skill"] } }`, use those skills in addition, the same way: if one is installed, use it; if
it is missing, say so and continue. The `skills` key is optional; when it is absent, nothing changes. Where a skill's
own steps or file locations differ from this guide or from the track files, the track files and this guide win; take the
skill's method, not its output paths.

### `lanes/quality-gate.md`

Run the checks, post the result, and route the track. Passing here queues the track for merge
(`done:queue`); it does not mean shipped, because the merge action sets `done:success` once the
code is on `main`.

Before step 1, look at "Offer a missing skill" near the end of this guide: one check, usually silent.

0. **Claim the track first.** Write `**Lane**: quality-gate` and `**Lane Status**: running` to
   the track's `index.md`. Set `**Lane**` explicitly: when run directly the track may not sit in
   this lane, and the board would show it running in the wrong column. In the same edit, clear
   any existing `**Verdict**` marker, so a run cut short (including the KPI-miss early exit in
   step 1) never leaves a stale value for a later run's exit handler to misread.
0b. **KPI window.** If `**KPI Check After**` in `index.md` is in the future, ask
   "KPI window not reached, Xh remaining. Measuring now may be unreliable. Run anyway? (y/n)" and
   stop on "n". When an automatic run launched you it already checked the time; skip this.
1. **KPI measurement (before any code check).** Read `**Type**`. If it is non-dev (`marketing`,
   `sales`, `support`, `other`) or `spec.md` has a `## KPI` block, read
   the KPI value by hand from the source the `## KPI` block names (`**Source**` and `**Source Config**`)
   or, when it cannot be read from here, ask the person for the number; compare it with `**Target**`
   and `**Threshold**`, and write `**KPI Actual**: N` and `**KPI Snapshot**: {JSON of what you read}`
   to `index.md`. Dev tracks without a `## KPI` block skip this.
   - **KPI failed** (the value does not reach the target or threshold): append to `plan.md`
     ```markdown
     ## ❌ KPI MISS - [ISO timestamp]
     **Target**: T | **Actual**: N | **Delta**: -D | **Window**: W
     **Snapshot**: `{raw JSON}`
     ```
     and to `conversation.md` `> **system**: ❌ KPI miss - actual=N, target=T, threshold=TH.`
     Then transition to `on_failure` (step 5, without a verdict) and skip the code checks.
   - **KPI passed:** append `> **system**: KPI measurement: actual=N, target=T, threshold=TH, passed=true.`
     with no leading emoji (it is not the terminal outcome; step 4's comment is) and continue.
2. **Execute the checks.** Read `conductor/quality-gate.md` and the track's `test.md`, and run
   every command in their "Automated Checks" / "Test Commands" sections with the shell.
   - **The checkboxes in `quality-gate.md` are a checklist to run, not a report.** Older copies
     of that file shipped pre-ticked with a stale `Status: PASS`. Re-run each command and judge
     only by output you saw yourself. If you catch yourself thinking "it's already checked",
     that is the failure this warning exists for.
   - `test.md` commands are the primary check for this track; `quality-gate.md` applies the
     project-wide standards.
   - Scan modified files for hardcoded secrets and check `.gitignore` covers the Zero-Secrets
     patterns.
   - If a command's tool is missing (for example `playwright`), install it or report a failure.
   - Non-dev tracks that passed KPI have no code to check; skip the code checks.

   **2a. Run the product, not just the code.** Unit tests show the code does what its author
   believed; they cannot show a feature is missing. If the track touched UI or a user-facing flow:
   - Run the project's browser/E2E suite if `quality-gate.md` names one (for example
     `npx playwright test`). Run the existing specs; a line saying "if UI changes exist,
     create/run tests" does not license one trivial new passing test.
   - With no E2E suite, drive the flow by hand once: start the app, use what the track added, and
     record what you saw (screenshot, or the real API/DB response). "The code looks correct" is
     not evidence.
   - **Restart long-running processes first.** Servers and long-running tools do not hot-reload, so
     verifying against a process started before your change tests the old code. This has caused
     several false passes in this repo.

   **2b. Stub and deferred-work scan.**
   ```bash
   grep -rniE "not yet implemented|not implemented|TODO|FIXME|FFU|placeholder|stub" \
     --include="*.mjs" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" \
     conductor ui bin 2>/dev/null | grep -v node_modules
   ```
   - A hit inside a code path `plan.md` marks `[x]` is a FAIL, not a note.
   - Also grep `index.md`, `plan.md` and `spec.md` for `FFU`, "deferred", "future", "stub". If a
     capability named in `spec.md`'s Solution is deferred, the track cannot reach `done` (step 5).

   **2c. Judge against the user-facing promise.** Read `spec.md`'s Problem Statement and Solution
   and ask whether a user doing what the track promises would see it work. Acceptance criteria
   that assert a placeholder ("logs the expected 'not yet implemented' message") are not met
   criteria; record them in `conversation.md` as a spec defect instead of passing the track on them.
3. **Self-healing.** If a check fails and you can fix it (a syntax error, a missing command),
   you may. Before the fix: write a failing test that reproduces the bug, then fix, then re-run
   to see it pass. Commit test and fix together as `fix(quality-gate): [description]`, and post a
   comment in `conversation.md` saying what failed and what you changed.
4. **Post the result** as one dated line in `history.md`, emoji first:
   `- <YYYY-MM-DD HH:MMZ> ✅ QUALITY GATE PASSED`, or `- <YYYY-MM-DD HH:MMZ> ❌ QUALITY GATE FAILED` (use `⚠️` when
   it needs human judgment rather than a plain retry). Put the full write-up in one comment in `conversation.md`
   (authored `claude`, `>`-prefixed continuation lines), not a second one; no status goes into `plan.md` or `spec.md`.
5. **Transition.**
   - Re-read `index.md`'s `**Lane**`. If it is no longer `quality-gate` (a human moved the card),
     leave `**Lane**` and `**Lane Status**` alone, keep the step 4 comment, and note there that
     the transition was skipped.
   - Otherwise take the move from the workflow: with the connector, `update_track` with
     `outcome: "success"` (PASS) or `"failure"` (FAIL), the target being `valid.next` in
     `get_track`; without it, read `conductor/workflow.json` with the grammar in
     `ops/lanes-and-statuses.md` (a bare `done` is `done:queue`).
   - **Done-gate.** A track may reach `done` (queued for merge) only if the feature works end to
     end. Confirm all of: (1) the stub scan found nothing in `[x]` code paths; (2) no capability
     named in `spec.md`'s Solution is FFU, deferred or future; (3) step 2a's real-product check
     was performed and an observation recorded. If any fails, do not set `done`: set the lane to
     `review` (or `on_failure`), keep `**Progress**` below 100%, and write what remains in
     `conversation.md`. Documenting a deferral honestly does not make the track complete; a track
     that shipped a stub and was marked `done: 100%` with an honest "SSH deferred (FFU)" note is
     the incident these rules come from.
   - **PASS:** apply the success move (this project: `done:queue`, passed and not yet shipped),
     append `## ✅ QUALITY PASSED` to `plan.md`, and in the same edit write `**Verdict**: pass`.
   - **FAIL:** apply the failure move, explain the failure in
     `conversation.md`, and in the same edit write `**Verdict**: fail`.
   - The move sets `**Lane**` and `**Lane Status**` together (a bare target is `queue`); do not set the
     status separately.
   - While the gate itself is executing (a full suite, a deploy), the track is
     `quality-gate:running`.
   - Write `**Verdict**` on every PASS/FAIL: the harness can tag the turn
     `blocked` although this step already resolved a routable outcome, and the run's exit
     handler reads `**Verdict**` first so a resolved result is routed, not parked. It is not
     written for the KPI-miss exit, which has no code verdict and routes through `on_failure` itself.

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

Candidates for the `quality-gate` lane:

###### `marketing-skills`

Marketing and sales skills for content: strategy, launch plans, copywriting, social posts, sales enablement, prospecting, cold email, analytics and A/B tests (53 skills in all). Third-party, licence MIT, from `coreyhaines31/marketingskills`. Fits `setup`, `plan`, `implement`, `quality-gate` (lanes), Type `marketing`, `sales`, any stack. Level: `prerequisite`.
Skills for this part: `analytics` (older installs list it as `analytics-tracking`), `ab-testing` (older installs list it as `ab-test-setup`).
It counts as installed when a skill from it (for example `copywriting` or `cold-email`) is in the session's skills list, in `.claude/skills` or `~/.claude/skills`, or `claude plugin list` shows `marketing-skills@marketingskills`. It is Markdown only: it adds knowledge and installs no program. It comes from `coreyhaines31/marketingskills`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add coreyhaines31/marketingskills
```

```bash
claude plugin install marketing-skills@marketingskills
```

###### `superpowers`

Process skills for the lanes: brainstorming and writing plans, test-first work, systematic debugging, sub-agent execution, worktrees, code review and verification before done. Third-party, licence MIT, from `anthropics/claude-plugins-official`. Fits `setup`, `brainstorm`, `plan`, `implement`, `review`, `quality-gate`, `merge` (lanes), Type `dev`, any stack. Level: `helps`.
Skills for this part: `systematic-debugging`, `verification-before-completion`.
It counts as installed when one of its skills (for example `test-driven-development`) is in the session's skills list, or `claude plugin list` shows `superpowers@claude-plugins-official`. It installs a shell hook script that runs when each session starts, plus Markdown skills on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install superpowers@claude-plugins-official
```

###### `security-guidance`

Security warnings on edits and a diff review when a turn ends, for injection, XSS, hardcoded secrets and other vulnerability classes. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `quality-gate` (lanes), Type `dev`, any stack. Level: `helps`.
It counts as installed when `claude plugin list` shows `security-guidance@claude-plugins-official`. It installs a Python hook script that runs before file edits and when a turn ends, to warn about security problems on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install security-guidance@claude-plugins-official
```

###### `playwright`

Drives a real browser to check a UI flow, click through it and take screenshots, for the quality gate of a UI track. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `setup`, `quality-gate` (lanes), Type `dev`, only when the project has `ui`. Level: `helps`.
It counts as installed when its browser tools are among your tools (they start with `mcp__plugin_playwright_playwright__`), or `claude plugin list` shows `playwright@claude-plugins-official`. It installs an MCP server (the Playwright MCP Node.js program from Microsoft, fetched with npx) that drives a real browser on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install playwright@claude-plugins-official
```

Stack tags used above:

- `ui`: a front-end stack (React, Vue, Svelte, Next.js, a Vite config, .html, .css or .tsx files), or the track's plan names screens or pages.

#### Skills that help here

These are suggestions, in the same spirit as the rest of this guide: a second opinion, never an order. If a skill
named here is installed (for example from the Superpowers plugin), consider using it; if it is not, say so in one line
and carry on without it. `verification-before-completion` helps keep the rule this lane already has: run the check this time and read the real output before marking anything done.

Also read `conductor/workflow.json`. If it has a top-level `skills` object with a list under `"quality-gate"`, such as
`{ "skills": { "quality-gate": ["my-skill"] } }`, use those skills in addition, the same way: if one is installed, use it; if
it is missing, say so and continue. The `skills` key is optional; when it is absent, nothing changes. Where a skill's
own steps or file locations differ from this guide or from the track files, the track files and this guide win; take the
skill's method, not its output paths.

### `lanes/merge.md`

The `done` lane's standard action. It runs in the **primary checkout, on `main`**, never in the track's worktree.
`done:success` means the code is reachable from local `main` (direct mode) or the PR is merged on
GitHub (pr mode), and nothing less.

Before step 1, look at "Offer a missing skill" near the end of this guide: one check, usually silent.

Markers this lane reads and writes:
- `**Merge Mode**: direct|pr` (absent means `pr`). `direct` merges straight to main in this
  session; `pr` pushes the branch and opens a GitHub PR, landing at `done:waiting`.
- `**PR URL**` (and `**PR Number**`, `**PR Status**`) are written by this lane once `gh pr create`
  returns; the board shows the URL while the track sits at `done:waiting`.

0. **Claim the track first.** Write `**Lane**: done` and `**Lane Status**: running` to
   `conductor/tracks/NNN-*/index.md`. Set `**Lane**` explicitly: when run directly the track may
   not sit in this lane, and the board would show it running in the wrong column.
1. **Work in the primary checkout.** Do not create a track worktree; work in the repo root, with `main`
   checked out. Commits made here still name the track (`Merge track-NNN`, and so on).
2. **Load context.** Skip files you already read this session, but always re-read `conversation.md`.
   Read `index.md` for `**Merge Mode**` and `conversation.md` for human instructions (for example
   a note about a conflicted PR; see step 6).
3. **Single writer.** Only the primary checkout's copy of `conductor/tracks/NNN-*/*.md` is ever
   written. If a leftover worktree for the track still exists, do not touch its files:
   two copies of `index.md` written in two places is how markers get overwritten.
4. **Direct mode** (`**Merge Mode**: direct`):
   a. Check `git status` in the primary checkout is clean enough to merge, then
      `git merge --no-ff track-NNN` with a message that names the track (`Merge track-NNN`). If it reports
      `track-NNN` is not a branch, that is expected, not a failure, for a track with
      `**Workspace**: main` (every earlier lane already ran on `main`, so there was never a
      branch). Treat it as a successful merge and go to 4e.
   b. If the merge stops with a **conflict**, resolve it in this session: read the conflicting
      hunks, understand both sides' intent (this track's plan/spec against the conflicting change
      on main) and produce a correct result, then commit the merge. There is no separate
      conflict-resolution action.
   c. After a successful merge, remove the worktree and the branch by hand
      (`git worktree remove --force .worktrees/NNN`, `git branch -d track-NNN`). Ask the human
      before any push (`git push origin main`, `git push origin --delete track-NNN`); say what
      would be pushed, and push nothing without a yes.
   d. If a conflict cannot be resolved safely even in-session (semantic ambiguity, not just textual
      overlap), do not guess or force it: run `git merge --abort`, set `**Lane Status**` to
      `lanes.done.on_failure` (`done:failure`) and write exactly what conflicts to `conversation.md`.
      Never fall back silently to `queue`.
   e. On any successful merge (4a or 4b) set `**Lane Status**: success` (`done:success`).
5. **PR mode** (`**Merge Mode**: pr`, or the marker is absent):
   a. Check `gh auth status` first; never fall back to a local merge when `gh` is not authenticated.
      If an open PR already exists for the branch (`gh pr list --head track-NNN`), report that one
      instead of opening a second. Otherwise, after the human says yes, `git push -u origin track-NNN`
      and then `gh pr create` (title naming the track, body from the track's summary), and write
      `**PR Number**`, `**PR URL**` and `**PR Status**` into the primary checkout's `index.md`.
   b. After a conflict re-run (step 6), the branch was already updated and pushed, so the existing
      PR picks up the new commits; just report it.
   c. Set `**Lane Status**: waiting` (`done:waiting`). In the done lane, `waiting` means "waiting
      on a human outside the system": there is nothing more for this session to do. Do not merge
      the PR yourself; approval and merge happen on GitHub.
6. **Re-entry after a conflicted PR.** If the track was moved back to `done:queue` because GitHub
   reports the PR has a conflict, run the pr-mode flow (step 5), but first `git fetch origin`
   and merge or rebase `origin/main` into `track-NNN`, resolve any real conflict in-session as in
   step 4b, and push (force-push only after a yes, and only if you rebased) before looking for
   the open PR. Pushing first is what makes the existing PR pick up the new commits.
7. **Add the completion line** to `history.md` (`- <YYYY-MM-DD HH:MMZ> <emoji> <text>`, emoji first; the merge, the
   commit hashes and any incident are dated lines there, never in `plan.md` or `spec.md`):
   - direct success: `✅ Merged track-NNN to main.`
   - pr mode: `⚠️ PR opened - waiting for review: <url>.` (⚠️ because it needs human
     action, not because anything failed)
   - unresolved conflict: `❌ Merge conflict could not be resolved automatically - see details above.`

Boundary: this lane only merges or opens a PR for code that already passed review and
quality-gate. Write no feature code here; the only code changes it should make are those needed
to resolve a conflict between the track branch and `main`. `workflow.json` stays the authority
for target lanes (how a target is read, and `done:queue` against `done:success`, is in
`ops/lanes-and-statuses.md`).

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

Candidates for the `merge` lane:

###### `superpowers`

Process skills for the lanes: brainstorming and writing plans, test-first work, systematic debugging, sub-agent execution, worktrees, code review and verification before done. Third-party, licence MIT, from `anthropics/claude-plugins-official`. Fits `setup`, `brainstorm`, `plan`, `implement`, `review`, `quality-gate`, `merge` (lanes), Type `dev`, any stack. Level: `helps`.
Skills for this part: `finishing-a-development-branch`.
It counts as installed when one of its skills (for example `test-driven-development`) is in the session's skills list, or `claude plugin list` shows `superpowers@claude-plugins-official`. It installs a shell hook script that runs when each session starts, plus Markdown skills on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install superpowers@claude-plugins-official
```

#### Skills that help here

These are suggestions, in the same spirit as the rest of this guide: a second opinion, never an order. If a skill
named here is installed (for example from the Superpowers plugin), consider using it; if it is not, say so in one line
and carry on without it. `finishing-a-development-branch` helps with the last steps (what to merge, what to clean up, what to leave to the human) without skipping the question about pushing.

Also read `conductor/workflow.json`. If it has a top-level `skills` object with a list under `"merge"`, such as
`{ "skills": { "merge": ["my-skill"] } }`, use those skills in addition, the same way: if one is installed, use it; if
it is missing, say so and continue. The `skills` key is optional; when it is absent, nothing changes. Where a skill's
own steps or file locations differ from this guide or from the track files, the track files and this guide win; take the
skill's method, not its output paths.

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
