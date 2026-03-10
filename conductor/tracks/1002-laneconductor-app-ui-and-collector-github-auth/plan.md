# Track 1002: Firebase Auth + Collector Auth

**Status**: in-progress

---

## Design Decision: Two Modes

LaneConductor operates in **two distinct modes** controlled by environment variables:

| Mode | Trigger | Auth | Use case |
|---|---|---|---|
| **Local** | No `VITE_FIREBASE_PROJECT_ID` in `.env` | Disabled (all routes open) | Single-developer, localhost |
| **Remote** | Firebase env vars present | Firebase login wall (GitHub, Google, Email) | Public host, team access |

Auth is entirely **opt-in**. Local mode works exactly as it does today — zero friction.

**Auth Stack**: Firebase Authentication (frontend) + Firebase Admin SDK (server-side token verification).
- Frontend: `firebase/auth` SDK → `signInWithPopup` (GitHub, Google, Email/Password) → ID token
- Server: `firebase-admin` `verifyIdToken()` → stateless JWT verification, no sessions

Firebase project: `laneconductor-site` (ID: `391617443825`)

---

## Phase 1: Firebase Auth Backend ✅ COMPLETE

**Problem**: No identity layer exists — the Express server (port 8091) accepts all requests anonymously.
**Solution**: Firebase Admin SDK verifies ID tokens on `/api/*` routes. No sessions, no cookies — stateless.

- [x] Task 1.1: Install `firebase-admin` dependency in `ui/`
- [x] Task 1.2: Create `ui/server/auth.mjs`
   - [x] `loadAuthConfig()` — checks `VITE_FIREBASE_PROJECT_ID` env var; sets `AUTH_ENABLED`
   - [x] Firebase Admin SDK initialised with ADC (works locally via `gcloud`, on GCP via service account)
   - [x] `requireAuth` middleware — verifies `Authorization: Bearer <Firebase ID token>`
   - [x] `GET /auth/me` — in local mode returns `{ user: { uid: 'local', local: true } }`; in remote mode verifies token
   - [x] `GET /auth/config` — serves Firebase web SDK config to frontend (enables dynamic init)
- [x] Task 1.3: Wire auth into `ui/server/index.mjs`
   - [x] Mount `/auth` router (always public)
   - [x] Apply `requireAuth` to all `/api/*` routes (no-op in local mode)
   - [x] `loadAuthConfig()` called at server startup before `server.listen()`
- [x] Task 1.4: DB migration `001_users.sql`
   - [x] `users` table with Firebase UID as primary key
   - [x] `projects.owner_uid` FK column (optional, future multi-user)
- [x] Task 1.5: All 29 existing tests pass (auth mocked via `server/__mocks__/auth.mjs`)

**Impact**: Local mode: zero change. Remote mode: all `/api/*` routes require a valid Firebase ID token.

---

## Phase 2: React Auth UI Layer ✅ COMPLETE

**Problem**: The React app has no login page and no Firebase SDK integration.
**Solution**: `AuthContext` fetches `/auth/config` at boot to determine mode, then initialises Firebase SDK dynamically.

- [x] Task 2.1: Install `firebase` SDK dependency in `ui/`
- [x] Task 2.2: Create `ui/src/contexts/AuthContext.jsx`
   - [x] Fetches `/auth/config` on mount → determines local vs. remote mode
   - [x] In local mode: returns synthetic `{ uid: 'local', local: true }` — no login page shown
   - [x] In remote mode: initialises Firebase SDK, listens to `onAuthStateChanged`
   - [x] Exposes `{ user, loading, idToken, authEnabled, login, logout }` via `useAuth()`
   - [x] `login()` calls Firebase `signInWithPopup` with `GithubAuthProvider`
- [x] Task 2.3: Create `ui/src/pages/LoginPage.jsx`
   - [x] Full-screen card with LaneConductor branding
   - [x] \"Sign in to LaneConductor\" UI with buttons for GitHub, Google, and Email/Password
   - [x] Handles `auth/popup-closed-by-user` gracefully
- [x] Task 2.4: Update `App.jsx`
   - [x] Unified single `<AuthProvider>` wrapping (removed separate CloudAuthProvider)
   - [x] Auth gate: loading spinner → LoginPage → dashboard
   - [x] Header shows user photo + email in remote mode; hidden in local mode
- [x] Task 2.5: Update `usePolling.js`
   - [x] Reads `idToken` from `useAuth()` and attaches as `Authorization: Bearer` header
   - [x] In local mode `idToken` is null → header omitted → routes work via `requireAuth` no-op
- [x] Task 2.6: Remove all Passport/session/Firebase-hybrid cruft
   - [x] Deleted `firebase.js`, `CloudAuthContext.jsx`, `CloudLoginPage.jsx` (wrong approach)
   - [x] Removed `passport`, `passport-github2`, `express-session` packages
   - [x] Restored clean `main.jsx`
- [x] Task 2.7: Created `ui/.env.remote.example` with actual Firebase config pre-filled

**Impact**: Local mode: zero UX change. Remote mode: Firebase popup login, dashboard loads after sign-in.

---

## Phase 3: Collector API Auth ⏳ IN PROGRESS

**Problem**: The collector API (port 8092) accepts track data from any source anonymously.
**Solution**: Per-project `api_token` (UUID) stored in `projects` table and `.laneconductor.json`. All collector write endpoints require `Authorization: Bearer <token>`.

- [x] Task 3.1: Generate `api_token` per project on collector registration
    - [x] On `POST /project` (or upsert): generate `crypto.randomUUID()` if no token yet
    - [x] Store in `projects.api_token` column (add migration if needed)
    - [x] Return token in the registration response
- [x] Task 3.2: Add `requireToken` middleware to collector (`conductor/collector/index.mjs`)
    - [x] Check `Authorization: Bearer <token>` header against `projects.api_token` in DB
    - [x] Return 401 if missing or invalid
    - [x] Apply to all write endpoints: `POST /track`, `PATCH /track/*`, `POST /heartbeat`, etc.
    - [x] Localhost-only bypass option (for development without token)
- [x] Task 3.3: Update `laneconductor.sync.mjs`
    - [x] Read `api_token` from `.laneconductor.json → collectors[0].token`
    - [x] `Authorization: Bearer <token>` is already wired (lines 28–29) — just populate the config
    - [x] If 401 received: log warning, skip (do not crash the worker)
- [x] Task 3.4: Persistence in `.laneconductor.json`
    - [x] Write `api_token` to `collectors[0].token` after first registration
    - [x] Ensure `.gitignore` includes `.laneconductor.json`

**Impact**: Collector rejects unauthenticated writes. Worker-to-collector channel is authenticated.

---

## Phase 4: E2E Flow Verification

**Problem**: Phases 1–3 were built incrementally. Need to confirm full stack works together.

- [x] Task 4.1: Verify local mode
    - [x] `npm run dev` → dashboard loads directly, no login page
    - [x] `GET /auth/config` returns `{ enabled: false }`
    - [x] `GET /auth/me` returns `{ user: { local: true } }`
    - [x] `GET /api/projects` returns 200 (no token required)
- [x] Task 4.2: Verify remote mode
    - [x] Add `.env` with Firebase config from `.env.remote.example`
    - [x] Restart server → `/auth/config` returns Firebase web config
    - [x] Visit `http://localhost:8090` → login page shown
    - [x] Click \"Continue with GitHub/Google/Email\" → popup → sign in → dashboard loads
    - [x] Confirm user photo + email in header
    - [x] Click Logout → login page returns
    - [x] `curl http://localhost:8091/api/projects` without token → 401 ✓
- [x] Task 4.3: Verify collector auth (Phase 3)
    - [x] `curl -X POST http://localhost:8092/track` → 401 ✓
    - [x] Start `laneconductor.sync.mjs` → heartbeat logs show 200 ✓
- [x] Task 4.4: Run full test suite
    - [x] `npm test` in `ui/` → all 29 tests green ✓

**Impact**: All acceptance criteria confirmed. Track moves to Review.

## ✅ REVIEWED
