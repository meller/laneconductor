---
description: "Add LaneConductor to this project: read what is there, confirm the stack and commands, write the conductor/ files (runs only because you named it)"
argument-hint: "[scaffold]"
---
Setup: `$ARGUMENTS` (nothing given means add LaneConductor to this project). This runs only because I named it; do nothing else with it. Look for no program other than `git`, and read no settings file.

This command carries its whole procedure below: it is the text of the skill file `setup/setup.md`, then the existing-repository path of `ops/new-project.md` (in "The path in detail"), with the recommendation block and the first-track card of `ops/next.md`. Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: it is outside the project, and a read there is asked about or denied. Skill file paths in the text are references only.

`/laneconductor:setup` adds LaneConductor to the project you are in. Run it only when the person asks for it by name. The result is a
`conductor/` folder of plain files in git. Nothing is committed without a yes, and nothing is ever pushed.

If your client asks "Allow this read outside the working directories?" for a file of this plugin, tell the person in one line to
choose the option that allows it this one time. The options that say "keep allowing" or "block ... from now on" change a
permanent setting for every project and are not needed. Never ask anyone to change their permission settings for LaneConductor.

## What setup does

Follow the existing-repository path in "The path in detail" below (the folder has a `.git`, or files other than `conductor/`); when the folder is empty, the new-project
path of `ops/new-project.md` applies and `/laneconductor:new-project` is the command for it. In short:

1. **Read the project, confirm it in ONE message.** The name, the stack, the commands that exist, what will be created and the one
   decision (tracks committed or private), as "Existing repository" in `ops/new-project.md` says: about
   twelve lines, ending "Reply ok, or tell me what differs". Write nothing until that reply. Say nothing about what does not
   exist or does not apply, and do not ask what the files already answer.
2. **An existing `conductor/`** (an older LaneConductor) is one more line in the message: how many tracks, in which naming form,
   which lanes. Import nothing and change none of them.
3. **Write after the reply.** The reply is the yes: create only the missing files. An existing README, `package.json` or any
   other file of the project is never touched, and `.gitignore` only gets the lines it lacks.
4. **A stale project-level skill** is one more line in the message, only if `.claude/skills/laneconductor` exists (read only: Glob,
   `test -L` for a link, `git ls-files` for git): the plugin supplies the skill itself, so this copy is stale. Offer its removal:
   `rm .claude/skills/laneconductor` alone in its own bash block (`rm -r` for a folder; `git rm` for one that git tracks, and
   removing it then needs a commit, which you ask about first). Never run it.
5. **Say what else fits**, in the closing summary, not in the message above: say which optional plugins would help this project, as a starter set of three or four at most (see "What else fits this
   project" below), say nothing when none fits. Do not wait for an answer: step 6 follows in the same message.
6. **Close with the first track.** Say in about three lines what you created (counts and folders) and what the person must do
   themselves, if anything. End with the first-track card (at the end of this command; it holds the board line), then the line "Say commit when you want the conductor files committed." The track choice is
   the one question: no "Next: run `/laneconductor:next`" line and no second question. On "commit": `git add` the files you
   created, by name (never `git add -A`), make one commit and never push.

## What else fits this project

After the project is read, offer a STARTER SET: say which optional plugins would help THIS project, three or four at most, once. Look at what you read (the stack from `package.json`, the marker files and `conductor/tech-stack.md`, the git history, the CI files, what the person told you and the Type of the tracks) and pick only the entries below that fit and are not installed; say in a sentence why each fits.
Order them: the core process skills first, a design skill when the project has a UI, the stack's pack, then the rest. Never more than four. If one is already installed, say
nothing about it. If nothing fits, say nothing and go on. End the offer with: "Install them now, or I will offer each one when it comes up (when you plan a screen, deploy, and so on)."
If the person says later, record nothing: each item is offered again at its own moment, as `/laneconductor:suggest-skills` describes.

How to offer: show an entry's install commands, each alone in its own bash block (no leading `$`), then the reload step (`/reload-plugins`), and say plainly what it installs. You only show them: never run an install command yourself, and install nothing unless the person says yes. Mention each plugin once in this session; if the person declines, do not bring it up again. Detect what is installed from the session's skills list and `claude plugin list`; if you cannot tell, take the person's word.

- `laneconductor-parallel`: parallel work: sub-agents per track in worktrees, conflict-checked track writes. Installs an MCP server (a Node.js program) and a scaffold script. It counts as installed when its connector tools are among your tools, or its agent `laneconductor-parallel:track-runner` is listed. Mention only when several sessions, people or sub-agents write the same tracks, or overwrites are a worry. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-parallel@laneconductor` It fits when the git history shows several authors, the project has CI files or several services, or the person wants tracks worked in parallel or by sub-agents.
- `laneconductor-board` (Type dev/marketing/sales/support): the board: one private page of every track by lane. Installs a script (a Node.js program, no packages) and its page. It has no tool or agent to look for, and its files are outside the project: offer it once, as an option that can be ignored if it is installed already. Mention only when the person asks for a board or dashboard (`/laneconductor:board`, `/laneconductor:board refresh`). `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-board@laneconductor` It fits when a team will follow the tracks, the project already has more than a handful of them, or the person wants an overview of every track by lane.
- `frontend-design` (prerequisite; stack ui): skills frontend-design. Markdown only. `claude plugin install frontend-design@claude-plugins-official` It fits when the project has a front end (React, Vue, Vite, HTML pages) or tracks that plan screens.
- `marketing-skills` (prerequisite; Type marketing/sales): skills content-strategy, launch (was launch-strategy), copywriting, social (was social-content), sales-enablement, cold-email, prospecting, revops, analytics (was analytics-tracking), ab-testing (was ab-test-setup). Markdown only. `claude plugin marketplace add coreyhaines31/marketingskills`, `claude plugin install marketing-skills@marketingskills` It fits when the project's tracks are marketing or sales work (copy, launch, outreach), or it is a product that needs a website and a launch.
- `superpowers`: skills brainstorming, writing-plans, test-driven-development, systematic-debugging, subagent-driven-development, using-git-worktrees, requesting-code-review, receiving-code-review, verification-before-completion, finishing-a-development-branch. Installs a session-start hook script, plus Markdown skills. `claude plugin install superpowers@claude-plugins-official` It fits when the project writes code: it adds the brainstorm, plan, test-first, debugging and review skills the lanes use.
- `playwright` (stack ui): drives a real browser to check a UI flow and take screenshots. Installs an MCP server (Node.js, via npx) that drives a browser. `claude plugin install playwright@claude-plugins-official` It fits when the project has a web UI that a person checks in a browser.
- `firebase` (stack firebase): Firebase tools: Firestore, auth, functions, hosting, and hosting deploys. Installs an MCP server (firebase-tools, via npx) that can change your Firebase project. `claude plugin install firebase@claude-plugins-official` It fits when the project has `firebase.json` or `.firebaserc`, or Firebase in its tech stack.
- `cloudflare` (stack cloudflare): skills cloudflare. Installs a connection to Cloudflare's hosted MCP server, plus skills. `claude plugin marketplace add cloudflare/skills`, `claude plugin install cloudflare@cloudflare` It fits when the project has `wrangler.toml`, `wrangler.json` or `wrangler.jsonc`, or Cloudflare in its tech stack.

When BOTH add-ons (`laneconductor-parallel` and `laneconductor-board`) are missing and you offer both, also show "Both add-ons in one line:" and this block, then the reload step. When only one of them is missing, keep its offer above and add nothing.

Both add-ons in one line:

```bash
claude plugin marketplace add meller/laneconductor && claude plugin install laneconductor-board@laneconductor && claude plugin install laneconductor-parallel@laneconductor
```

## setup scaffold

`/laneconductor:setup scaffold` is the explicit action that goes straight to the files: follow the scaffold text under "Reference: scaffold" at the end (`setup/scaffold.md`, templates in `setup/templates.md`) and skip the interview.

## The path in detail

### Detect the situation

- Empty or new folder: a new project. Ask for a name if the argument gave none.
- An existing repository (a `.git`, or files other than `conductor/`): offer only the `conductor/` scaffold (`/laneconductor:setup`
  takes this path). Read what is there first ("Existing repository" below) and ask less. Never overwrite a file.
- `conductor/tracks` already holds tracks (an older LaneConductor, or another tool): say what you found (how many, in which
  naming form, which lanes), import nothing, offer only the missing `conductor/` context files and leave every track as it is;
  importing them is a separate yes (`setup/scaffold.md`, "Older tracks"). `new` creates tracks.

#### Existing repository

Keep the interview short. Read the project and ask only to confirm:

- The name and purpose (`package.json`, `pyproject.toml`, the README; else the folder name), the stack (dependencies and config
  files) and the commands that really exist (scripts in `package.json`, the Makefile, the CI files). The npm placeholder
  `echo "Error: no test specified"` is not a test command, and a lint config without a lint script is not a lint command.

Show the result as ONE message in this form, at most twelve lines, everything filled in (for a public-looking repository):

> **my-app**: a command-line tool that sorts notes.
> Stack: Node.js, no dependencies.
> Commands: `npm start`, `npm test`.
> I will create `conductor/` (context files, an empty `tracks/`) and three `.gitignore` lines.
> Tracks: committed with the code, or private (out of git, not shared)? I recommend private: the README says this is a public demo.
> Reply ok, or tell me what differs.

Recommend private for a repository that looks public (a README that says public demo, no licence yet), committed otherwise. Add a line only for something unusual or that needs a decision (an existing `conductor/` folder, a stale project-level skill, a conflict). Say nothing about what does not exist or does not apply: no list of commands left out, no "nothing to clean up", no "no optional plugins", no "I will not touch your README", no repository facts (a count you do state comes from a command run for that purpose, `git rev-list --count HEAD`, never from a truncated listing). Write nothing until that reply; it is the yes.
Do not add the walking-skeleton track to an existing project; suggest planning the first real track instead.

### Create the files

For an existing repository the step 1 reply is that yes.

Show what you would create and what you would skip because it exists, and ask for a yes; after the yes, create the files. The files and templates are
in "Reference: scaffold" at the end of this command (from the skill files `setup/scaffold.md` and `setup/templates.md`); apply these rules over them:

- Create `conductor/product.md`, `tech-stack.md`, `workflow.md`, `workflow.json`, `product-guidelines.md`,
  `design-language.md`, `quality-gate.md`, `user-stories.md`, `kpis.md` and `tracks/`. No settings file is created: LaneConductor needs none.
- Every file is tailored from the answers; what was not discussed is an honest placeholder, never an invented value.
- `quality-gate.md` names only commands that really exist in the chosen stack, with unchecked boxes and no verdict.
- `.gitignore` gets `conductor/tracks/**/conversation.md`, `conductor/tracks/**/conversation.json` and `.worktrees/`.
- `git init` only when the folder is not a repository. No skill symlinks, `.claude/MEMORY.md`, deploy stub or database.

## The first-track card

S04 at the default level, and the close of `setup`. Fill each line from this project; nothing is created before the person answers:

> **Next: your first track.**
> 1. Choose a licence: the README says none is chosen
> 2. Add CI that runs `npm test`: no CI files
> 3. Audit: review the code for privacy, security and quality, and file each finding as its own track
> The project on a board: `/laneconductor:board` (the files setup wrote, later the tracks).
> Reply with numbers, or tell me a title of your own.

- **Suggestions**: at most four, one line each: the title, then the fact behind it in a few words. Use only facts you have read (setup's reading, or a read-only look at the README, `package.json`, `.gitignore`, the file layout, `git log`); claim no finding you did not check. In this order: no licence file or the README says none is chosen (Choose a licence); the README or `package.json` says public, demo or open source (Check the repository for secrets and personal data before it is public); no CI files but a test command (Add CI that runs `<the test command>`); no lint or format config (Add a lint and format check); no `SECURITY.md` (Add a SECURITY.md); no lockfile (Pin the dependencies). Keep the first three that fit, then always last: Audit: review the code for privacy, security and quality, and file each finding as its own track.
- **The board line**: as above when the board add-on is installed (look at the skills list and your tools; only if that is not enough run `claude plugin list` as a command of its own, never chained). Without it, say instead: "To see the project on a board, run this yourself, then `/reload-plugins` (the line adds the parallel add-on too, which installs a local program):" and the line below alone in its own bash block, never run by you. Skip it when setup's starter set offered the board.

```bash
claude plugin marketplace add meller/laneconductor && claude plugin install laneconductor-board@laneconductor && claude plugin install laneconductor-parallel@laneconductor
```

- **The answer**: numbers or a title. For each, follow `new`: search first (a fitting track is offered an update), then create.

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

The no-questions variant: another tool already scanned the project and got the person's confirmation. Read
`conductor/.setup-scaffold-context.json` (`project` with `name`, `git_remote`, `has_existing_code`; `scan`, a list of snippets;
`brainstorm_summary`). The summary, when present, is the agreed understanding and wins over the scan snippets.

Create the files of "Create the files" (the project steps: the file list, the `.gitignore` lines, what is never created), tailored from the context, with templates from `templates.md` and these notes: `product.md` says what the product does, who uses it, the key features and the problem it solves; `tech-stack.md` the languages, frameworks, data stores, infrastructure and key libraries; `workflow.md` the commit strategy, branching, testing approach and review process; `product-guidelines.md` the brand, style and UX principles; `design-language.md` the design tokens (infer them from Tailwind/CSS-variable config, a component-library theme or token files); `kpis.md` the north-star metrics, from `brainstorm_summary` if it states goals; `user-stories.md` the personas and journeys, a TODO stub if the summary has no journey language (invent no personas); `quality-gate.md` the project's own verification commands, each derived from what the scan found (`package.json` scripts, test runner, lint config, e2e framework): a gate naming commands the project does not have is worse than none, it gets skipped or faked; `code_styleguides/` only when the project has lint or format config to describe. Unknown stays a placeholder.

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

Both create the files of "Create the files" (the `workflow.json` default is in `templates.md`). Never ignore `conductor/tracks/**/index.md` or `history.md` (the run log of a track): both are tracked. Every track the scaffold creates gets an empty `history.md` (one header line, `# History: Track INITIALS-NNN`).

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

#### Close

End as `setup` does: about three lines on what you created, then the first-track card of `ops/next.md` (the board line is in it) and no other question. A problem you saw in the basics (a repository missing, a test or lint command that does not run) is a suggestion in that card.

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
`conductor/tracks/**/conversation.json` and `.worktrees/`. Nothing else is added: `history.md` is tracked, never ignored.
