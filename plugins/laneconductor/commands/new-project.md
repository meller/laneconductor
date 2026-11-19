---
description: "Start a project: a short brainstorm, the conductor scaffold and the first tracks (runs when you name it, or reply go to a next card)"
argument-hint: "[name or idea]"
---
New project: `$ARGUMENTS` (nothing given means ask me). This runs when I named it, or said go to the card of `next` that named it.

This command carries its whole procedure below: it is the text of the skill file `ops/new-project.md`, in full, with the first-track card of `ops/next.md`. Do not Glob or Read the plugin's install folder (`~/.claude/plugins/...`) to carry it out: it is outside the project, and a read there is asked about or denied. Skill file paths in the text are references only.

Start a project from a short conversation: a brainstorm, the scaffold, first tracks. Run it when the person names it, or says
`go` to the card of `next` that named it. Nothing is committed without their yes, and nothing is ever pushed.

Do the scaffold by hand, as step 3 describes: the result is the same as the add-on's scaffold script gives. Do not search for that script (it lives in
the add-on's install folder, outside the project) and do not recommend the add-on for this.

## 1. Detect the situation

- Empty or nearly empty folder (no code and no plan document; a README, licence or `.gitignore` alone does not count): a new project: `/laneconductor:new-project` is the command for it, not `setup`; the reply `go` to the card of `next` starts it. Ask for no name first: the first question is what it is for.
- An existing repository (a `.git`, or files other than `conductor/`): `/laneconductor:setup` is the command for it, which reads the project, writes the files and files its plan as tracks. Say so in one line and stop.
- `conductor/tracks` already holds tracks (an older LaneConductor, or another tool): say what you found (how many, in which
  naming form, which lanes), import nothing, offer only the missing `conductor/` context files and leave every track as it is;
  importing them is a separate yes (`setup/scaffold.md`, "Older tracks"). `new` creates tracks.

## 2. Interview

This is a brainstorm, in the style of `lanes/brainstorm.md`: ONE question per message, adaptive, short, in chat (there
is no track yet, so no `conversation.md`). Explore before you decide: for a choice that shapes the project (the stack, the data, hosting, authentication) give two or three options with the trade-off in a line and a recommendation, and let the person choose. Write no file until the interview is done and they say to scaffold. Cover, in
this order, and skip what the person told you or the repository shows:

1. What is it for, and who uses it
2. The three key features
3. Language and stack
4. Data (what is stored, how much)
5. Authentication
6. Hosting and the deploy target
7. AI use (none is a fine answer)
8. Testing (which commands really exist, or will exist in the walking skeleton)
9. Constraints (budget, deadline, compliance, things to avoid)

Stop early when the answers are enough to scaffold; say "That is enough to start". Ask for 2 to 4 letter initials for track
ids last, only if the folder has none to reuse. Record the answers as you go: `name`, `summary`, `users`, `features`, `stack` (language, framework, data, auth, hosting, ai,
testing, other), `constraints`, `commands` (typecheck, lint, test, build, coverage, audit, e2e: ONLY commands that
exist), `kpis`, `journeys`, `initials`.

## 3. Scaffold

Show what you would create and what you would skip because it exists, and ask for a yes; after the yes, create the files. The files and templates are
in "Reference: scaffold" at the end of this command (from the skill files `setup/scaffold.md` and `setup/templates.md`); apply these rules over them:

- Create `conductor/product.md`, `tech-stack.md`, `workflow.md`, `workflow.json`, `product-guidelines.md`,
  `design-language.md`, `quality-gate.md`, `user-stories.md`, `kpis.md` and `tracks/`. No settings file is created: LaneConductor needs none.
- Every file is tailored from the answers; what was not discussed is an honest placeholder, never an invented value.
- `quality-gate.md` names only commands that really exist in the chosen stack, with unchecked boxes and no verdict.
- `.gitignore` gets `conductor/tracks/**/conversation.md`, `conductor/tracks/**/conversation.json` and `.worktrees/`, and, when tracks are private (decided from facts and declared in the closing message, never asked: the project looks public, or has no remote to share with), `conductor/tracks/`, `conductor/tracks-summary.md` and `conductor/advice-log/`.
- `git init` only when the folder is not a repository. No skill symlinks, `.claude/MEMORY.md`, deploy stub or database.

## 4. First tracks

One "Walking skeleton" track in the plan lane, the thinnest end-to-end slice of the product. Create it by hand as `ops/tracks.md` describes.
When the add-on's connector tools are present and the project already has its `conductor/` files, create further tracks with
`mcp__plugin_laneconductor-parallel_lc__create_track`; otherwise write the files as `ops/tracks.md` describes.

## 5. Say what else fits this project (a new project)

After the project is read, offer a STARTER SET: say which optional plugins would help THIS project, three or four at most, once. Look at what you read (the stack from `package.json`, the marker files and `conductor/tech-stack.md`, the git history, the CI files, what the person told you and the Type of the tracks) and pick only the entries below that fit and are not installed; say in a sentence why each fits.
Order them: the core process skills first, a design skill when the project has a UI, the stack's pack, then the rest. Never more than four. If one is already installed, say
nothing about it. If nothing fits, say nothing and go on. End the offer with the statement: "Install them whenever you like; otherwise I will offer each one when it comes up (when you plan a screen, deploy, and so on)."
If the person says later, record nothing: each item is offered again at its own moment, as `/laneconductor:suggest-skills` describes.

How to offer: show an entry's install commands, each alone in its own bash block (no leading `$`), then the reload step (`/reload-plugins`), and say plainly what it installs. You only show them: never run an install command yourself, and install nothing unless the person says yes. Mention each plugin once in this session; if the person declines, do not bring it up again. Detect what is installed from the session's skills list and `claude plugin list`; if you cannot tell, take the person's word.

- `laneconductor-parallel`: parallel work: sub-agents per track in worktrees, conflict-checked track writes. Installs an MCP server (a Node.js program) and a scaffold script. It counts as installed when its connector tools are among your tools, or its agent `laneconductor-parallel:track-runner` is listed. Mention only when several sessions, people or sub-agents write the same tracks, or overwrites are a worry. `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-parallel@laneconductor` It fits when the git history shows several authors, the project has CI files or several services, or the person wants tracks worked in parallel or by sub-agents.
- `laneconductor-board` (Type dev/marketing/sales/support): the board: one private page of every track by lane. Installs a script (a Node.js program, no packages) and its page. It has no tool or agent to look for, and its files are outside the project: offer it once, as an option that can be ignored if it is installed already. Mention only when the person asks for a board or dashboard (`/laneconductor:board`, `/laneconductor:board refresh`). `claude plugin marketplace add meller/laneconductor`, `claude plugin install laneconductor-board@laneconductor` It fits when a team will follow the tracks, the project already has more than a handful of them, or the person wants an overview of every track by lane.
- `frontend-design` (prerequisite; stack ui): design direction for UI: typography, layout, no templated defaults. Markdown only. `claude plugin install frontend-design@claude-plugins-official` It fits when the project has a front end (React, Vue, Vite, HTML pages) or tracks that plan screens.
- `marketing-skills` (prerequisite; Type marketing/sales): marketing and sales skills: strategy, launch, copy, social, cold email, analytics. Markdown only. `claude plugin marketplace add coreyhaines31/marketingskills`, `claude plugin install marketing-skills@marketingskills` It fits when the project's tracks are marketing or sales work (copy, launch, outreach), or it is a product that needs a website and a launch.
- `superpowers`: process skills: plans, test-first, debugging, sub-agents, worktrees, review, verification. Installs a session-start hook script, plus Markdown skills. `claude plugin install superpowers@claude-plugins-official` It fits when the project writes code: it adds the brainstorm, plan, test-first, debugging and review skills the lanes use.
- `playwright` (stack ui): drives a real browser to check a UI flow and take screenshots. Installs an MCP server (Node.js, via npx) that drives a browser. `claude plugin install playwright@claude-plugins-official` It fits when the project has a web UI that a person checks in a browser.
- `firebase` (stack firebase): Firebase tools: Firestore, auth, functions, hosting, and hosting deploys. Installs an MCP server (firebase-tools, via npx) that can change your Firebase project. `claude plugin install firebase@claude-plugins-official` It fits when the project has `firebase.json` or `.firebaserc`, or Firebase in its tech stack.
- `cloudflare` (stack cloudflare): Cloudflare skills and hosted MCP server for edge functions and deploys. Installs a connection to Cloudflare's hosted MCP server, plus skills. `claude plugin marketplace add cloudflare/skills`, `claude plugin install cloudflare@cloudflare` It fits when the project has `wrangler.toml`, `wrangler.json` or `wrangler.jsonc`, or Cloudflare in its tech stack.

When BOTH add-ons (`laneconductor-parallel` and `laneconductor-board`) are missing and you offer both, also show "Both add-ons in one line:" and this block, then the reload step. When only one of them is missing, keep its offer above and add nothing.

Both add-ons in one line:

```bash
claude plugin marketplace add meller/laneconductor && claude plugin install laneconductor-board@laneconductor && claude plugin install laneconductor-parallel@laneconductor
```

## 6. Summarize and close

End with ONE message, filled in from what you did and nothing else:

> **Habit tracker**: a small web app for daily habits (TypeScript, SQLite).
> Created `conductor/` (context files, `tracks/`), a git repository and the `.gitignore` lines. First track in the plan lane: 1 Walking skeleton.
> Tracks are private (git-ignored): there is no remote to share them with. Say 'commit my tracks' to share them.
> The conductor files are not committed; say commit when you want them committed.
> **See it on the board:** the board line of the first-track card (at the end of this command).
> **Plan the first track:** `/laneconductor:plan 1` ("Walking skeleton").
> Board, or plan the first track?

Exactly two offers and one question, nothing after them (the starter set of step 5 comes before the message): no add-ons paragraph, no "Next: run `/laneconductor:next`". On "commit", `git add` the created paths by name (never `git add -A`) and make one commit `chore: add the LaneConductor scaffold`. Do not push, and do not offer to; if they ask, say what would be pushed and ask again.

## Rules

- Never request, read or handle a credential, token or key. Sign-in and secrets are the person's steps.
- One question at a time; never ask what the repository already answers.

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

- **The plan** (read only, one look): `docs/plan.md`, `PLAN.md`, `ROADMAP.md`, `TODO.md`, `docs/roadmap*.md`, and README sections on the roadmap, next steps, status, todo or what is missing. Items, in the file's order and words, cut to one line: unticked checkboxes, else bullets or numbered lines, else `###` headings, of the sections on what is still to come; never a ticked, struck-through or "done" one. A decision or question still open (a heading with decision, open or question, or a line ending "?") is an open question, not an item.
- **With a plan**: the lead names the file; at most four items, "N more in `<file>`", at most two open questions; then, only for what the plan does not say, at most two generic suggestions, the audit last.
- **Without a plan**, only generic suggestions, at most four, one line each: the title, then the fact behind it in a few words. In this order: no licence file or the README says none is chosen (Choose a licence); the README or `package.json` says public, demo or open source (Check the repository for secrets and personal data before it is public); no CI files but a test command (Add CI that runs `<the test command>`); no lint or format config (Add a lint and format check); no `SECURITY.md` (Add a SECURITY.md); no lockfile (Pin the dependencies). Keep the first three that fit, then always last: Audit: review the code for privacy, security and quality, and file each finding as its own track. The reply line has no "all".
- **Never invent**: every line is text from a file (named) or a fact a command or a read checked.
- **The board line**: always the one in the card above, `/laneconductor:board`. That command looks for the board add-on itself and, when it is missing, says so and shows the install commands; so detect nothing and show no install line here.

- **The answer**: numbers, "all N" (every plan item, the hidden ones too) or a title. For each, in the plan's order, follow `new`: search first (a fitting track is offered an update), then create in the plan lane, the plan item as the problem ("From `docs/plan.md`: <the item as written>"). An open question is filed only if asked. Setup files the first four the same way, with no question.

If the laneconductor-parallel add-on's tools are present (`mcp__plugin_laneconductor-parallel_lc__create_track`), use them instead of editing the files by hand: they refuse a write when someone edited first (a CONFLICT), so pass `update_track` the `base` from `get_track` and, after a CONFLICT, re-read and retry. If they are not present, the steps above are the whole job.

## Reference: scaffold

From the skill files this command names, copied here: whole files, or only the sections the command uses.

### `setup/scaffold.md`

Run only when the person asks for it by name: `/laneconductor:setup scaffold`. It goes straight to the files: no interview about the
project beyond what the files below need. Plain `setup` follows `ops/new-project.md` (its existing-repository
path) and uses this file and `templates.md` for the same `conductor/` structure. Three rules hold either way:

- Tell the person what you are about to create or change before you write anything, and wait for a yes.
- Never overwrite a file that exists; skip it and say so.
- Create no database or symlink, and commit nothing without a separate yes. Never push.



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
   **Auto Run**: yes
   **Author**: INITIALS
   **Created By**: user@email.com
   **Summary**: [description]
   ```
   `**Type**` defaults to `dev`; `**Merge Mode**` and `**Auto Run**` to `direct` and `yes`. Write `pr` / `no` only when the
   user asks for it on this track ("this one needs a PR, don't auto-run it").
3. **Non-dev types.** For `marketing`, `sales` or `support`, say which of the skills the Type works best with are installed. A skill is
   installed when it is in the session's skills list, in `claude plugin list`, or in `.claude/skills/` or `~/.claude/skills/`; an older
   name counts. For each one installed say "you have `<skill>` installed, use it before writing the content". Offer the missing ones:

   
4. Create `history.md` beside the other files, with one header line (`# History: Track INITIALS-<n>`, the id only) and nothing else.
5. Print `✅ Track <n> created in conductor/tracks/<folder>/.`

### `lanes/brainstorm.md`

An optional deepening step before implement: ask the human clarifying questions through
`conversation.md`. It is not a lane and can run at any time. Write the first question to `conversation.md` and set
`**Waiting for reply**: yes` in `index.md` yourself.

1. **Load context.** On `FRESH_SESSION: false` read only `conversation.md` (you need the latest
   human reply; every question-answer round after the first is normally a resumed session).
   Otherwise read `conductor/product.md`, `tech-stack.md`, `deployment-stack.md` (if present), and
   the track's `spec.md`, `plan.md`, `test.md` and `conversation.md`.
2. **Ask one question**, appended to `conversation.md` (the dialogue file; run events are dated lines in `history.md`, never in `plan.md` or `spec.md`):
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

Suggestions, a second opinion, never an order: if a skill named here is installed (for example from the Superpowers
plugin), consider using it; if not, say so in one line and carry on without it. `brainstorming` helps draw out requirements one question at a time; `writing-plans` helps once the requirements are clear and the plan lane is next.

An optional top-level `skills` object in `conductor/workflow.json` may list more under `"brainstorm"` (`{ "skills": { "brainstorm": ["my-skill"] } }`): use them the same way (if one is missing, say so and continue). Absent, nothing changes. Where a skill's steps or file locations differ from this guide or the track files, those win; take the skill's method, not its output paths.
