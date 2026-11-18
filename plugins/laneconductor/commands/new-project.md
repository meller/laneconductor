---
description: "Start a project: a short interview, the conductor scaffold and the first tracks (runs only because you named it)"
argument-hint: "[name or idea]"
---
New project: `$ARGUMENTS` (nothing given means ask me). This runs only because I named it.

This command carries its whole procedure below: it is the text of the skill file `ops/new-project.md`, in full. Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: that folder is outside the project, and a read there raises a permission question or is denied. The skill file paths named in the text are references only.

Start a project from a short conversation: interview, scaffold, first tracks. Run it only when the person asks for it by
name. Nothing is committed without their yes, and nothing is ever pushed. It needs no installer and no database.

Do the scaffold by hand, as step 3 describes: the result is the same as the add-on's scaffold script gives. Do not search for that script (it lives in
the add-on's install folder, outside the project) and do not recommend the add-on for this.

If your client asks "Allow this read outside the working directories?" for a file of this plugin, tell the person in one line to
choose the option that allows it this one time. The options that say "keep allowing" or "block ... from now on" change a
permanent setting for every project and are not needed. Never ask anyone to change their permission settings for LaneConductor.

## 1. Detect the situation

- Empty or new folder: a new project. Ask for a name if the argument gave none.
- An existing repository (it has a `.git`, or files other than `conductor/`): say so and offer to add only the
  `conductor/` scaffold. `/laneconductor:setup` takes this path. Read what is there first (see "Existing repository" below) and
  use it as answers, so you ask less. Never overwrite an existing file; the scaffold skips what exists.
- `conductor/tracks` already holds tracks (an older LaneConductor, or another tool): say what you found (how many, in which
  naming form, which lanes) and import nothing. Offer to add only the missing `conductor/` context files and leave every track
  as it is; importing older tracks is a separate yes the person gives (`setup/scaffold.md`, "Older
  tracks"). Point to `new` for creating tracks.

### Existing repository

Keep the interview short. Instead of the nine questions of step 2, read the project and ask only to confirm:

- The name, from `package.json`, `pyproject.toml` or the README title (else the folder name).
- What it is for, from the package description or the first README paragraph (else ask one question).
- The stack, from the dependencies and config files; hosting hints from `Dockerfile`, `vercel.json` and the like.
- The test, lint, typecheck, build and e2e commands from the scripts in `package.json`, the Makefile and the CI files. A
  command is proposed only if it really exists: the npm placeholder `echo "Error: no test specified"` is not a test command, and
  a lint config without a lint script is not a lint command. Say so when you leave one out.
- Read the files yourself; do not look for a script to do it.

Show the result as ONE message with everything filled in, so the person only has to approve it: the name, what it is for, the
stack, the test, lint, typecheck and build commands that really exist (one line for each one you left out, with the reason),
where each fact came from, and the tracks folder: `conductor/tracks/`, committed with the code (the default), or private, for a
public repository whose plans should not be public (the folder is then kept out of git with one `.gitignore` line; private tracks
are not shared with other machines or people). End with "Reply ok, or tell me what differs." Write nothing until that reply. Ask a
further question only about what could not be read (usually KPIs and constraints, and only if the person wants them now).
Do not add the walking-skeleton track to an existing project; suggest planning the first real track instead.

## 2. Interview

For an existing repository use the short version under "Existing repository" in step 1 instead of the questions below.

Follow the style of `lanes/brainstorm.md`: ONE question per message, adaptive, short, in chat
(not through `conversation.md`; there is no track yet). Offer a likely default with each question so a one-word answer
is enough. Cover, in this order, and skip what the person already told you or the repository shows:

1. What is it for, and who uses it
2. The three key features
3. Language and stack
4. Data (what is stored, how much)
5. Authentication
6. Hosting and the deploy target
7. AI use (none is a fine answer)
8. Testing (which commands really exist, or will exist in the walking skeleton)
9. Constraints (budget, deadline, compliance, things to avoid)

Stop early when the answers are enough to scaffold; say "That is enough to start" and move on. Ask for 2 to 4 letter
initials for track ids last, only if the folder has none to reuse. Record the answers as you go: `name`, `summary`, `users`, `features`, `stack` (language, framework, data, auth, hosting, ai,
testing, other), `constraints`, `commands` (typecheck, lint, test, build, coverage, audit, e2e: ONLY commands that
exist), `kpis`, `journeys`, `initials`.

## 3. Scaffold

Show what you would create and what you would skip because it exists, and ask for a yes; after the yes, create the files. The files and templates are
in "Reference: scaffold" at the end of this command (from the skill files `setup/scaffold.md` and `setup/templates.md`); apply these rules over them:

- Create `conductor/product.md`, `tech-stack.md`, `workflow.md`, `workflow.json`, `product-guidelines.md`,
  `design-language.md`, `quality-gate.md`, `user-stories.md`, `kpis.md` and `tracks/`. No settings file is created: LaneConductor needs none.
- Every file is tailored from the answers; what was not discussed is an honest placeholder, never an invented value.
- `quality-gate.md` names only commands that really exist in the chosen stack, with unchecked boxes and no verdict.
- `.gitignore` gets `conductor/tracks/**/conversation.md`, `conductor/tracks/**/conversation.json` and `.worktrees/`.
- `git init` only when the folder is not a repository. Do not create skill symlinks, `.claude/MEMORY.md` or a deploy
  stub, and do not touch a database.

## 4. First tracks

New project: one "Walking skeleton" track in the plan lane, the thinnest end-to-end slice of the product. Create it by hand as `ops/tracks.md` describes.
Existing repository: none, because the project has its own history; offer to plan its first real track instead.
When the add-on's connector tools are present and the project already has its `conductor/` files, create further tracks with
`mcp__plugin_laneconductor-parallel_lc__create_track`; otherwise write the files as `ops/tracks.md` describes.

## 5. Say what else fits this project

After the project is read, say which of these optional plugins would help THIS project, so the person does not have to find them in
the README. Look at what you read (the git history, the CI files, how big the project is, what the person told you), pick only the entries
that fit and are not installed, and say for each, in one short paragraph, why it fits this project. If one is already installed, say
nothing about it. If nothing fits, say nothing and go on.

How to offer one:

- Show its two install commands exactly as written below, each alone in its own bash block, then the reload step. You only show them:
  never run an install command yourself, and install nothing unless the person says yes (and then still show the commands for them to run).
- Say plainly what it installs, from the note under its name.
- Mention each plugin once in this session. If the person declines, do not bring it up again.
- A plugin is offered once because an installed plugin cannot be detected without reading outside the project, which this plugin never does. If the person says it is already installed, take their word and say no more about it.

**`laneconductor-parallel`**: Parallel work: isolated sub-agents, one per track in its own worktree, and safe shared state through conflict-checked track writes. It fits when the git history shows several authors, the project has CI files or several services, or the person wants tracks worked in parallel or by sub-agents. It installs an MCP server (the connector, a Node.js program) and a scaffold script on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory. It counts as installed when its connector tools are among your tools, or its agent `laneconductor-parallel:track-runner` is listed.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-parallel@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-parallel@laneconductor` instead (that opens the plugin's details for review).

**`laneconductor-board`**: The board, one private page of every track by lane, which Claude publishes as an artifact. It fits when a team will follow the tracks, the project already has more than a handful of them, or the person wants an overview of every track by lane. It installs a script (a Node.js program, no packages) and its page on your computer, from the owner's marketplace (`meller/laneconductor`), not from Anthropic's directory. It has no tool or agent to look for, and finding its files means searching the plugin install folder, which is outside the project and not read here: offer it as an option, once, and say it can be ignored if it is already installed.

```bash
claude plugin marketplace add meller/laneconductor
```

```bash
claude plugin install laneconductor-board@laneconductor
```

Then run `/reload-plugins` in the session. Inside a session you can type `/plugin marketplace add meller/laneconductor` and `/plugin install laneconductor-board@laneconductor` instead (that opens the plugin's details for review).

## 6. Summarize and ask before any commit

Print what was created (counts and folders, the track numbers and titles), what the person has to do themselves (listed,
never done by you), and the line "Next: run `/laneconductor:next`" (it names the one next step; do not name the step yourself). Ask: "Commit this
scaffold?". On yes, `git add` the created paths by name (never `git add -A`) and make one commit
`chore: add the LaneConductor scaffold`. Do not push, and do not offer to; if they ask, say what would be pushed and
ask again.

<!-- Starter set: reserved for the skill advisor -->

## Rules

- Never request, read or handle a credential, token or key. Sign-in and secrets are the person's steps.
- One question at a time; never ask what the repository already answers.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__create_track`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.

## Reference: scaffold

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `setup/scaffold.md`

Run only when the person asks for it by name: `/laneconductor:setup scaffold`. It is the explicit action that goes straight to
the files: no interview about the project beyond what the files below need. Plain `setup` follows
`ops/new-project.md` (its existing-repository path) and uses this file and `templates.md` for the same
`conductor/` structure. Whichever way you got here, three rules hold:

- Tell the person what you are about to create or change before you write anything, and wait for a yes.
- Never overwrite a file that exists; skip it and say so.
- Create no database or symlink, and commit nothing without a separate yes. Never push.

#### setup scaffold generate

The no-questions variant: another tool already scanned the project, talked with the person and got confirmation. Read
`conductor/.setup-scaffold-context.json`:
```json
{
  "project": { "name": "...", "git_remote": "...", "has_existing_code": true },
  "scan": ["package.json: ...", "README: ...", "Framework signals: next.config.js"],
  "brainstorm_summary": "user: ...\nassistant: ..."
}
```
If `brainstorm_summary` is present it is the agreed understanding of the project and wins over the
scan snippets, which are supplementary.

Generate these files, creating `conductor/` directories as needed (templates are in
`templates.md`):

- `conductor/product.md`: what the product does, who uses it, key features, the problem it solves
- `conductor/tech-stack.md`: languages, frameworks, data stores, infrastructure, key libraries
- `conductor/workflow.md`: commit strategy, branching, testing approach, review process
- `conductor/workflow.json`: the default lanes in `templates.md`
- `conductor/product-guidelines.md`: brand, style and UX principles (placeholders if unknown)
- `conductor/design-language.md`: design tokens (infer from Tailwind/CSS-variable config, a
  component-library theme or token files; placeholders if unknown)
- `conductor/kpis.md`: north-star metrics, from `brainstorm_summary` if it states goals
- `conductor/user-stories.md`: personas and journeys; a TODO stub if the summary has no journey
  language (do not invent personas that were not discussed)
- `conductor/quality-gate.md`: the project's own verification commands. Derive every command
  from what the scan found (`package.json` scripts, test runner, lint config, e2e framework). A
  gate naming commands the project does not have is worse than none: it gets skipped or faked.
- `conductor/tracks/`, and `conductor/code_styleguides/` when the project has lint or format config to describe

#### setup scaffold (interactive)

Ask first: "Does this project have existing code? (yes/no)".

**Existing code.** Read `package.json`, `README.md`, the source directories, CI and lint config,
and infer: `product.md` (README, app name, entry points, routes), `tech-stack.md` (dependencies,
framework patterns), `workflow.md` (`.git` log patterns, CI files, test setup),
`code_styleguides/` (`.eslintrc`, `.prettierrc`, `tsconfig.json` when present), and the design
language and `product-guidelines.md` stubs as above. Write `user-stories.md`
content only if concrete journeys surface in the README or scan. Then ask one KPI question: "What
does success look like? What are your 2-3 north-star metrics and rough targets?" and use the
answer for `kpis.md` (stub rows from the README if skipped). Show what you inferred and ask only to confirm it.

**New project.** Ask a short questionnaire: what it does and for whom; language, framework and
data; TDD, commit strategy and branching; brand or style standards; the same KPI question
(for example "500 signups by Q2", "HN front page"); and optionally any key user journeys. Generate
all the files above from the answers.

Both create `conductor/{tracks/, product.md, product-guidelines.md, design-language.md, tech-stack.md, user-stories.md,
workflow.md, kpis.md, quality-gate.md}` and `conductor/workflow.json` (the default in `templates.md`). Also:

- **`.gitignore`**: append whichever of these lines are missing (create the file if it does not exist):
  ```
  conductor/tracks/**/conversation.md
  conductor/tracks/**/conversation.json
  .worktrees/
  ```
  `conversation.md` and `.json` hold comment threads that are per machine and noisy to review; `.worktrees/` holds git worktree
  checkouts, which must never be tracked in the main tree (without this rule they end up committed as submodule-style gitlinks).
  Do not add `conductor/tracks/**/index.md`: it carries real authored content that is worth tracking.

#### Older tracks

If `conductor/tracks/` already holds folders, say what you found before anything else: how many, in which naming form
(`INITIALS-NNN-slug`, a bare `NNN-slug`, or something else such as `feature_name_20260213/README.md` from another tool), and the
lanes their `index.md` files show. Import nothing silently, and change none of them. Then ask: "Found N existing tracks. Leave them
as they are, or bring the ones that do not follow the `INITIALS-NNN-slug` form into LaneConductor? (leave/import)". On "import",
for each such folder:

1. Take the title from the first `# Heading` of `README.md` or `index.md`.
2. Detect status: `✅ COMPLETED`, `DONE` or `complete` -> lane `done`; `IN PROGRESS` or
   `in-progress` -> `implement`; anything else -> `backlog`.
3. Assign the next free track number (continue from the highest existing folder).
4. Create `conductor/tracks/NNN-slug/index.md` (only if it does not exist):
   ```markdown
   # Track NNN: Title

   **Lane**: done
   **Lane Status**: success
   **Progress**: 100%
   **Last Run**: imported (n/a)
   **Summary**: Imported from a previous tool
   ```
5. Leave the original `README.md` where it is.
6. Print `✅ Imported N tracks -> conductor/tracks/NNN-*/`.

#### Check the basics

After scaffolding, check that git is present (`git rev-parse --is-inside-work-tree`, note `main` vs `master`) and that the test
and lint commands in `conductor/quality-gate.md` really run. Report each problem as `⚠️ <description>` and offer to make a track for
the fixes; create it only on a yes.

#### Offer the board

At the end of scaffolding, ask once: "Create a private board for this project (every track by lane,
refreshed when you ask)?" On yes, run the `/laneconductor:board` command, which carries that procedure.
On no, do nothing; the human can ask for it later ("show the board"). Never create it unasked.

### `setup/templates.md` (the file templates)

Used by `scaffold.md`. Replace every `<...>` with a real value from the project, or leave a
placeholder when the project has none. Do not invent content.

**`conductor/design-language.md` template** (infer from existing Tailwind/CSS-variable config,
component library theme, or design-token files if present; otherwise leave placeholders):
```markdown
# Design Language

## Color Tokens
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| <e.g. background> | <hex/var> | <hex/var> | <context> |

## Typography Scale
- Font family: <family>
- Scale: <e.g. 12/14/16/20/24/32px, weight 400/500/600>

## Spacing System
- Base unit: <e.g. 4px>
- Scale: <e.g. 4/8/12/16/24/32/48>

## Component Conventions
- <e.g. buttons: rounded-md, primary/secondary/ghost variants>
- <e.g. cards: border + subtle shadow, no heavy elevation>

## Iconography / Motion
- <icon set / style>
- <motion: none / subtle / expressive — note any animation conventions>
```


**`conductor/kpis.md` template** (populate from brainstorm_summary if it contains goal/metric statements; otherwise use stubs):
```markdown
# Project KPIs

## North-Star Metrics

| Metric | Target | Time Horizon | Status | Notes |
|--------|--------|--------------|--------|-------|
| <metric> | <target> | <e.g. Q2 2026> | tracking | <context> |

## Contributing Tracks

Tracks with `**Maps To**` referencing a metric above will appear here automatically.
```


**`conductor/quality-gate.md` template.** Replace every `<...>` with a real
command discovered in the scan; **delete any line whose command this project
doesn't actually have** rather than leaving an aspirational one. Note the
boxes are left **unchecked** and there is **no pre-filled verdict** — this
file is a checklist to run, not a report. (An earlier version of this
template shipped every box pre-ticked with `Status: PASS` already filled in,
which invited agents to rubber-stamp it; that is why this warning exists.)
```markdown
# Quality Gate

> Checklist, not a report. Every box starts unchecked and is ticked only by
> whoever ran the command **this time** and saw it pass. Do not trust marks
> left by a previous run.

## Automated Checks

- [ ] Syntax/typecheck: `<e.g. npm run typecheck | node --check>` (Expected: no errors)
- [ ] Lint: `<e.g. npm run lint>` (Expected: clean)
- [ ] Unit + integration tests: `<e.g. npm test>` (Expected: all pass)
- [ ] Build: `<e.g. npm run build>` (Expected: succeeds)
- [ ] Coverage: `<e.g. npm run test:coverage>` (Expected: >= <N>% lines)
- [ ] Security: `<e.g. npm audit --audit-level=high>` (Expected: 0 high/critical)

> The Automated Checks above are the FULL layer: the quality-gate lane runs
> every command in this section. Do not put cheaper, partial commands here.

## Test Layers (which tests for which change)

> Guidance for developing, not for the gate. Run the layer a change needs,
> not everything after every step; the full layer runs ONCE before the track
> is done (this is what the lane executes). Fill the commands and the table
> from what the project really has; delete rows it does not need.

| Layer | Command | Cost |
|-------|---------|------|
| 0. Types | `<e.g. npx tsc --noEmit>` | seconds |
| 1. Targeted (changed files) | `<e.g. npx vitest related <files> --run>` | seconds |
| 2. Area (the folder / module touched) | `<e.g. npx vitest run src/<area>>` | under a minute |
| 3. Full | the Automated Checks above | minutes |

| Kind of change | Minimum layer while building |
|----------------|------------------------------|
| Docs, tracks, notes only | none |
| Data / content files | the project's content guards + a dry run of any loader |
| Text and translations only | the parity / lint checks, the component's tests, types |
| One screen or module | layers 0-2 for that area |
| A shared rule (used by many places, or with a second copy elsewhere) | area + the copy-parity tests + the simulator or property tests |
| Server / schema | the server area tests; for a schema change the migration check |

Rules: the full layer runs once before done (not after every step, not twice:
a test that passes only on a second run is a bug to fix); a new rule gets a
failing test first; record which commands ran and their counts in the track's
`conversation.md`; fix a flaky test by waiting for the real condition, never
with a longer fixed delay or a skip.

## End-to-End / Real-Product Checks

> Required for any track touching UI or a user-facing flow. Unit tests
> cannot detect a feature that was never wired up.

- [ ] E2E suite: `<e.g. npx playwright test>` (Expected: all specs pass —
      run the EXISTING specs; writing one trivial new passing test does not
      satisfy this)
- [ ] Restarted long-running processes (dev servers, API server) before
      verifying — they do not hot-reload, and testing against a stale
      process is a false pass
- [ ] If no E2E suite exists: drove the flow manually and recorded the
      observed user-visible result (screenshot, or real API/DB response)

## Manual Quality Review

- [ ] Architecture alignment: follows this project's established patterns
- [ ] Readability: clear naming, comments explain *why*
- [ ] No stubs in completed work: `grep -rniE "not yet implemented|TODO|FIXME|FFU" <src dirs>`
      returns nothing in code paths marked `[x]`

## Verdict

- Status: <PENDING — set to PASS/FAIL only after running the above>
- Reviewer: <who/what ran it>
- Date: <ISO date of this run>
```


**`conductor/user-stories.md` template** (seed from `brainstorm_summary` if it describes concrete
user journeys/flows; otherwise stub with a TODO — don't invent personas that weren't discussed):
```markdown
# User Stories

## <Persona A> — <short journey name>
**As a** <persona>, **I want to** <action>, **so that** <outcome>.

Flow: <ordered list of concrete steps — screens, emails, links, endpoints touched>
Related tracks: <[[track-name]] links, filled in as tracks implement/test pieces of this>

## <Persona B> — <short journey name>
...
```


**`workflow.md` template** (human-readable docs only — machine config lives in `workflow.json`):
```markdown
# Workflow

## Commit Strategy
- Conventional Commits: feat/fix/docs/refactor/test/chore
- Include track number: `feat(track-001): description`

## Branching Model
- main: production-ready
- feature branches: track-NNN-description

## Development Process
1. Create track with `/laneconductor newTrack`
2. Write spec.md before coding
3. Implement in phases with commits per phase
4. Update progress with `/laneconductor pulse`

## Code Review
- Self-review before marking done
- Update plan.md with learnings after each phase

## Workflow Configuration
Machine-readable config lives in `conductor/workflow.json`.
Edit it directly or via `/laneconductor workflow set`.
See `conductor/workflow.json` for lane transitions, parallel limits, and model overrides.
```

**`conductor/workflow.json` default** (create it during scaffold from this text; there is no canonical
repository to copy from when only the plugin is installed, and none is needed). No model names are set:
the project picks its own.
```json
{
  "global": { "total_parallel_limit": 3 },
  "defaults": { "parallel_limit": 1, "max_retries": 1 },
  "lanes": {
    "plan": { "parallel_limit": 1, "max_retries": 1, "on_success": "plan:success", "on_failure": "backlog" },
    "implement": { "parallel_limit": 2, "max_retries": 3, "on_success": "review:queue", "on_failure": "implement:failure" },
    "review": { "parallel_limit": 1, "max_retries": 1, "on_success": "quality-gate:queue", "on_failure": "implement:queue" },
    "quality-gate": { "parallel_limit": 1, "max_retries": 1, "on_success": "done:queue", "on_failure": "plan:queue" },
    "done": { "parallel_limit": 1, "max_retries": 1, "on_failure": "done:failure" }
  }
}
```

**Optional `skills` object in `conductor/workflow.json`** (not part of the default above, which stays as it is). It
names your own skills per lane; the lane guides tell Claude to read it and use the listed skills in addition to the
ones they suggest. Keys are lane guide names (`plan`, `brainstorm`, `implement`, `review`, `quality-gate`, `merge`),
values are lists of skill names. A skill that is not installed is mentioned and skipped; nothing here is an order.
Leave the key out and nothing changes; every reader of `workflow.json` ignores keys it does not know.
```json
{ "skills": { "implement": ["my-firebase-deploy"], "review": ["my-review-checklist"] } }
```

**`.gitignore` entries of a new project**: `conductor/tracks/**/conversation.md`,
`conductor/tracks/**/conversation.json` and `.worktrees/`. Nothing else is added.

### `ops/tracks.md` (newTrack)

#### newTrack `[name] [description]`

Do "Search first" above, and continue here only when it ends in "create". With the add-on, call `create_track` (it takes the same fields, including the merge mode and auto run
markers). By hand:

1. **Number and author initials.** Take initials from `git config user.name` (first letter of each
   word, at most 3, `XX` if unset: "Asaf Meller" -> `AM`, "John von Neumann" -> `JVN`). Find the
   highest existing number by scanning every folder name under `conductor/tracks/`, ignoring any prefix (`10022-slug` and
   `AM-10022-slug` both give `10022`). The display ID is `INITIALS-NNN`; the folder is
   `INITIALS-NNN-slug/`.
2. **Create `conductor/tracks/INITIALS-NNN-slug/index.md` right away**, for fast feedback:
   ```markdown
   # Track INITIALS-NNN: [name]

   **Lane**: plan
   **Lane Status**: queue
   **Progress**: 0%
   **Phase**: New
   **Type**: [dev|marketing|sales|support|other]
   **Merge Mode**: direct
   **Auto Run**: yes
   **Author**: INITIALS
   **Created By**: user@email.com
   **Summary**: [description]
   ```
   `**Type**` defaults to `dev`. `**Merge Mode**` and `**Auto Run**` default to `direct` and
   `yes` (changed 2026-09-08; before that the markers were omitted and fell back to the
   conservative `pr` / not-auto-run). Write `pr` / `no` only when the user asks for it on this
   track ("this one needs a PR, don't auto-run it"). The change affects new tracks only; a track
   that already exists without the markers keeps the old fallbacks.
3. **No queue file.** The folder you just made is the track; nothing else registers it.
4. **Non-dev types.** For `marketing` or `sales`, look in `.claude/skills/` for the recommended
   skills (marketing: `social-content`, `copywriting`, `content-strategy`, `launch-strategy`;
   sales: `sales-enablement`, `cold-email`) and tell the user which are missing.
5. Print `✅ Track NNN created in conductor/tracks/<folder>/.`

### `lanes/brainstorm.md`

An optional deepening step before implement: ask the human clarifying questions through
`conversation.md`. It is not a lane and can run at any time. Write the first question to `conversation.md` and set
`**Waiting for reply**: yes` in `index.md` yourself.

1. **Load context.** On `FRESH_SESSION: false` read only `conversation.md` (you need the latest
   human reply; every question-answer round after the first is normally a resumed session).
   Otherwise read `conductor/product.md`, `tech-stack.md`, `deployment-stack.md` (if present), and
   the track's `spec.md`, `plan.md`, `test.md` and `conversation.md`.
2. **Ask one question**, appended to `conversation.md`:
   ```
   > **system**: Brainstorm requested. [Your question here]
   ```
   One question per message: several at once get partial answers.
3. Set `**Waiting for reply**: yes` in `index.md`, then stop and wait for the human's reply in
   `conversation.md` (or the UI inbox).
4. On a reply, ask the next question. Repeat.
   If the outcome is work no track holds yet, do not open a track by reflex: search first, the default is
   update, not create (see "Search first" in `ops/tracks.md`).
5. When the requirements are unambiguous, the acceptance criteria are clear and every phase
   implies at least one test case (or the human says "go ahead"), run the plan lane on the
   track: it reads `conversation.md` and updates `spec.md`, `plan.md` and `test.md` from the dialogue.

#### Skills that help here

These are suggestions, in the same spirit as the rest of this guide: a second opinion, never an order. If a skill
named here is installed (for example from the Superpowers plugin), consider using it; if it is not, say so in one line
and carry on without it. `brainstorming` helps draw out requirements one question at a time; `writing-plans` helps once the requirements are clear and the plan lane is next.

Also read `conductor/workflow.json`. If it has a top-level `skills` object with a list under `"brainstorm"`, such as
`{ "skills": { "brainstorm": ["my-skill"] } }`, use those skills in addition, the same way: if one is installed, use it; if
it is missing, say so and continue. The `skills` key is optional; when it is absent, nothing changes. Where a skill's
own steps or file locations differ from this guide or from the track files, the track files and this guide win; take the
skill's method, not its output paths.
