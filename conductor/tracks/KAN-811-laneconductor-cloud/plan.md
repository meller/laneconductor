# Track 017: Cloud Mode — Plan

## Architecture (decided)

```
Worker (file watcher)
  └─→ POST :8092/track        ← local Collector  →  local Postgres
  └─→ POST LC_URL/track       ← LC cloud Collector → Supabase (auth-gated, fire-and-forget)

UI Dashboard (React)
  └─→ GET  :8091/api/...      ← UI Reader Express →  Postgres (read-only)
```

### Setup collection — collector picker (3 options)

```
Which collectors?
  [1] Local only    — local Postgres + local collector (default, works today)
  [2] LC cloud      — laneconductor.io managed (paste token)
  [3] Both          — local primary + LC cloud fire-and-forget
```

No self-hosted option for now. Either your machine or ours.

### Config shape

```json
{
  "project": { ... },
  "collectors": [
    { "url": "http://localhost:8092", "token": null },
    { "url": "https://collector.laneconductor.io", "token": "lc_xxxx" }
  ],
  "ui": { "port": 8090 }
}
```

Tokens in `.env` as `COLLECTOR_0_TOKEN`, `COLLECTOR_1_TOKEN`.
DB credentials only on the collector side — never in the worker.

### Repo structure

```
laneconductor/
├── conductor/
│   ├── tracks/
│   ├── laneconductor.sync.mjs    ← worker (file watcher → HTTP POST)
│   └── collector/
│       └── index.mjs             ← local Collector Express :8092
│
├── ui/
│   ├── src/                      ← React dashboard
│   └── server/
│       └── index.mjs             ← UI Reader Express :8091 (unchanged)
│
└── cloud/
    └── functions/
        └── collector.mjs         ← Firebase Function (LC cloud Collector) — Phase 3
```

`make lc-start` → worker + local collector together
`make lc-ui-start` → UI + reader (unchanged)

---

## Phase 1: Dual Sync (direct DB in worker) ✅ COMPLETE — superseded

Added `cloudPool` + `dualQuery` directly in the worker. Superseded by collector pattern.
Supabase schema, `.gitignore`, `.env` setup, data sync all remain valid.

---

## Phase 2: Local Collector + Worker Refactor ✅ COMPLETE

**Problem**: Worker writes directly to Postgres — couples it to DB credentials, makes
local and cloud paths fundamentally different code.
**Solution**: Extract DB writes into a Collector Express server. Worker becomes pure
file watcher + HTTP poster. Same worker code for all collector targets.

- [x] Task 1: Created `conductor/collector/index.mjs` — Express :8092
    - `POST /track`, `POST /conductor-files`, `GET /health`, `GET /project`
    - `POST /worker/register`, `PATCH /worker/heartbeat`, `DELETE /worker`
    - `POST /tracks/claim-waiting` (FOR UPDATE SKIP LOCKED), `POST /tracks/heartbeat`
    - `PATCH /track/:num/action`, `PATCH /track/:num/heartbeat`, `PATCH /track/:num/block`
    - `GET /track/:num/retry-count`, `GET /tracks/stale`
    - Optional auth: `Authorization: Bearer` if `COLLECTOR_0_TOKEN` env set
- [x] Task 2: Collector reads DB config from `.laneconductor.json` + `.env`
- [x] Task 3: Refactored `laneconductor.sync.mjs` — zero `pg` imports
    - All DB calls replaced with `fetch()` to collectors array
    - `postToCollectors()` / `patchCollectors()` helpers — primary awaited, rest fire-and-forget
    - Orchestration loop uses collector HTTP endpoints (no direct DB access)
- [x] Task 4: Updated `.laneconductor.json` — `collectors` array replaces `db`/`cloud_db`/`sync_mode`
- [x] Task 5: Updated `Makefile` — `lc-start` starts collector + worker; `lc-stop` stops both
- [x] Task 6: Update SKILL.md `setup collection` — replace sync mode prompts with 3-option collector picker

**Impact**: Worker has zero DB knowledge. Adding LC cloud later = paste URL + token into config.

---

## Phase 3: LC Cloud Collector — Firebase Functions ✅ COMPLETE

**Problem**: Cloud users need an always-on collector endpoint at laneconductor.io.
**Solution**: Firebase Function with same HTTP contract as local collector.
Supabase as DB. Token = Firebase ID token or API key minted at sign-up.

- [x] Task 1: Firebase Auth — Google + email/password (existing `laneconductor-site` project)
- [x] Task 2: Sign-up flow → mint `lc_xxxx` API token → store in Supabase `users` table
- [x] Task 3: `cloud/functions/collector.mjs` — same routes as local collector
    - `POST /track`, `POST /project`, `POST /heartbeat`, `POST /log`
    - Auth middleware: verify `lc_xxxx` token against `users` table
    - All writes scoped to `user_id` (row-level isolation)
- [x] Task 4: Supabase pool using `defineSecret('CLOUD_DB_PASSWORD')`
- [x] Task 5: Deploy + expose URL (e.g. `https://collector.laneconductor.io`)
- [x] Task 6: CORS config for local worker origin
- [x] Task 7: Add to `setup collection` as option [2] / [3]

**Impact**: User pastes URL + token into `.laneconductor.json`. Worker unchanged.

---

## Phase 4: Cloud UI Reader + Dashboard ✅ COMPLETE

- [x] Task 1: `cloud/functions/reader.js` — port read routes from `ui/server/index.mjs`
    - All read routes ported with workspace scoping via `workspace_id` authorization
    - Supports both API token auth (worker) and Firebase ID token auth (UI)
- [x] Task 2: Supabase pool, all queries scoped to `user_id`/`workspace_id`
    - All queries in reader.js filtered by workspace_id
    - Access control enforced at query level via joins
- [x] Task 3: `VITE_CLOUD_MODE` build — Firebase Hosting serves cloud UI
    - vite.config.js updated with VITE_CLOUD_MODE and VITE_API_URL/VITE_AUTH_URL env vars
    - firebase.json created with hosting config + function deployments
    - npm script: `npm run build:cloud` sets env and builds for Firebase Hosting
- [x] Task 4: Login page, AuthContext, protected routes
    - AuthContext.jsx polls /auth/me to detect local vs cloud mode
    - LoginPage.jsx shows GitHub OAuth button in cloud mode
    - App.jsx gates dashboard with useAuth() hook — redirects to LoginPage if not authenticated
- [x] Task 5: "Connect worker" onboarding — show token, copy collector URL
    - WorkerOnboarding.jsx component created with token/URL display + copy buttons
    - Shows setup instructions for connecting local worker to cloud collector (lc_xxxx token format)
    - Firebase.js initialized for cloud mode with Firebase SDK loading
    - Can be triggered from settings/onboarding modal in main UI
    - Updated usePolling hook to support cloud mode with Firebase token Authorization header
    - Updated AuthContext to support Firebase Auth state management in cloud mode
    - Updated LoginPage to handle GitHub OAuth via Firebase Auth in cloud mode

---

## Phase 5: Billing — Stripe

- [ ] Task 1: Free / Pro plan definition
- [ ] Task 2: Stripe Checkout session endpoint
- [ ] Task 3: Stripe webhook → `subscriptions` table in Supabase
- [ ] Task 4: Feature gates, billing page, waitlist invite flow

---

## Phase 6: `/laneconductor syncdb` Command ✅ COMPLETE

**Problem**: Switching collectors (local → cloud) loses comment history — comments are DB-only.
**Solution**: Export/import utility + filesystem touch to trigger re-sync.

- [x] Task 1: Export `track_comments` from source → JSON
    - `conductor/syncdb.mjs` exports comments via query: tracks + projects join to get context
- [x] Task 2: Apply schema to target
    - syncdb.mjs creates `track_comments` table if missing (idempotent)
- [x] Task 3: Touch all markdown files → worker re-syncs tracks
    - syncdb.mjs updates file mod times in conductor/tracks/NNN-*
- [x] Task 4: Import comments to target
    - Matches by (project_name, track_number), inserts to target DB
    - Skips unmatched comments with warning
- [x] Task 5: Update config + restart
    - User updates `.laneconductor.json` collectors array
    - Runs `make lc-stop` then `make lc-start` to switch active collector
- [x] Task 6: Add to SKILL.md
    - `/laneconductor syncdb` command documented with usage examples

---

## Quality Gate Review ⚠️ FAILED (2026-02-27)

**Coverage**: 50.4% (required: ≥80%)
- server/auth.mjs: 97.74% ✅
- server/index.mjs: 42.06% ❌ (needs integration tests)
- server/utils.mjs: 100% ✅
- server/wsBroadcast.mjs: 100% ✅

**Reason for failure**: Dashboard routes in `server/index.mjs` lack integration test coverage.

**Action required**: Add 10-15 integration tests covering:
- GET /api/projects/:id (fetch tracks, status)
- PATCH /api/projects/:id (update workflow)
- WebSocket broadcast callbacks
- Track polling loop + state transitions

See conversation.md for full review.
