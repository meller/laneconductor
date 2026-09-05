# Product: LaneConductor

## What It Does
LaneConductor is the AI orchestration layer for your whole business — not just code. Dev ships features, launch posts launches, market runs outreach, support resolves tickets. Every function runs as a **track** on one board, executed or assisted by AI agents, and measured against a KPI so you know what actually worked.

It is not a project tracker (those are passive — humans do the work). LaneConductor is an **operating layer**: agents execute the work, outcomes are measured, and failed experiments automatically replan with measurement data attached. The Conductor metaphor is exact — it doesn't play the instruments, it orchestrates them.

**One-liner**: *"AI agents for every business function. One board. Closed loop."*

## Track Types
LaneConductor supports four track domains:

| Type | What AI does | How success is measured |
|------|-------------|------------------------|
| **dev** | Plans, implements, reviews, and ships code | Tests pass, quality gate clears |
| **launch** | Drafts launch posts, copy, campaigns — human publishes | KPI: HN score, Reddit upvotes, PH upvotes |
| **market** | Writes outreach sequences, pitches, one-pagers — human sends | KPI: replies, conversions |
| **support** | Drafts responses, knowledge base articles | KPI: resolution rate, CSAT |

Non-dev tracks follow a **supervised implement** flow: AI drafts the content, human publishes it, AI schedules and runs the quality gate when the measurement window closes.

## Users
- Solo founders using AI tools across their whole business — not just engineering
- Developers who want visibility into multi-agent work across multiple repos
- Privacy-conscious builders who won't send business data to third-party SaaS
- Teams running AI-assisted launches and marketing alongside product development

## Core Goals
- **Visibility**: Know what every AI agent is doing — code, content, or outreach — without reading terminal output
- **Multi-function**: Dev, launch, market, support all in one board
- **Closed loop**: KPI measurement after every non-dev track — did it actually work?
- **Sovereign**: 100% local — no cloud, no auth, no cost
- **Agent-First**: Designed for the workflow of AI assistants, not human project managers

LaneConductor supports **Multi-Target Synchronization**. You no longer select a global mode; instead, you configure individual **Collectors** in `.laneconductor.json`. Each collector has its own type and enabled status.

| Target Type | Use Case | Auth / Key |
|-------------|----------|------------|
| **local-api** | Local Postgres + Kanban dashboard | None (🔓 local-api) |
| **remote-api** | Cloud / multi-machine sync | Token (🔑 .env or 🔒 GCP Secret) |

The project runs in **local-fs** mode if zero enabled collectors are configured.

**remote-api known gap (as of 2026-09, tracked in track 10052):** Firebase
Hosting's rewrite rules for `app.laneconductor.com` (and the raw
`laneconductor-app.web.app`) use `/prefix**` glob patterns, which only match
*within* a single path segment — not the cross-segment `/prefix/**` behavior
the routing was written assuming. Confirmed live: 24 of the 27 collector
endpoints the sync worker calls are multi-segment (`/worker/register`,
`/tracks/claim-queue`, `/track/:n/lock`, etc.) and silently receive the SPA's
`index.html` with a `200` instead of reaching the `api` Cloud Function — only
single-segment paths (`/track`, `/worker`, `/provider-status`) and `/health`
route correctly today. A worker or CLI pointed at the Hosting domain will see
this as `SyntaxError: Unexpected token '<'` on writes. Workaround until the
Hosting fix ships: point the collector at the Cloud Function's own URL
directly (bypasses Hosting's rewrite layer entirely). Two route families are
also missing from `cloud/functions/index.js` outright (not just misrouted) —
filed as a Phase 6 follow-up on the same track.

### Who Owns Remote Sync (Track 10064)

The naming here is genuinely ambiguous — the local API server is called a
collector, the remote endpoint is called a collector, and the API server
even holds a `CLOUD_FUNCTIONS_URL` constant — so it's worth stating plainly:
**the sync worker (`conductor/laneconductor.sync.mjs`) is the only
component that ever writes to a remote collector.** The local API server
(`ui/server/index.mjs`) does not write to the cloud at all: its
`collectorWrite` helper posts to `COLLECTOR_URL`, which defaults to
`http://127.0.0.1:8091` — itself. `CLOUD_FUNCTIONS_URL` there is used only
to *proxy reads* in production, which is what makes the API server look
cloud-responsible for writes when it structurally isn't.

**Collector-0 vs collector-1..n.** `.laneconductor.json`'s `collectors`
array has one privileged member: index 0 is awaited by
`postToCollectors`/`patchCollectors`, and its result is what the caller
actually gets back — this is the authoritative write. Every other
configured collector (1..n, typically a remote/cloud target layered on top
of a local primary) is fire-and-forget: the call still happens, but nothing
downstream waits on or depends on its outcome. A remote collector failing
is deliberately **degraded-but-acceptable** — it never fails the worker or
changes the awaited result — but as of track 10064 it can no longer be
*silently* degraded: per-collector health (attempts, consecutive failures,
last error, last success, token source) is tracked in-process, ships on
every `/worker/register` and `/worker/heartbeat` call as `collector_health`,
and renders as a "SYNC DEGRADED" badge on that worker's card in the Kanban
UI once any collector has a nonzero consecutive-failure count. Five
consecutive failures escalate the worker's own log from `warn` to a
throttled `error` (at most one line per `LC_COLLECTOR_FAILURE_LOG_INTERVAL_MS`,
default 60s) — the direct fix for a real incident where 560 consecutive
identical 401s produced 560 identical log lines and nothing else.

**Token resolution and `.env`.** `.env`, `conductor/defaults.json`, and
`.laneconductor.json` are all resolved against the **primary checkout**
(`conductor/services/config-root.mjs`), not a bare relative path — a worker
launched with its cwd inside a linked track worktree, or a machine-level
`--manager` worker (never chdir'd to any project checkout by design), reads
the same `.env` a worker in the primary checkout would. `.env` is also
re-read on every `.laneconductor.json` config-file change: a collector
added to the config while the worker is already running goes live
immediately (the config watcher replaces `config` wholesale), so its token
must be re-readable immediately too, not only at the next process restart.
A genuine ambient environment variable always outranks a `.env` file value,
exactly as before.

**A failed fire-and-forget write isn't necessarily lost.** Non-primary
collector writes that fail are queued in a small in-memory, bounded
(`LC_COLLECTOR_RETRY_MAX`, default 100), coalescing retry buffer
(`conductor/services/collector-retry-buffer.mjs`) with exponential backoff,
and replayed on a periodic tick (`LC_COLLECTOR_RETRY_INTERVAL_MS`, default
15s) once the collector starts accepting writes again. This is memory-only
by design (see the track's spec.md Non-Goals) — track state re-syncs from
the filesystem on the worker's own next cycle regardless, so a durable
write-ahead log wasn't judged worth the complexity.

**Related silent-failure tracks:** 10052 covers the Hosting-rewrite/missing-route
gap described above — a *routing* problem, distinct from this section's
*auth* problem, though both currently point at the same underlying "the
cloud collector doesn't reliably receive what the worker sends" symptom.
10061 covers the absence of any version/capability handshake between
worker and collector — the same category of silent-drift failure, but
about the two sides silently disagreeing on what a payload should look
like rather than one side never getting the payload at all.

## Feature Availability — Skill-Only vs Worker Modes

"Skill-only" means no worker process at all: an AI session (Claude Desktop, an
interactive CLI session) drives the `conductor/` files directly via the
`/laneconductor` skill. It's the zero-install on-ramp — everything degrades
gracefully to it — but the automation and model-control features are what the
worker (and, further, the full local/cloud stack) exist for. This table is the
honest upgrade path: each column to the right is a reason to install more.

| Feature | Skill-only | Worker (local-fs) | Full stack (local-api) | Cloud (remote-api)¹ |
|---------|-----------|-------------------|------------------------|--------------------|
| Track scaffolding, plan/implement/review via markdown | ✅ | ✅ | ✅ | ✅ |
| Git lock + worktree isolation (`lock`/`unlock`) | ✅ manual | ✅ automatic | ✅ automatic | ✅ automatic |
| Auto-launch of queued lane actions | ❌ human invokes each step | ✅ | ✅ | ✅ |
| Retry / on_failure lane automation (`workflow.json`) | ❌ | ✅ | ✅ | ✅ |
| **Per-lane model** (`lanes.<lane>.primary_model`) | ❌ session model is whatever the human runs | ✅ | ✅ | ✅ |
| **Per-track model override** (planned, track 1116) | ❌ same reason | ✅ | ✅ | ✅ |
| Provider exhaustion fallback (primary → secondary CLI) | ❌ | ✅ | ✅ | ✅ |
| Session continuity across lane actions (`--resume`), bounded (track 10047) | n/a (one human session) | ✅ | ✅ | ✅ |
| Live model discovery from the machine (heartbeat) | ❌ | ❌ no collector to report to | ✅ | ✅ |
| Kanban dashboard, Inbox, conversation UI | ❌ | ❌ | ✅ `localhost:8090` | ✅ cloud URL |
| Worker dispatch / manual "run this on that worker" | ❌ | ❌ | ✅ | ✅ |
| Multi-machine / team coordination, worker identity | ❌ | git locks only | ✅ single machine | ✅ full |

¹ This column names what remote-api is *designed* to do, not what it does
today against the Hosting-fronted URL — see the remote-api known gap above
`## Feature Availability`. Most of these rows depend on API calls that
currently misroute in production; only local-api and a Cloud Function URL
pointed at directly are confirmed working end-to-end.

Caveat that applies to every model-control row: model selection is resolved by
the **worker at spawn time** (`--model` on the CLI it launches) and is
**best-effort** — it is not validated against the executing machine's actually
installed models; a mismatch fails that run (normal retry handling applies)
rather than being blocked at claim time.

### Worker & Target Management
Registration and synchronization are managed via the unified `lc` CLI:
- `lc worker <start|stop|restart|status|logs|sync>`: Manage the background heartbeat daemon.
- `lc add-target --url <url> [--key <key>] [--store-type gcp-secret]`: Add a sync endpoint.
- `lc enable-target <url>` / `lc disable-target <url>`: Granularly control where sync traffic flows.
- `lc remove-target <url>`: Permanently remove a collector.
- `lc status`: Real-time dashboard with integrated worker health monitoring.

### Secure Secret Management
For production environments, hardcoded `.env` tokens are discouraged. LaneConductor supports **dynamic runtime resolution** via GCP Secret Manager:
- Configure a target with `--store-type gcp-secret --secret-name NAME`.
- The worker will transparently fetch the key using `gcloud` credentials when syncing.

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
| `conductor/.runs/<track_number>.json` | sync worker (`spawnCli`) | sync worker (`reconcileOrphanedDispatches`) | Track 10020: gitignored, primary checkout only — a persistent, cross-process liveness marker (pid, command, dispatch id) for the CLI child a lane action spawned, so a REPLACEMENT worker process can tell a dispatch orphaned by a restart is still genuinely running apart from one that finished or crashed. Not a committed artifact. |
| `conductor/tracks/NNN-slug/last_run.log` | sync worker (`spawnCli` exit handler) | Claude agents (`/laneconductor implement` step 2) | Track 10016: gitignored (matches `.gitignore`'s `*.log`) — a per-run tail of the CLI's log, giving the next lane-action run the previous run's failure context off the local filesystem. Not a committed artifact; the exit handler no longer attempts to `git add` it (git refuses to stage an explicitly-ignored path without `-f`, and committing a per-run log would churn history on every lane action). |

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
   - **Infrastructure**: `lc list-targets`, `lc add-target`, `lc enable-target`, `lc disable-target`.

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

Worktrees provide isolated parallel execution for a track running in
**`branch` workspace mode** — see "Workspace Modes" below; a
**`main`-mode** track skips everything in this section entirely (no
worktree, no track branch, no merge step). For `branch`-mode tracks, the
lifecycle is controlled by `project.worktree_lifecycle` in
`.laneconductor.json`:

- **per-cycle** (default): Worktree persists for the full track lifecycle (plan → implement → review → quality-gate → done)
  - Created: lazily, at the first `branch`-mode lane action that needs
    one (normally `implement` — never at track creation or during
    `plan`, which always runs directly in the primary checkout
    regardless of the track's resolved mode; see "Workspace Modes")
  - Path: `.git/worktrees/{track_number}/`
  - Reused: Across all lane transitions until `done:success`
  - Cleanup: Only when track reaches `done:success` (merge to main + remove worktree)
  - Benefit: Uncommitted work and git state persist across retries and lane changes

- **per-lane** (legacy): Worktree is created/destroyed per lane run (old behavior)
  - Created: When track enters a lane with `lane_action_status: queue`
  - Cleanup: When exiting the lane (regardless of success/failure)
  - Use case: Strict isolation, each lane starts fresh with no context

For a `branch`-mode track, all work happens inside the worktree (isolated
from main branch). Commits go to the track's feature branch
(`track-{track_number}`). On `done:success`, the feature branch is merged
to main via `git merge --no-ff` (preserves history), then the worktree is
removed. A `main`-mode track is already on main at `done:success` — there
is no merge step.

**The Worktrees Panel**

A dedicated tab on the Kanban dashboard provides direct control and monitoring over active worktrees:
- **Worktree List**: Surfaces all current track worktrees, paths, corresponding branch names, and unmerged commits.
- **Dev-Server Preview**: Swaps the active local dev server to execute code from a specific worktree, making manual testing of in-progress tracks extremely simple.
- **PR & Integration Hub**: Visualizes open Pull Requests, statuses (e.g., `open`, `conflicted`, `merged`), and provides action buttons to Approve & Merge or clean up/delete the worktree.
- **Lock visualizer**: Displays current track locks (`.conductor/locks/`).

**Workspace Modes (Track 1115)**

Orthogonal to the lifecycle above: every lane action first resolves to
`branch` (the default — everything described in this section applies) or
`main` (runs directly in the primary checkout; this whole section is
N/A). Selected via a `**Workspace**` marker (deliberate, explicit —
always wins) or a `**Track Kind**` marker (an inference from bug/feature
classification, which defaults `bug` → `main` but does *not* survive an
unattended auto-queue claim, unlike an explicit `**Workspace**` marker).
See `conductor/workflow.md`'s "Workspace Modes" section and
`conductor/tracks/1115-workspace-mode-main-vs-branch/spec.md` for the
full resolution table.

**PR & Merge Modes (Track 10018)**

Governs how a completed track branch merges back to `main` upon passing the Quality Gate. Resolved per-track via the `**Merge Mode**` marker:
- **`pr`** (default): Automatically pushes the branch and opens a Pull Request on GitHub. The PR and branch preview can be managed and merged directly inside the UI/Worktrees panel.
- **`direct`**: The worker merges the track branch straight to `main` without creating a PR.

**Auto-Run Configuration (Track 10017)**

Controls whether background workers automatically pick up queued tracks. Checked per-track via `**Auto Run**` marker:
- **`yes`**: The track is eligible to be claimed from the queue and executed autonomously by any eligible active worker.
- **`no`** (default): The track remains in the queue and must be manually run/dispatched via the UI or CLI.

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

## Worker Identity, Assignment & Manual Dispatch (Tracks 1084/1085)

Beyond the git-lock coordination above (which prevents two workers from
double-claiming a track), a developer can also explicitly say who a track is
for and manually trigger a specific worker to act — needed once a project
has multiple workers/developers instead of one.

**Stable worker identity**: a worker's DB identity is
`(project_id, hostname, worker_number)`, not `pid` — `pid` changes on every
restart, `worker_number` doesn't. `lc worker start --worker-number <n>`
(default `1`) lets multiple worker processes run for the same project on
the same machine. A worker registers under the calling developer's identity
(`workers.user_uid`, from remote-api auth) automatically — there's no
separate "pin a worker to yourself" step.

**Track assignment**: `tracks.assignee_uid` (nullable) names the developer
responsible for a track, defaulting to its creator, then the project owner,
when unset. Auto-launch claim gating resolves the assignee's own workers
(`workers.user_uid`, not a separate grant/pin table) and, if they have any
registered, only those may claim the track's queued actions; if the
assignee has none, claiming stays open to any worker (today's zero-config
behavior). Routing work to a worker registered under a *different*
developer's identity is deliberately unsupported — that's dispatching to
someone else's machine, a security boundary needing its own consent design,
not something this resolves.

**Manual dispatch**: workers can run in `sync-only` mode (heartbeat + file
sync, no auto-claim from the general queue — see `lc start --sync-only` /
`worker.mode` in `.laneconductor.json`) for a developer who wants to control
exactly what runs, rather than racing the open queue. Every worker — in
either mode — also checks its own per-worker inbox (`worker_dispatch` table)
on each sync tick, entirely separate from the general queue: `POST
/api/tracks/:id/dispatch` enqueues a specific lane action (plan/implement/
review/quality-gate — validated against the track's current lane) for a
specific worker; `POST /api/projects/:id/dispatch` enqueues a `deploy`
action (project-scoped, no track). This is how a `sync-only` worker does
anything at all — it's the only work-launching path that ignores worker
mode.

**Bounded session resume** (track 10047): a track's session (`--resume`)
carries forward indefinitely by default, but not unconditionally — each
lane-action run reports its final context size (last `assistant` event's
cache tokens) back to the collector, and the next dispatch for that track
consults it before deciding to resume. Past `worker.session_max_context_tokens`
(default 400,000 — calibrated above the normal single-action working range
and below the observed dead zone where a resumed run inherits hundreds of
thousands of tokens and does essentially nothing before ending) the track
cold-starts a fresh session instead — with the full project + track context
(`index.md`/`spec.md`/`plan.md`/`test.md`/a `conversation.md` tail)
re-injected into that first prompt, so it isn't starting blind. When token
data is unavailable (a non-claude CLI, or a run that never measured),
`worker.session_max_resumes` (default 12) is the fallback signal. Both
accept env overrides (`LC_SESSION_MAX_CONTEXT_TOKENS`,
`LC_SESSION_MAX_RESUMES`) and `0` disables the respective check.

**Deploy as dispatch**: `lc deploy <env>` and a worker's dispatched deploy
action both run through one shared function
(`conductor/deploy-runner.mjs`), reading `conductor/deploy.json` and logging
to `conductor/logs/deploy-<env>-<timestamp>.log` — so deploying from the app
(via a worker) and deploying from a human's terminal are guaranteed to
behave identically.

Full design context:
[docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md](../docs/superpowers/specs/2026-08-07-remote-worker-identity-and-sessions-design.md).
