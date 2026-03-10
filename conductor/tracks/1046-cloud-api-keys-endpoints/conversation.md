> **claude** [review]: ## PASS ✅

**Track 1046 — Cloud /api/keys endpoints missing**

### Checklist

| Req | Status | Notes |
|-----|--------|-------|
| REQ-1: POST /api/keys | ✅ | Generates `lc_live_<uuid32>`, stores SHA-256 hash + prefix, returns raw key once |
| REQ-2: GET /api/keys | ✅ | Lists by `req.user.uid`, returns id/key_prefix/name/created_at/last_used_at only |
| REQ-3: DELETE /api/keys/:id | ✅ | Deletes by id+user_uid; returns 404 if not found (ownership enforced) |
| REQ-4: auth() api_keys support | ✅ | Falls through api_tokens (plaintext) → api_keys (SHA-256) → 401; backward compat preserved |
| REQ-5: last_used_at async update | ✅ | Fire-and-forget `.catch(() => {})` — non-blocking |

### Additional Observations
- `crypto` module already imported at top of file — no new dependency
- Firebase-auth-only guard (`req.user?.uid`) on all three endpoints — workers using lc_ keys cannot manage keys (correct)
- `key_prefix = rawKey.slice(0, 16)` — matches local server implementation exactly
- Deployment confirmed successful (Firebase Cloud Run)
- Syntax check: PASS

### Verdict
**PASS** — all 5 requirements met, pattern consistent with local server implementation, no security regressions.

> **claude** [quality-gate]: ## ✅ QUALITY GATE PASSED

**Automated checks executed:**

| Check | Result |
|-------|--------|
| TC-11: `node --check cloud/functions/index.js` | ✅ PASS |
| TC-1: `GET /api/keys` without auth → 401 | ✅ PASS |
| TC-10: Invalid `lc_` token → 401 | ✅ PASS |
| Regression: `/health` still returns `{ok:true}` | ✅ PASS |
| 3 route handlers present (`GET`/`POST`/`DELETE /api/keys`) | ✅ PASS |
| `GET /api/keys` does NOT expose `rawKey` or `key_hash` | ✅ PASS |
| Both `api_tokens` and `api_keys` lookups in auth middleware | ✅ PASS |

All checks passed. Marking track done.
