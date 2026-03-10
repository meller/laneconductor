# Spec: Track 017 — LaneConductor Cloud

## Problem Statement

LaneConductor is local-only. Teams can't share a live Kanban view, and there's no
persistent cloud record of project state. We need a cloud path that's frictionless
for solo devs and scales to teams — without touching the local-only experience.

## Core Principle

**Local = zero config, zero auth, always works.**
Cloud is an optional add-on. A user who never signs up gets the full local experience.

---

## Auth Model

| Mode | Auth |
|------|------|
| Local only | None |
| LC cloud (solo or team) | GitHub OAuth via Firebase Auth |

**Why GitHub OAuth:**
- One button, no passwords
- GitHub org = workspace. Members inherited automatically.
- User leaves the GitHub org → LC access revoked automatically. No "who ran setup first" problem.
- Firebase Auth supports GitHub as a provider natively — enable in console, done.

---

## Data Model

### `git_global_id`
Deterministic UUID derived from the git remote URL:
```
git_global_id = UUID_v5(namespace, git_remote_url)
```
Everyone who checks out the same repo gets the same `git_global_id` — no coordination needed.
Falls back to a random UUID if no git remote (local-only project).
Stored in `.laneconductor.json` under `project.git_global_id`.

### Schema additions

```sql
-- Workspaces (GitHub org or personal account)
CREATE TABLE workspaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_org      TEXT UNIQUE NOT NULL,   -- e.g. "acme-corp" or "user" (personal)
  display_name    TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Workspace members (synced from GitHub org via OAuth)
CREATE TABLE workspace_members (
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  firebase_uid    TEXT NOT NULL,
  github_username TEXT NOT NULL,
  role            TEXT DEFAULT 'member',  -- admin|member
  joined_at       TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (workspace_id, firebase_uid)
);

-- Projects: add columns
ALTER TABLE projects
  ADD COLUMN git_global_id  UUID UNIQUE,   -- deterministic from git remote
  ADD COLUMN workspace_id   UUID REFERENCES workspaces(id);
```

### Collector auth

Local collector: no auth (localhost only).
LC cloud collector:
- GitHub OAuth → Firebase ID token
- Collector verifies token → extracts GitHub org → finds workspace
- Write allowed if `firebase_uid` is in `workspace_members`
- All rows scoped to `workspace_id` (RLS in Supabase)

### Collision handling

| Situation | Outcome |
|-----------|---------|
| First user for this `git_global_id` | Create project, link to their workspace |
| Same user, second machine | Upsert — already linked |
| Different user, same workspace (same org) | Allowed |
| Different user, different workspace | 403 — project owned by another org |
| No git remote | Local-only, random UUID, no collision possible |

---

## Setup Collection — Collector Options

```
Which collectors?
  [1] Local only    — local Postgres + local collector (default, works today)
  [2] LC cloud      — laneconductor.io (sign in with GitHub → token written to .env)
  [3] Both          — local primary, LC cloud fire-and-forget
```

---

## Collector HTTP Contract

Both local and cloud collectors expose identical routes:

```
POST /project     { git_global_id, git_remote, name, repo_path }
POST /track       { project_git_global_id, track_number, title, lane_status, ... }
POST /heartbeat   { project_git_global_id, worker_id, pid }
POST /log         { project_git_global_id, track_number, tail }
GET  /health      → { ok: true }
```

Auth header (cloud only): `Authorization: Bearer <firebase_id_token>`

---

## Acceptance Criteria

### Phase 2 — Local Collector (immediate)
- [x] `conductor/collector/index.mjs` starts on :8092, accepts all routes
- [x] Worker has zero `pg` imports — only HTTP POSTs to collectors
- [x] `collectors` array in config replaces `db`/`cloud_db`/`sync_mode`
- [x] `make lc-start` starts both collector and worker together
- [x] `git_global_id` generated at setup, stored in `.laneconductor.json`
- [x] Existing local dashboard continues working unchanged

### Phase 3 — LC Cloud Collector
- [ ] GitHub OAuth via Firebase Auth — one button sign-in
- [ ] Workspace created/linked from GitHub org
- [ ] Cloud collector accepts writes, scoped to workspace
- [ ] Same repo, two org members → both can write
- [ ] User removed from GitHub org → rejected on next heartbeat, no LC admin needed
- [ ] Worker retries cloud collector on next heartbeat after access granted — no re-setup

### Phase 4 — Cloud Dashboard
- [ ] Cloud UI shows same Kanban, data from Supabase
- [ ] Team members see updates in real time (2s poll)
