---
description: "Plan a track: write its spec, plan and test cases (the plan lane)"
argument-hint: <track number or title>
---
Work on track `$ARGUMENTS` in the plan lane. The procedure is the plan lane guide (skill file `lanes/plan.md`); follow it and do not restate it here.

This command carries the skill text it uses, at the end under "Reference". Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the command are references only.

1. Find the track's folder under `conductor/tracks/` (Glob `conductor/tracks/*<number>*/`; both naming conventions exist, see "Finding a track" in the skill index) and read its `index.md`, `spec.md`, `plan.md`, `test.md` and `conversation.md`. Read the lane guide too. Read where a lane sends a finished track from `conductor/workflow.json` with the grammar of the skill file `ops/lanes-and-statuses.md` (a bare target is `queue` for another lane and `success` or `failure` for the same lane; a bare `done` is `done:queue`); never guess it from the raw file. The guide is advice.
2. Work through the guide. Change state by editing the track files directly, following the skill's `ops/tracks.md` (it has the formats): re-read a file right before editing it and change only the lines you mean to change.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__get_context`, `mcp__plugin_laneconductor-parallel_lc__get_track`, `mcp__plugin_laneconductor-parallel_lc__list_tracks`, `mcp__plugin_laneconductor-parallel_lc__update_track`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.

## Reference

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `lanes/plan.md`

Produce or refine `spec.md`, `plan.md` and `test.md` for track N. This lane writes documentation
only. Application code written here gets in the way: the implement lane works from what you
planned, and `plan` always runs in the primary checkout whatever `**Workspace**` says.

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
   - Create `conductor/tracks/INITIALS-<n>-slug/`. Initials are the first letter of each word of
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
   **Kill rule**: <optional: when to stop, e.g. under 20 sign-ups at the end of the window>
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

Your job ends here: write the closing message of a lane and stop. The track waits in its new lane for the next step.

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

Before the work, look at what fits this lane and offer what is missing; usually this is silent. The track is the one this command names.

**Offer rule** (full procedure: `/laneconductor:suggest-skills`). Plain text, never a form, never blocking.
- Look first: a skill is installed when it is in the session's skills list, `claude plugin list` (read only), `.claude/skills/` or `~/.claude/skills/`; an older name counts. Then say "you have `<skill>` installed, use it before writing the content" and use it.
- Offer only what is missing and fits this lane, the track's `**Type**` (dev if none) and the stack; else say nothing. At most two, ours first, never twice in a session, never one in `skills.declined` of `.laneconductor.json` (or older `.git/skill-advisor-declined.txt`).
- One or two plain sentences (what, why here, program or only knowledge), each install command alone in its own bash block, no leading `$`.
- `prerequisite`: ask, in the same sentence, whether to install first or carry on; otherwise a one-line tip. No answer: carry on.
- Never run an install yourself: the person runs it, then `/reload-plugins`. "Do not ask again": show the change; on a yes add it there (`.gitignore` first, asked).

Candidates for the `plan` lane (stack tags: ui, dashboard):

- `frontend-design` (prerequisite; stack ui): skills frontend-design. Markdown only. `claude plugin install frontend-design@claude-plugins-official`
- `marketing-skills` (prerequisite; Type marketing/sales): skills content-strategy, launch (was launch-strategy), prospecting, revops, analytics (was analytics-tracking), ab-testing (was ab-test-setup). Markdown only. `claude plugin marketplace add coreyhaines31/marketingskills`, `claude plugin install marketing-skills@marketingskills`
- `superpowers`: skills brainstorming, writing-plans. Installs a session-start hook script, plus Markdown skills. `claude plugin install superpowers@claude-plugins-official`
- `customer-support` (Type support): skills ticket-triage, customer-research. Installs connections to hosted services (Slack, Intercom and more), plus skills. `claude plugin marketplace add anthropics/knowledge-work-plugins`, `claude plugin install customer-support@knowledge-work-plugins`
- `data` (stack dashboard): skills build-dashboard, data-visualization. Installs connections to hosted data services, plus skills. `claude plugin marketplace add anthropics/knowledge-work-plugins`, `claude plugin install data@knowledge-work-plugins`

#### Skills that help here

Suggestions, a second opinion, never an order: if a skill named here is installed (for example from the Superpowers
plugin), consider using it; if not, say so in one line and carry on without it. `brainstorming` helps settle unclear requirements before the spec is written; `writing-plans` helps break the work into phases with small, checkable tasks for `plan.md`.

An optional top-level `skills` object in `conductor/workflow.json` may list more under `"plan"` (`{ "skills": { "plan": ["my-skill"] } }`): use them the same way (if one is missing, say so and continue). Absent, nothing changes. Where a skill's steps or file locations differ from this guide or the track files, those win; take the skill's method, not its output paths.

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
