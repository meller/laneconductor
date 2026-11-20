---
description: "Add LaneConductor to this project: read what is there, write the conductor/ files and file the plan as tracks (runs when you name it, or reply go to a next card)"
argument-hint: "[scaffold]"
---
Setup: `$ARGUMENTS` (nothing given means add LaneConductor to this project). This runs when I named it, or said go to the card of `next` that named it; do nothing else with it. Look for no program other than `git`, and read no settings file.

This command carries its whole procedure below: it is the text of the skill file `setup/setup.md`, then the file rules of `ops/new-project.md` (in "The path in detail") and the first-track card of `ops/next.md`. Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: it is outside the project, and a read there is asked about or denied. Skill file paths in the text are references only.

`/laneconductor:setup` adds LaneConductor to the project you are in. It runs when the person names it, or says `go` to the card of `next` that named it:
the card names the command and `go` is the consent. The result is a `conductor/` folder of plain files in git. Nothing is committed without a yes, and nothing is ever pushed.

If your client asks "Allow this read outside the working directories?" for a file of this plugin, tell the person in one line to
choose the option that allows it this one time. The options that say "keep allowing" or "block ... from now on" change a
permanent setting for every project and are not needed. Never ask anyone to change their permission settings for LaneConductor.

## What setup does

Setup writes first: new files are additive and one line undoes them, so there is no confirmation before the files. A folder with no code and no plan document (empty, or only a README or licence) is a new project: say in one line that `/laneconductor:new-project` is the command for it (a brainstorm, the scaffold, first tracks, suggested skills) and stop. Otherwise:

1. **Read the project** and ask nothing the files already answer:
   - The name and purpose (`package.json`, `pyproject.toml`, the README; else the folder name), the stack (dependencies and config files) and the commands that really exist (scripts in `package.json`, the Makefile, the CI files). The npm placeholder `echo "Error: no test specified"` is not a test command, and a lint config without a lint script is not a lint command.
   - The plan documents ("The first-track card" at the end of this command says which): their items, counted for "Found your plan in `docs/plan.md`: 6 items"; nothing when there is none.
   - The tracks choice, declared and never asked: private when something says the project is public (the README says public, public demo or open source; an open-source LICENSE file; a `package.json` `license` other than UNLICENSED or proprietary) or `git remote` is empty (nothing to share); committed when there is a remote and no such sign. Private tracks are git-ignored (step 3).
2. **Stop and ask first, one line each, only for something unusual**: a `conductor/` folder with content (an older LaneConductor: how many tracks, in which naming form, which lanes; offer to finish the scaffold: write only what is missing, import nothing, change no track); no git repository (offer `git init` first); uncommitted changes in `.gitignore`, the one existing file setup edits (offer to go on, or to wait while they commit it). Anything else: write.
3. **Write** the files that are missing ("Create the files" below; the files and templates are under "Reference: scaffold" at the end). No existing file of the project is touched, and `.gitignore` only gets the lines it lacks. Add no walking-skeleton track.
4. **File the plan items.** With a plan document, file its first four items as tracks, in the plan's order and the plan lane, as "The answer" of the first-track card says (the `new` procedure: search first, then `create_track` when that tool is present, else by hand as `newTrack` writes the files: next free number, unpadded, heading `# Track AM-1: <Title>`, id only; the plan item as the problem, its source file named). No question. The plan's open questions are not filed: list them. With no plan document nothing is filed.
5. **A stale project-level skill** is one more line in the closing message, only if `.claude/skills/laneconductor` exists (read only: Glob,
   `test -L`, `git ls-files`): the plugin supplies the skill itself, so this copy is stale. Offer its removal:
   `rm .claude/skills/laneconductor` alone in its own bash block (`rm -r` for a folder; `git rm` for one that git tracks, and
   removing it then needs a commit, which you ask about first). Never run it.
6. **Close with ONE message**, after the files and the tracks, filled in from what you did and nothing else:

> **my-app**: a command-line tool that sorts notes (Node.js).
> Created `conductor/` (context files, an empty `tracks/`) and the `.gitignore` lines.
> Tracks are private (git-ignored) because the README says this is a public demo. Say 'commit my tracks' to share them.
> Found your plan in `docs/plan.md`: 6 items. Filed the first four as tracks in the plan lane: 1 A publish checklist, 2 An /openapi.json door, 3 A /prompt paste pack, 4 Plugin packaging. Open question, not filed: browse-only dry-run variants.
> Undo: `rm -r conductor`, then `git checkout .gitignore`.
> The conductor files are not committed; say commit when you want them committed.
> **See it on the board:** the board line of the first-track card (at the end of this command).
> **Plan the first track:** `/laneconductor:plan 1` ("A publish checklist").
> Board, or plan the first track?

   Exactly two offers and one question, nothing after them: no add-ons paragraph, no starter set (`/laneconductor:suggest-skills` has it), no "Next: run `/laneconductor:next`". Committed tracks say "Tracks are committed with the code. Say 'make tracks private' to keep them out of git." A count you state comes from a command run for that purpose (`git rev-list --count HEAD`), never from a truncated listing. Say nothing about what does not exist or does not apply. With no plan document nothing was filed: end with the first-track card instead of the two offers. On "commit": `git add` the files you created, by name (never `git add -A`), make one commit and never push.

## setup scaffold

`/laneconductor:setup scaffold` is the explicit action that goes straight to the files: follow the scaffold text under "Reference: scaffold" at the end (`setup/scaffold.md`, templates in `setup/templates.md`) and skip the interview.

## The path in detail

### Create the files

Create the files with no question first (setup writes first). The files and templates are
in "Reference: scaffold" at the end of this command (from the skill files `setup/scaffold.md` and `setup/templates.md`); apply these rules over them:

- Create `conductor/product.md`, `tech-stack.md`, `workflow.md`, `workflow.json`, `product-guidelines.md`,
  `design-language.md`, `quality-gate.md`, `user-stories.md`, `kpis.md` and `tracks/`. No settings file is created: LaneConductor needs none.
- Every file is tailored from the answers; what was not discussed is an honest placeholder, never an invented value.
- `quality-gate.md` names only commands that really exist in the chosen stack, with unchecked boxes and no verdict.
- `.gitignore` gets `conductor/tracks/**/conversation.md`, `conductor/tracks/**/conversation.json` and `.worktrees/`, and, when tracks are private (decided from facts and declared in the closing message, never asked: the project looks public, or has no remote to share with), `conductor/tracks/`, `conductor/tracks-summary.md` and `conductor/advice-log/`.
- `git init` only when the folder is not a repository. No skill symlinks, `.claude/MEMORY.md`, deploy stub or database.

## The first-track card

S04 at the default level, and the close of `setup` (with no plan document) and `new-project`. Nothing is created before the person answers. With a plan (below) the card leads with it:

> **Next: your first track.** From your plan in `docs/plan.md`:
> 1. A publish checklist
> 2. An /openapi.json door
> 3. A /prompt paste pack
> 4. Plugin packaging
> 2 more in `docs/plan.md`. Open question there: browse-only dry-run variants? (not filed)
> 5. Choose a licence: the README says none is chosen
> 6. Audit: review the code for privacy, security and quality, and file each finding as its own track
> The project on a board: `/laneconductor:board` (the files setup wrote, later the tracks).
> Reply with numbers, "all 6 plan items", or tell me a title of your own.

- **The plan** (read only, one look): `docs/plan.md`, `PLAN.md`, `ROADMAP.md`, `TODO.md`, `docs/roadmap*.md`, and README sections on the roadmap, next steps, status, todo or what is missing. Items, in the file's order and words, cut to one line: unticked checkboxes, else bullets or numbered lines, else `###` headings, of the sections on what is still to come; never a ticked or "done" one. A decision or question still open (a heading with decision, open or question, or a line ending "?") is an open question, not an item.
- **With a plan**: the lead names the file; at most four items, "N more in `<file>`", at most two open questions; then, only for what the plan does not say, at most two generic suggestions, the audit last.
- **Without a plan**, only generic suggestions, at most four, one line each: the title and the fact behind it. In this order: no licence file or the README says none is chosen (Choose a licence); the README or `package.json` says public, demo or open source (Check the repository for secrets and personal data before it is public); no CI files but a test command (Add CI that runs `<the test command>`); no lint or format config (Add a lint and format check); no `SECURITY.md` (Add a SECURITY.md); no lockfile (Pin the dependencies). Keep the first three that fit, then always last: Audit: review the code for privacy, security and quality, and file each finding as its own track. The reply line has no "all".
- **Never invent**: every line is text from a file (named) or a fact a command or a read checked.
- **The board line**: always the one in the card above, `/laneconductor:board`. That command looks for the board add-on itself and, when it is missing, says so and shows the install commands; so detect nothing and show no install line here.

- **The answer**: numbers, "all N" (every plan item, the hidden ones too) or a title. For each, in the plan's order, follow `new`: search first (a fitting track is offered an update), then create in the plan lane, the plan item as the problem ("From `docs/plan.md`: <the item as written>"). An open question is filed only if asked. Setup files the first four the same way, with no question.

## Reference: scaffold

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `setup/scaffold.md`

Run only when the person asks for it by name: `/laneconductor:setup scaffold`. It goes straight to the files: no interview about the
project beyond what the files below need. Plain `setup` follows `ops/new-project.md` (its existing-repository
path) and uses this file and `templates.md` for the same `conductor/` structure. Three rules hold either way:

- Tell the person what you are about to create or change before you write anything, and wait for a yes.
- Never overwrite a file that exists; skip it and say so.
- Create no database or symlink, and commit nothing without a separate yes. Never push.


#### setup scaffold (interactive)

Ask first: "Does this project have existing code? (yes/no)".

**Existing code.** Read `package.json`, `README.md`, the source directories, CI and lint config, and infer: `product.md`
(README, app name, entry points, routes), `tech-stack.md` (dependencies, framework patterns), `workflow.md` (the commit log, CI
files, test setup), `code_styleguides/` (`.eslintrc`, `.prettierrc`, `tsconfig.json` when present), and the design language and
`product-guidelines.md` stubs as above. Write `user-stories.md` only if concrete journeys surface in the README or scan. Then ask
one KPI question: "What does success look like? What are your 2-3 north-star metrics and rough targets?" and use the answer for
`kpis.md` (stub rows from the README if skipped). Show what you inferred and ask only to confirm it.

**New project.** Ask a short questionnaire: what it does and for whom; language, framework and data; TDD, commit strategy and
branching; brand or style standards; the same KPI question (for example "500 signups by Q2"); and optionally key user journeys.
Generate the files from the answers.

Both create the files of "Create the files" (the `workflow.json` default is in `templates.md`). Never ignore `conductor/tracks/**/index.md` or `history.md`: both are tracked. Every track the scaffold creates gets an empty `history.md` (one header line, `# History: Track INITIALS-NNN`).

#### Older tracks

If `conductor/tracks/` already holds folders, say what you found first: how many, in which naming form (`INITIALS-NNN-slug`, a bare
`NNN-slug`, or another tool's such as `feature_name_20260213/README.md`), and the lanes their `index.md` files show. Import nothing
silently and change none of them. Then ask: "Found N existing tracks. Leave them as they are, or bring the ones that do not follow
the `INITIALS-NNN-slug` form into LaneConductor? (leave/import)". On "import", for each such folder:

1. Take the title from the first `# Heading` of `README.md` or `index.md`.
2. Detect status: `✅ COMPLETED`, `DONE` or `complete` -> lane `done`; `IN PROGRESS` or `in-progress` -> `implement`; anything else -> `backlog`.
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
5. Leave the original `README.md` where it is, and print `✅ Imported N tracks -> conductor/tracks/NNN-*/`.

#### Close

End as `setup` does: its one closing message. A problem you saw in the basics (a test or lint command that does not run) goes in it as one line.

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
boxes are left **unchecked** and there is **no pre-filled verdict**: this
file is a checklist to run, not a report (a pre-ticked one invites rubber-stamping).
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

> Guidance for developing, not for the gate. Run the layer a change needs;
> the full layer runs ONCE before the track is done (this is what the lane
> executes). Fill the commands from what the project really has; delete rows it does not need.

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

Rules: the full layer runs once before done (a test that passes only on a
second run is a bug to fix); a new rule gets a failing test first; record which
commands ran, with counts, in the track's `conversation.md`; fix a flaky test by
waiting for the real condition, never with a longer delay or a skip.

## End-to-End / Real-Product Checks

> Required for any track touching UI or a user-facing flow: unit tests
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

## What goes in each track file
Each track folder has six files with one job each. Keep a log out of the design files.
- `index.md`: the overview (what and why, the markers, one line on where it stands). No logs.
- `spec.md`: the detailed design (requirements, dated decisions, data model and APIs, acceptance criteria, risks). No status.
- `plan.md`: the task tracker: phases and the individual tasks as checkboxes, ticked as work proceeds. No dated status, releases or incidents, and no design detail (that goes to `spec.md`).
- `test.md`: the test plan (test cases and commands). No status.
- `history.md`: the run log, tracked in git, append-only. One dated line per event (what ran, commit hashes, deploys,
  incidents): `- <YYYY-MM-DD HH:MMZ> <emoji> <one line>`.
- `conversation.md`: the dialogue between people and agents. Untracked, may be private.

Status, releases, incidents and any other dated entry never go into `plan.md` or `spec.md`: they are one line in `history.md`.
Review and the quality gate tick the acceptance criteria of `spec.md`; the implementing agent ticks the tasks of `plan.md`. A plan task may name the requirement it serves (`REQ-3`).

## Workflow Configuration
Machine-readable config lives in `conductor/workflow.json`.
Edit it directly or via `/laneconductor workflow set`.
See `conductor/workflow.json` for lane transitions, parallel limits, and model overrides.
```

**`conductor/workflow.json` default** (create it during scaffold from this text; no repository to copy from is needed). No model names are set.
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

**Optional `skills` object in `conductor/workflow.json`** (not part of the default above). It
names your own skills per lane; the lane guides read it and use the listed skills in addition to the
ones they suggest. Keys are lane guide names (`plan`, `brainstorm`, `implement`, `review`, `quality-gate`, `merge`),
values are lists of skill names. A skill that is not installed is mentioned and skipped; nothing here is an order.
Leave the key out and nothing changes.
```json
{ "skills": { "implement": ["my-firebase-deploy"], "review": ["my-review-checklist"] } }
```

**`.gitignore` entries of a new project**: `conductor/tracks/**/conversation.md`,
`conductor/tracks/**/conversation.json` and `.worktrees/`. Nothing else is added: `history.md` is tracked, never ignored.

### `ops/tracks.md` (newTrack)

#### newTrack `[name] [description]`

Do "Search first" above, and continue here only when it ends in "create". With the add-on, call `create_track` (it takes the same fields, including the merge mode and auto run
markers). By hand, write the files exactly as it would:

1. **Number and author initials.** Take initials from `git config user.name` (first letter of each
   word, at most 3, `XX` if unset: "Asaf Meller" -> `AM`, "John von Neumann" -> `JVN`). Find the
   highest existing number by scanning every folder name under `conductor/tracks/`, ignoring any prefix (`10022-slug` and
   `AM-10022-slug` both give `10022`). The number is that plus one, never zero-padded (`AM-1`, `AM-10`; `1` for the first track).
   The id is `INITIALS-<n>` without the slug; the folder is `INITIALS-<n>-slug/`.
2. **Create `conductor/tracks/INITIALS-<n>-slug/index.md` right away**, for fast feedback:
   ```markdown
   # Track INITIALS-<n>: [name]

   **Lane**: plan
   **Lane Status**: queue
   **Progress**: 0%
   **Phase**: New
   **Type**: [dev|marketing|sales|support|other]
   **Merge Mode**: direct
   **Auto Run**: no
   **Author**: INITIALS
   **Created By**: user@email.com
   **Summary**: [description]
   ```
   `**Type**` defaults to `dev`; `**Merge Mode**` and `**Auto Run**` to `direct` and `no` (as create_track does). Write `pr` / `yes` only when the
   user asks for it on this track ("this one needs a PR, auto-run it").
3. **Non-dev types.** For `marketing`, `sales` or `support`, say which of the skills the Type works best with are installed. A skill is
   installed when it is in the session's skills list, in `claude plugin list`, or in `.claude/skills/` or `~/.claude/skills/`; an older
   name counts. For each one installed say "you have `<skill>` installed, use it before writing the content". Offer the missing ones:

   
4. Create `history.md` beside the other files, with one header line (`# History: Track INITIALS-<n>`, the id only) and nothing else.
5. Print `✅ Track <n> created in conductor/tracks/<folder>/.`
