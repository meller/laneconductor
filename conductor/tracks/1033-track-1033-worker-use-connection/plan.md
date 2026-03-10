# Plan: Track 1033: Worker Identity & Remote API Keys

## ✅ COMPLETE — All Phases Implemented (2026-03-06)

## Phase 1: Planning & Design
- [x] Analyze current worker registration flow ✅
- [x] Define "API Key" flow requirements ✅
- [x] Define Worker Visibility Levels (private, team, public) ✅
- [x] Define Worker Path Isolation requirements ✅

## Phase 2: CLI & Configuration (lc)
- [x] `lc setup` prompts for API key when `remote-api` is selected — stores as `COLLECTOR_0_TOKEN` in `.env` ✅
- [x] `lc config mode` prompts for key when switching to remote-api ✅
- [x] `lc config visibility [private|team|public]` — sets `worker.visibility` in `.laneconductor.json` ✅
- [x] `lc verify-isolation` command implemented ✅
- [x] sync.mjs already passes `Authorization: Bearer <COLLECTOR_N_TOKEN>` in all remote calls ✅

## Phase 3: Sync Worker (laneconductor.sync.mjs)
- [x] local-fs and local-api remain auth-free ✅
- [x] `upsertWorker`: priority COLLECTOR_N_TOKEN > machine_token > user token ✅
- [x] Path isolation validation in `createWorktree` — resolves and checks path is within `.worktrees/` ✅
- [x] Track number traversal check (`..` or `/` in track number rejected) ✅
- [x] `upsertWorker` sends `visibility` to `/worker/register` (reads from `config.worker.visibility`) ✅

## Phase 4: Backend (Collector) — ui/server/index.mjs
- [x] **Schema**: `api_keys`, `worker_permissions`, `workers.visibility`, `workers.user_uid` — migrated via Atlas ✅
- [x] `hashApiKey(key)` — SHA-256 helper ✅
- [x] `collectorAuth` — added SHA-256 API key lookup in `api_keys` table after machine_token check ✅
  - Sets `req.user_uid` on match, updates `last_used_at` asynchronously
- [x] `POST /worker/register` — resolves `user_uid` from Firebase auth > API key > body; stores `visibility` ✅
- [x] `POST /api/keys` — generate API key (`lc_live_...`), store SHA-256 hash (requires Firebase auth) ✅
- [x] `GET /api/keys` — list user's keys (prefix only, never raw) ✅
- [x] `DELETE /api/keys/:id` — revoke a key ✅
- [x] `PATCH /api/workers/:id/visibility` — owner can set private/team/public ✅
- [x] `GET /api/workers/:id/permissions` — owner sees team members ✅
- [x] `POST /api/workers/:id/permissions` — owner grants access ✅
- [x] `DELETE /api/workers/:id/permissions/:uid` — owner revokes access ✅

## Phase 5: Verification
- [x] 15/15 track-1033-api-keys.test.mjs tests pass ✅
- [x] Server starts without errors ✅
- [x] local-fs and local-api still zero-auth (collectorAuth fallback preserved) ✅

## Notes
- UI Kanban visibility display (showing "Shared"/"Private") not implemented — deferred, requires Firebase auth in UI which is out of scope for local-api mode
- API key generation requires Firebase auth (AUTH_ENABLED=true) — only meaningful in remote-api mode
- `/api/workers` GET visibility filtering not implemented — deferred, only meaningful in multi-user remote-api setups

## ✅ REVIEWED

## ✅ QUALITY PASSED
