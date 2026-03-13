---
name: laneconductor
description: Use this skill when the user invokes /laneconductor commands. Manages multi-project development with a live Kanban dashboard backed by local Postgres. Handles setup, track management, heartbeat sync, and DB-backed status updates. Extends the conductor workflow with real-time visibility across all repository projects.
user-invocable: true
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---
<!-- Portions of workflow protocols adapted from superpowers by Jesse Vincent (MIT License) -->

# LaneConductor Skill

**Sovereign Developer Environment** — real-time visibility into AI-driven development across multiple repositories. Tracks progress through a local Postgres database and displays it on a Vite Kanban dashboard (port 8090).

## Universal CLI (`lc`)

LaneConductor provides a global `lc` command to manage your projects without relying on an LLM or per-project Makefiles.

### Installation
```bash
cd ~/Code/laneconductor
make install-cli
```

### Core Commands
- `lc start [sync-only]`: Start the heartbeat worker. Use `sync-only` to disable auto-polling for queued tracks.
- `lc stop`: Stop the heartbeat worker.
- `lc status`: Show a Kanban board of tracks in the terminal.
- `lc ui [start|stop]`: Manage the Vite dashboard.
- `lc new "Title" "Description"`: Create a new track.
- `lc setup`: Initialize a new project with LaneConductor.

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
- **`laneconductor/`** — this Claude skill (AI instructions + heartbeat worker)
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
Runs `setup scaffold`.

**Note**: Infrastructure setup (DB, AI agents, git remote), registration, and `.env` generation are handled by the `lc setup` CLI command. You should run `lc setup` in your terminal *before* invoking this skill command.

---

### `/laneconductor setup scaffold`

Generates the `conductor/` folder structure and project context files using AI reasoning.

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
   - `code_styleguides/` — inferred from `.eslintrc`, `.prettierrc`, `tsconfig.json` if present

**Mode B — New project:**
Ask a short questionnaire:
- What does this project do? Who are the users?
- What language/framework/database will you use?
- TDD? Commit strategy? Branching model?
- Any brand/style standards?

Generate all conductor files with content from answers, including a stub for `deployment-stack.md`.

**Both modes create:**
```
conductor/
├── tracks/
├── code_styleguides/
├── product.md
├── product-guidelines.md
├── tech-stack.md
├── deployment-stack.md
├── workflow.md
├── tracks.md
└── laneconductor.sync.mjs
```
Also:
- Create `.claude/MEMORY.md` if not present
- **Symlink the skill into this project** so Claude can invoke it locally:
  ```bash
  SKILL_DIR=$(cat ~/.laneconductorrc 2>/dev/null || echo "$HOME/Code/laneconductor/.claude/skills/laneconductor")
  TARGET=".claude/skills/laneconductor"
  # Skip if this IS the laneconductor repo (skill is already the real file here)
  if [ "$(realpath $TARGET 2>/dev/null)" = "$(realpath $SKILL_DIR 2>/dev/null)" ]; then
    echo "ℹ️  Skill already present (this is the laneconductor repo)"
  else
    mkdir -p .claude/skills
    ln -sf "$SKILL_DIR" "$TARGET"
    echo "✅ Skill symlinked → $TARGET → $SKILL_DIR"
  fi
  ```
  This means the skill is loaded from the project's own `.claude/skills/` and always reflects
  the latest version from the laneconductor repo without any per-project copying.

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
   **Summary**: Imported from previous conductor tool
   ```
5. Copy or symlink the original folder content alongside (or leave original README.md in place)
6. Print: `✅ Imported NNN tracks → conductor/tracks/NNN-*/`

The heartbeat worker will then pick them up via `ignoreInitial: false` on next `lc start`.

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
   - `LC Cloud Token (lc_xxxx...):` ← stored in `.env` as `COLLECTOR_1_TOKEN` (if Both) or `COLLECTOR_0_TOKEN` (if LC cloud only), NOT in config.
   - The default URL for LC cloud is `https://collector.laneconductor.io`.

   Write all tokens to `.env` (create if absent; never overwrite existing values without prompting).
   Ensure `.gitignore` exists and contains `.env` and `.laneconductor.json`.

3. **Primary agent** — ask which CLI drives this project (`claude` / `gemini` / `other`).
   Then:
   a. **Verify reachability** by running the version check:

   | Agent  | Check command                     | Passes if               |
   |--------|-----------------------------------|-------------------------|
   | claude | `claude --version`                | exits 0, prints version |
   | gemini | `npx @google/gemini-cli --version`| exits 0, prints version |
   | other  | ask for CLI command, then run it  | exits 0                 |

   **On success:** print `✅ <agent> reachable — <version>`
   **On failure:** warn, ask `Continue anyway? [y/N]:` — abort if N.

   b. **Discover models dynamically** — do NOT present a hardcoded list (except for Claude).
   For Claude, the CLI uses aliases. Do not run a discovery command. Instead, recommend:
   - `haiku`: Claude 3.5 Haiku
   - `sonnet`: Claude 3.7 Sonnet
   - Leave blank/default for system recommendation.

   For others, run a one-shot prompt to get current models:

   | Agent  | Discovery command |
   |--------|------------------|
   | gemini | `npx @google/gemini-cli -p "List the available Gemini model IDs as a plain newline-separated list, no commentary"` |
   | other  | ask user: `Model name (leave blank to set later):` |

   Parse the output and present the discovered model IDs as choices.
   If discovery fails or times out (>15s), fall back to asking the user to type a model name.
   Always allow free-text entry as a fallback.

   c. Ask: `Primary model [default]:` (emphasize that blank = best default)

4. **Secondary agent** (optional) — ask `Add a secondary AI CLI? (none / claude / gemini / other)`.
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
    "secondary": { "cli": "gemini", "model": "<selected-model>" },
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

## Lane Action State Machine

Each lane (except Backlog and Done) has an automated action:
- **Planning**: AI fleshes out `spec.md` and `plan.md` (triggered when 0% and 'waiting').
- **In-Progress**: AI implements the phases (triggered when 'waiting').
- **Review**: AI performs automated review (triggered when 'waiting').

Dragging a card to a lane in the UI resets `lane_action_status` to `'waiting'`, triggering the corresponding action. The worker transitions it to `'running'` while active, and `'done'` or `'waiting'` (on failure) when finished.

7. UPSERT the project row *(local-api only — skip for local-fs; for remote-api the collector handles this on first heartbeat)*
   Include `primary_cli`, `primary_model`, `secondary_cli`, `secondary_model`, and `create_quality_gate`. Retrieve the generated `id` and write it back to `.laneconductor.json` under `project.id`.

   **`git_global_id`** — a UUID v5 derived deterministically from `git_remote` (URL namespace, RFC 4122). It provides a stable cross-machine project identity — the same remote URL on any machine always produces the same UUID. It is NOT stored in `.laneconductor.json` (always derived from the remote). The collector auto-populates this column on startup when `git_remote` is set; you do not need to pass it in the psql UPSERT.

```bash
# psql approach:
psql -h <host> -p <port> -U <user> -d <dbname> -f /tmp/laneconductor_schema.sql
```

---

### `/laneconductor activate` (or `start`) [sync-only]

Start the heartbeat worker.

1. Verify `.laneconductor.json` exists — if not, tell user to run `setup collection` first
2. Check `conductor/.sync.pid` — warn if process already running
3. Ensure `pg` and `chokidar` are installed: `npm install --save-dev pg chokidar`
4. Start: `node conductor/laneconductor.sync.mjs [--sync-only] &` and save PID

If `sync-only` is provided, the worker will only perform file↔API synchronization and will NOT poll the database for queued tracks to execute.

Print:
```
✅ LaneConductor heartbeat started (PID: XXXX) [sync-only: yes/no]
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

Query Postgres and render a Kanban board in the terminal.

1. Read `.laneconductor.json`
2. Query: `SELECT track_number, title, lane_status, progress_percent, current_phase, last_heartbeat FROM tracks WHERE project_id = :project_id ORDER BY track_number`
3. Display grouped by lane:

```
╔══════════════════════════════════════════════════════════════════╗
║  Project: my-app  │  2026-02-23 14:32                            ║
╠══════════╦════════════════╦═════════════╦═══════════════════════╣
║ BACKLOG  ║  IN PROGRESS   ║   REVIEW    ║        DONE           ║
╠══════════╬════════════════╬═════════════╬═══════════════════════╣
║ 003-auth ║ 001-dashboard  ║ 002-api     ║                       ║
║          ║   45% ⏳ 3s ago ║  90% ⚠️     ║                       ║
╚══════════╩════════════════╩═════════════╩═══════════════════════╝
```

Show "last beat: Xs ago" for in-progress tracks.

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

### `/laneconductor setup-deploy`

AI-guided wizard to configure deployment context and commands.

**Logic:**
1. **Scan**: Detect existing deployment signals:
   - `deploy.sh`, `Makefile` (look for `deploy` targets), `firebase.json`, `vercel.json`, `Dockerfile`, `fly.toml`, `railway.json`.
   - `.github/workflows/`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml`.
   - `cloud-run.yaml`, `kubernetes/`, `terraform/`, `infra/`.
2. **Interview**: Ask targeted questions to define the deployment topology per layer.
   - **Preset Selection**: Offer shorthand presets (`firebase-full`, `gcp-cloud-run`, `gcp-full-stack`, `vercel`, `aws-serverless`, `supabase`).
   - **Component Selection**: If no preset, or if customized, ask per layer:
     - **Frontend**: Firebase Hosting / Vercel / GCP Cloud Storage / S3+CloudFront / none.
     - **Backend**: GCP Cloud Run / AWS Lambda / Vercel Functions / Firebase Functions / none.
     - **Database**: Cloud SQL / Supabase / RDS / PlanetScale / none.
     - **Secrets**: GCP Secret Manager / AWS Secrets Manager / Azure Key Vault / Vercel env vars / Supabase Vault.
3. **Verify Credentials**: Run provider-specific identity checks and document result.
   - **GCP**: `gcloud auth list` and `gcloud auth application-default print-access-token`.
   - **AWS**: `aws sts get-caller-identity`.
   - **Vercel**: `vercel whoami`.
   - **Supabase**: `supabase projects list`.
   - **Firebase**: `firebase projects:list`.
4. **Scaffold**:
   - **deployment-stack.md**: Write verified topology, environments, and secrets policy.
   - **deploy.json**: Map environments to commands (e.g., `bash infra/deploy.sh prod`). Offer to wrap existing scripts.
   - **.env.example**: Generate with required CI env var names (e.g., `GOOGLE_APPLICATION_CREDENTIALS`, `VERCEL_TOKEN`) and comments. **NEVER prompt for or write actual secret values.**
   - **.gitignore**: Append secrets patterns (`.env`, `*.tfvars`, `*-key.json`, `.vercel`).

**Example `deploy.json` Schema:**
```json
{
  "template": "gcp-cloud-run",
  "environments": {
    "prod": {
      "command": "bash infra/deploy.sh prod",
      "project": "my-project-prod"
    },
    "staging": {
      "command": "bash infra/deploy.sh staging",
      "project": "my-project-staging"
    }
  },
  "secrets": {
    "strategy": "adc+secret-manager",
    "keys": ["DB_PASSWORD", "STRIPE_KEY"]
  },
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
   **Summary**: [description]
   ```
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
5. Print: `✅ Track NNN queued in file_sync_queue.md. Worker will register in DB on next cycle.`

---

### `/laneconductor plan [track-number]`

The "Planning" phase — handles initial scaffolding and ongoing plan updates.

1. **Load Context**:
   - Read `conductor/tracks/file_sync_queue.md` and any existing track files.
2. **Scaffold/Update Files**:
   - If the track folder doesn't exist, create `conductor/tracks/NNN-[slug]/`.
   - Write or update `index.md`, `spec.md`, and `plan.md`.
   - Use `**Status**: plan` and `**Progress**: 10%`.
3. **Cleanup**:
   - Update `conductor/tracks/file_sync_queue.md`: Mark entry for this track as `**Status**: processed`.
4. **Print**: `✅ Planning updated for Track NNN.`

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

0. **Claim the track immediately** — before any other work, write `**Lane Status**: running` to `conductor/tracks/NNN-*/index.md`. This prevents the worker from double-launching and shows activity in the UI.
1.  **Locate the Track**: Use the **Protocol: Locating Tracks**. If it has `**Status**: pending` in `file_sync_queue.md` and no folder exists yet, proceed to **Scaffold**.
2.  **Scaffold (if missing)**:
    - Create directory `conductor/tracks/NNN-slug/`
    - Create `index.md` (Title, Status: planning, Progress: 0%)
    - Create `spec.md` (Problem, Requirements, Acceptance Criteria, **Data Model Changes** (if applicable))
    - Create `plan.md` (Phases, Tasks with ⏳)
    - Create `test.md` (Test Commands, Test Cases per phase, Acceptance Criteria checklist)
    - In `file_sync_queue.md`: update the entry's `**Status**: pending` → `**Status**: processed`.
3.  **Refine (if exists)**:
    - Read existing `spec.md`, `plan.md`, and `test.md`.
    - Check for human comments in `conversation.md`. **If `conversation.md` contains a brainstorm thread** (lines starting with `> **system**: Brainstorm`), treat the Q&A dialogue as enriched requirements — incorporate answers into `spec.md`, `plan.md`, and `test.md` before finalising.
    - Flesh out missing requirements or phase details based on current codebase context.
    - Update `test.md` with test cases for any new phases or requirements.
4.  **Pulse**: Update DB status via `/laneconductor pulse NNN planning 0%`.

---

### `/laneconductor brainstorm [track-number]`

Optional deepening step. Call this before `/laneconductor implement` when you want to explore requirements further via dialogue. Not a lane — can be run at any time.

**Flow:**
1. **Load all context**: read `conductor/product.md`, `conductor/tech-stack.md`, `conductor/deployment-stack.md` (if present), `conductor/tracks/NNN-*/spec.md`, `plan.md`, `test.md`, and `conversation.md`
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

0. **Claim the track immediately** — before acquiring the lock, write `**Lane Status**: running` to `conductor/tracks/NNN-*/index.md`. This prevents the worker from double-launching and shows activity in the UI.
1.  **Locate the Track**: Use the **Protocol: Locating Tracks** (check `tracks-metadata.json` first) to find the track folder `conductor/tracks/NNN-*/`.
2.  **Acquire lock and worktree:**
   ```bash
   lock_result = /laneconductor lock {track_number}
   worktree_path = lock_result.worktree_path
   cd {worktree_path}
   ```

2. **Read existing context:**
   - Read `conductor/tracks/NNN-*/plan.md` to understand phases
   - Read `conductor/tracks/NNN-*/spec.md` for technical details
   - Read `conductor/deployment-stack.md` (if present) for deployment context (ADC, Secret Manager, target runtime)
   - Read `conductor/tracks/NNN-*/test.md` if it exists — it drives the implementation order. **TDD Protocol**: for each phase, find its test cases in `test.md`, write the test code first (before any implementation), run the test and confirm it fails (feature missing, not a typo), then write minimal code to make it pass, then confirm green. A phase is not complete until its `test.md` test cases pass. If no test cases exist for a phase, proceed without this step.
   - **CRITICAL**: Read `conductor/tracks/NNN-*/conversation.md` if it exists. This contains the human-to-AI conversation history. Treat human comments as overriding instructions or blocker resolutions.
   - **IMPORTANT**: Read `conductor/tracks/NNN-*/last_run.log` if it exists. This contains why the previous run failed.
   - Update `index.md` to `**Status**: implement`

3. **For each phase:**
   - Implement tasks
   - Update `plan.md` (⏳ → ✅ per task as completed)
   - Update `index.md` `**Progress**` marker
   - Commit: `feat(track-NNN): Phase X - description`

4. **On complete:**
   - Update `index.md` to `**Status**: review` and `**Progress**: 100%`
   - **IMPORTANT**: **NEVER** mark a track as `done` yourself. The implementation agent MUST always move to `review`. Only the `review` and `quality-gate` agents (or humans) are permitted to move a track to `done`.
   - **Workflow Config**: The transitions (e.g., `implement` → `review`) are defined in `conductor/workflow.json`. The heartbeat worker will enforce these upon exit, but you should move to `review` in `index.md` to indicate you are ready for the next stage.
   - Append `## ✅ COMPLETE` to `plan.md`.
   - Final commit: `feat(track-NNN): Implementation complete`

5. **Release lock and cleanup:**
   ```bash
   /laneconductor unlock {track_number}
   ```

**Error handling:**
- If lock fails (already locked): Stop and report error
- If work fails: Still call unlock in finally block to ensure cleanup
- On exit: Update `**Lane Status**: success` or `queue` based on exit code

---

### `/laneconductor review [track-number]`

Structured review of a track against its plan and product guidelines. Posts the result as a comment by writing to the track's conversation file.

0. **Claim the track immediately** — write `**Lane Status**: running` to `conductor/tracks/NNN-*/index.md` before doing anything else.
1. **Load Context**:
   - Read `plan.md`, `spec.md`, `test.md`, `product-guidelines.md`, and `deployment-stack.md` (if present).
   - Read `conversation.md` to see if previous review gaps were addressed or if the user provided specific instructions.
2. **Evaluate**: Check implementation against requirements and guidelines.
   - **Secrets Policy**: Ensure no secrets are hardcoded or leaked in logs. Verify use of ADC/Secret Manager as specified in `deployment-stack.md`.
   - If `test.md` exists, run the test commands listed there. A FAIL verdict is mandatory if any test cases are failing.
3. **Post Review**: Write the review results into `conductor/tracks/NNN-*/conversation.md` (append to it). Include test pass/fail summary if `test.md` was present.
4. **Auto-lane transition**:
   - Read `conductor/workflow.json` and check `lanes.review.on_success` / `lanes.review.on_failure` for the correct target lanes. **Never jump to `done` unless `on_success` explicitly says `done`.**
   - If **PASS**: Set `**Lane**` to the `on_success` lane (default: `quality-gate`) and `**Lane Status**` to `queue`. Append `## ✅ REVIEWED` to `plan.md`.
   - If **FAIL**: Set `**Lane**` to the `on_failure` lane (default: `implement`) and `**Lane Status**` to `queue`. Add `⚠️ Gaps` to `plan.md`.

---

### `/laneconductor quality-gate [track-number]`

Runs automated checks and updates status files based on results.

0. **Claim the track immediately** — write `**Lane Status**: running` to `conductor/tracks/NNN-*/index.md` before doing anything else.
1. **Execute Checks**: Read `conductor/quality-gate.md` and the track's `test.md`. You MUST execute EVERY command listed in both files' "Automated Checks" / "Test Commands" sections as shell commands (using your Bash/terminal tool).
   - `test.md` test commands are the primary automated check for this specific track.
   - `quality-gate.md` commands apply project-wide quality standards.
   - **Deployment Safety**: Scan modified files for hardcoded secrets (API keys, tokens). Verify that `.gitignore` contains the patterns defined in the Zero-Secrets Policy.
   - If a command is missing from your system (e.g., `playwright` not installed), you MUST install it or report a failure.
   - Do NOT just mark them as checked; you must actually run the code and verify the output.
2. **Self-Healing**: If a check fails but you can fix it (e.g., a syntax error or missing command), you MAY do so. However, before writing any fix:
   - **Write a failing test that reproduces the bug first.** The test must fail before you fix anything.
   - Then implement the fix.
   - Re-run to confirm the test now passes.
   - You MUST commit both the test and the fix together with `fix(quality-gate): [description]`.
   - You MUST post a comment to `conversation.md` explaining what failed and what was fixed.
3. **Post Results**: Append results to `conversation.md`.
4. **Transition**:
   - If **PASS**: Update `index.md` to `**Status**: done` and append `## ✅ QUALITY PASSED` to `plan.md`.
   - If **FAIL**: Keep in `quality-gate` status.

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

1. Append `> **claude**: [body]` to `conductor/tracks/NNN-*/conversation.md`.
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
  primary_cli     TEXT DEFAULT 'claude',  -- claude|gemini|other
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
| `/laneconductor comment [NNN] [body]` | Post comment as Claude (⚠️ BLOCKED / ℹ️ NOTE) |
| `/laneconductor delete [NNN]` | Hard-delete track: remove folder + DB row + git lock |
| `/laneconductor review [NNN]` | Review track against plan + guidelines → post result, auto-transition lane |
| `/laneconductor remote-sync [track-num?]` | Sync track changes from API to local files (Phase 5) |
| `/laneconductor init-tracks-summary` | Regenerate conductor/tracks.md from all track files (Phase 6) |
| `lc brainstorm <track>` | Start brainstorm dialogue for a track via conversation.md |
| `lc install` | Install pg + chokidar deps |
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

