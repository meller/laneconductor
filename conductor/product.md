# Product: LaneConductor

## What It Does
LaneConductor is a local-first "Control Plane" for AI developer agents. It gives developers real-time visibility into AI-driven work across multiple repositories through a Kanban dashboard backed by a local Postgres database.

## Users
- Solo developers using agentic AI tools (Claude Code, etc.)
- Founders running multiple AI-driven feature branches simultaneously
- Privacy-conscious engineers who won't send project metadata to third-party SaaS

## Core Goals
- **Visibility**: Know what the AI agent is doing without reading terminal output
- **Multi-project**: Track progress across all your repos from one dashboard
- **Sovereign**: 100% local — no cloud, no auth, no cost
- **Agent-First**: Designed specifically for the workflow of AI coding assistants

## Three Operating Modes

LaneConductor supports three operating modes, selected by `config.mode` in `.laneconductor.json` (or auto-detected from the collector URL):

| Mode | `config.mode` | When to use | DB / UI needed? |
|------|--------------|-------------|-----------------|
| **local-fs** | `"local-fs"` | Offline, CI, testing — no API or DB | No |
| **local-api** | `"local-api"` | Daily development with the Kanban dashboard | Yes (localhost) |
| **remote-api** | `"remote-api"` | Multi-machine / cloud collector | Yes (remote URL) |

### Mode 1: local-fs (pure filesystem)
The worker reads and writes Markdown files only. No Collector API is called.
Ideal for CI pipelines, offline environments, and automated tests.

```json
{ "mode": "local-fs",
  "project": { "name": "my-app", "id": null, "repo_path": "/path/to/repo",
               "primary": { "cli": "claude", "model": "sonnet" } },
  "collectors": [], "ui": { "port": 8090 } }
```

### Mode 2: local-api (local Postgres + Kanban UI)
The worker syncs with a local Express Collector (`localhost:8091`) backed by Postgres.
Provides the full Kanban dashboard at `http://localhost:8090`.
Git lock/worktree coordination prevents double-claiming tracks across workers.

```json
{ "mode": "local-api",
  "project": { "name": "my-app", "id": 1, "repo_path": "/path/to/repo",
               "primary": { "cli": "claude", "model": "sonnet" } },
  "collectors": [{ "url": "http://localhost:8091", "token": null }],
  "ui": { "port": 8090 } }
```

### Mode 3: remote-api (cloud / self-hosted collector)
Identical to local-api from the worker's perspective — just a remote URL.
Use when the collector runs on a separate machine or cloud instance.

```json
{ "mode": "remote-api",
  "project": { "name": "my-app", "id": 42, "repo_path": "/path/to/repo",
               "primary": { "cli": "claude", "model": "sonnet" } },
  "collectors": [{ "url": "https://collector.example.com", "token": "lc_xxx" }],
  "ui": { "port": 8090 } }
```

**Auto-detection** (when `config.mode` is omitted):
- No collectors → `local-fs`
- Collector URL contains `localhost` or `127.0.0.1` → `local-api`
- Any other URL → `remote-api`

---

## File Roles — Separation of Concerns

Every file in the conductor system has one owner and one purpose. Claude agents must respect these boundaries.

| File | Written by | Read by | Role |
|------|-----------|---------|------|
| `conductor/tracks/file_sync_queue.md` | humans, Claude, API | sync worker only | **Filesystem message bus** — pending operations queue (new tracks, config changes, etc.) |
| `conductor/tracks/NNN-slug/index.md` | Claude agents only | sync worker | **Per-track state** — source of truth for lane, progress, summary |
| `conductor/tracks/NNN-slug/plan.md` | Claude agents only | Claude agents | Implementation phases and task checklist |
| `conductor/tracks/NNN-slug/spec.md` | Claude agents only | Claude agents | Technical requirements and acceptance criteria |
| `conductor/tracks/NNN-slug/conversation.md` | humans + Claude | Claude agents, sync worker | Per-track human↔AI conversation |
| `conductor/tracks/tracks.md` | sync worker only | humans, Claude | **Generated summary view** — never write to directly |
| `conductor/workflow.json` | humans, Claude | sync worker | Machine-readable automation config (lane transitions, retries, models) |
| `.laneconductor.json` | sync worker + CLI | sync worker | Project identity and collector config |
| `conductor/product.md` | humans, Claude | Claude agents | Product description and architecture reference |
| `conductor/tech-stack.md` | humans, Claude | Claude agents | Technology choices and stack decisions |
| `conductor/quality-gate.md` | humans, Claude | Claude agents (quality-gate phase) | Quality gate check definitions |
| `conductor/code_styleguides/*.md` | humans, Claude | Claude agents | Coding standards per language |

**Rules:**
- Only the **sync worker** writes `tracks.md` — it is a view, not a source
- Only **Claude agents** write `index.md` — they own per-track state
- Only **humans/Claude/API** produce entries in `file_sync_queue.md` — the worker is the sole consumer
- `.laneconductor.json` is written by the sync worker (on registration/token update) and the CLI (on setup) — never by Claude agents

---

The sync worker (`laneconductor.sync.mjs`) sits at the center of two queue channels. Each track moves through a standardized lifecycle from intake to completion (Intake → Plan → Implement → Review → Quality Gate → Done).

```
Filesystem side                           DB side
───────────────                           ───────
file_sync_queue.md ──→ sync worker ←── file_sync_queue (Postgres table)
  (fs → DB queue)           │              (DB → fs queue)
                            ↕
                        Postgres
                    (projects, tracks,
                     workers, comments)
```

### Disk → DB (chokidar watchers)
All file changes flow to the DB via chokidar:

| Watched file | Synced to |
|-------------|-----------|
| `tracks/NNN-slug/index.md` | `tracks` table (lane, progress, summary) |
| `tracks/NNN-slug/conversation.md` | `track_comments` table |
| `tracks/file_sync_queue.md` | Worker processes entries → creates folders + DB rows |
| `product.md`, `tech-stack.md`, `product-guidelines.md`, `quality-gate.md` | `conductor_files` JSONB column |
| `code_styleguides/*.md` | `conductor_files` JSONB column |
| `workflow.json` | In-memory reload (automation config) |
| `.laneconductor.json` | In-memory reload (collector config) |

### DB → Disk (file_sync_queue Postgres table)
API operations that need to reach disk go through the DB queue → worker polls every 5s:

| Trigger | File written |
|---------|-------------|
| New track created in UI | `tracks/file_sync_queue.md` entry → worker creates `NNN-slug/index.md` |
| Human comment in UI | `tracks/NNN-slug/conversation.md` append |
| Config changed in UI | `.laneconductor.json` overwrite |
| Quality gate enabled | `conductor/quality-gate.md` create |

### file_sync_queue.md — Message Format
Each entry is a typed message with status lifecycle:

```markdown
## Track 1026: Machine Workers View
**Type**: new-track
**Lane**: planning
**Lane Status**: pending
**Created**: 2026-03-05T10:00:00Z
**Description**: Show all workers across projects in All Projects mode

## .laneconductor.json
**Type**: config-change
**Status**: pending
**Created**: 2026-03-05T10:05:00Z
**Change**: primary_model = sonnet
```

Worker updates status in-place: `pending` → `processing` → `done` | `error`. Old `done` entries are pruned after 7 days.

---

## High-Level Architecture & Features
LaneConductor bridges localized Markdown definitions (read/written by LLMs) with persistent Postgres databases (read/written by UIs) via a strict **Bidirectional Sync Loop** using the **Filesystem-as-API** principle.

1. **Skill Worker (The Brains)**:
   - Your local LLM agent (e.g., Claude via `/laneconductor` commands) or a human developer.
   - **Role:** Deep reasoning, writing code, executing automated quality-gate checks.
   - **Stateless/Plumbing-free:** The Brains MUST NOT know about APIs, database tokens, or network state. It communicates its intent **exclusively** by modifying the physical Markdown files inside the `conductor/tracks/` folder.
2. **Sync Worker (The Plumbing)**:
   - A perfectly deterministic background Node process (`laneconductor.sync.mjs`) that acts as a continuous 5-second Heartbeat.
   - **Role:** The sole interface to the network/database. It syncs files UP to the database and pulls queued changes DOWN from the database to the filesystem.
   - **Multi-API Registration:** A *single* local Sync Worker can register to and poll from *multiple* API destinations concurrently (e.g., the Local Dev DB via `http://localhost:8092` AND a Remote Cloud App DB via `https://app.laneconductor.com`).
3. **The Bidirectional Bridge (Sync Manager)**:
   - **UI ➔ FS (Plumbing Controlled)**: Web UIs act through their API layer. The API mutates the Database and syncs to local files via `syncTrackToFile()`. The remote-sync utility can also pull DB state and apply it to files.
   - **FS ➔ DB (Brains Controlled)**: The Skill Worker (Brains) modifies the filesystem. The Sync Worker's file listener watches `conductor/` updates and strictly pushes that new file snapshot upstream via API to *all* registered interfaces.
   - **Conflict Resolution (Newer Wins)**: Metadata timestamps (`last_file_update` vs `last_db_update`) determine which version is authoritative. Whichever was modified more recently wins, preventing data loss during simultaneous edits.
   - **Execution Lifecycle:** The Sync Worker manages the "Automation" state (`running`/`done`) by watching the Skill Worker's process exit code. No explicit API "pulse" from the Brains is required.

## The Sync Skill Interface
To maintain strict boundary separation, the Skill Worker (Brains) and Sync Worker (Plumbing) communicate via a standard Markdown-based protocol.

### 1. State Propagation (Brains ➔ FS ➔ DB)
The Brains signals its internal state by writing specific bold markers in `index.md` or `plan.md`:
- `**Status**: [lane]` — Transitions the track to a new lane (`plan`, `implement`, `review`, `quality-gate`, `done`).
- `**Step**: [step]` — The specific activity within the lane (e.g., `plan`, `coding`, `reviewing`, `complete`).
- `**Progress**: [0-100]%` — Updates the visual progress bar.
- `**Phase**: [Phase Name] ⏳` — Marks the current active phase.
- `**Summary**: [text]` — Updates the short description on the Kanban card.
- `**Waiting for reply**: [yes|no]` — Signals that a human comment needs an AI response.

### 2. Action Completion (Process Lifecycle)
- **Done**: When the Brains (LLM) completes its task successfully, it exits with **code 0**. The Plumbing detects this and transitions the track based on the flexible rules in `workflow.json` (e.g., automatically moving from `implement` to `review`).
- **Error/Retry**: If the Brains fails or crashes (exit code > 0), the Plumbing increments the retry count and re-queues the track for another attempt if the `max_retries` limit hasn't been reached.

### 3. Human Feedback (DB ➔ FS ➔ Brains)
- **Intake**: New requests from the UI are written to `conductor/tracks/intake.md` by the Plumbing.
- **Comments**: Human comments in the UI conversation are synced down to the filesystem (e.g., via `last_comment` updates or a dedicated conversation log) for the Brains to read.

4. **Sync Manager (Track 1010 Implementation)**:
   - **Remote-Sync Utility**: `conductor/remote-sync.mjs` syncs tracks between API and local files with bidirectional conflict resolution.
     - **DB → File**: If database is newer, updates local `index.md` with latest lane/progress/phase
     - **File → DB**: If file is newer, syncs local changes back to API
     - **Metadata Tracking**: Timestamps enable intelligent "newer wins" conflict resolution
     - **Command**: `/laneconductor remote-sync [track-num?]` or `make lc-remote-sync`
   - **Track Summary**: `conductor/init-tracks-summary.mjs` aggregates all tracks into `conductor/tracks.md`
     - Scans all track folders and extracts metadata
     - Groups by lane (planning, in-progress, review, quality-gate, backlog, done)
     - Includes progress percentages and last-updated timestamp
     - **Command**: `/laneconductor init-tracks-summary` or `make lc-init-tracks-summary`
   - **Metadata Store**: `.conductor/tracks-metadata.json` tracks timestamps for conflict resolution
     - Stores `last_file_update` and `last_db_update` per track
     - Enables deterministic sync direction (newer always wins)

5. **Universal CLI (`lc`)**:
   - A global Node.js command providing full parity with Makefile targets for high-level project and track management.
   - **Project Management**: `lc status`, `lc new`, `lc setup`, `lc config`.
   - **Track Management**: `lc move`, `lc comment`, `lc pulse`, `lc logs`.
   - **Validation**: `lc verify`, `lc quality-gate`.
   - **Transitions**: `lc plan`, `lc implement`, `lc review`, etc.

6. **Kanban Dashboard (Local & Cloud)**:
   - Vite + React UI rendering track progress visually.
   - **Merged APIs:** Functionally, the UI API and the Collector API are strictly merged both in local development (`:8090/8091`) and Remote Cloud deployments to ensure identical boundary interactions.
6. **Makefile Targets**:
   - `make lc-start / lc-stop / lc-ui-start` provided for manually spinning up the local control plane.
7. **Per-Project Strategy**:
   - Core configurations are tracked universally via `.laneconductor.json` which maps the targeted Collector API endpoints.

## Worker Coordination Architecture (Track 1010)

LaneConductor supports two work patterns that coordinate seamlessly:

### Two Work Patterns

**1. CLI-Driven Pattern** (offline-capable, direct)
- Users invoke `/laneconductor implement {track}` directly
- Works offline (no database required)
- Can be invoked from any machine
- Single execution per invocation

**2. Daemon-Driven Pattern** (persistent, multi-machine)
- Persistent worker daemon (`laneconductor.sync.mjs`) claims and runs queued tracks
- Runs continuously on specific machine
- Polls for queued tracks every 5 seconds
- Coordinates with database (optional)
- Multi-track parallel execution

### Three-Layer Coordination System

Both patterns coordinate via a three-layer system:

**Layer 1: Git Lock Layer** (offline-first, source of truth)
- Location: `.conductor/locks/{track}.lock` (committed to git)
- Format: JSON with user, machine, started_at, cli, pattern
- Lifecycle: Check → Create → Work → Remove → Commit
- Available: Offline (git always available locally)
- Benefits: Any worker can `git fetch` and see all locks
- Stale cleanup: Locks >5 minutes old are automatically removed

**Layer 2: Git Worktree Layer** (parallel isolation)
- Location: `.git/worktrees/{track}/` per track
- Managed by: Worker daemon (on track claim/release)
- Benefits: No git conflicts during parallel execution
- Lifecycle: Create on claim → Work in worktree → Remove on completion
- Isolation: Each track has own staging area and branch

**Layer 3: Database Layer** (optional sync & UI)
- Tables: `tracks` (with worktree metadata), `track_locks` (lock history)
- Synced from: Git locks (git is authoritative)
- When unavailable: System still works (git locks sufficient)
- Database updates: Async sync via worker's chokidar file watcher
- Remote API: Optional `POST /track/{track}/lock` endpoint for remote collector sync

### Multi-Worker Conflict Resolution

**Scenario 1: Two workers claim same track**
```
Time 1: Both workers run git fetch (no lock exists)
Time 2: Worker A commits lock, Worker B sees conflict/stale lock
Result: Worker B skips this track, Worker A claims it
```

**Scenario 2: Stale lock (process crashed)**
```
Lock file exists and is >5 minutes old
→ Assume worker crashed
→ Remove lock, claim track, continue
```

**Scenario 3: DB unreachable on completion**
```
Exit handler:
- Updates local files (always works) ✓
- Commits to git (always works) ✓
- Removes lock (always works) ✓
- DB will catch up when online (via file sync) ✓
```

### Implementation Details

**File ↔ DB Sync**
- Worker watches `conductor/tracks/` via chokidar
- On file change: reads index.md, parses markers, PATCHes API
- Markers synced: Lane, Lane Status, Progress, Phase, Summary
- Exit handler: updates Lane Status to `success` or `queue` on process completion

**Worktree Management**

Worktrees provide isolated parallel execution for each track. The lifecycle is controlled by `project.worktree_lifecycle` in `.laneconductor.json`:

- **per-cycle** (default): Worktree persists for the full track lifecycle (plan → implement → review → quality-gate → done)
  - Created: When track first enters `in-progress` lane
  - Path: `.git/worktrees/{track_number}/`
  - Reused: Across all lane transitions until `done:success`
  - Cleanup: Only when track reaches `done:success` (merge to main + remove worktree)
  - Benefit: Uncommitted work and git state persist across retries and lane changes

- **per-lane** (legacy): Worktree is created/destroyed per lane run (old behavior)
  - Created: When track enters a lane with `lane_action_status: queue`
  - Cleanup: When exiting the lane (regardless of success/failure)
  - Use case: Strict isolation, each lane starts fresh with no context

All work happens inside the worktree (isolated from main branch). Commits go to the track's feature branch (`track-{track_number}`). On `done:success`, the feature branch is merged to main via `git merge --no-ff` (preserves history), then the worktree is removed.

**Lock Synchronization** (when remote collector configured)
- Local worker creates lock, commits to git
- `POST /track/{track}/lock` syncs to remote DB
- Allows remote workers to see local locks
- Prevents double-work across machines

### Benefits

✅ **Offline-first**: Works without database (git is sufficient)
✅ **Multi-machine**: Workers on different machines can safely coordinate
✅ **Parallel execution**: Multiple tracks run in isolated worktrees
✅ **Fault-tolerant**: Stale locks auto-recover, no manual intervention needed
✅ **Audit trail**: All locks committed to git, fully traceable
✅ **Pattern agnostic**: Both CLI and daemon patterns use same coordination
✅ **Optional DB**: Database enhances UI visibility but isn't required
