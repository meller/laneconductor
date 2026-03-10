# Tests: Track 1046 — Cloud /api/keys endpoints

## Test Commands
```bash
# Syntax check the cloud function
node --check cloud/functions/index.js

# Deploy and smoke-test (requires gcloud auth)
firebase deploy --only functions --project laneconductor-site

# Manual curl tests (replace TOKEN with a real Firebase ID token)
TOKEN="<firebase-id-token>"
BASE="https://api-pu7bcq73zq-uc.a.run.app"

# List keys (should return [])
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/keys

# Create a key
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"test-key"}' $BASE/api/keys

# Delete a key (replace ID)
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" $BASE/api/keys/1
```

## Test Cases

### Phase 1: /api/keys endpoints

- [ ] TC-1: `GET /api/keys` without auth returns 401
- [ ] TC-2: `GET /api/keys` with valid Firebase token returns 200 + JSON array
- [ ] TC-3: `POST /api/keys` with `{ name: "test" }` returns `{ ok, key, key_prefix, name }` where `key` starts with `lc_live_`
- [ ] TC-4: After POST, `GET /api/keys` returns array containing the new key (prefix visible, no raw key or hash)
- [ ] TC-5: `DELETE /api/keys/:id` returns 200 for own key
- [ ] TC-6: `DELETE /api/keys/:id` returns 404 for already-deleted key
- [ ] TC-7: `DELETE /api/keys/:id` returns 404 for another user's key (ownership enforced)

### Phase 2: Auth middleware api_keys support

- [ ] TC-8: Worker authenticating with `lc_live_` key (from api_keys table) gets 200 on a protected endpoint (e.g. `GET /api/projects`)
- [ ] TC-9: `api_tokens` plaintext lookup still works after the change (backward compat)
- [ ] TC-10: Invalid `lc_` token returns 401

### Phase 3: Syntax & deploy

- [ ] TC-11: `node --check cloud/functions/index.js` exits 0 (no syntax errors)
- [ ] TC-12: AccountPanel opens without JS errors on app.laneconductor.com
- [ ] TC-13: Generating a key in the UI and copying it works end-to-end

## Acceptance Criteria
- [ ] All TC-1 through TC-13 pass
- [ ] No regressions on existing auth endpoints (`/auth/token`, `/health`, `/api/projects`)
