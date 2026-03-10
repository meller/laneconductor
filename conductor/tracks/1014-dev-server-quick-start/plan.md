# Track 1014: Dev Server Quick-Start from Kanban Card

## Phase 1: DB Migration + Config Schema

**Problem**: No columns to store dev server config or running PID per project.
**Solution**: Add `dev_command`, `dev_url`, `dev_server_pid` to `projects` table.

- [x] Task 1: Write `ui/server/migrations/006_dev_server.sql`
    - [x] `ALTER TABLE projects ADD COLUMN IF NOT EXISTS dev_command TEXT`
    - [x] `ALTER TABLE projects ADD COLUMN IF NOT EXISTS dev_url TEXT`
    - [x] `ALTER TABLE projects ADD COLUMN IF NOT EXISTS dev_server_pid INTEGER`
- [x] Task 2: Migration runs automatically on server startup (already handled by `runMigration()`)
- [x] Task 3: Document `dev` section in `.laneconductor.json` schema in SKILL.md

**Impact**: Projects can store dev server config and track running PID. ✅ COMPLETE

---

## Phase 2: Express API — Start / Stop / Status

**Problem**: No API to spawn or kill a dev server process.
**Solution**: Three new endpoints on the Express server; in-memory Map + DB for state.

- [x] Task 1: Add `const devServers = new Map()` in `ui/server/index.mjs`
    - [x] Key: `projectId`, Value: `{ proc, pid, url }`
- [x] Task 2: `POST /api/projects/:id/dev-server/start`
    - [x] Read `dev_command`, `dev_url`, `repo_path` from `projects` WHERE id = $id
    - [x] If no `dev_command`: return `400 { error: 'No dev_command configured for this project' }`
    - [x] If already running in Map: kill existing, wait 500ms, continue
    - [x] `spawn('sh', ['-c', dev_command], { cwd: repo_path, detached: true, stdio: 'ignore' })`
    - [x] Store in Map: `devServers.set(projectId, { proc, pid: proc.pid, url: dev_url })`
    - [x] `UPDATE projects SET dev_server_pid = $pid WHERE id = $id`
    - [x] Return `{ running: true, pid, url }`
- [x] Task 3: `POST /api/projects/:id/dev-server/stop`
    - [x] Get entry from Map; if missing, read PID from DB
    - [x] Send SIGTERM; after 3s, SIGKILL if still alive
    - [x] `devServers.delete(projectId)`
    - [x] `UPDATE projects SET dev_server_pid = NULL WHERE id = $id`
    - [x] Return `{ running: false }`
- [x] Task 4: `GET /api/projects/:id/dev-server/status`
    - [x] Check Map first; fall back to DB PID on miss
    - [x] Probe PID with `kill(pid, 0)` — if throws ESRCH, process is dead → clear DB
    - [x] Return `{ running, pid, url, dev_command }`
- [x] Task 5: Server shutdown cleanup — kill all running dev servers on process exit (`process.on('exit')`)

**Impact**: UI can start, stop, and query dev server state via API. ✅ COMPLETE

---

## Phase 3: Sync Worker — Send Dev Config in /project/ensure

**Problem**: `dev_command` and `dev_url` from `.laneconductor.json` are not sent to the DB.
**Solution**: Extend the `/project/ensure` payload in `upsertWorker()`.

- [x] Task 1: Read `project.dev?.command` and `project.dev?.url` from config in `laneconductor.sync.mjs`
- [x] Task 2: Add to `/project/ensure` POST body:
    - [x] `dev_command: project.dev?.command ?? null`
    - [x] `dev_url: project.dev?.url ?? null`
- [x] Task 3: Extend `/project/ensure` handler in `ui/server/index.mjs`
    - [x] Accept `dev_command`, `dev_url` in request body
    - [x] UPSERT them into `projects` table (only set if non-null, don't overwrite with null)

**Impact**: Projects with dev config in `.laneconductor.json` automatically populate the DB on worker startup. ✅ COMPLETE

---

## Phase 4: UI — Button + URL Badge + Stop on TrackCard

**Problem**: No UI affordance for dev server in the Kanban card.
**Solution**: Add DevServerButton to TrackCard, visible on review and in-progress lanes.

- [x] Task 1: Add `DevServerButton` component (inline in `TrackCard.jsx` or separate file)
    - [x] Props: `projectId`, `devUrl`
    - [x] On mount: `GET /api/projects/:id/dev-server/status` → set `running`, `url` state
    - [x] "▶ Dev Server" button → POST start → show spinner → show link + Stop
    - [x] Running state: `🟢` + clickable URL badge (`<a href={url} target="_blank">`)
    - [x] "⏹ Stop" button → POST stop → revert to Start button
    - [x] Error state: show config hint if 400 returned
- [x] Task 2: Add button in `TrackCard.jsx` inside the actions row (line ~239)
    - [x] Show when `lane_status === 'review' || lane_status === 'in-progress'`
    - [x] Pass `project_id` and `dev_url` (from project context or track data)
- [x] Task 3: Add dev server status section to `TrackDetailPanel.jsx`
    - [x] Full URL display, start/stop controls, last-started timestamp

**Impact**: Reviewers can launch and stop the dev server without leaving the dashboard. ✅ COMPLETE

---

## Phase 5: Polish + Per-Track Worktree Support (Optional, depends on 1012)

**Problem**: Dev server always starts in `repo_path` (main working tree). With worktrees, each track has its own directory.
**Solution**: If track has `worktree_path`, use that as cwd for the dev server.

- [ ] Task 1: Pass `worktree_path` to start endpoint when available
    - [ ] `POST /api/projects/:id/dev-server/start` accepts optional `{ track_number }`
    - [ ] If provided: query `tracks.worktree_path` → use as cwd
- [ ] Task 2: Show which track's dev server is running in the UI (when per-track)
- [ ] Task 3: Update Stop to scope by track when in worktree mode
