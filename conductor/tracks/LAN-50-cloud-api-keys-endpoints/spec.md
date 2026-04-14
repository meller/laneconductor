# Spec: Cloud /api/keys endpoints missing

## Problem Statement
The AccountPanel and ProjectConfigSettings UI components call `/api/keys` (GET/POST/DELETE) on `app.laneconductor.com`. These endpoints were implemented in `ui/server/index.mjs` (local dev server) but were never ported to `cloud/functions/index.js`. All calls return `Cannot GET /api/keys` (404).

Additionally, the cloud `auth()` middleware only checks the `api_tokens` table (plaintext token lookup). Workers using keys from the `api_keys` table (SHA-256 hashed, generated via the UI) cannot authenticate against the cloud collector.

## Requirements
- REQ-1: `POST /api/keys` — generate a `lc_live_<uuid>` key, store SHA-256 hash + prefix in `api_keys`, return raw key once (never stored)
- REQ-2: `GET /api/keys` — list keys for the authenticated Firebase user (prefix + name + timestamps, no raw key or hash)
- REQ-3: `DELETE /api/keys/:id` — revoke a key; only the owner (by `firebase_uid`) may delete
- REQ-4: Cloud `auth()` middleware — when bearer starts with `lc_`, also check `api_keys` table via SHA-256 hash lookup (in addition to existing `api_tokens` plaintext lookup)
- REQ-5: `last_used_at` updated asynchronously on successful `api_keys` auth (fire-and-forget)

## Acceptance Criteria
- [ ] `GET /api/keys` returns 200 + array after Firebase auth
- [ ] `POST /api/keys` returns `{ ok, key, key_prefix, name }` — raw key shown once
- [ ] `DELETE /api/keys/:id` returns 200; second attempt returns 404
- [ ] Worker using an `lc_live_` key from `api_keys` table can authenticate to cloud collector
- [ ] `last_used_at` is updated after successful api_keys auth

## Data Model (existing — cloud Supabase DB)
```sql
-- Already migrated (20260306103650_worker_security.sql)
CREATE TABLE api_keys (
  id           serial PRIMARY KEY,
  user_uid     text,          -- firebase_uid; nullable (20260306190414 migration)
  key_hash     text NOT NULL UNIQUE,  -- SHA-256 hex
  key_prefix   text NOT NULL,         -- first 16 chars e.g. lc_live_XXXXXXXX
  name         text,
  created_at   timestamp DEFAULT NOW(),
  last_used_at timestamp
);
```

## Files to Modify
- `cloud/functions/index.js` — add 3 endpoints + update auth middleware
