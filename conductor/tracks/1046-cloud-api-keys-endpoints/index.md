# Cloud Api Keys Endpoints

**Lane**: done
**Lane Status**: success

# Cloud Api Keys Endpoints

**Lane**: done
**Lane Status**: done

# Track 1046: Cloud /api/keys endpoints missing

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: Complete
**Summary**: Three endpoints missing from cloud function — UI gets 404.

## Problem
`/api/keys` returns 404 on `app.laneconductor.com` — the endpoints exist in the local server but were never added to `cloud/functions/index.js`.

## Solution
Port the three `/api/keys` endpoints from `ui/server/index.mjs` to `cloud/functions/index.js`, and update the cloud auth middleware to also accept `api_keys` table tokens (SHA-256 hashed).

## Phases
- [ ] Phase 1: Add POST/GET/DELETE /api/keys to cloud/functions/index.js
- [ ] Phase 2: Update cloud auth middleware to support api_keys table
- [ ] Phase 3: Deploy and verify


