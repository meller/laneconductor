# Tech Stack

## Skill / Heartbeat Worker
- **Runtime**: Node.js (ESM, `.mjs`)
- **DB client**: `pg` (node-postgres)
- **File watcher**: `chokidar`
- **Config**: `.laneconductor.json` per project

## Worker Coordination Layer
- **Git Locks**: `.conductor/locks/{track}.lock` (JSON files, committed to git)
- **Git Worktrees**: `.git/worktrees/{track}/` (isolated parallel execution)
- **Coordination Logic**: Centralized in `conductor/lock.mjs` and `conductor/unlock.mjs`
- **Conflict Resolution**: 5-minute stale lock timeout, whoever commits lock first wins

## UI
- **Frontend**: React 18 + Vite 6 (port 8090)
- **Styling**: Tailwind CSS v3
- **Backend API**: Express 4 (port 8091)
- **DB client**: `pg`
- **Real-time**: Polling every 2s
- **Build tool**: Vite

## Chat Composer Autocomplete (Track 10080)

The Chat composer (`ui/src/components/TrackChatComposer.jsx`) completes `@file` mentions,
`#track`/`@track:` references, and `/laneconductor` slash commands. Trigger detection requires
the trigger character to begin a token — position 0, or preceded by whitespace:

| Typed | Menu | Source |
|---|---|---|
| `@src/comp` | files | `GET /api/projects/:id/files?q=…` (debounced) |
| `#100` / `@track:100` | tracks | the track list already held in memory — no request |
| `/mo` (position 0 only) | commands | `conductor/services/slash-commands.mjs` — static data |

**`GET /api/projects/:id/files?q=&limit=`** returns `{ files: [{ path, score }], source, total,
truncated, age_seconds }`, ranked by `conductor/services/fuzzy-match.mjs`'s subsequence scorer
(shared between the API server and the browser). `source` tiers: `disk` (`git ls-files` in the
project's `repo_path`, cached with a TTL + in-flight-promise dedupe) → `worker` (a manifest the
worker pushed, for `remote-api` deployments where the API host can't reach the repo) → `none`
(always `200`, never an error — the composer degrades to "file list unavailable" instead of
failing).

**`PATCH /worker/file-manifest`** (`collectorAuth`-guarded, like `/worker/heartbeat`) is how a
worker keeps that `worker` tier fresh: on the same 60s cadence as its worktree-summary tick, it
hashes its tracked-file list and pushes only when the digest changed, via the shared
`patchCollectors()` fan-out (token resolution, health, the collector-0-authoritative rule and the
retry buffer, all for free). Capped at 20,000 paths (`truncated: true` beyond that). Stored in
`projects.file_manifest` / `file_manifest_digest` / `file_manifest_updated_at`.

## Database
- **Engine**: PostgreSQL (local, default port 5432)
- **DB name**: `laneconductor` (default)
- **Schema**: `projects` + `tracks` + `track_locks` tables
- **ORM**: Prisma (type-safe query builder)
  - `prisma/schema.prisma` — declarative schema definition
  - `generated/prisma` — auto-generated client
- **Migrations**: Atlas (schema management)
  - `atlas.hcl` — environments and migration config
  - `migrations/` — SQL migration files
  - Workflow: Update `schema.prisma` → generate SQL → `atlas migrate dev` → apply migration

## Testing

| Layer | Framework | Command | Notes |
|-------|-----------|---------|-------|
| Worker E2E (local-fs) | `node:test` (built-in) | `node --test conductor/tests/local-fs-e2e.test.mjs` | Spawns real worker process, polls filesystem, zero deps |
| Worker E2E (local-api + remote-api) | `node:test` (built-in) | `node --test conductor/tests/local-api-e2e.test.mjs` | Spawns worker + mock collector (Node http, zero deps), no real DB |
| Worker unit (auto-launch logic) | Vitest | `cd ui && npm test` | Fast, mocked, no real process |
| Server API (Express routes) | Vitest + supertest | `cd ui && npm test` | Integration tests with mocked DB |
| UI / Kanban browser tests | Playwright *(planned)* | `cd ui && npm run test:e2e` | Headless Chromium, real browser interactions against the Vite UI |

**Rules**:
- `node:test` — anything that spawns real processes or touches the filesystem (zero deps, runs anywhere)
- Vitest — unit/integration tests with mocking and fast feedback
- Playwright — UI flows that require a real browser (drag-and-drop, WebSocket updates, auth flows)

## Filesystem Sync Layer
- **File watcher**: `chokidar` (watches conductor/tracks/, workflow.json, .laneconductor.json, etc.)
- **Filesystem queue**: `conductor/tracks/file_sync_queue.md` — typed message bus (fs→DB direction)
- **DB queue**: `file_sync_queue` Postgres table — pending file writes (DB→fs direction)
- **Worker**: `laneconductor.sync.mjs` — sole consumer of both queues, runs as background daemon

## Developer Experience
- **Skill format**: Claude Code SKILL.md
- **Install**: `make install` → writes `~/.laneconductorrc`
- **Per-project**: `lc setup` from project directory
- **No-LLM ops**: `lc start / lc stop / lc ui start / lc status`
