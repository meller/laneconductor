# plan lane: `/laneconductor plan N`

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
   "Search first: the default is update, not create" in [ops/tracks.md](../ops/tracks.md): list the tracks by the key
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
   [../ops/lanes-and-statuses.md](../ops/lanes-and-statuses.md). This project's `plan:success`
   means `**Lane**: plan` and `**Lane Status**: success`; do not assume the next lane is implement.
   Then add the completion line to `history.md` (one dated line, `- <YYYY-MM-DD HH:MMZ> <emoji> <text>`; with the connector,
   `append_conversation` with author `system` writes it):
   `✅ Plan complete - track now at <lane>:<status>.`, or, if step 5b
   fired, `⚠️ Plan complete with a fundamentals conflict - see conversation above.`
   (the guardrail's own comment plus this line is enough; do not post a third).

Your job ends here. The track waits in its new lane for the next step.

## Where things go

`spec.md` is the detailed design, `plan.md` the task tracker (phases and the tasks as checkboxes, ticked as work proceeds), `test.md` the test
plan, `history.md` the tracked run log, `conversation.md` the dialogue. When you write or refine a plan, keep it that
way: status, releases, incidents and any dated entry never go into `plan.md` or `spec.md`; they are one dated line in
`history.md` (`- <YYYY-MM-DD HH:MMZ> <emoji> <one line>`), and a design decision goes into `spec.md` with its date and its
reason. Write the acceptance criteria in `spec.md` as checkboxes (review and the quality gate tick them), and give each plan task the requirement it serves when it helps (`REQ-3`); the implementing agent ticks the tasks. If the plan you refine already holds a dated log, move it out first (ask before moving; the procedure is
"Splitting a plan that holds a log" in [../ops/tracks.md](../ops/tracks.md)). The full table is "What goes in each
track file" in the same file.

## Templates

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

## Offer a missing skill

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

#### `frontend-design`

Design direction for a new or reshaped UI: typography, layout and choices that do not read as templated defaults. Third-party, licence Apache-2.0, from `anthropics/claude-plugins-official`. Fits `setup`, `plan`, `implement` (lanes), Type `dev`, only when the project has `ui`. Level: `prerequisite`.
Skills for this part: `frontend-design`.
It counts as installed when a skill named `frontend-design` is in the session's skills list (it may show as `frontend-design:frontend-design`), or `claude plugin list` shows `frontend-design@claude-plugins-official`. It is Markdown only: it adds knowledge and installs no program. It comes from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install frontend-design@claude-plugins-official
```

#### `marketing-skills`

Marketing and sales skills for content: strategy, launch plans, copywriting, social posts, sales enablement, prospecting, cold email, analytics and A/B tests (53 skills in all). Third-party, licence MIT, from `coreyhaines31/marketingskills`. Fits `setup`, `plan`, `implement`, `quality-gate` (lanes), Type `marketing`, `sales`, any stack. Level: `prerequisite`.
Skills for this part: `content-strategy`, `launch` (older installs list it as `launch-strategy`), `prospecting`, `revops`, `analytics` (older installs list it as `analytics-tracking`), `ab-testing` (older installs list it as `ab-test-setup`).
It counts as installed when a skill from it (for example `copywriting` or `cold-email`) is in the session's skills list, in `.claude/skills` or `~/.claude/skills`, or `claude plugin list` shows `marketing-skills@marketingskills`. It is Markdown only: it adds knowledge and installs no program. It comes from `coreyhaines31/marketingskills`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add coreyhaines31/marketingskills
```

```bash
claude plugin install marketing-skills@marketingskills
```

#### `superpowers`

Process skills for the lanes: brainstorming and writing plans, test-first work, systematic debugging, sub-agent execution, worktrees, code review and verification before done. Third-party, licence MIT, from `anthropics/claude-plugins-official`. Fits `setup`, `brainstorm`, `plan`, `implement`, `review`, `quality-gate`, `merge` (lanes), Type `dev`, any stack. Level: `helps`.
Skills for this part: `brainstorming`, `writing-plans`.
It counts as installed when one of its skills (for example `test-driven-development`) is in the session's skills list, or `claude plugin list` shows `superpowers@claude-plugins-official`. It installs a shell hook script that runs when each session starts, plus Markdown skills on your computer, from `anthropics/claude-plugins-official`, Anthropic's official marketplace.

```bash
claude plugin install superpowers@claude-plugins-official
```

#### `customer-support`

Support skills: ticket triage, draft replies, knowledge-base articles and escalations. Third-party, licence Apache-2.0, from `anthropics/knowledge-work-plugins`. Fits `plan`, `implement` (lanes), Type `support`, any stack. Level: `helps`.
Skills for this part: `ticket-triage`, `customer-research`.
It counts as installed when a skill from it (for example `ticket-triage`) is in the session's skills list, or `claude plugin list` shows `customer-support@knowledge-work-plugins`. It installs connection settings for hosted services (Slack, Intercom, HubSpot, Notion and others; no local program, each asks you to sign in before it connects), plus Markdown skills on your computer, from `anthropics/knowledge-work-plugins`, a third-party source, not LaneConductor.

```bash
claude plugin marketplace add anthropics/knowledge-work-plugins
```

```bash
claude plugin install customer-support@knowledge-work-plugins
```

#### `data`

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

## Skills that help here

These are suggestions, in the same spirit as the rest of this guide: a second opinion, never an order. If a skill
named here is installed (for example from the Superpowers plugin), consider using it; if it is not, say so in one line
and carry on without it. `brainstorming` helps settle unclear requirements before the spec is written; `writing-plans` helps break the work into phases with small, checkable tasks for `plan.md`.

Also read `conductor/workflow.json`. If it has a top-level `skills` object with a list under `"plan"`, such as
`{ "skills": { "plan": ["my-skill"] } }`, use those skills in addition, the same way: if one is installed, use it; if
it is missing, say so and continue. The `skills` key is optional; when it is absent, nothing changes. Where a skill's
own steps or file locations differ from this guide or from the track files, the track files and this guide win; take the
skill's method, not its output paths.
