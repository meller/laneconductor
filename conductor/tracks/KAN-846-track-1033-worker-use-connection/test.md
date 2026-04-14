# Tests: Track 1033 — Worker Identity & Remote API Keys

## Test Commands
```bash
# Run the full Track 1033 Vitest suite
npm test -- server/tests/track-1033-worker-auth.test.mjs

# Run all server tests (includes api-keys.test.mjs)
npm test -- server/tests/

# Run the node:test config/filesystem tests
node --test conductor/tests/track-1033-api-keys.test.mjs
```

## Test Cases

### collectorAuth Middleware
- [x] TC-1: No token in local mode → request passes through (zero-auth)
- [x] TC-2: Valid machine_token → populates req.worker_project_id and passes
- [x] TC-3: Unknown token → falls through to SHA-256 API key check
- [x] TC-4: Valid API key → SHA-256 hash matches, req.user_uid populated
- [x] TC-5: Both machine_token and API key fail → still passes in local mode (no COLLECTOR_TOKEN_ENV)

### POST /api/keys
- [x] TC-6: Generated key matches format `lc_live_<32 hex chars>`
- [x] TC-7: Key prefix is first 16 chars (`lc_live_XXXXXXXX`)
- [x] TC-8: SHA-256 hash stored in DB matches hash of the returned raw key
- [x] TC-9: Raw key returned once — GET /api/keys never returns key_hash or raw key
- [x] TC-10: Name is stored and returned
- [x] TC-11: Null name accepted (unnamed key)
- [x] TC-12: Returns 500 on DB failure

### GET /api/keys
- [x] TC-13: Returns keys for current user, ordered by created_at DESC
- [x] TC-14: Returns empty array when user has no keys
- [x] TC-15: Query uses IS NOT DISTINCT FROM for null-safe user_uid scoping
- [x] TC-16: Response never includes key_hash field

### DELETE /api/keys/:id
- [x] TC-17: Revokes owned key, returns {ok:true}
- [x] TC-18: Returns 404 when key not found or belongs to another user
- [x] TC-19: DELETE uses IS NOT DISTINCT FROM for user_uid (null-safe)
- [x] TC-20: Returns 500 on DB failure

### POST /worker/register
- [x] TC-21: Registers worker and returns machine_token
- [x] TC-22: Stores visibility field in INSERT params
- [x] TC-23: Stores mode field (e.g. sync-only)
- [x] TC-24: ON CONFLICT DO UPDATE does NOT update visibility (preserves owner setting)

### PATCH /api/workers/:id/visibility
- [x] TC-25: Sets visibility to 'private' successfully
- [x] TC-26: Sets visibility to 'team' successfully
- [x] TC-27: Sets visibility to 'public' successfully
- [x] TC-28: Rejects invalid value (e.g. 'everyone') with 400
- [x] TC-29: Rejects empty string with 400
- [x] TC-30: Returns 404 when worker not found or caller is not owner
- [x] TC-31: UPDATE is scoped to user_uid (ownership check in SQL)

### Worker Permissions (GET/POST/DELETE)
- [x] TC-32: GET returns list of user_uids with access
- [x] TC-33: GET returns empty array when no permissions exist
- [x] TC-34: GET returns 404 when caller is not owner
- [x] TC-35: POST grants access to user by user_uid
- [x] TC-36: POST is idempotent (ON CONFLICT DO NOTHING)
- [x] TC-37: POST returns 400 when user_uid is missing
- [x] TC-38: POST returns 404 when caller is not owner
- [x] TC-39: DELETE revokes access for specific user
- [x] TC-40: DELETE returns 404 when caller is not owner

### hashApiKey — SHA-256 consistency
- [x] TC-41: Same key always produces same hash
- [x] TC-42: Different keys produce different hashes
- [x] TC-43: Hash is 64 hex chars (256-bit)
- [x] TC-44: Generated key format matches lc_live_ + 32 hex chars

### Path Isolation Enforcement (REQ-8)
- [x] TC-45: Valid path inside .worktrees/ is accepted
- [x] TC-46: Path outside project root is rejected
- [x] TC-47: Sibling traversal (../) is rejected
- [x] TC-48: Project root itself (not inside .worktrees) is rejected
- [x] TC-49: null/undefined path is rejected
- [x] TC-50: '..' in track number is detected as traversal
- [x] TC-51: '/' in track number is detected as traversal
- [x] TC-52: Valid numeric track numbers pass validation
- [x] TC-53: Track numbers with hyphens (slug format) are accepted

### Team Worker Sharing — End-to-End Flow (REQ-7)
- [x] TC-54: Owner adds a teammate via POST /api/workers/:id/permissions
- [x] TC-55: GET /api/workers — team member sees team-visibility worker
- [x] TC-56: GET /api/workers — private worker not visible to other users
- [x] TC-57: Team worker claims a queued track when called with owner's machine_token
- [x] TC-58: claim-queue SQL always includes project_id + lane_action_status=queue filter
- [x] TC-59: Private worker returns empty when no eligible tracks (auth enforcement at runtime)
- [x] TC-60: Public worker claims any queued track regardless of ownership
- [x] TC-61: Revoking team access → worker no longer visible to that user

### claimQueuedTracks — Visibility Enforcement (implemented)
- [x] TC-62: `public` workers: no user filter added to SQL
- [x] TC-63: `team` workers: `worker_permissions` subquery added when AUTH_ENABLED=true
- [x] TC-64: `private` workers: `last_updated_by_uid = owner` filter added when AUTH_ENABLED=true

## Acceptance Criteria
- [x] All 57 test cases pass in `ui/server/tests/track-1033-worker-auth.test.mjs`
- [x] No regressions in existing API key tests (`api-keys.test.mjs`)
- [x] Zero-auth local-fs/local-api modes still work (TC-1, TC-5)
- [x] Path isolation logic verified (TC-45 through TC-53)
- [x] Team worker sharing end-to-end flow verified (TC-54 through TC-61)
- [x] claimQueuedTracks visibility enforcement implemented for AUTH_ENABLED mode
