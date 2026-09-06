# Tests: Track 10070 — Adopt PR #1's legacy `api_tokens` hashing fix

## Test Commands

```bash
# Cloud function unit + integration (jest + supertest, mocked pg/firebase).
# Not currently in conductor/quality-gate.md's command list — it needs to be.
cd cloud/functions && npm test

# This track's suite alone
cd cloud/functions && npx jest test/api-tokens-hashing.test.js

# Syntax check on the files this track touches (reader.mjs is ESM, so
# `node --check` on it needs the .mjs extension to be honoured)
node --check cloud/functions/index.js
node --check cloud/functions/reader.js
node --check cloud/functions/reader.mjs

# Migration, against a throwaway Postgres (see "Migration verification" below)
atlas migrate hash --dir "file://migrations"
atlas migrate validate --dir "file://migrations" --dev-url "$DEV_URL"
```

New test file:
- `cloud/functions/test/api-tokens-hashing.test.js` (all phases)

## Test Cases

### Phase 1 — Hash on write (`POST /auth/token`)

- [x] TC-1: `POST /auth/token` for a first-time caller — expected: 200, body's
      `token` matches `/^lc_[0-9a-f]{48}$/`, and the value bound into `INSERT INTO
      api_tokens` is 64-hex, is **not** the returned token, and equals
      `sha256(returned)`. The core invariant: what goes over the wire and what
      lands in the column are different strings. (REQ-1)
- [x] TC-2: same request — expected: the raw token appears in **no** bind
      parameter of **any** statement. Guards the sideways leaks TC-1 can't see: a
      second column, a later statement. (REQ-1)
- [x] TC-3: `POST /auth/token` when a row already exists for `(workspace_id,
      created_by)` — expected: 200, body is exactly `{ workspace_id }` with no
      `token`, and no `INSERT INTO api_tokens` runs at all. (REQ-2, RC7)

### Phase 2 — Hash on read, with self-heal (`auth()`)

- [x] TC-4: request with a valid bearer whose row is stored hashed — expected:
      200, and the `api_tokens` lookup's first bind parameter is the digest, not
      the raw token. (REQ-3)
- [x] TC-5: same, but the row is still in plaintext form — expected: 200. This is
      the whole reason the change is safe to deploy in either order relative to
      the migration. (REQ-4)
- [x] TC-6: same as TC-5 — expected: an `UPDATE api_tokens SET token` runs with
      exactly `[digest, raw]`. The table has to converge on its own, or the
      plaintext arm becomes a permanent second way in. (REQ-4)
- [x] TC-7: TC-4's hashed row — expected: **no** `UPDATE api_tokens SET token`.
      The counterpart to TC-6: an already-migrated row must not be rewritten on
      every request. (REQ-4)
- [x] TC-8: an `lc_` bearer matching nothing in either table — expected: 401 with
      `invalid api token`. Widening the lookup to two arms must not turn a miss
      into a fall-through. (REQ-8)
- [x] TC-8b: a bearer that matches an `api_keys` row — expected: 200, and the
      `api_keys` lookup binds the *same* digest `auth()` already computed, i.e.
      exactly one digest per request and the `api_keys` path unchanged.
      (REQ-3, REQ-8)

### Phase 3 — Migration

- [x] TC-10: property check — for 2000 distinct inputs, every SHA-256 hex digest
      matches `/^[0-9a-f]{64}$/` and none starts `lc_`. This is what makes
      `left(token, 3) = 'lc_'` an exact predicate rather than a heuristic, makes
      the migration idempotent, and makes TC-5's `OR` arm address a disjoint set
      of rows. (REQ-5)

Migration verification (manual, against a throwaway Postgres cluster — recorded
here because it is not automatable in this repo's harness, which has no live DB):

- [x] TC-11: seed plaintext `lc_` rows, `atlas migrate apply` — expected: every
      row 64-hex (`bool_and(token ~ '^[0-9a-f]{64}$')` is true), and `SELECT
      count(*) … WHERE left(token,3) = 'lc_'` is 0. (REQ-5)
- [x] TC-12: apply twice more — expected: `UPDATE 0` each time, table unchanged.
      (REQ-5)
- [x] TC-13: for each seeded token, Postgres's `encode(sha256(token::bytea),
      'hex')` equals Node's `crypto.createHash('sha256').update(token)
      .digest('hex')` — expected: byte-identical. If these two disagree the
      migration silently locks every worker out, and no unit test would catch it.
      (REQ-5, REQ-4)

### Phase 4 — The raw token stops travelling past `auth()`

- [x] TC-9: `POST /file-sync/claim` with a valid bearer — expected: the
      `UPDATE file_sync_queue` binds a `worker_id` that is **not** the raw token,
      and is the digest's first 12 characters. (REQ-6)

### Phase 5 — The tests test something

- [x] TC-14: stash the implementation and re-run the suite — expected: it fails.
      Result: 6 of 11 cases fail without the fix (TC-1, TC-2, TC-3, TC-4, TC-6,
      TC-9), which is the expected set — TC-5, TC-7, TC-8 and TC-8b describe
      behaviour that was already correct or vacuously true beforehand, and TC-10
      is a property of SHA-256 rather than of this code.

## Acceptance Criteria

- [x] A worker whose `.env` already contains a `COLLECTOR_<n>_TOKEN` keeps
      working across the migration without anyone editing its config, restarting
      it, or reissuing anything. This is the user-visible promise that made
      rehash the right call over reissue. **Verified end-to-end** on the
      throwaway cluster: seeded three plaintext tokens representing the three
      real client sources (`.env`, GCP Secret Manager, inline
      `.laneconductor.json`), applied the migration, then confirmed in Node that
      `hashToken(raw)` equals the value Postgres wrote for each — so `auth()`'s
      digest lookup still finds every row using the token the worker already
      holds.
- [x] Someone who obtains a full dump of the `api_tokens` table cannot
      authenticate as anyone with its contents. Post-migration every row is
      64-hex (TC-11) and issuance stores only a digest (TC-1, TC-2).
- [x] The same is true of `file_sync_queue` — no table in the database holds a
      value that can be replayed as a credential. `req.api_token` no longer
      exists on the request object at all (Task 4.1), so this is enforced by
      absence rather than by remembering; TC-9 pins the claim label.
- [x] Signing in to the UI repeatedly no longer adds a row to `api_tokens` each
      time (TC-3).
- [x] Deploying the function and applying the migration in either order, with any
      gap between them, causes no failed worker authentication (TC-4 + TC-5
      cover both arms; TC-6 makes the table converge without the migration).
- [x] `cd cloud/functions && npm test` shows no new failures. Baseline before
      this track: 61 passed, 1 failed (`GET /health` route-manifest assertion,
      pre-existing and unrelated). After: **72 passed, same 1 failed.**
- [x] The quality gate's automated checks show nothing new — see the
      quality-gate record in `index.md`. This track touches only
      `cloud/functions/`, `migrations/`, and two schema comments; every failure
      in the `conductor`/`ui` suites was diff-confirmed pre-existing, and the one
      failing test that does read `cloud/functions/index.js`
      (`cloud-route-parity`) fails identically with the change stashed.
