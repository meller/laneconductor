# Track 1005: Multi-User Data Model & Auth — Plan

## Architecture Summary — Dual Mode Operations

LaneConductor operates in two distinct operational modes controlled by the presence of Remote/Firebase environment variables (e.g., `VITE_FIREBASE_PROJECT_ID`):

### 1. Sync/Worker Modes (The Client)
*   **Local Sync**: The `laneconductor.sync.mjs` worker connects to a local collector (e.g., `localhost:8092`). Auth is implicitly trusted or uses a local dev token.
*   **Remote Sync**: The worker connects to a remote cloud collector. It must read the user's `~/.laneconductor-auth.json` (Firebase token) to register initially, obtaining a stable `machine_token`. Subsequent syncs use ONLY the `machine_token`.

### 2. UI & Collector Modes (The Server)
*   **Local Server**: No Firebase variables present. The UI shows all data openly. The collector accepts data from any local worker.
*   **Remote Server**: Firebase configured. 
    *   **UI**: Acts as a multi-tenant cloud app. Enforces Firebase Auth and filters projects by `project_members`.
    *   **Collector**: Operates as a remote data receiver. It **only accepts data from registered workers** (requiring a valid `machine_token`). During `POST /worker/register`, it strictly validates the incoming `Bearer <UserToken>` against Firebase before issuing a `machine_token`.

### Auth Layers
| Layer | Who authenticates | Token type | Status |
|---|---|---|---|
| UI → API server (Remote) | Human via Firebase | Firebase ID token | ✅ done (Track 1002) |
| Worker Registration (Remote)| Human via Firebase | Firebase ID token | ⬜ Phase 3 (Firebase Verify) |
| Worker → Collector (Remote) | Machine process | `machine_token` | ✅ done (Phase 3 DB) |
| Remote mode routing | Project identity | `git_global_id` | ⬜ Phase 4 |

---

## Phase 3: Machine Token + Collector Auth

**Goal**: Workers authenticate to the collector with a stable machine credential, tied to the user's global CLI login.

### 3.0 `laneconductor login` CLI flow (New)
- [x] Add `laneconductor login` command to the skill
- [x] Opens browser to a login page on the UI server (or hosted app)
- [x] Captures the issued Firebase User Token
- [x] Saves it globally to `~/.laneconductor-auth.json`

### 3.1 DB Migration 002 ✅ Applied
- Dropped broken `owner_github_id` FK + `api_token` from projects
- Added `project_members` table (project_id, user_uid, role)
- Added `machine_token TEXT UNIQUE` + `user_uid TEXT` to workers
- Added `last_updated_by_uid TEXT` to tracks

### 3.2 Collector: `POST /worker/register` generating machine_token
- [x] Worker sends `Authorization: Bearer <User Token>` (read from `~/.laneconductor-auth.json`) during registration
- [x] Collector verifies User Token via `firebase-admin` (if remote mode is on)
- [x] Collector extracts `user_uid`
- [x] `SELECT machine_token FROM workers WHERE project_id=$1 AND hostname=$2 AND pid=$3`
- [x] If none exists: `machine_token = crypto.randomUUID()`
- [x] Upsert worker row with `machine_token` and `user_uid = req.user.uid`
- [x] Return `{ ok: true, machine_token }` in response

### 3.3 Collector: enforce machine_token on all write endpoints
- [x] Current `auth()` middleware checks `TOKEN` from startup config
- [x] Extend: accept either the static `TOKEN` (backward compat) OR a valid `machine_token` from the `workers` table
- [x] New `authWorker()` middleware: look up `Authorization: Bearer <token>` in workers.machine_token

### 3.4 laneconductor.sync.mjs: persist + send machine_token
- [x] After `POST /worker/register`: if response has `machine_token`, write it to `.laneconductor.json` at `collectors[0].machine_token`
- [x] Read `machine_token` from config on startup; attach as `Authorization: Bearer <machine_token>` on all collector fetches
- [x] On 401: log warning, skip (do not crash)

### 3.5 .laneconductor.json shape after Phase 3
```json
{
  "collectors": [{
    "url": "http://localhost:8092",
    "token": null,
    "machine_token": "uuid-generated-on-first-register"
  }]
}
```

---

## Phase 4: project_members + git_global_id Routing

**Goal**: A user logging into the UI only sees projects they are a member of. A project is identified stably by `git_global_id` across devices/users.

### 4.1 Collector: `POST /project/ensure`
- [x] New endpoint (replaces implicit "project exists in .laneconductor.json" assumption)
- [x] Body: `{ git_remote, name, repo_path, user_uid?, primary_cli, primary_model, ... }`
- [x] Computes `git_global_id = uuidV5(git_remote)`
- [x] Upserts project by `git_global_id` (ON CONFLICT DO UPDATE name, repo_path, agents)
- [x] If `user_uid` provided: upserts `project_members(project_id, user_uid, role='owner')` — first user becomes owner, subsequent ones become member
- [x] Returns `{ project_id, git_global_id, machine_token }` (machine_token generated here if worker registers simultaneously)

### 4.2 UI Server: `GET /api/projects` — filter by membership in remote mode
- [x] When `AUTH_ENABLED` and `req.user.uid` present:
  ```sql
  SELECT p.* FROM projects p
  JOIN project_members pm ON pm.project_id = p.id
  WHERE pm.user_uid = $1
  ORDER BY p.name
  ```
- [x] When local mode: existing query (all projects), unchanged

### 4.3 UI Server: `POST /api/projects` — auto-add owner to project_members
- [x] After INSERT into projects: if `req.user?.uid`, insert into `project_members` with `role = 'owner'`

### 4.4 UI Server: new `GET /api/projects/:id/members` endpoint
- [x] Returns list of `{ user_uid, role, joined_at }` for a project (remote mode only)

---

## Phase 5: Multi-Device / Multi-User E2E Verification

### 5.1 Single user, two workers (same project, different machine tokens)
- [x] Start two terminal instances of `laneconductor.sync.mjs` point to the same project
- [x] Both instances should read the same User Token but get different Machine Tokens
- [x] Confirm both `workers` rows appear in UI workers panel, grouped under the same user

### 5.2 Two users, same GitHub repo
- [x] User A signs in via Firebase → registers project X → becomes owner
- [x] User B signs in → runs collector setup with same `git_remote` → `git_global_id` matches → added as member
- [x] Both see the same tracks in the UI dashboard
- [x] Worker from User B appears under the shared project

### 5.3 Run full test suite
- [x] `npm test` in `ui/` — all 29 tests green

---

## What Does NOT Change (invariants)
- Local mode: zero changes to UX or code paths
- Track data model: no changes to tracks table (except the optional `last_updated_by_uid` column)
- Collector business logic: all DB writes unchanged; only the auth layer wraps them
- Existing `.laneconductor.json` files: backward compatible (no machine_token = no worker auth = localhost trust)

## ✅ REVIEWED

## ✅ QUALITY PASSED
