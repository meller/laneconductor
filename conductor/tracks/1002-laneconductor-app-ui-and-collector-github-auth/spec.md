# Spec: GitHub OAuth + Collector Auth + Supabase Sync

## Problem Statement
The LaneConductor UI and collector API are currently unauthenticated — anyone with network access can view the dashboard, post tracks, and receive sync data. This track adds GitHub OAuth as the identity layer so:
1. Developers log in once with GitHub to access the dashboard.
2. Projects authenticate to the collector API using a per-project token tied to the GitHub user.
3. Sync to Supabase (`dual` mode) is verified to work end-to-end with auth headers.

## Requirements

- REQ-1: Users must log in with GitHub OAuth before accessing the Kanban dashboard.
- REQ-2: The Express server must handle the GitHub OAuth callback and issue a session cookie.
- REQ-3: The React UI must reflect auth state (show login page or dashboard; show user avatar + logout in header).
- REQ-4: The collector API (port 8092) must require a bearer token on write endpoints.
- REQ-5: `laneconductor.sync.mjs` must attach the project's bearer token to collector requests.
- REQ-6: Supabase dual-sync mode must be verified: a track update in local Postgres must replicate to Supabase within 5 seconds.
- REQ-7: GitHub user identity (login, avatar_url, github_id) must be stored in a `users` table in the local `laneconductor` DB.
- REQ-8: Each project row must be linkable to a GitHub user (`owner_github_id`).
- REQ-9: Env vars (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`) must be the only place credentials appear — never in committed code.
- REQ-10: Unauthenticated requests to protected API routes must return HTTP 401.

## Acceptance Criteria

- [ ] AC-1: Visiting `http://localhost:8090` without a session shows a login page with a "Continue with GitHub" button.
- [ ] AC-2: Clicking the button redirects to GitHub OAuth; after approval, user is redirected back and lands on the Kanban dashboard.
- [ ] AC-3: The dashboard header displays the GitHub avatar and username of the logged-in user.
- [ ] AC-4: A "Logout" button ends the session and returns the user to the login page.
- [ ] AC-5: `GET /api/projects` returns 401 when called without a valid session cookie.
- [ ] AC-6: `POST /track` on the collector (port 8092) returns 401 without a valid `Authorization: Bearer <token>` header.
- [ ] AC-7: `laneconductor.sync.mjs` sends the bearer token and succeeds (200) on every heartbeat.
- [ ] AC-8: When `sync_mode` is `dual`, a track PATCH visible on the local DB also appears in Supabase `tracks` table within 5 seconds.
- [ ] AC-9: A `users` table exists in the `laneconductor` DB with columns: `id`, `github_id`, `login`, `avatar_url`, `access_token`, `created_at`.
- [ ] AC-10: `npx jest` (or `npm test`) passes all auth-related unit tests.

## API Contracts

### Auth routes (Express, port 8091)
```
GET  /auth/github           → redirect to GitHub OAuth consent screen
GET  /auth/github/callback  → exchange code for token; set session cookie; redirect to /
GET  /auth/me               → 200 { login, avatar_url } if authenticated; 401 otherwise
POST /auth/logout           → clear session cookie; 200 OK
```

### Collector write endpoints (port 8092) — require `Authorization: Bearer <token>`
```
POST /track                 → 401 if no valid token; 200 on success
PATCH /track/:id            → 401 if no valid token; 200 on success
```

## Environment Variables (`.env`)
```
GITHUB_CLIENT_ID=<from GitHub OAuth app>
GITHUB_CLIENT_SECRET=<from GitHub OAuth app>
SESSION_SECRET=<random 32+ char string>
OAUTH_CALLBACK_URL=http://localhost:8091/auth/github/callback  # override for remote Vite configs
SUPABASE_URL=<e.g. https://xxx.supabase.co>
SUPABASE_SERVICE_KEY=<service role key>
```

> **Note (remote Vite):** When running Vite with `--host` or accessing from a non-localhost origin, set `OAUTH_CALLBACK_URL` to your actual server URL, register that URL in the GitHub OAuth App, and ensure the Vite proxy uses `changeOrigin: true`. The session cookie must use `sameSite: 'none'` + `secure: true` in production/remote mode.

## DB Schema Additions
```sql
CREATE TABLE IF NOT EXISTS users (
  id           SERIAL PRIMARY KEY,
  github_id    TEXT UNIQUE NOT NULL,
  login        TEXT NOT NULL,
  avatar_url   TEXT,
  access_token TEXT,
  created_at   TIMESTAMP DEFAULT NOW()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_github_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS api_token TEXT;  -- per-project bearer token
```

## Out of Scope
- Multi-org / team access control (future track)
- GitHub App (vs OAuth App) — use OAuth App for simplicity
- Email/password auth
