# Track 1046: Cloud /api/keys endpoints missing

## Phase 1: Add /api/keys endpoints to cloud/functions/index.js

**Problem**: Three endpoints missing from cloud function — UI gets 404.
**Solution**: Port POST/GET/DELETE /api/keys from ui/server/index.mjs, using the same `crypto.randomUUID` + SHA-256 hash pattern.

- [x] Add `POST /api/keys` — generate `lc_live_<uuid>` key, store hash+prefix in `api_keys`, return raw key once
- [x] Add `GET /api/keys` — list by `firebase_uid` from `req.user.uid`, return prefix/name/timestamps only
- [x] Add `DELETE /api/keys/:id` — delete by id WHERE user_uid matches firebase_uid; 404 if not found
- [x] Ensure `crypto` is already imported (it is — `const crypto = require("crypto")`)

**Impact**: AccountPanel and ProjectConfigSettings will load and manage API keys on the cloud app.

## Phase 2: Update cloud auth middleware for api_keys table

**Problem**: Cloud `auth()` only checks `api_tokens` (plaintext). Workers using `lc_live_` keys from `api_keys` (hashed) cannot authenticate.
**Solution**: After failing `api_tokens` lookup, try SHA-256 hash lookup against `api_keys`. Update `last_used_at` async.

- [x] In `auth()`, after `api_tokens` lookup fails (rows.length === 0), compute `SHA-256(bearer)` and query `api_keys WHERE key_hash = $1`
- [x] If found: set `req.workspace_id` — need to resolve via `workspace_members WHERE firebase_uid = user_uid`
- [x] Update `last_used_at` asynchronously (fire-and-forget, don't await)
- [x] Keep `api_tokens` lookup first for backward compat with existing worker tokens

**Impact**: Workers configured with `lc_live_` keys can authenticate to the cloud collector.

## Phase 3: Deploy and verify

- [x] `firebase deploy --only functions --project laneconductor-site`
- [x] Verify `GET /api/keys` returns 200 on app.laneconductor.com (open AccountPanel)
- [x] Verify `POST /api/keys` generates a key visible in the UI
- [x] Verify `DELETE /api/keys/:id` removes the key

**Impact**: Feature live on production.

## ✅ COMPLETE

## ✅ REVIEWED

## ✅ QUALITY PASSED
