# Track AM-10070: Adopt PR #1's legacy `api_tokens` hashing fix

Phases are ordered so that no intermediate state can break authentication. The
read path learns to accept both forms (Phase 2) before anything rewrites stored
rows (Phase 3), and the write path stops producing new plaintext (Phase 1) before
the migration claims the table is clean. Every phase is independently
committable.

The whole change is one commit's worth of code in practice, but the ordering
matters enough to write down: reversing Phases 2 and 3 produces exactly the
outage the maintainer's review warned about.

---

## Phase 1: Hash on write

**Problem**: `POST /auth/token` inserts the raw minted token
(`cloud/functions/index.js:439`, RC2). PR #1 left this untouched, so its diff
would have broken newly minted tokens too — the vulnerability was never closed.
Separately the endpoint mints unconditionally while its only caller discards the
response (RC7), so the table accumulates one live unusable credential per
sign-in.

**Solution**: Store the digest, return the raw value, and mint only for a caller
who doesn't already have a token.

- [x] Task 1.1: Add a single `hashToken(rawToken)` helper in
      `cloud/functions/index.js`, ahead of `auth()`, and route `/api/keys`'s
      inline `createHash` through it too — one definition of what "hashed" means
      for both credential tables. (REQ-3, RC6)
    - [x] Sub-task: record in the comment *why* SHA-256 and not bcrypt/argon2 —
          these are full-entropy random values, not user-chosen passwords, so
          there is no dictionary to attack and nothing for a slow KDF to buy.
- [x] Task 1.2: `INSERT INTO api_tokens` binds `hashToken(token)`; the raw token
      goes only into the response body. (REQ-1)
- [x] Task 1.3: Probe `SELECT 1 FROM api_tokens WHERE workspace_id = $1 AND
      created_by = $2 LIMIT 1` first and return `{ workspace_id }` on a hit,
      minting nothing. (REQ-2)

**Impact**: Newly issued tokens are never stored in a usable form. The response
shape changes for repeat callers — the in-repo caller
(`ui/src/contexts/AuthContext.jsx:76`) ignores the body, so nothing in the
repository is affected, but the function is `invoker: "public"` and this belongs
in the PR description.

---

## Phase 2: Hash on read, with a self-healing plaintext fallback

**Problem**: `auth()` binds the raw bearer (`cloud/functions/index.js:234`,
RC1) — it is the read path that forces plaintext storage. Hashing it naively
breaks every existing row, and because `scripts/deploy.sh` applies migrations
(`:89`) but leaves the function deploy manual (`:96`), *either* deploy order
leaves a window where all `lc_` auth fails.

**Solution**: Compare digests, accept a plaintext row as well, and upgrade it on
the way through.

- [x] Task 2.1: Hoist one `const tokenHash = hashToken(bearer)` and use it for
      both the `api_tokens` and the `api_keys` lookups (and the `last_used_at`
      update). Removes the duplicate-digest smell PR #1's diff would have added.
      (REQ-3)
- [x] Task 2.2: Look up `WHERE token = $1 OR token = $2` with `[tokenHash,
      bearer]`, selecting `token` as well so the handler can tell which arm
      matched. Document that the arms are provably disjoint: `$2` reached here
      only by starting with `lc_`, and a hex digest cannot start with `l`.
      (REQ-4, REQ-8)
- [x] Task 2.3: When the plaintext arm matched, fire `UPDATE api_tokens SET token
      = $1 WHERE token = $2` with `.catch(() => {})` — same fire-and-forget shape
      as the existing `last_used_at` update. Comment it as removable once every
      deployment is migrated. (REQ-4)
- [x] Task 2.4: Same hashed-with-fallback lookup in `cloud/functions/reader.js`
      and `cloud/functions/reader.mjs`, without the rehash — the reader function
      is read-only. (REQ-7)

**Impact**: Auth works against a hashed row, against an unmigrated plaintext row,
and across a deploy in either order. The table converges even if Phase 3 is never
applied.

---

## Phase 3: Bulk data migration

**Problem**: Every row already in `api_tokens` is plaintext (RC3). Phase 2 makes
them keep working, but they are still the leak the report was about, and the
plaintext arm of the lookup stays live as long as any of them exist.

**Solution**: One hand-written DML migration, following the precedent of
`migrations/20260904130500_delete_null_project_tracks.sql`.

- [x] Task 3.1: `migrations/20260906120000_hash_legacy_api_tokens.sql` —
      `UPDATE api_tokens SET token = encode(sha256(token::bytea), 'hex') WHERE
      left(token, 3) = 'lc_';`. `sha256(bytea)` is built into Postgres 11+, so no
      `pgcrypto`. (REQ-5)
    - [x] Sub-task: comment block covering the root cause, rehash-vs-reissue
          rationale, the idempotency proof, why rewriting a PRIMARY KEY value is
          safe here, why either apply order is safe, and — explicitly — that this
          is **not** a revocation.
- [x] Task 3.2: `atlas migrate hash` to regenerate `migrations/atlas.sum`; a
      hand-written file fails `atlas migrate validate` without it.
- [x] Task 3.3: Verify against a throwaway Postgres: seed plaintext rows, apply,
      assert every row is 64-hex and zero rows match `left(token,3) = 'lc_'`,
      re-apply and assert `UPDATE 0`. Confirm the Postgres digest is
      byte-identical to Node's for the same input — the two implementations have
      to agree or Phase 2 stops matching.

**Impact**: No plaintext credential remains at rest. Existing workers keep
authenticating with the token already in their `.env` — the entire reason for
choosing rehash over reissue.

---

## Phase 4: Stop propagating the raw token into a second table

**Problem**: `cloud/functions/index.js:1674` writes `req.api_token` — the live
bearer — into `file_sync_queue.worker_id` (RC4). Hashing `api_tokens` while this
stands just moves the plaintext credential to a table with no pretence of being a
credential store.

**Solution**: Stop putting the token on the request object at all; carry the
digest and label the claim with a prefix of it.

- [x] Task 4.1: Replace both `req.api_token = bearer` assignments in `auth()`
      with `req.api_token_hash = tokenHash`, so no code downstream of auth can
      reach the raw value even by accident. (REQ-6)
- [x] Task 4.2: `/file-sync/claim` binds `req.api_token_hash.slice(0, 12)`,
      falling back to `'machine'` as before. Verified safe: `worker_id` is only
      ever written and read back as an opaque label, never matched on
      (`index.js:1664`, `:1692`, `:1703` are the only other touches).

**Impact**: One credential, one table, one form. `worker_id` still distinguishes
callers in the log.

---

## Phase 5: Documentation and regression tests

**Problem**: Nothing in the declarative schema said the column holds a digest —
which is how it ended up plaintext in the first place, and how it would drift
back. And the invariant has three separate halves that can each regress
independently.

**Solution**: State the invariant where the column is declared, and pin all three
halves in tests.

- [x] Task 5.1: Comment on `api_tokens.token` in both `cloud/schema.sql` and
      `prisma/schema.prisma`, pointing at `hashToken` and this track's migration.
      No DDL change — the column keeps its name and type, so Atlas's declarative
      diff stays a no-op. (REQ-9)
- [x] Task 5.2: `cloud/functions/test/api-tokens-hashing.test.js`, using the
      existing jest + supertest harness in `cloud/functions/test/` (mocked `pg`
      and `firebase-*`, app exported under `NODE_ENV === 'test'`). Cases in
      `test.md`.
    - [x] Sub-task: reset the query mocks with `mockReset()` in `beforeEach`, not
          `jest.clearAllMocks()` — `clearAllMocks` drops recorded calls but leaves
          the `mockResolvedValueOnce` queue intact, so an over-queued test shifts
          every assertion in the next one. Do not use `resetAllMocks`, which would
          strip the `pg` Pool factory the app caches.
- [x] Task 5.3: Confirm the tests actually test something: stash the fix and
      check that they fail.

**Impact**: The next person to touch this path has the invariant written down
next to the column, and a failing test if they break any of its three halves.

---

## Not in scope

- **Rotating the existing tokens.** Rehashing protects future database reads; it
  does not undo a past leak. That is an operator decision, and it needs the
  `api_tokens` list/revoke endpoints this track does not add.
- **Removing the plaintext fallback.** It has to survive at least one full
  migrate-plus-deploy cycle. Marked removable in the code; a follow-up once the
  migration is confirmed applied everywhere.
- **The `scratch/` scripts with a hardcoded `lc_live_` token.** Already gone from
  the rewritten upstream `main`.
