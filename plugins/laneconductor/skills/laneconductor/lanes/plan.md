# plan lane: `/laneconductor plan N`

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

Before the work, look at what fits this lane and offer what is missing; usually this is silent. The track is the one this command names.

**Offer rule** (full procedure: `/laneconductor:suggest-skills`). Plain text, never a form, never blocking.
- Look first: a skill is installed when it is in the session's skills list, `claude plugin list` (read only), `.claude/skills/` or `~/.claude/skills/`; an older name counts. Then say "you have `<skill>` installed, use it before writing the content" and use it.
- Offer only what is missing and fits this lane, the track's `**Type**` (dev if none) and the stack; else say nothing. At most two, ours first, never twice in a session, never one on the declined list (`skill-advisor-declined.txt` in the directory `git rev-parse --git-common-dir` prints).
- One or two plain sentences (what, why here, program or only knowledge), each install command alone in its own bash block, no leading `$`.
- `prerequisite`: ask, in the same sentence, whether to install first or carry on; otherwise a one-line tip. No answer: carry on.
- Never run an install yourself: the person runs it, then `/reload-plugins`. "Do not ask again": after a yes, add the entry name to the declined file.

Candidates for the `plan` lane (stack tags: ui, dashboard):

- `frontend-design` (prerequisite; stack ui): skills frontend-design. Markdown only. `claude plugin install frontend-design@claude-plugins-official`
- `marketing-skills` (prerequisite; Type marketing/sales): skills content-strategy, launch (was launch-strategy), prospecting, revops, analytics (was analytics-tracking), ab-testing (was ab-test-setup). Markdown only. `claude plugin marketplace add coreyhaines31/marketingskills`, `claude plugin install marketing-skills@marketingskills`
- `superpowers`: skills brainstorming, writing-plans. Installs a session-start hook script, plus Markdown skills. `claude plugin install superpowers@claude-plugins-official`
- `customer-support` (Type support): skills ticket-triage, customer-research. Installs connections to hosted services (Slack, Intercom and more), plus skills. `claude plugin marketplace add anthropics/knowledge-work-plugins`, `claude plugin install customer-support@knowledge-work-plugins`
- `data` (stack dashboard): skills build-dashboard, data-visualization. Installs connections to hosted data services, plus skills. `claude plugin marketplace add anthropics/knowledge-work-plugins`, `claude plugin install data@knowledge-work-plugins`

## Skills that help here

These are suggestions, in the same spirit as the rest of this guide: a second opinion, never an order. If a skill
named here is installed (for example from the Superpowers plugin), consider using it; if it is not, say so in one line
and carry on without it. `brainstorming` helps settle unclear requirements before the spec is written; `writing-plans` helps break the work into phases with small, checkable tasks for `plan.md`.

Also read `conductor/workflow.json`. If it has a top-level `skills` object with a list under `"plan"`, such as
`{ "skills": { "plan": ["my-skill"] } }`, use those skills in addition, the same way: if one is installed, use it; if
it is missing, say so and continue. The `skills` key is optional; when it is absent, nothing changes. Where a skill's
own steps or file locations differ from this guide or from the track files, the track files and this guide win; take the
skill's method, not its output paths.
