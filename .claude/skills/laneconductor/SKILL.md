---
name: laneconductor
description: Use this skill when the user invokes /laneconductor commands. Manages multi-project development with a live Kanban dashboard backed by local Postgres. Handles setup, track management, heartbeat sync, and DB-backed status updates. Extends the conductor workflow with real-time visibility across all repository projects.
user-invocable: true
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
parameters:
  - name: command
    description: The laneconductor command to execute
    required: true
    options:
      - setup
      - activate
      - deactivate
      - start
      - stop
      - status
      - workflow
      - setup-deploy
      - deploy
      - qualityGate
      - quality-gate
      - move
      - pulse
      - newTrack
      - updateTrack
      - reportaBug
      - featureRequest
      - lock
      - unlock
      - plan
      - brainstorm
      - implement
      - review
      - remote-sync
      - comment
      - delete
      - revert
      - syncdb
      - init-tracks-summary
  - name: subcommand
    description: Subcommand for setup and workflow operations
    required: false
    options:
      - scaffold
      - collection
      - generate
      - set
  - name: track_number
    description: Track number (NNN format, e.g., 001, 042)
    required: false
  - name: lane
    description: Kanban lane for move/workflow operations (backlog, ready, implement, review, done)
    required: false
    options:
      - backlog
      - ready
      - implement
      - review
      - done
  - name: status
    description: Status for pulse and move operations
    required: false
    options:
      - queue
      - running
      - success
      - failed
      - blocked
  - name: environment
    description: Deployment environment
    required: false
    options:
      - dev
      - staging
      - prod
      - production
  - name: flags
    description: Command flags and options
    required: false
    options:
      - "--sync-and-work"
      - "--source"
      - "--target"
---
<!-- Portions of workflow protocols adapted from superpowers by Jesse Vincent (MIT License) -->

# LaneConductor Skill

**Sovereign Developer Environment** — real-time visibility into AI-driven development across multiple repositories. Tracks progress through a local Postgres database and displays it on a Vite Kanban dashboard (port 8090).

## Modes of Operation

1. **Full Local Stack (CLI-driven)**: Uses the `lc` CLI, local Postgres, and a Vite Kanban dashboard. Best for solo developers wanting a rich UI. Requires Node.js and a Unix-like environment (Linux/macOS/WSL).
2. **AI-Native / Skill-Only (Minimalist)**: No CLI or DB required. Simply copy this skill into your Claude Desktop, and the AI will manage everything through the filesystem (`conductor/` folder). Perfect for Windows or lightweight environments.

---

## Universal CLI (`lc`)

LaneConductor provides a global `lc` command to manage your projects without relying on an LLM or per-project Makefiles.

### Installation
```bash
cd ~/Code/laneconductor
make install-cli
```

### Core Commands
- `lc worker run <track>`: **Normally what you want.** Runs a worker scoped to
  that track in the foreground and exits when it's done. It cannot claim any
  other queued track — unlike `lc worker start --sync-and-work`, which claims
  *anything* queued and will begin autonomous agent runs on every other track
  sitting in `queue`. (Track 1109)
- `lc worker start [--sync-and-work] [--only-tracks <n,n>] [--once]`: Start the
  heartbeat worker in the background. `--only-tracks` restricts what it may
  claim — it narrows only, and can never widen a server-side permission
  decision; `--once` exits when that scoped work is finished.
- `lc worker stop`: Stop the background heartbeat worker.
- `lc worker restart`: Restart the background heartbeat worker.
- `lc worker status`: Check the health and PID of the local worker.
- `lc worker logs`: Stream the worker's activity logs.
- `lc worker sync`: Manually trigger an immediate fan-out synchronization across all targets.
- `lc status`: Show a Kanban board of tracks in the terminal (with worker health check).
- `lc ui [start|stop]`: Manage the Vite dashboard.
- `lc new "Title" "Description"`: Create a new track.
- `lc setup`: Initialize a new project with LaneConductor.
- `lc add-target --url <url> [--key <key>] [--store-type gcp-secret] [--secret-name <name>]`: Add a sync endpoint.
- `lc add-target --type jira --domain <domain> --email <email> --project-key <key> [--token-env <env>]`: Add a Jira sync target.
- `lc add-target-mapping --lane <lc_lane> --target "<target_status>"`: Configure custom Jira status mapping for a specific Lane. (Example: `lc add-target-mapping --lane implement --target "In Progress"`)
- `lc list-targets`: Show all sync targets and their active/disabled status.

---

## Installation (one-time, per machine)

```bash
git clone <repo> ~/Code/laneconductor
cd ~/Code/laneconductor
make install    # writes ~/.laneconductorrc (install path) + installs UI deps
```

To add LaneConductor to an existing project:
```bash
cd your-project
lc setup
```

The skill is symlinked from `~/Code/laneconductor/.claude/skills/laneconductor` into each
project's `.claude/skills/laneconductor`. Updates to the laneconductor repo propagate
automatically to all projects — no re-installation needed.

---

## Architecture

One repo, two parts:
- **`laneconductor/`** — this LaneConductor AI skill (AI instructions + heartbeat worker)
- **`laneconductor/ui/`** — Vite dashboard at `http://localhost:8090`

Shared local Postgres (`laneconductor` db) stores all project/track state. One project per repository. Zero cloud, zero auth.

```
[Your Project]
├── conductor/
│   ├── tracks/001-feature/
│   ├── index.md        ← Atomic Status (Status, Progress, Title)
│   ├── plan.md         ← Detailed Implementation Phases
│   └── spec.md         ← Technical Requirements
├── tracks.md           ← Project Summary (built from index.md files)
├── Makefile                    ← project build targets (lc commands handle LaneConductor)
└── .laneconductor.json         ← DB config + project identity

[Postgres: laneconductor DB]
├── projects (one row per repo)
└── tracks   (one row per track, per project)

[laneconductor/ui @ :8090]
├── Express API  → localhost:8091
└── Vite + React → localhost:8090  (Kanban board, polls every 2s)
```

## Protocol: conversation.md Format (required for sync)

Every entry appended to `conductor/tracks/NNN-*/conversation.md` — by an
agent or a human — MUST use this exact format, including continuation
lines:

```
> **author**: First line of the message
> second line, also prefixed with >
> third line
```

`author` is `human`, `claude`, `gemini`, or `system`. This is not just a
style convention: the sync worker's parser only recognizes lines matching
`> **author**: ...` (plus `>`-prefixed continuation lines) as comments to
push into the database. **Anything else — markdown section headers, plain
blockquotes without an author marker, freeform prose — is silently not
synced.** It stays in the file, but never reaches `track_comments`, so it
never shows up in the UI's Conversation tab, with no error or warning
anywhere (the sync worker does log a warning now when this happens, but
don't rely on that — get the format right the first time).

**If you need to include long reference material** as part of a turn — a
pasted email, contract text, a redline, negotiation history — wrap the
*entire* block under one `> **author**:` opening line, with every
subsequent line (including blank ones you want preserved, and any markdown
headers within the pasted content) still prefixed with `>`, so the parser
treats it all as one continuous comment body:

```
> **claude**: Liran replied with a full counter-redraft. Summary below.
>
> ## Liran's reply (received 2026-08-09)
>
> [full pasted text here, every line prefixed with >]
```

Do NOT drop the `> **author**:` prefix partway through just because the
content is long or reads more naturally as a standalone document — that is
exactly what silently breaks sync.

## Protocol: Session Continuity (skip re-reading context on resume)

Every prompt you receive starts with a line the worker adds:

```
FRESH_SESSION: true
```
or
```
FRESH_SESSION: false
```

`true` means this is the first call in a new session for this (worker,
track) pair — proceed normally, including every "Load context" /
"Read existing context" step below. `false` means the worker resumed your
*same Claude session* from an earlier call on this same track (track
1086) — you already have `product.md`, `tech-stack.md`,
`product-guidelines.md`, `design-language.md`, `spec.md`, `plan.md`,
`test.md`, and `conversation.md` loaded from that earlier call in this
conversation. **On `FRESH_SESSION: false`, skip re-reading any file you
already read earlier in this session** — jump straight to the actual
instruction that follows. Re-reading them wastes the exact time/token cost
this mechanism exists to remove.

This does **not** mean skip reading everything unconditionally: if the
prompt is pointing you at something you genuinely haven't seen yet in this
session (a new human comment appended to `conversation.md` since your last
turn, a file that didn't exist before, output from a command you just
ran), still read it — "resumed" means "don't redo work you already did,"
not "ignore new information." Every "Load context" / "Read existing
context" step in the commands below is annotated with which files this
applies to.

## Protocol: Locating Tracks

To find a track by number (e.g., "Track 017"):

1.  **Check `conductor/tracks-metadata.json`**: This is the canonical index. Look for the track number key (e.g., `"017"`) and its `folder_path`.
2.  **Scan `conductor/tracks/`**: If the metadata is missing or out of sync, look for a directory starting with the track number (e.g., `conductor/tracks/017-firebase-static/`).
3.  **Check `conductor/tracks.md`**: This summary file often contains links to the track folders.
4.  **Check `conductor/tracks/file_sync_queue.md`**: New tracks queued from the UI or CLI appear here with `**Status**: pending` before the worker creates their folder.

**Folder Naming Convention**: `conductor/tracks/NNN-slug/` (where NNN is the 3-digit track number).

---

## Core Commands

### `/laneconductor setup`

Initializes LaneConductor in the current project.

1.  **Check for CLI**: Check if `lc` is available in the system (`which lc`). 
2.  **If `lc` is available**: Tell the user they can run `lc setup` in their terminal for a guided wizard, or proceed here with `/laneconductor setup scaffold`.
3.  **If `lc` is NOT available (Skill-Only Mode)**:
    -   Assume `mode: "local-fs"`.
    -   Create `.laneconductor.json` with minimal configuration:
        ```json
        {
          "mode": "local-fs",
          "project": {
            "name": "<detected-name>",
            "repo_path": "<absolute-path>",
            "primary": { "cli": "claude" }
          }
        }
        ```
    -   Proceed immediately to `setup scaffold`.

**Note**: In Skill-Only mode, the AI acts as the primary orchestrator. There is no background heartbeat worker; instead, the AI updates the `conductor/` files directly during its turn.

---

### `/laneconductor setup scaffold generate`

**File-generation phase of `lc setup`.** The CLI wizard has already:
- Scanned the project (package.json, README, framework signals)
- Ran a multi-turn brainstorm loop where the user clarified the project
- Got explicit confirmation to proceed

Your job is **only to generate the context files**. Do not ask questions.

**Read context from `conductor/.setup-scaffold-context.json`:**
```json
{
  "project": { "name": "...", "git_remote": "...", "has_existing_code": true },
  "scan": ["package.json: ...", "README: ...", "Framework signals: next.config.js"],
  "brainstorm_summary": "user: ...\nassistant: ..."
}
```

**If `brainstorm_summary` is present**, use it as the authoritative source — it contains the agreed-upon understanding of the project. The scan snippets are supplementary.

**Generate these files** (create `conductor/` dirs as needed):

- **`conductor/product.md`** — what the product does, who uses it, key features, problem it solves
- **`conductor/tech-stack.md`** — languages, frameworks, databases, infrastructure, key libraries
- **`conductor/workflow.md`** — commit strategy, branching, testing approach, code review process
- **`conductor/product-guidelines.md`** — brand/style/UX principles (stub with placeholders if unknown)
- **`conductor/design-language.md`** — color tokens (light/dark), typography scale, spacing system, component conventions, iconography/motion (stub with placeholders if unknown; see template below)
- **`conductor/deployment-stack.md`** — stub: "Not configured. Run `lc setup-deploy`."
- **`conductor/kpis.md`** — project north-star metrics (see KPI template below)
- **`conductor/user-stories.md`** — personas + their end-to-end journeys (see template below;
  stub with a TODO if no journey/flow language is found in `brainstorm_summary`)
- **`conductor/quality-gate.md`** — the project's own verification commands
  (see template below). **Must be tailored to THIS project's real stack** —
  derive every command from what you actually found in the scan
  (`package.json` scripts, test runner, lint config, e2e framework), not
  from a generic list. A quality gate that names commands this project
  doesn't have is worse than none: it gets skipped or faked.
- **`conductor/tracks/`** and **`conductor/code_styleguides/`** — create dirs if missing
- **`.claude/MEMORY.md`** — create if not present

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

## End-to-End / Real-Product Checks

> Required for any track touching UI or a user-facing flow. Unit tests
> cannot detect a feature that was never wired up.

- [ ] E2E suite: `<e.g. npx playwright test>` (Expected: all specs pass —
      run the EXISTING specs; writing one trivial new passing test does not
      satisfy this)
- [ ] Restarted long-running processes (workers, API server) before
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

Print progress as you write each file:
```
📝 Writing conductor/product.md...            ✅
📝 Writing conductor/tech-stack.md...         ✅
📝 Writing conductor/workflow.md...           ✅
📝 Writing conductor/product-guidelines.md... ✅
📝 Writing conductor/design-language.md...    ✅
📝 Writing conductor/deployment-stack.md...   ✅
📝 Writing conductor/kpis.md...               ✅
📝 Writing conductor/user-stories.md...       ✅
📝 Writing conductor/quality-gate.md...       ✅
```

**Also symlink the skill and Antigravity workspace rule/skill** (if not already linked):
```bash
SKILL_DIR=$(cat ~/.laneconductorrc 2>/dev/null || echo "$HOME/Code/laneconductor/.claude/skills/laneconductor")
TARGET=".claude/skills/laneconductor"
mkdir -p .claude/skills
ln -sf "$SKILL_DIR" "$TARGET"

# Symlink skill and rules for Antigravity
mkdir -p .agents/skills .agents/rules
ln -sf "$SKILL_DIR" ".agents/skills/laneconductor"
REPO_DIR=$(dirname $(dirname $(dirname "$SKILL_DIR")))
RULE_SRC="$REPO_DIR/.agents/rules/laneconductor.md"
ln -sf "$RULE_SRC" ".agents/rules/laneconductor.md"
```

After writing all files, check for foreign tracks and print summary.

---

### `/laneconductor setup scaffold`

Generates the `conductor/` folder structure and project context files using AI reasoning.
**Use this only when invoked directly from an AI editor (not via `lc setup`).**

Asks first:
> "Does this project have existing code? (yes/no)"

**Mode A — Existing code:**
1. Scan the codebase: read `package.json`, `README.md`, source dirs, CI config, lint config
2. Auto-generate conductor context files from findings:
   - `product.md` — inferred from README, app name, entry points, routes
   - `tech-stack.md` — inferred from `package.json` deps, framework patterns, config files
   - `deployment-stack.md` — stub: "Not configured. Run `lc setup-deploy`."
   - `workflow.md` — inferred from `.git` log patterns, CI files, test setup
   - `product-guidelines.md` — minimal template (hard to infer; leave stubs for user)
   - `design-language.md` — inferred from existing Tailwind/CSS-variable config, component
     library theme (e.g. shadcn, MUI theme), or design-token files if present; otherwise
     minimal template like `product-guidelines.md`
   - `code_styleguides/` — inferred from `.eslintrc`, `.prettierrc`, `tsconfig.json` if present
   - `user-stories.md` — only if concrete user journeys surface in the README/scan (e.g. distinct
     roles interacting with each other, invite/approval flows); otherwise stub with a TODO —
     don't fabricate personas from a codebase scan alone
3. Ask one KPI question: **"What does success look like? What are your 2–3 north-star metrics and rough targets?"** — use answer to populate `kpis.md`; if user skips, generate stub rows from README/product description inferences

**Mode B — New project:**
Ask a short questionnaire:
- What does this project do? Who are the users?
- What language/framework/database will you use?
- TDD? Commit strategy? Branching model?
- Any brand/style standards?
- **What does success look like? What are your 2–3 north-star metrics and rough targets?** (e.g. "500 signups by Q2", "1000 DAUs", "HN front page")
- **Any key user journeys worth tracking now?** (optional — e.g. "admin invites a manager, manager invites a rep"; skip is fine, `user-stories.md` stubs if so)

Generate all conductor files with content from answers, including a stub for `deployment-stack.md`.

**Both modes create:**
```
conductor/
├── tracks/
├── code_styleguides/
├── product.md
├── product-guidelines.md
├── design-language.md
├── tech-stack.md
├── deployment-stack.md
├── user-stories.md
├── workflow.md
├── kpis.md
├── tracks.md
└── laneconductor.sync.mjs
```
Also:
- Create `.claude/MEMORY.md` if not present
- **Symlink the skill into this project** so AI agents can invoke it locally:
  ```bash
  SKILL_DIR=$(cat ~/.laneconductorrc 2>/dev/null || echo "$HOME/Code/laneconductor/.claude/skills/laneconductor")
  TARGET=".claude/skills/laneconductor"
  # Skip if this IS the laneconductor repo (skill is already the real file here)
  if [ "$(realpath $TARGET 2>/dev/null)" = "$(realpath $SKILL_DIR 2>/dev/null)" ]; then
    echo "ℹ️  Skill already present (this is the laneconductor repo)"
  else
    mkdir -p .claude/skills .agents/skills .agents/rules
    ln -sf "$SKILL_DIR" "$TARGET"
    ln -sf "$SKILL_DIR" ".agents/skills/laneconductor"
    REPO_DIR=$(dirname $(dirname $(dirname "$SKILL_DIR")))
    ln -sf "$REPO_DIR/.agents/rules/laneconductor.md" ".agents/rules/laneconductor.md"
    echo "✅ Skill and rules symlinked for Claude and Antigravity"
  fi
  ```
  **Windows/Manual Note**: On Windows (without WSL), use `mklink /D` or `mklink /J` to create the symlink, or simply copy the `laneconductor` skill folder from your installation path into `.claude/skills/`.

  This ensures that the latest version of the skill is always discoverable by the AI within this project.

**The Heartbeat Worker (`laneconductor.sync.mjs`)** is managed globally by the `lc` CLI. You no longer need a copy of this script inside your project's `conductor/` folder. The `lc start` command will automatically use the canonical version from your LaneConductor installation.

**Detect and import foreign tracks (from other conductor tools):**

After creating the structure, scan `conductor/tracks/` for folders that do NOT follow the `NNN-slug` naming convention (e.g. Gemini conductor tracks like `feature_name_20260213/README.md`). These won't be auto-synced by the heartbeat worker.

If foreign track folders are found, ask:
> "Found N existing tracks from a previous conductor tool. Import them as LaneConductor tracks? (y/n)"

If yes, for each foreign folder:
1. Parse the title from `README.md` or `index.md` (first `# Heading` line)
2. Detect status from content: look for `✅ COMPLETED`, `DONE`, `complete` → lane `done`; `IN PROGRESS`, `in-progress` → lane `implement`; anything else → lane `backlog`
3. Assign the next available track number (continue from highest existing `NNN-*` folder, or start at 001)
4. Create `conductor/tracks/NNN-slug/index.md` with proper markers:
   ```markdown
   # Track NNN: Title

   **Lane**: done
   **Lane Status**: success
   **Progress**: 100%
   **Last Run**: imported (n/a)
   **Summary**: Imported from previous conductor tool
   ```
5. Copy or symlink the original folder content alongside (or leave original README.md in place)
6. Print: `✅ Imported NNN tracks → conductor/tracks/NNN-*/`

The heartbeat worker will then pick them up via `ignoreInitial: false` on next `lc start`.

**3. Environment Verification & Self-Healing:**
After scaffolding files, you MUST verify the project environment:
1.  **Check Dependencies**: Verify if `chokidar` is installed (`npm list chokidar` or checking `package.json`).
2.  **Check Git**: Verify `git rev-parse --is-inside-work-tree` and detect current branch naming (e.g., `main` vs `master`).
3.  **Check Binaries**: Verify that the agents configured in `.laneconductor.json` (e.g., `claude`, `agy`, `gemini`) are accessible in the system `PATH`.

**If issues are found:**
- Report them clearly: `⚠️  Environment Issue: <detailed description>`.
- Ask: `Would you like me to create Track 001 to track these environment fixes? (y/n)`.
- If yes, create `conductor/tracks/001-fix-environment/index.md`:
    ```markdown
    # Track 001: Fix Project Environment
    
    **Lane**: backlog
    **Lane Status**: queue
    **Progress**: 0%
    **Summary**: Initial environment verification found missing dependencies or configuration gaps.
    ```
- Write specific tasks to `conductor/tracks/001-fix-environment/plan.md` (e.g., `npm install chokidar`, `git init`, etc.).

**Create `conductor/quality-gate.md` if enabled:**
If `create_quality_gate` is `true` in `.laneconductor.json`, create `conductor/quality-gate.md` with quality standards (Unit Tests, Linting, Build, Security).

Do NOT embed the sync.mjs code inline in this skill — the canonical source at
`~/Code/laneconductor/conductor/laneconductor.sync.mjs` is always correct and avoids
template substitution issues with parameterized query placeholders.


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

**Also create `conductor/workflow.json`** during scaffold (copy from the canonical laneconductor repo):
```bash
SKILL_DIR=$(cat ~/.laneconductorrc 2>/dev/null || echo "$HOME/Code/laneconductor/.claude/skills/laneconductor")
LC_REPO=$(dirname $(dirname $(dirname "$SKILL_DIR")))
cp "$LC_REPO/conductor/workflow.json" conductor/workflow.json
echo "✅ workflow.json copied from canonical source"
```

---

### `/laneconductor setup collection`

Sets up the **collection destination** — configures the operating mode, AI agents, and registers this project.

1. **Operating mode** — ask first, as it determines what infrastructure is needed:

   ```
   How will this worker operate?
     [1] local-fs    — no DB, no API; pure filesystem (offline, CI, testing) ← default
     [2] local-api   — local Postgres + local Collector at localhost:8091 + Vite UI at localhost:8090
     [3] remote-api  — remote Collector (laneconductor.io or self-hosted)
   ```

   Write `"mode": "<choice>"` into `.laneconductor.json`. This is the **first** field — it controls everything below.

   | Mode | Needs DB? | Needs Collector? | UI Dashboard | Best for |
   |------|-----------|------------------|-------------|----------|
   | `local-fs` | No | No | No | Offline, CI, testing |
   | `local-api` | Yes (local) | Yes (`:8091`) | `localhost:8090` (Vite Kanban) | Solo dev full stack |
   | `remote-api` | No (remote) | Yes (remote) | Cloud URL | Teams, multi-machine |

   **If `[1] local-fs`**: skip steps 2–3 (no DB or collector needed). Jump straight to step 4 (agent config).

2. **DB connection** *(local-api only — skip for local-fs and remote-api)*
   Show current values if `.laneconductor.json` already exists:
   - `DB host [localhost]:`
   - `DB name [laneconductor]:`
   - `DB port [5432]:`
   - `DB user [postgres]:`
   - `DB password [postgres]:` ← stored in `.env` as `DB_PASSWORD`, NOT in `.laneconductor.json`
   - `DB SSL? (y/n) [n]:`

3. **Collectors** — ask how this project syncs data *(skip for local-fs)*:
   ```
   Which collectors?
     [1] Local only    — local Postgres + local collector (default, works today)
     [2] LC cloud      — laneconductor.io managed (paste token)
     [3] Both          — local primary + LC cloud fire-and-forget
   ```

   If `[2]` or `[3]`, collect the LC cloud token:
   - `LC Cloud Token (lc_xxxx...):` ← stored in `.env` as `COLLECTOR_n_TOKEN`, NOT in config.
   - `Store Type:` [1] `.env` (direct token) [2] `gcp-secret` (dynamic GCP Secret Manager resolution).
   - If `gcp-secret`, ask for: `Secret Name (e.g., LC_PROD_KEY)`.
   - The default URL for LC cloud is `https://app.laneconductor.com`.

   Write all configurations to `.laneconductor.json` and tokens to `.env` (if using token storage).
   Ensure `.gitignore` exists and contains `.env`.

4. **Primary agent** — ask which CLI drives this project (`claude` / `antigravity (agy)` /
   `gemini (retired)` / `other`).
   Then:
   a. **Verify reachability** by running the version check:

   | Agent           | Check command                      | Passes if               |
   |-----------------|-------------------------------------|-------------------------|
   | claude          | `claude --version`                 | exits 0, prints version |
   | antigravity/agy | `agy --version`                    | exits 0, prints version |
   | gemini (retired)| `npx @google/gemini-cli --version` | exits 0, prints version |
   | other           | ask for CLI command, then run it   | exits 0                 |

   **On success:** print `✅ <agent> reachable — <version>`
   **On failure:** warn, ask `Continue anyway? [y/N]:` — abort if N.
   **If `gemini` is chosen:** additionally warn that Gemini CLI was retired by Google and
   antigravity is now recommended (see `bin/lc.mjs`'s setup wizard for the exact wording) —
   non-blocking, setup still proceeds if the user continues anyway.

   b. **Discover models dynamically** — do NOT present a hardcoded list (except for Claude).
   For Claude, the CLI uses aliases. Do not run a discovery command. Instead, recommend:
   - `haiku`: Claude 3.5 Haiku
   - `sonnet`: Claude 3.7 Sonnet
   - Leave blank/default for system recommendation.

   For others, run a one-shot prompt to get current models:

   | Agent           | Discovery command |
   |-----------------|------------------|
   | antigravity/agy | no known non-interactive model-listing command yet — ask user: `Model name (leave blank to set later):` |
   | gemini (retired)| `npx @google/gemini-cli -p "List the available Gemini model IDs as a plain newline-separated list, no commentary"` |
   | other           | ask user: `Model name (leave blank to set later):` |

   Parse the output and present the discovered model IDs as choices.
   If discovery fails or times out (>15s), fall back to asking the user to type a model name.
   Always allow free-text entry as a fallback.

   c. Ask: `Primary model [default]:` (emphasize that blank = best default)

4. **Secondary agent** (optional) — ask `Add a secondary AI CLI? (none / claude / antigravity / gemini (retired) / other)`.
   If not `none`: repeat reachability check + model discovery for that CLI.
   Ask: `Secondary model [default]:` (emphasize that blank = best default)

5. Detect project name: run `git remote get-url origin 2>/dev/null` and parse the repo name. Fall back to `basename $(pwd)`.

6. Write `.laneconductor.json` (passwords NEVER go here — they live in `.env`):

**Mode 1 — local-fs** (minimal, no infrastructure):
```json
{
  "mode": "local-fs",
  "project": {
    "name": "<detected-name>",
    "repo_path": "<absolute-path>",
    "git_remote": "<git-remote-or-null>",
    "primary": { "cli": "claude", "model": "<selected-model>" }
  },
  "collectors": []
}
```

**Mode 2 — local-api** (full local stack):
```json
{
  "mode": "local-api",
  "project": {
    "name": "<detected-name>",
    "id": null,
    "repo_path": "<absolute-path>",
    "git_remote": "<git-remote-or-null>",
    "primary": { "cli": "claude", "model": "<selected-model>" },
    "secondary": { "cli": "agy", "model": "<selected-model>" },
    "dev": { "command": "npm run dev", "url": "http://localhost:3000" }
  },
  "collectors": [{ "url": "http://localhost:8091", "token": null }],
  "ui": { "port": 8090 }
}
```

**Mode 3 — remote-api** (cloud or self-hosted):
```json
{
  "mode": "remote-api",
  "project": {
    "name": "<detected-name>",
    "id": null,
    "repo_path": "<absolute-path>",
    "git_remote": "<git-remote-or-null>",
    "create_quality_gate": false,
    "primary": { "cli": "claude", "model": "<selected-model>" }
  },
  "collectors": [{ "url": "https://collector.laneconductor.io", "token": null }],
  "ui": { "port": 8090 }
}
```

Omit `id` for local-fs (no DB row). Omit `secondary` if no secondary agent was chosen. Omit `dev` if dev server quick-start is not needed. Token secrets are stored in `.env` as `COLLECTOR_0_TOKEN` / `COLLECTOR_1_TOKEN` (mapped by array index) — never in the JSON.

**Dev Server Config (Optional)**:
- `dev.command` — Shell command to start the dev server (e.g., `npm run dev`, `cargo run`)
- `dev.url` — URL where the dev server runs (e.g., `http://localhost:3000`)
When configured, the Kanban UI will show a "Start Dev Server" button on tracks in the review and in-progress lanes. Reviewers can launch the running app without switching to a terminal.
Omit the `dev` key entirely if dev server quick-start is not needed for this project.

6. Create the DB schema *(local-api only — skip for local-fs and remote-api)*
   Run via `psql` if available, else write + run a one-time node script:
```sql
CREATE TABLE IF NOT EXISTS projects (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  repo_path       TEXT UNIQUE NOT NULL,
  git_remote      TEXT,
  git_global_id   UUID UNIQUE,
  primary_cli     TEXT DEFAULT 'claude',
  primary_model   TEXT,
  secondary_cli   TEXT,
  secondary_model TEXT,
  create_quality_gate BOOLEAN DEFAULT false,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tracks (
  id               SERIAL PRIMARY KEY,
  project_id       INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  track_number     TEXT NOT NULL,
  title            TEXT NOT NULL,
  lane_status      TEXT DEFAULT 'planning',  -- planning|backlog|in-progress|review|done
  lane_action_status TEXT DEFAULT 'waiting', -- waiting|running|done
  lane_action_result TEXT,                   -- success|error|timeout
  progress_percent INTEGER DEFAULT 0,
  current_phase    TEXT,
  content_summary  TEXT,
  sync_status      TEXT DEFAULT 'synced',
  last_updated_by  TEXT DEFAULT 'worker',
  last_heartbeat   TIMESTAMP DEFAULT NOW(),
  created_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, track_number)
);
```

---

## Lane Action State Machine & Dynamic Boundaries

Transitions are NOT hardcoded. You MUST read `conductor/workflow.json` at the start of every command to determine the correct target lanes for success and failure.

### 🛑 CRITICAL: Boundary Rules
- **`/laneconductor plan`**: ONLY produces documentation. **NEVER** write application code. On completion, set `**Lane**` to the value of `lanes.plan.on_success` from `workflow.json`.
- **`/laneconductor implement`**: ONLY executes the `plan.md`. On completion, set `**Lane**` to the value of `lanes.implement.on_success` from `workflow.json`.
- **`/laneconductor review`**: ONLY evaluates code. **NEVER** fix bugs. On success/failure, set `**Lane**` to the target specified in `lanes.review` (`on_success` or `on_failure`).
- **`/laneconductor quality-gate`**: Final verification. On completion, set `**Lane**` to the value of `lanes.quality-gate.on_success` from `workflow.json`.

**🛑 BOUNDARY ENFORCEMENT**: Never override the workflow. Use `workflow.json` as the sole authority for target lanes. Do NOT assume `implement` always follows `plan`; the project may be configured with a `review` lane in between.

```bash
# psql approach:
psql -h <host> -p <port> -U <user> -d <dbname> -f /tmp/laneconductor_schema.sql
```

---

### `/laneconductor activate` (or `start`) [--sync-and-work]

Start the heartbeat worker.

1. Verify `.laneconductor.json` exists — if not, tell user to run `setup collection` first
2. Check `.sync.pid` — warn if process already running
3. Start: `node bin/lc.mjs worker start [--sync-only]`

By default, the worker will only perform file↔API synchronization and will NOT poll the database for queued tracks to execute. If `--sync-and-work` is provided, it will also poll and execute tracks from the queue.

Print:
```
✅ LaneConductor heartbeat started (PID: XXXX) [SYNC-ONLY mode] or [SYNC-AND-WORK mode]
📊 Dashboard: http://localhost:8090
```

---

### `/laneconductor deactivate` (or `stop`)

Stop the heartbeat worker.

```bash
PID=$(cat conductor/.sync.pid 2>/dev/null)
if [ -n "$PID" ]; then
  kill "$PID" && echo "✅ Heartbeat stopped" && rm conductor/.sync.pid
else
  echo "⚠️  No heartbeat running"
fi
```

Print reminder to also stop the Vite UI (`Ctrl+C` in the UI terminal).

---

### `/laneconductor status`

Display a Kanban board of all tracks in the terminal. **Mode-aware**: intelligently chooses between filesystem and database.

**Logic:**
1. Read `.laneconductor.json` to detect operating mode
2. **If `mode: "local-fs"`** (no database):
   - Scan `conductor/tracks/*/index.md`
   - Extract: `track_number`, `title`, `**Lane**`, `**Progress**`, `**Phase**` markers
   - Display Kanban grouped by lane (source of truth from filesystem)
3. **If `mode: "local-api"` or `"remote-api"`** (has database):
   - Query Postgres: `SELECT track_number, title, lane_status, progress_percent, current_phase, last_heartbeat FROM tracks WHERE project_id = :project_id ORDER BY track_number`
   - Display Kanban grouped by lane (real-time from DB + UI state)
4. Print grouped by lane with progress and activity indicators:

```
╔══════════════════════════════════════════════════════════════════╗
║  Project: my-app  │  2026-02-23 14:32  [local-fs]                ║
╠══════════╦════════════════╦═════════════╦═══════════════════════╣
║ BACKLOG  ║  IN PROGRESS   ║   REVIEW    ║        DONE           ║
╠══════════╬════════════════╬═════════════╬═══════════════════════╣
║ 003-auth ║ 001-dashboard  ║ 002-api     ║ 004-docs              ║
║ 005-logs ║   45% ⏳        ║  90% ⚠️     ║ (100%)                ║
╚══════════╩════════════════╩═════════════╩═══════════════════════╝
```

**Indicators:**
- `⏳` = in-progress track (shows "Xs ago" if DB available)
- `⚠️` = has gaps/warnings from review
- `(100%)` = done tracks
- Mode indicator shown in header: `[local-fs]`, `[local-api]`, or `[remote-api]`

---

### `/laneconductor workflow`

Display the current workflow configuration from `conductor/workflow.json` as a formatted table.

1. Read `conductor/workflow.json`
2. Display:

```
╔══════════════════════════════════════════════════════════════════════╗
║  Workflow: <project>  │  Global parallel limit: 3                    ║
║  Default model: haiku  │  Default retries: 1                         ║
╠══════════════╦═══════════════╦══════════════╦════════════════════════╣
║  LANE        ║  AUTO ACTION  ║  ON SUCCESS  ║  ON FAILURE            ║
╠══════════════╬═══════════════╬══════════════╬════════════════════════╣
║ planning     ║ plan          ║ planning     ║ backlog                ║
║ in-progress  ║ implement     ║ review       ║ in-progress            ║
║ review       ║ review        ║ quality-gate ║ in-progress            ║
║ quality-gate ║ qualityGate   ║ done         ║ planning               ║
╚══════════════╩═══════════════╩══════════════╩════════════════════════╝
```

---

### `/laneconductor workflow set [lane] [key] [value]`

Update a single field in `conductor/workflow.json`.

**Examples:**
```bash
/laneconductor workflow set review max_retries 3
/laneconductor workflow set quality-gate on_failure review
/laneconductor workflow set in-progress primary_model sonnet
/laneconductor workflow set global total_parallel_limit 5
```

**Logic:**
1. Read `conductor/workflow.json`
2. Navigate to `lanes[lane][key]` (or `global[key]` / `defaults[key]` if lane is `global`/`defaults`)
3. Update the value (parse integers for numeric fields)
4. Write back to `conductor/workflow.json`
5. Print: `✅ workflow.json updated: lanes.<lane>.<key> = <value>`

**Valid keys per lane:** `parallel_limit`, `max_retries`, `primary_model`, `auto_action`, `on_success`, `on_failure`
**Valid on_success/on_failure values:** `planning`, `backlog`, `in-progress`, `review`, `quality-gate`, `done`, `null`

---

### `/laneconductor setup-deploy generate`

**File-generation phase of `lc setup-deploy`.** The CLI wizard (`lc setup-deploy`) has already:
- Scanned for deployment signals
- Asked the user all questions interactively
- Verified credentials
- Got explicit user confirmation

Your job is **only to generate the files**. Do not ask questions. Do not scan. Do not show a confirmation prompt. Just write the files.

**Read context from `conductor/.setup-deploy-context.json`:**
```json
{
  "components": { "frontend": "...", "backend": "...", "db": "...", "secrets": "..." },
  "environments": ["prod", "staging"],
  "deploy_command": "bash infra/deploy.sh",
  "cicd": false,
  "credentials": { "gcp": "verified (user@example.com)", "firebase": "verified" },
  "existing_signals": ["deploy.sh", "Dockerfile", "firebase.json"],
  "files_to_create": ["conductor/deployment-stack.md", "conductor/deploy.json", ".env.example"],
  "brainstorm_summary": "user: ...\nassistant: ..."
}
```

**If `brainstorm_summary` is present**, use it as the authoritative source for the final configuration — it contains the agreed-upon decisions from the interactive brainstorm. The `components` fields may contain raw user input (including questions); the brainstorm summary has the clarified answers.

**Generate each file listed in `files_to_create`:**

Print progress as you write each file:
```
📝 Writing conductor/deployment-stack.md...  ✅
📝 Writing conductor/deploy.json...          ✅
📝 Writing .env.example...                   ✅
🔒 Updating .gitignore...                    ✅
```

**`conductor/deployment-stack.md`** — Full human-readable topology:
```markdown
# Deployment Stack

## Provider
[derived from components]

## Environments
[list each environment with region/project if detectable]

## Services
- Frontend: [component]
- Backend: [component]
- Database: [component]
- Secrets: [component]

## Authentication
[credentials entry from context — verified ✅ or NOT CONFIGURED]

## Deploy Command
lc deploy prod  →  [deploy_command] prod
```

**`conductor/deploy.json`** — Machine-readable config:
```json
{
  "environments": {
    "prod": { "command": "[deploy_command] prod" },
    "staging": { "command": "[deploy_command] staging" }
  },
  "components": { "frontend": "...", "backend": "...", "db": "...", "secrets": "..." },
  "secrets": {
    "strategy": "[derive from secrets component]",
    "keys": []
  },
  "ci": null
}
```
Set `"ci": null` unless `cicd` is `true` in context (in which case add CI config block).

**`.env.example`** — Required CI env var names only, **never actual values**:
- GCP: `GOOGLE_APPLICATION_CREDENTIALS`, `GCP_PROJECT`, `GCP_REGION`
- Firebase: `FIREBASE_TOKEN` (for CI; locally use ADC)
- Vercel: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- AWS: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- Supabase: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`
Include only providers relevant to the selected components.

**`.gitignore`** — Append if not already present:
```
.env
*.tfvars
*-key.json
service-account*.json
.vercel
```

**After writing all files, print:**
```
✅ Deployment stack configured!
   Run: lc deploy prod
   Run: lc deploy staging
```
And list any credentials marked `NOT CONFIGURED` with their setup commands.

**Example `deploy.json` Schema:**
```json
{
  "environments": {
    "prod": { "command": "bash infra/deploy.sh prod", "project": "my-project-prod" },
    "staging": { "command": "bash infra/deploy.sh staging", "project": "my-project-staging" }
  },
  "components": { "frontend": "Firebase Hosting", "backend": "GCP Cloud Run", "db": "Cloud SQL", "secrets": "GCP Secret Manager" },
  "secrets": { "strategy": "adc+secret-manager", "keys": [] },
  "ci": null
}
```

---

### `/laneconductor deploy [env]`

Execute the deployment command for the specified environment.

**Logic:**
1. Read `conductor/deploy.json`.
2. Locate the command for the requested `env` (default: `prod`).
3. Execute the command in the terminal with `stdio: inherit`.
4. Log the output to `conductor/logs/deploy-<env>-<timestamp>.log`.

---

## The Filesystem-as-API Interface

The Skill Worker communicates state to the dashboard by writing specific bold markers in `index.md` or `plan.md`. The Sync Worker parses these markers and updates the database via the API.

| Marker | API Field | Purpose |
|--------|-----------|---------|
| `**Status**: [lane]` | `lane_status` | Moves the card on the Kanban board (e.g., `in-progress`, `review`). |
| `**Step**: [step]` | `phase_step` | Describes the current activity (e.g., `planning`, `coding`, `complete`). |
| `**Progress**: [0-100]%` | `progress_percent` | Sets the track's completion percentage. |
| `**Phase**: [text]` | `current_phase` | Names the current phase being worked on. |
| `**Summary**: [text]` | `content_summary` | A one-line summary of the current work/problem. |
| `**Waiting for reply**: [yes\|no]` | `waiting_for_reply` | Signals that a human comment needs an answer. |

### Completion Comment Convention

Every terminal lane-action outcome (`plan`, `implement`, `review`, `quality-gate`) appends
**exactly one** structured comment to `conversation.md` on completion, always authored `system`
and always leading with one of these three emoji as the very first character of the body (the
Inbox's classification matches on this leading character — see `/api/inbox`):

| Emoji | Meaning | Inbox bucket |
|-------|---------|--------------|
| `✅` | Success — no action needed, informational only | Recent activity |
| `⚠️` | Needs intervention — human should look at this | Needs your input |
| `❌` | Failed | Needs your input |

Format: `> **system**: <emoji> <one-line summary>.` — e.g.
`> **system**: ✅ Plan complete — moved to implement.` Don't double-post: if an earlier step in
the same run already posted a `⚠️`/`❌` comment for this outcome (e.g. the fundamentals-conflict
guardrail, or a quality-gate FAIL), that comment satisfies this convention on its own — no need
for a second one.

### `/laneconductor qualityGate [track_number]`

Verifies the implementation of a track against the project's quality standards. This command is usually invoked automatically by the worker when a track enters the `quality-gate` lane.

**Logic**:
1. Read `conductor/quality-gate.md` to understand the criteria.
2. Perform automated checks based on the criteria:
   - **Syntax**: Run linter or `node --check` on modified files.
   - **Existence**: Verify all files listed in `plan.md` phases actually exist.
   - **Configuration**: Ensure `.laneconductor.json` and `.env` are valid.
   - **Reachability**: Try to invoke any new commands or APIs introduced.
   - **Automated Tests**: Run the project's test suite (e.g., `npm test`).
   - **Coverage**: Verify if test coverage meets the required target (default 50%).
3. **Outcome**:
   - **PASS**: Move track to `done` lane, update `index.md` status to `success`.
   - **FAIL**: Move track back to `implement:queue`, list failures in `index.md` summary for the next implementation round.

---

### `/laneconductor move [track-number] [lane:status]`

Move a track to a different lane and optionally set its status (defaults to `queue` if moving lane).

**Usage**:
- `/laneconductor move NNN backlog` (Moves to backlog, status queue)
- `/laneconductor move NNN implement:queue` (Moves to implement, triggers auto-action)
- `/laneconductor move NNN plan:success` (Moves to plan, marks as done)

---

### `/laneconductor pulse [track-number] [status] [progress%] [summary?]`

Update the track status and progress by modifying its Markdown files. 

**Logic**:
1. Find `conductor/tracks/NNN-*/index.md`.
2. Update the following markers:
   - `**Status**: [status]`
   - `**Step**: [step]` (infer from context if not provided)
   - `**Progress**: [progress]%`
   - `**Summary**: [summary]` (or update the Problem/Solution section)
   - `**Waiting for reply**: no` (Always set to `no` after an AI response)
3. The Sync Worker will detect these changes and update the DB.

---

### `/laneconductor newTrack [name] [description]`

Registers a new track in the **file sync queue**. The sync worker processes it on next heartbeat.

1. Determine the next track number: check highest number in `conductor/tracks/file_sync_queue.md` (matching `### Track NNN:`) and existing `conductor/tracks/NNN-*/` folder names.
2. Create `conductor/tracks/NNN-slug/index.md` immediately (for fast feedback):
   ```markdown
   # Track NNN: [name]

   **Lane**: plan
   **Lane Status**: queue
   **Progress**: 0%
   **Phase**: New
   **Type**: [dev|marketing|sales|support|other]
   **Summary**: [description]
   ```
   Default `**Type**` to `dev` unless the user specified a type.
3. Append a typed entry to `conductor/tracks/file_sync_queue.md` (under `## Track Creation Requests`):
   ```markdown
   ### Track NNN: [name]
   **Status**: pending
   **Type**: track-create
   **Created**: [ISO timestamp]
   **Title**: [name]
   **Description**: [description]
   **Metadata**: { "priority": "medium", "assignee": null }
   ```
4. The sync worker detects the change (via chokidar or 5s heartbeat), creates the DB row, and moves the entry to `## Completed Queue`.
5. **Skill check for non-dev types**: if type is `marketing` or `sales`, check `.claude/skills/` for recommended skills:
   - Marketing: `social-content`, `copywriting`, `content-strategy`, `launch-strategy`
   - Sales: `sales-enablement`, `cold-email`
   - Print `⚠️ Track type 'marketing' works best with [skill] — not found in .claude/skills/` for each missing skill.
   - Print `✅ [skill] available` for each present skill.
6. Print: `✅ Track NNN queued in file_sync_queue.md. Worker will register in DB on next cycle.`

---

### `/laneconductor lock [track-number]`

Acquire a git lock and create an isolated worktree for safe parallel execution. Returns the `worktree_path` for the skill to use.

**Usage:**
```javascript
const { worktree_path } = await /laneconductor lock NNN
process.chdir(worktree_path)
// ... do work ...
await /laneconductor unlock NNN
```

---

### `/laneconductor unlock [track-number]`

Release a git lock and clean up the worktree created by the lock command. Always call this in a `finally` block to ensure cleanup.

**Usage:**
```javascript
try {
  const { worktree_path } = await /laneconductor lock NNN
  process.chdir(worktree_path)
  // ... do work ...
} finally {
  await /laneconductor unlock NNN
}
```

---

### `/laneconductor plan [track-number]`

Scaffold or refine the planning phase of a track (Spec + Plan).

0. **Claim the track immediately** — before any other work, write `**Lane**: plan` and `**Lane Status**: running` to `conductor/tracks/NNN-*/index.md`. Setting `**Lane**` explicitly (not just `**Lane Status**`) matters whenever this command is invoked directly rather than via the normal queued-worker path — e.g. a KPI-miss replan or a manual re-run — where the track may not already be sitting in the `plan` lane; without it the Kanban board shows the track running in the wrong column for the whole duration of the work. This prevents the worker from double-launching and shows activity in the UI.
1.  **Locate the Track**: Use the **Protocol: Locating Tracks**. If it has `**Status**: pending` in `file_sync_queue.md` and no folder exists yet, proceed to **Scaffold**.
2.  **Scaffold (if missing)**:
    - Create directory `conductor/tracks/NNN-slug/`
    - Create `index.md` (Title, Lane, Status: planning, Progress: 0%, Last Run: user)
    - Create `spec.md` (Problem, Requirements, Acceptance Criteria, **Data Model Changes** (if applicable))
    - Create `plan.md` (Phases, Tasks with ⏳)
    - Create `test.md` (Test Commands, Test Cases per phase, Acceptance Criteria checklist)
    - In `file_sync_queue.md`: update the entry's `**Status**: pending` → `**Status**: processed`.
3.  **Refine (if exists)**:
    - Read existing `spec.md`, `plan.md`, and `test.md` (**skip if `FRESH_SESSION: false`** and you already read them earlier this session — see **Protocol: Session Continuity** — e.g. a replan immediately following a brainstorm on the same session).
    - Check for human comments in `conversation.md` (always re-read this one). **If `conversation.md` contains a brainstorm thread** (lines starting with `> **system**: Brainstorm`), treat the Q&A dialogue as enriched requirements — incorporate answers into `spec.md`, `plan.md`, and `test.md` before finalising.
    - Flesh out missing requirements or phase details based on current codebase context.
    - **Fulfill test.md**: If `test.md` is missing, empty, or contains the generic `(Test cases to be added)` stub, you MUST fully scaffold/rewrite it using the **Track File Templates** format at the bottom of this file. Populating `test.md` with specific, real test cases for each phase in `plan.md` is a MANDATORY requirement of the planning phase. Never leave the test file empty or at the generic stub.
    - **Acceptance criteria must describe the user-facing outcome, never
      the scaffolding.** Every criterion has to be something a user could
      observe. Criteria that lock in a placeholder are forbidden — e.g.
      *"the worker logs the expected 'not yet implemented' message"*,
      *"no real code path is exercised"*, *"the dispatch is marked failed
      with that message"*. Those are satisfied by a stub, so the track can
      pass its own gate while the feature does not exist (this happened —
      see the quality-gate command's done-gate). Write *"a worker actually
      starts on the target machine"* instead.
    - **Deferring scope is fine; calling the track complete is not.** If a
      capability is intentionally out of this pass (FFU), it must NOT
      appear as a satisfiable acceptance criterion, and the plan must
      carry an explicit unchecked phase for it. A track with deferred
      Solution-level capability cannot later be marked `done` at 100%.
    - Update `test.md` with test cases for any new phases or requirements.
    - **Check for `## ❌ KPI MISS` in plan.md**: if present, this is a replanning cycle after a KPI failure. Read the failure data (target, actual, delta, snapshot) and use it as context. Generate a *different* hypothesis — new content angle, different channel, different CTA. Print: `♻️ Replanning with KPI data: target=X, actual=Y, delta=Z`. Append a new `## ❌ KPI MISS` entry (don't overwrite old ones).
4.  **KPI enforcement** (for `marketing` and `sales` tracks):
    - Read `**Type**` from index.md.
    - If type is `marketing` or `sales`: check spec.md for `## KPI` block.
    - If missing: print `⚠️ KPI block required for marketing/sales tracks` and write a stub `## KPI` section with TODOs.
    - Block transition to `on_success` until all required fields are filled: Target, Metric, Source, Threshold.
    - Required `## KPI` block format in spec.md:
      ```markdown
      ## KPI
      **Target**: <number>
      **Metric**: <label>
      **Source**: hn-api | reddit-api | manual | custom-url
      **Source Config**: <item_id=NNN or URL>
      **Threshold**: <number>
      **Window**: <e.g. 48h or 7d>
      **Maps To**: <metric name from conductor/kpis.md>   ← optional
      ```
5.  **Draft section** (for non-dev tracks):
    - After planning is complete for non-dev tracks: write a `## Draft` section to spec.md (alongside KPI and Requirements).
    - Draft = publish-ready content the human will execute (post text, email copy, social content).
    - Include a `### Publish Instructions` subsection with step-by-step numbered instructions.
    - Do NOT create a separate `draft.md` — everything stays in spec.md.
    - Moving the track to implement (drag or Run) IS the approval — no extra gate needed.
5b. **Fundamentals-conflict guardrail**: if, while planning, the track's requirements appear
    to conflict with or require a change to one of the project's fundamental docs
    (`product-guidelines.md`, `design-language.md`, `tech-stack.md`, `workflow.md`) — e.g. the
    requested UI contradicts the documented design tokens, or a dependency choice conflicts
    with the documented stack — do NOT silently edit that fundamental doc as part of this
    track's plan. Instead:
    - Append a comment to `conductor/tracks/NNN-*/conversation.md`:
      ```
      > **system**: ⚠️ FUNDAMENTALS CONFLICT — this track's [requirement] appears to require
      changing conductor/[doc].md ([specific conflict]). Continuing implementation as
      specified; doc not modified — please review whether conductor/[doc].md should be
      updated.
      ```
    - Note the same flag in `spec.md`'s Requirements section as an open item for human review.
    - This is **non-blocking** by default — the track continues through planning; a human
      reviews and decides whether to update the fundamental doc or adjust the track's approach.
6.  **Pulse**: Update DB status via `/laneconductor pulse NNN planning 0%`.
7.  **Transition**: Read `conductor/workflow.json`. Set `**Lane**` in `index.md` to exactly what is defined in `lanes.plan.on_success`. Then append a completion comment to
    `conversation.md` (see **Completion Comment Convention** below): if step 5b's
    fundamentals-conflict guardrail fired during this run, use
    `> **system**: ⚠️ Plan complete with a fundamentals conflict — see conversation above.`
    (don't double-post; the guardrail's existing comment plus this one line is enough
    context); otherwise use `> **system**: ✅ Plan complete — moved to <lane>.`

**🛑 BOUNDARY ENFORCEMENT**: Your job ends here. Do NOT start implementing code. Wait for the next worker cycle to pick up the track in its new lane.

---

### `/laneconductor brainstorm [track-number]`

Optional deepening step. Call this before `/laneconductor implement` when you want to explore requirements further via dialogue. Not a lane — can be run at any time.

**Flow:**
1. **Load all context** (**if `FRESH_SESSION: false`** — see **Protocol:
   Session Continuity** — **skip everything except `conversation.md`**;
   brainstorm is a repeated back-and-forth, so every question-answer round
   after the first is almost always a resumed session, but you still need
   the latest human reply): read `conductor/product.md`, `conductor/tech-stack.md`, `conductor/deployment-stack.md` (if present), `conductor/tracks/NNN-*/spec.md`, `plan.md`, `test.md`, and `conversation.md`
2. **Ask one clarifying question** — appended to `conductor/tracks/NNN-*/conversation.md` in this format:
   ```
   > **system**: Brainstorm requested. [Your question here]
   ```
3. Set `**Waiting for reply**: yes` in `index.md`
4. **Wait for human reply** in `conversation.md` (or via UI inbox)
5. Repeat: ask next question based on reply. One question per message.
6. When enough context is gathered (or human says "go ahead"), run `/laneconductor plan NNN` — it will read `conversation.md` and update `spec.md`/`plan.md`/`test.md` from the dialogue.

**What counts as "enough context":** requirements are unambiguous, acceptance criteria are clear, at least one test case per phase is implied.

**Also available as:** `lc brainstorm <track-number>` (writes initial trigger to `conversation.md`, sets `**Waiting for reply**: yes`)

---

### `/laneconductor implement [track-number]`

Execute implementation tasks. The Skill Worker communicates purely through files.

**Updated flow (uses lock/unlock):**

0. **Claim the track immediately** — before acquiring the lock, write `**Lane**: implement` and `**Lane Status**: running` to `conductor/tracks/NNN-*/index.md`. Setting `**Lane**` explicitly matters whenever this command is invoked directly on a track still sitting in an earlier lane (e.g. a human runs `/laneconductor implement NNN` right after planning, without an intervening move-to-implement step — this project's `workflow.json` keeps `plan.on_success: plan:success`, so a track does NOT land in the `implement` lane automatically) — without it, the Kanban board shows the track "running" in the wrong column for the whole duration of the work. This prevents the worker from double-launching and shows activity in the UI.
1.  **Locate the Track**: Use the **Protocol: Locating Tracks** (check `tracks-metadata.json` first) to find the track folder `conductor/tracks/NNN-*/`.
2.  **Acquire lock and worktree:**
   ```bash
   lock_result = /laneconductor lock {track_number}
   worktree_path = lock_result.worktree_path
   cd {worktree_path}
   ```

2. **Read existing context** (**skip entirely if `FRESH_SESSION: false`** —
   see **Protocol: Session Continuity** — except `conversation.md` and
   `last_run.log`, which you should always check for anything new since
   your last turn):
   - Read `conductor/tracks/NNN-*/plan.md` to understand phases
   - Read `conductor/tracks/NNN-*/spec.md` for technical details and `**Type**` 
   - Read `conductor/deployment-stack.md` (if present) for deployment context
   - Read `conductor/product-guidelines.md` (if present) for brand/style/UX principles
   - Read `conductor/design-language.md` (if present) for concrete design tokens/conventions
   - Read `conductor/tech-stack.md` (if present) for the project's languages/frameworks/deps
   - **TDD / test.md Self-Healing**: Check if `conductor/tracks/NNN-*/test.md` exists and contains real test cases. If it is missing, empty, or contains the generic `(Test cases to be added)` stub, you MUST generate and write a structured `test.md` with concrete test cases and commands for each phase in `plan.md` before writing any implementation code.
   - Read `conductor/tracks/NNN-*/test.md` — it drives the implementation order. **TDD Protocol**: for each phase, find its test cases in `test.md`, write the test code first, run the test and confirm it fails, then write minimal code to make it pass, then confirm green.
   - **CRITICAL**: Read `conductor/tracks/NNN-*/conversation.md` if it exists. Treat human comments as overriding instructions. (Always — even when resumed.)
   - **IMPORTANT**: Read `conductor/tracks/NNN-*/last_run.log` if it exists. This contains why the previous run failed. (Always — even when resumed.)
   - Update `index.md` to `**Status**: implement`

2b. **Skill check for non-dev tracks** (type = marketing or sales):
   - Check `.claude/skills/` for recommended skills:
     - Marketing: `social-content`, `copywriting`, `content-strategy`, `launch-strategy`
     - Sales: `sales-enablement`, `cold-email`
   - Print `⚠️ Track type 'marketing' works best with [skill] — not found in .claude/skills/` for missing.
   - Print `💡 Invoke /[skill] before writing content` for present skills.

3. **Non-dev track supervised implement**:
   - If `**Type**` is not `dev`: this is a supervised implement — do NOT write code.
   - Read `## Draft` from spec.md (written by the plan phase).
   - Output the full publish-ready content to the user with clear formatting.
   - Output the `### Publish Instructions` step-by-step.
   - Set `**Waiting for reply**: yes` in index.md.
   - The worker will detect "done" reply in conversation.md and automatically schedule the quality gate.
   - **Stop here** — do not transition the lane yourself. The worker handles the transition.

3b. **Fundamentals-conflict guardrail** (dev tracks): checked against the
   `product-guidelines.md`/`design-language.md`/`tech-stack.md` content loaded in step 2 — if
   what this track needs to build conflicts with, or implies a needed change to, one of those
   fundamental docs (or `workflow.md`), do NOT silently write code that contradicts them, and
   do NOT silently rewrite the fundamental doc either. Append the same `⚠️ FUNDAMENTALS CONFLICT`
   comment format used in `/laneconductor plan` to `conversation.md`, naming the specific doc
   and conflict. Non-blocking by default — continue implementing as specified unless the
   conflict is severe enough that proceeding would be actively wrong (in which case treat it
   like any other blocker: stop and flag for human input instead of guessing).

4. **Dev track: For each phase** (skip for non-dev tracks):
   - Implement tasks
   - **Before marking any task `[x]` or writing a "✅ Phase N complete" summary: actually
     run whatever verifies it, and look at the real output — a written-but-unexecuted test
     file, or a plausible-looking diff you reasoned about but never ran, is not verification.**
     This applies even when `test.md` has no predefined cases for this phase (the TDD
     Protocol above is not the only trigger for this rule) — if there's a real mechanism to
     exercise (a CLI flag, an API endpoint, a UI flow, a dispatch), run it for real and
     confirm the actual behavior, not just that the code compiles/parses. Found and
     documented the hard way on track 1087's Phase 6: an autonomous `implement` run marked a
     phase "✅ complete" with a plausible diff and two new test files, but the feature was
     non-functional (a hardcoded `null` broke the one code path meant to matter) and neither
     test file had actually been executed — one had a hard import error that any single run
     would have caught immediately.
   - Update `plan.md` (⏳ → ✅ per task as completed)
   - Update `index.md` `**Progress**` marker
   - Commit: `feat(track-NNN): Phase X - description`

5. **Dev track: On complete** (skip for non-dev tracks):
   - Same verification bar as step 4, for the track as a whole, before writing `## ✅ COMPLETE`.
   - Update `index.md` `**Progress**` marker to 100%.
   - **Transition**: Read `conductor/workflow.json`. Set `**Lane**` in `index.md` to exactly what is defined in `lanes.implement.on_success`.
   - Append `## ✅ COMPLETE` to `plan.md`.
   - Append a completion comment to `conversation.md` (see **Completion Comment Convention**):
     `> **system**: ✅ Implementation complete — moved to <lane>.`
   - Final commit: `feat(track-NNN): Implementation complete`

   Non-dev (supervised) tracks already set `**Waiting for reply**: yes` in step 3 — that
   `waiting_for_reply` marker is itself the Inbox signal (see **Completion Comment
   Convention** and `waiting_for_reply` in the marker table above), so no additional
   completion comment is needed there.

5. **Release lock and cleanup:**
   ```bash
   /laneconductor unlock {track_number}
   ```

**🛑 BOUNDARY ENFORCEMENT**: Never override the workflow. Use `workflow.json` as the sole authority for target lanes.
- If lock fails (already locked): Stop and report error
- If work fails: Still call unlock in finally block to ensure cleanup
- On exit: Update `**Lane Status**: success` or `queue` based on exit code

---

### `/laneconductor review [track-number]`

Structured review of a track against its plan and product guidelines. Posts the result as a comment by writing to the track's conversation file.

0. **Claim the track immediately** — write `**Lane**: review` and `**Lane Status**: running` to `conductor/tracks/NNN-*/index.md` before doing anything else (see `/laneconductor implement`'s step 0 for why `**Lane**` needs setting explicitly, not just `**Lane Status**`).
1. **Load Context** (**skip the first bullet if `FRESH_SESSION: false`** —
   see **Protocol: Session Continuity**; review often resumes the same
   session `implement` used, so this is worth checking — the second bullet
   always applies):
   - Read `plan.md`, `spec.md`, `test.md`, `product-guidelines.md`, `design-language.md`, and `deployment-stack.md` (if present).
   - Read `conversation.md` to see if previous review gaps were addressed or if the user provided specific instructions. (Always — even when resumed.)
2. **Evaluate**: Check implementation against requirements and guidelines.
   - **Secrets Policy**: Ensure no secrets are hardcoded or leaked in logs. Verify use of ADC/Secret Manager as specified in `deployment-stack.md`.
   - If `test.md` exists, run the test commands listed there. A FAIL verdict is mandatory if any test cases are failing.
3. **Post Review**: Append the review results to `conductor/tracks/NNN-*/conversation.md` as a
   single `> **system**: ...` comment (see **Completion Comment Convention**) — author `system`,
   not `claude`/`gemini`, and the emoji is the literal first character of the body, e.g.
   `> **system**: ✅ REVIEW PASSED` or `> **system**: ⚠️ REVIEW FAILED`, followed by the full
   write-up (test pass/fail summary if `test.md` was present, gaps if any) as `>`-prefixed
   continuation lines under that same comment — do not post the write-up as a second comment.
4. **Auto-lane transition**:
   - Read `conductor/workflow.json`.
   - If **PASS**: Set `**Lane**` to the value of `lanes.review.on_success` and `**Lane Status**` to `queue`. Append `## ✅ REVIEWED` to `plan.md`.
   - If **FAIL**: Set `**Lane**` to the value of `lanes.review.on_failure` and `**Lane Status**` to `queue`. Add `⚠️ Gaps` to `plan.md`.

---

### `/laneconductor quality-gate [track-number]`

Runs automated checks and updates status files based on results.

0. **Claim the track immediately** — write `**Lane**: quality-gate` and `**Lane Status**: running` to `conductor/tracks/NNN-*/index.md` before doing anything else (see `/laneconductor implement`'s step 0 for why `**Lane**` needs setting explicitly, not just `**Lane Status**`).
0b. **KPI window check** (early trigger warning):
   - Read `**KPI Check After**` from index.md. If it exists and is in the future:
     > "KPI window not reached — Xh remaining. Measuring now may give unreliable results. Run anyway? (y/n)"
   - If user says "n", stop. If "y", proceed.
   - If invoked automatically by the worker, the worker already checked the time — skip this warning.
1. **KPI measurement** (runs BEFORE code checks):
   - Read `**Type**` from index.md.
   - If type is non-dev (`marketing`, `sales`, `support`, `other`) OR spec.md has a `## KPI` block: run `conductor/measure.mjs` for this track.
   - `node conductor/measure.mjs --track NNN`
   - Write result back to index.md: `**KPI Actual**: N` and `**KPI Snapshot**: {JSON}`
   - **If KPI failed** (`passed: false`):
     - Append `## ❌ KPI MISS` to `plan.md`:
       ```markdown
       ## ❌ KPI MISS — [ISO timestamp]
       **Target**: T | **Actual**: N | **Delta**: -D | **Window**: W
       **Snapshot**: `{raw JSON}`
       ```
     - This is a terminal outcome (see **Completion Comment Convention**) — append to
       `conversation.md`: `> **system**: ❌ KPI miss — actual=N, target=T, threshold=TH.`
     - Transition to `on_failure` lane. **Do NOT run code checks.**
   - **If KPI passed**: append to `conversation.md`:
     `> **system**: KPI measurement: actual=N, target=T, threshold=TH, passed=true.` — no
     leading emoji here (this is not yet a terminal outcome; step 4's Post Results is the
     terminal comment for this run, and gets the emoji) — then continue to code checks below.
   - Dev tracks without a `## KPI` block: skip measurement entirely.
2. **Execute Checks**: Read `conductor/quality-gate.md` and the track's `test.md`. You MUST execute EVERY command listed in both files' "Automated Checks" / "Test Commands" sections as shell commands (using your Bash/terminal tool).
   - **The checkboxes in `quality-gate.md` are NOT a report — they are a
     checklist you must run.** That file ships with every box pre-ticked
     `[x]` and often a stale `Status: PASS` verdict from an earlier run.
     Those marks say nothing about *your* track. Re-run every command and
     judge only by output you personally saw. If you catch yourself
     reasoning "it's already checked" — stop; that is exactly the failure
     mode this warning exists for.
   - `test.md` test commands are the primary automated check for this specific track.
   - `quality-gate.md` commands apply project-wide quality standards.
   - **Deployment Safety**: Scan modified files for hardcoded secrets (API keys, tokens). Verify that `.gitignore` contains the patterns defined in the Zero-Secrets Policy.
   - If a command is missing from your system (e.g., `playwright` not installed), you MUST install it or report a failure.
   - Do NOT just mark them as checked; you must actually run the code and verify the output.
   - For non-dev tracks that passed KPI: skip code checks (there's no code to check).

   **2a. Run the product, not just the code.** Unit tests only prove code
   does what its author believed; they cannot tell you a feature is
   missing. If this track touched UI or any user-facing flow:
   - Run the project's browser/E2E suite if `quality-gate.md` names one
     (e.g. `npx playwright test`). A line reading "if UI changes exist,
     create/run tests" does **not** license writing one trivial passing
     test — if specs already exist, run those.
   - If there's no E2E suite, **drive the flow by hand once**: start the
     app, use the thing this track added, confirm the user-visible result,
     and record what you observed. A screenshot, or the real API/DB
     response, is evidence. "The code looks correct" is not.
   - **Restart long-running processes first.** Workers and the API server
     do not hot-reload; verifying against a process started before your
     change tests the *old* code and yields a false pass. This has caused
     several false verdicts in this repo.

   **2b. Stub / deferred-work scan.** Cheap, and catches the most damaging
   class of false pass:
   ```bash
   grep -rniE "not yet implemented|not implemented|TODO|FIXME|FFU|placeholder|stub" \
     --include="*.mjs" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" \
     conductor ui bin 2>/dev/null | grep -v node_modules
   ```
   - A hit inside a code path this track's `plan.md` marks `[x]` is a
     **FAIL**, not a note. A task is not done if the thing it claims to do
     prints "not yet implemented".
   - Also grep `index.md`/`plan.md`/`spec.md` for `FFU`, "deferred",
     "future", "stub". If any capability named in `spec.md`'s Solution is
     deferred, the track cannot reach `done` — see step 5.

   **2c. Judge against the user-facing promise, not the implementation.**
   Read `spec.md`'s Problem Statement and Solution and ask: *if a user did
   the thing this track promises, would it work?* Acceptance criteria that
   assert a placeholder ("logs the expected 'not yet implemented' message",
   "no real code path is exercised") are **not** met criteria — they
   describe scaffolding. Record them as a spec defect in `conversation.md`
   instead of passing the track on them.
3. **Self-Healing**: If a check fails but you can fix it (e.g., a syntax error or missing command), you MAY do so. However, before writing any fix:
   - **Write a failing test that reproduces the bug first.** The test must fail before you fix anything.
   - Then implement the fix.
   - Re-run to confirm the test now passes.
   - You MUST commit both the test and the fix together with `fix(quality-gate): [description]`.
   - You MUST post a comment to `conversation.md` explaining what failed and what was fixed.
4. **Post Results**: Append results to `conversation.md` as a single `> **system**: ...` comment
   (see **Completion Comment Convention**) — author `system`, and the emoji is the literal first
   character of the body: `> **system**: ✅ QUALITY GATE PASSED` on pass, or
   `> **system**: ❌ QUALITY GATE FAILED` (or `⚠️` if it needs human judgment rather than a
   straightforward retry) on fail, followed by the full results write-up as `>`-prefixed
   continuation lines under that same comment — do not post the write-up as a second comment.
5. **Transition**:
   - Read `conductor/workflow.json`.
   - **Done-gate — a track may only reach `done` at 100% if the feature
     actually works end to end.** Before setting a `done` lane, confirm
     all of:
     1. Step 2b's stub scan found nothing in `[x]` code paths.
     2. No capability named in `spec.md`'s Solution is marked FFU /
        deferred / future.
     3. Step 2a's real-product check was actually performed, with a
        recorded observation.
     If any fails, you MUST NOT mark the track `done`. Set the lane to
     `review` (or `on_failure`), keep `**Progress**` below 100%, and write
     what remains in `conversation.md`. Honestly documenting a deferral
     does **not** make a track complete — a track that shipped a stub and
     was marked `done: 100%` with an honest "SSH deferred (FFU)" note is
     the exact incident these rules were written for.
   - If **PASS**: Set `**Lane**` to the value of `lanes.quality-gate.on_success` and append `## ✅ QUALITY PASSED` to `plan.md`.
   - If **FAIL**: Set `**Lane**` to the value of `lanes.quality-gate.on_failure` and explain the failure in `conversation.md`.
   - Update `**Lane Status**` to `queue`.

---

### `/laneconductor remote-sync [track-number?]`

Bidirectional sync between the local filesystem and the configured Collector API. Uses a "newer wins" strategy based on modification timestamps.

- If the database version is newer: updates the local `index.md`.
- If the local file is newer: patches the API with the local changes.
- If no track number provided: syncs all tracks in the current project.

---

---

### `/laneconductor comment [track-number] [body]`

Post a comment on a track by writing to its conversation file.

1. Append `> **system**: [body]` to `conductor/tracks/NNN-*/conversation.md`.
2. The Sync Worker will sync this comment to the database.

---

### `/laneconductor delete [track-number]`

Permanently delete a track — removes it from the filesystem, database, and any git locks.

1. Find `conductor/tracks/NNN-*/` — print the track title so the user can confirm.
2. Delete the folder: `rm -rf conductor/tracks/NNN-*/`
3. Remove from `conductor/tracks/file_sync_queue.md` if present (mark entry as `**Status**: deleted` or remove the entry block entirely).
4. If `mode` is `local-api` or `remote-api`: call `DELETE /api/projects/:id/tracks/NNN` to remove from DB.
5. Remove any stale git lock: `conductor/.locks/NNN.lock`
6. Print: `✅ Track NNN deleted`

**Warning:** This is a hard delete — no undo. For soft-delete/archiving, move to backlog instead.

---

### `/laneconductor revert [track] [phase] [task?]`

Safe undo at track/phase/task level with DB sync.

Same logic as the conductor `revert` command, plus:
- After revert: re-parse `plan.md` → recalculate `progress_percent` → pulse DB
- If reverting a done track back to a phase: pulse `in-progress`

---

### `/laneconductor syncdb [--source <url>] [--target <url>]`

Migrate track comments between collectors — critical when switching from local-only to cloud, or between workspaces.

**Problem**: Track metadata (status, progress) re-syncs naturally from filesystem. But comments are DB-only, so switching collectors loses conversation history.

**Solution**: Export comments from source, apply schema to target, then import.

**Usage**:
```bash
# Export from local DB, import to cloud
node conductor/syncdb.mjs \
  --source "postgresql://localhost:5432/laneconductor?..." \
  --target "postgresql://cloud-db.supabase.co/postgres?..."

# Save export for manual inspection
node conductor/syncdb.mjs \
  --source "postgresql://localhost/laneconductor" \
  --export comments.json

# Import previously exported file
node conductor/syncdb.mjs \
  --target "postgresql://cloud-db.supabase.co/postgres" \
  --import comments.json
```

**What it does**:
1. Query source: `track_comments` join with tracks/projects
2. Map to target: find matching project + track_number, insert comment
3. Touch filesystem: updates plan.md mod times → worker re-syncs tracks
4. Instructions: user updates `.laneconductor.json` collectors config + runs `lc stop`, `lc start`

**Important**:
- Only comments are synced — tracks re-sync from disk automatically
- Schema must exist on target (created if missing)
- Duplicate detection: tries to find matching project/track by name; skips if not found
- User must manually update config + restart worker

---

### `/laneconductor remote-sync [track-num?]`

**Phase 5 Implementation** — Sync track changes from the Collector API back to local filesystem.

**Problem**: When using a remote Collector API/database, UI changes (dragging tracks to lanes, updating progress) happen in the DB but don't reach the local worker's filesystem. The worker can't see them.

**Solution**: A bidirectional sync mechanism where the Skill reads from the API and writes to local files.

**Usage**:
```bash
# Sync a single track from DB to file
/laneconductor remote-sync NNN

# Sync all tracks from DB to files
/laneconductor remote-sync
```

**What it does**:
1. Read `.laneconductor.json` for collector URL and project ID
2. Fetch tracks from `GET /api/projects/:id/tracks` endpoint
3. For each track returned:
   - Extract: `track_number`, `title`, `lane_status`, `lane_action_status`, `progress_percent`, `current_phase`
   - Find or create `conductor/tracks/NNN-*/index.md`
   - Update markers: `**Lane**`, `**Lane Status**`, `**Progress**`, `**Phase**`
   - Use regex to update existing markers or prepend new ones
4. Update `.conductor/tracks-metadata.json` with sync timestamps
5. Log results: number of tracks updated, any conflicts or errors
6. Automatically triggers Phase 6 to regenerate `conductor/tracks.md`

**Architecture**:
- **Skill reads API** (not DB directly) — ensures it works with both local and remote collectors
- **Writes local files** — respects filesystem-as-source-of-truth for worker
- **Timestamp-based conflict resolution** — newer timestamp (file vs DB) wins
- **Metadata tracking** — `conductor/.tracks-metadata.json` stores `last_db_update` per track for conflict resolution

**Only activates if**:
- `.laneconductor.json` has a `collectors` array with at least one configured collector
- Track files exist locally (creates them if missing, but won't create new track folders)

---

### `/laneconductor init-tracks-summary`

**Phase 6 Implementation** — Regenerate `conductor/tracks.md` from all track files.

**Problem**: `conductor/tracks.md` is an aggregate summary that needs to be kept in sync with all individual track files.

**Usage**:
```bash
# Regenerate full summary from all track files
/laneconductor init-tracks-summary
```

**What it does**:
1. Scan `conductor/tracks/` directory for all folders matching `NNN-*` pattern
2. For each track folder, read `NNN-*/index.md` and extract:
   - Track number and slug from folder name
   - Title from `**Title**` marker (fallback to slug)
   - Lane from `**Lane**` marker (default: 'planning')
   - Progress from `**Progress**` marker (default: 0%)
3. Generate `conductor/tracks.md` with:
   - Header: Last Updated timestamp (ISO format)
   - Summary line: Total tracks, counts per lane
   - Grouped sections by lane: planning, in-progress, review, quality-gate, backlog, done
   - Each track listed as: `- **NNN**: Title (XX%)`
4. Tracks sorted numerically within each lane

**Example output**:
```markdown
# Track Summary

Last Updated: 2026-02-27 13:11:20 UTC
Total Tracks: 34 | Planning: 4 | In-Progress: 2 | Review: 2 | Quality-Gate: 2 | Done: 20

## Planning
- **1011**: Update Product
- **1012**: Git Worktree Per Track (0%)

## In progress
- **NNN**: Sync Manager (45%)

...
```

**Trigger Points**:
- Automatically runs after `/laneconductor remote-sync`
- Can be run manually at any time
- Worker could trigger this after `/laneconductor pulse` updates a track

**Benefits**:
- Always reflects current state of all tracks (no stale summary)
- Grouped by lane for quick status overview
- Percentage progress shows at a glance what's done
- Baseline data for dashboard Kanban board

---

## Track File Templates

### `plan.md`
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

### `spec.md`
```markdown
# Spec: [Feature Name]

## Problem Statement
[What problem does this solve?]

## Requirements
- REQ-1: ...

## Acceptance Criteria
- [ ] Criterion 1

## API Contracts / Data Models
[If applicable]
```

### `index.md`
```markdown
# Track NNN: [Title]

**Status**: backlog
**Progress**: 0%

## Problem
[One sentence]

## Solution
[One sentence]

## Phases
- [ ] Phase 1: [name]
```

### `test.md`
```markdown
# Tests: Track NNN — [Title]

## Test Commands
```bash
# Run all tests
npm test

# Run specific test file
npm test -- path/to/test.spec.js
```

## Test Cases

### Feature: [Feature Name]
- [ ] TC-1: [Description] — expected: [outcome]
- [ ] TC-2: [Description] — expected: [outcome]

## Acceptance Criteria
- [ ] All unit tests pass
- [ ] No regressions in related features
```

---

## DB Schema Reference

```sql
CREATE TABLE IF NOT EXISTS projects (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  repo_path       TEXT UNIQUE NOT NULL,
  git_remote      TEXT,
  git_global_id   UUID UNIQUE,            -- UUID v5 from git_remote (URL namespace); null if no remote
  primary_cli     TEXT DEFAULT 'claude',  -- claude|agy|gemini|other
  primary_model   TEXT,
  secondary_cli   TEXT,                   -- optional second agent
  secondary_model TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tracks (
  id               SERIAL PRIMARY KEY,
  project_id       INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  track_number     TEXT NOT NULL,
  title            TEXT NOT NULL,
  lane_status      TEXT DEFAULT 'backlog',  -- backlog|in-progress|review|quality-gate|done
  progress_percent INTEGER DEFAULT 0,
  current_phase    TEXT,
  content_summary  TEXT,
  sync_status      TEXT DEFAULT 'synced',
  last_updated_by  TEXT DEFAULT 'human',
  last_heartbeat   TIMESTAMP DEFAULT NOW(),
  created_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, track_number)
);
```

---

## Status Badges → Lane Mapping

| Badge in plan.md | lane_status in DB |
|-----------------|-------------------|
| ⏳ IN PROGRESS  | `in-progress`     |
| ✅ QUALITY PASSED | `done`            |
| ✅ REVIEWED     | `on_success` lane from `workflow.json` (default: `quality-gate`) |
| ✅ COMPLETE (no open tasks) | `review` |
| 🔄 BLOCKED      | `review`          |
| ⚠️ PARTIAL      | `review`          |
| (none / new)    | `planning`        |
| (none in DB, explicitly backlog) | `backlog`         |

Note: `✅ COMPLETE` with all checkboxes ticked moves to `review` (ready for review). Only `✅ REVIEWED` (added automatically by the review skill on PASS) moves to `done`. New tracks created via `/laneconductor newTrack` or the UI land in `planning` (staging area) — drag to `in-progress` to start auto-implement, or drag to `backlog` to defer.

---

## Multi-Project Notes

- Each project has its own `.laneconductor.json` with its unique `project.id`
- All projects share one Postgres DB (`laneconductor`)
- The Vite UI shows all projects; heartbeat workers are per-project
- Project identity key = `repo_path` (absolute path)
- Run `setup collection` in each repo once; run `lc start` per active session

---

## Commit Convention

```
feat(track-NNN): brief description
fix(track-NNN): bug fix
docs(track-NNN): documentation
refactor: changes across multiple tracks
```

---

## Handling Automation Failures

If a track fails during automation (e.g. `auto-implement`), it will increment its retry count.
- **Max Retries**: Default is 1 (configured in `workflow.md`).
- **Blocking**: Once reached, `lane_action_status` becomes `blocked`.

**To Unblock/Reset:**
Perform ANY human intervention:
1. **Comment**: Add a message to the track thread (`/laneconductor pulse`).
2. **Move**: Drag the track to a different lane in the UI.
3. **Implement**: Click "Re-run Implement" in the UI.

The system adds a "Moved to [lane]" or "Human comment" marker which **resets the retry count to 0** for the worker.

---

## Dev Logging (Worker + API)

Track 1075: the heartbeat worker (`conductor/laneconductor.sync.mjs`) and the Collector API
(`ui/server/index.mjs`) each have a structured Pino logger (`conductor/services/logger.mjs` and
`ui/server/logger.mjs` respectively) that fans out to two destinations:

- **stdout** — unchanged from before; still captured into `conductor/.sync.log` / `ui/.api.log`
  by `bin/lc.mjs`'s spawn redirect, so existing `tail -f` workflows keep working.
- **A standalone Pinorama log viewer** — a live, searchable web UI showing both processes' logs
  together, filterable by `component` (`"worker"` or `"api"`).

**Why a standalone instance, not the documented `node app.js | pinorama` pipe**: both the worker
and API are detached background daemons managed by PID file (`lc worker start/stop`, `lc api
start/stop`), not a single foreground process — there's nothing to pipe. Instead, both loggers
ship to a persistently-running `pinorama --server` instance via `pinorama-transport` (an HTTP
transport target), started/stopped independently.

**Managing the viewer**:
```bash
lc logs start   # starts the standalone Pinorama server (port 6201)
lc logs stop
lc logs status
lc logs open    # starts it if needed, then opens http://localhost:6201 in a browser
```
`lc worker start`, `lc worker restart`, and `lc api start` all best-effort auto-start the log
viewer already — you usually don't need to call `lc logs start` yourself.

**Port/storage convention — do not reuse for anything else**: this runs on **port 6201** with its
own storage file (`<install-path>/.pinorama.msp`), deliberately different from the default port
(6200) and storage path a *managed project* might use for its own Pinorama instance (e.g.
coachai's `make local-start` pipes its dev server into `pinorama --open` on the default port).
The two must never collide — always use 6201 (or `LC_PINORAMA_PORT`) for LaneConductor's own
logs, never the default.

**Logging from worker/API code**: import the shared `logger` and call it like any Pino logger —
`logger.info({ trackNumber }, 'message')`, `logger.warn({ err }, 'message')`,
`logger.error({ err }, 'message')`. Only a handful of the noisiest existing `console.*` call
sites have been migrated so far (proof of concept, not a full migration) — new code should use
`logger` directly rather than `console.*`.

---

## Best Practices

1. **Keep index.md lean**: It is the "Status File" for the project. Always update it when status or progress changes.
2. **Fast Summary**: Avoid reading all `plan.md`/`spec.md` files for deep summaries. Use `/laneconductor summarize`.
3. **Phase Tracking**: Keep checkboxes in `plan.md` up to date. The sync worker uses these to calculate % progress automatically.

## Quick Reference

| Command | What it does |
|---------|-------------|
| `/laneconductor setup` | Run AI-powered scaffold |
| `/laneconductor setup scaffold` | Create context files (product.md, tech-stack.md, deployment-stack.md, etc.) |
| `/laneconductor setup-deploy` | AI-guided deployment setup (writes deployment-stack.md + deploy.json) |
| `/laneconductor deploy [env]` | Execute deployment for a specific environment (prod/staging/preview) |
| `/laneconductor qualityGate [NNN]` | Run automated quality checks |
| `/laneconductor start` | Start heartbeat worker (or: `lc start`) |
| `/laneconductor stop` | Stop heartbeat worker (or: `lc stop`) |
| `/laneconductor status` | Kanban board from DB (or: `lc status`) |
| `/laneconductor workflow` | Display lane automation config (transitions, retries, models) |
| `/laneconductor workflow set [lane] [key] [value]` | Edit a workflow setting in `conductor/workflow.json` |
| `/laneconductor newTrack [name] [desc]` | Create track + DB row |
| `/laneconductor updateTrack [NNN] [what]` | Add work/bug/feature to existing track, move back to backlog |
| `/laneconductor reportaBug [desc]` | Smart bug intake — updates existing track or creates new bug track |
| `/laneconductor featureRequest [desc]` | Smart feature intake — updates existing track or creates new feature track |
| `/laneconductor brainstorm [NNN]` | Optional pre-implement dialogue via conversation.md to deepen spec/plan |
| `/laneconductor implement [NNN]` | Execute track with DB sync |
| `/laneconductor revert [track] [phase]` | Safe undo + DB sync |
| `/laneconductor pulse [NNN] [status] [%] [summary]` | Manual DB update |
| `/laneconductor comment [NNN] [body]` | Post comment as AI agent (⚠️ BLOCKED / ℹ️ NOTE) |
| `/laneconductor delete [NNN]` | Hard-delete track: remove folder + DB row + git lock |
| `/laneconductor review [NNN]` | Review track against plan + guidelines → post result, auto-transition lane |
| `/laneconductor remote-sync [track-num?]` | Sync track changes from API to local files (Phase 5) |
| `/laneconductor init-tracks-summary` | Regenerate conductor/tracks.md from all track files (Phase 6) |
| `lc brainstorm <track>` | Start brainstorm dialogue for a track via conversation.md |
| `lc start` | Start heartbeat worker |
| `lc stop` | Stop heartbeat worker |
| `lc status` | Quick track list |
| `lc ui start` | Start Vite dashboard |
| `lc ui stop` | Stop Vite dashboard |

---

## Operating Mode Configuration

LaneConductor supports three operating modes, selected by the `mode` field in `.laneconductor.json`:

### 1. local-fs (pure filesystem)
The worker reads and writes Markdown files only. No Collector API or Database is required.
- **Set via**: `"mode": "local-fs"`
- **Best for**: Offline development, CI pipelines, and automated tests.
- **Workflow**: Progress is tracked via `**Lane**` and `**Lane Status**` markers in `index.md`.

### 2. local-api (local Postgres + Kanban UI)
The worker syncs with a local Collector API backed by a local Postgres database.
- **Set via**: `"mode": "local-api"`
- **Best for**: Daily development with the full Vite Kanban dashboard.
- **Workflow**: Full bidirectional sync between filesystem and local database.

### 3. remote-api (cloud / self-hosted)
Identical to local-api but connects to a remote Collector URL.
- **Set via**: `"mode": "remote-api"`
- **Best for**: Team collaboration and multi-machine setups.

### Auto-detection Rules
If the `mode` field is omitted from `.laneconductor.json`, LaneConductor infers the mode from the `collectors` array:
- **No collectors**: defaults to `local-fs`.
- **Collector URL contains `localhost` or `127.0.0.1`**: defaults to `local-api`.
- **Any other URL**: defaults to `remote-api`.

