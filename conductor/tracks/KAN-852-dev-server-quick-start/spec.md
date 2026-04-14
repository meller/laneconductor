# Spec: Dev Server Quick-Start from Kanban Card

## Problem Statement
Reviewers in the `review` lane have to leave the dashboard to start a dev server. There is no way to see the running application without switching to a terminal. This breaks the review flow.

## Goals
- One-click "Start Dev Server" from the Kanban card (primarily review lane, available in-progress too)
- Configurable `dev_command` and `dev_url` per project in `.laneconductor.json`
- The Express/collector server owns process lifecycle (spawn + kill)
- UI shows running URL as a clickable link and a Stop button
- State persists across UI refreshes (stored in DB or server memory with DB fallback)

## Non-Goals
- This does NOT go through the sync worker or the filesystem
- This does NOT auto-detect the port/URL (user configures it)
- Per-track dev servers (requires track 1012 worktrees — optional Phase 5)

## Architecture

```
UI (React)
  → POST /api/dev-server/start  → Express server spawns child_process
  → GET  /api/dev-server/status → Express returns {running, pid, url}
  → POST /api/dev-server/stop   → Express kills process
```

The Express server (port 8091) already has `exec`/`child_process` imported. Dev server processes are tracked in a server-side `Map<projectId, {proc, pid, url}>`. The PID is also stored in the `projects` table so the UI can query status after a page refresh.

## Config Schema

`.laneconductor.json` — add `dev` section:
```json
{
  "project": {
    "dev": {
      "command": "npm run dev",
      "url": "http://localhost:3000"
    }
  }
}
```

`projects` table — add columns:
- `dev_command TEXT` — shell command to start the dev server
- `dev_url TEXT` — URL the dev server will be reachable at
- `dev_server_pid INTEGER` — PID of running dev server (null if not running)

## API Endpoints

### `POST /api/projects/:id/dev-server/start`
- Auth: `requireAuth` (same as other project actions)
- Reads `dev_command` and `dev_url` from `projects` table
- If no `dev_command` configured: `400 { error: 'No dev_command configured' }`
- If already running (pid in Map or DB): kills old process first, then restarts
- Spawns: `spawn('sh', ['-c', dev_command], { cwd: project.repo_path, detached: true, stdio: 'ignore' })`
- Stores proc in `Map<projectId, {proc, pid, url}>`
- Updates `projects SET dev_server_pid = $pid WHERE id = $id`
- Returns: `{ running: true, pid, url: dev_url }`

### `POST /api/projects/:id/dev-server/stop`
- Kills process from Map (or by PID from DB if Map entry missing)
- Clears Map entry
- Updates `projects SET dev_server_pid = NULL WHERE id = $id`
- Returns: `{ running: false }`

### `GET /api/projects/:id/dev-server/status`
- Checks Map for live process
- Falls back to DB `dev_server_pid` if Map miss (e.g., server restart)
- If PID exists: probe with `kill(pid, 0)` to verify process is still alive
- Returns: `{ running: bool, pid: int|null, url: string|null, dev_command: string|null }`

## DB Migration (`006_dev_server.sql`)
```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS dev_command TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS dev_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS dev_server_pid INTEGER;
```

## Sync Worker Change
In `upsertWorker()` → `/project/ensure` payload, add:
```js
dev_command: project.dev?.command ?? null,
dev_url: project.dev?.url ?? null,
```

## UI Changes (`TrackCard.jsx`)

Alongside the existing review-lane button block (line 239), add:

```jsx
{(track.lane_status === 'review' || track.lane_status === 'in-progress') && (
  <DevServerButton projectId={track.project_id} devUrl={project.dev_url} />
)}
```

`DevServerButton` component (new or inline):
- Calls `GET /api/projects/:id/dev-server/status` on mount
- "Start Dev Server" button → calls `POST .../start` → shows spinner → shows URL link + "Stop" button
- "Stop" button → calls `POST .../stop` → reverts to "Start Dev Server"
- Running state: shows `🟢 localhost:3000 ↗` as clickable link

## `TrackDetailPanel.jsx`
Also show dev server status in the detail panel when open, with full URL and start/stop controls.

## Requirements
- REQ-1: `dev_command` and `dev_url` configurable in `.laneconductor.json`
- REQ-2: Start/stop via one click from the Kanban card
- REQ-3: Running URL shown as clickable link
- REQ-4: Process killed cleanly on Stop (SIGTERM + SIGKILL fallback after 3s)
- REQ-5: Status persists across UI page refreshes (DB-backed PID)
- REQ-6: Graceful error if no `dev_command` configured (show setup hint)
- REQ-7: Works per-project; per-track support deferred to track 1012 integration
