# Track 1046: Cloud /api/keys endpoints missing

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: Complete
**Summary**: The /api/keys (GET/POST/DELETE) endpoints implemented in ui/server/index.mjs for API key management were never ported to cloud/functions/index.js. The AccountPanel and ProjectConfigSettings UI components call /api/keys which returns 404 on app.laneconductor.com. Needs: POST /api/keys (generate lc_live_ key, store SHA-256 hash), GET /api/keys (list by firebase_uid, prefix only), DELETE /api/keys/:id (revoke). Also update auth middleware to check api_keys table (key_hash) in addition to api_tokens table.

## Problem
`/api/keys` returns 404 on `app.laneconductor.com` — the endpoints exist in the local server but were never added to `cloud/functions/index.js`.

## Solution
Port the three `/api/keys` endpoints from `ui/server/index.mjs` to `cloud/functions/index.js`, and update the cloud auth middleware to also accept `api_keys` table tokens (SHA-256 hashed).

## Phases
- [ ] Phase 1: Add POST/GET/DELETE /api/keys to cloud/functions/index.js
- [ ] Phase 2: Update cloud auth middleware to support api_keys table
- [ ] Phase 3: Deploy and verify
