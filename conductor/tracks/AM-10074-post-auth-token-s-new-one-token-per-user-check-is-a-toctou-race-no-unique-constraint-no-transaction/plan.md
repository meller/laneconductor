# Track AM-10074: Make "one api_token per user" a database invariant

Four phases, deliberately ordered so the constraint exists before any code
depends on it. Phase 2's `ON CONFLICT` clause raises Postgres `42P10` if Phase
1's index is missing, so committing Phase 2 first would leave the tree in a
state where a deploy from that commit breaks every sign-in.

---

## Phase 1: Schema — unique index plus a dedupe that survives real data

**Problem**: `api_tokens` has no unique index on `(workspace_id, created_by)`, so
nothing enforces the one-token-per-user rule the handler claims. Adding the
index naively aborts on any database that already has duplicates — and
production almost certainly does, because before PR #25 the endpoint minted a
row on every `onAuthStateChanged`.

**Solution**: one forward migration that deduplicates first (keep oldest) and
then creates the index, both idempotent, with the operational reasoning in the
file header the way `20260906120000_hash_legacy_api_tokens.sql` does it.

- [x] Task 1.1: Write `migrations/<timestamp>_unique_api_token_per_user.sql`
    - [x] Header comment covering: why the index exists (REQ-1), the keep-oldest
          policy and what it revokes (D-2), the `workspace_id` NULL carve-out
          (D-3), and the hard requirement that this migration lands before the
          function deploy (REQ-9)
    - [x] Include the pre-flight audit query in the header, to be run *before*
          applying so the blast radius is known rather than discovered:
          `SELECT workspace_id, created_by, count(*) FROM api_tokens
           WHERE workspace_id IS NOT NULL
           GROUP BY 1,2 HAVING count(*) > 1 ORDER BY 3 DESC;`
    - [x] Include the post-apply verification query that must return 0 rows
          (same query — after the migration no group exceeds one row)
    - [x] Dedupe `DELETE` using the `row_number()` form from spec.md's Data Model
          Changes, with `ORDER BY created_at ASC NULLS FIRST, token ASC`
    - [x] `CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_workspace_id_created_by_key
           ON api_tokens (workspace_id, created_by)`
    - [x] Confirm both statements are re-runnable: the `DELETE` matches nothing on
          a second pass, the `CREATE` is guarded by `IF NOT EXISTS` (REQ-7)
- [x] Task 1.2: Update the declarative schema sources so Atlas sees no drift (REQ-8)
    - [x] `cloud/schema.sql` — add the index next to the `api_tokens` table, with
          a one-line comment pointing at this track
    - [x] `prisma/schema.sql` — add the matching `CREATE UNIQUE INDEX` alongside
          the other `-- CreateIndex` entries
    - [x] `prisma/schema.prisma` — add `@@unique([workspace_id, created_by])` to
          the `api_tokens` model
- [x] Task 1.3: `cd <repo root> && atlas migrate hash` to regenerate
      `migrations/atlas.sum`, then `atlas migrate validate`
- [x] Task 1.4: Verify against a real Postgres, not by reading the SQL
    - [x] Create a scratch database, apply the table definition, seed it with
          duplicate `(workspace_id, created_by)` rows including at least one
          group whose oldest member has a NULL `created_at`
    - [x] Apply the migration; confirm one row survives per group and it is the
          oldest
    - [x] Apply it a second time; confirm zero rows deleted and no error
    - [x] `\d api_tokens` shows the unique index

**Impact**: The invariant becomes true at the storage layer regardless of what
any application does. Duplicate rows beyond the oldest per user are deleted,
which is a revocation — see spec.md D-2 for what that knowingly gives up.

---

## Phase 2: Handler — one atomic statement replaces check-then-act

**Problem**: `cloud/functions/index.js:471-487` does `SELECT` then `INSERT` with
no transaction. Both concurrent callers pass the `SELECT` and both `INSERT`.

**Solution**: delete the probe entirely and let the single `INSERT … ON CONFLICT
… DO NOTHING RETURNING token` decide. Zero rows back means the user already had
one; one row back means this call minted it.

- [ ] Task 2.1: Replace the probe and insert in `POST /auth/token`
    - [ ] Delete the `SELECT 1 FROM api_tokens …` query and the
          `if (existing.length > 0)` early return
    - [ ] Change the `INSERT` to
          `INSERT INTO api_tokens (token, workspace_id, created_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (workspace_id, created_by) DO NOTHING
           RETURNING token`
    - [ ] Branch on `rows.length === 0` → `res.json({ workspace_id })`;
          otherwise `res.json({ token, workspace_id })` (REQ-3)
    - [ ] Keep `hashToken(token)` as the bound value; the raw `token` stays in
          the response only (REQ-4)
- [ ] Task 2.2: Rewrite the block comment above the mint. The existing one
      explains *why* only one token is minted and is still correct and worth
      keeping; extend it to say the guarantee is now the database's, name the
      index, and note that `ON CONFLICT` requires it to exist
- [ ] Task 2.3: Add the `42P10` diagnostic (REQ-10)
    - [ ] In the handler's `catch`, detect `err.code === '42P10'` and return a
          500 whose `details` names `api_tokens_workspace_id_created_by_key` and
          says the migration has not been applied
    - [ ] Keep the existing `auth/` prefix check for 401 ahead of it, unchanged
- [ ] Task 2.4: `node --check cloud/functions/index.js`

**Impact**: The race is gone — the window between check and act no longer exists,
because there is no check. The endpoint's observable contract is unchanged.

---

## Phase 3: Tests that actually discriminate the bug

**Problem**: `cloud/functions/test/api-tokens-hashing.test.js` covers the
sequential case only, and its `mockSignup` helper queues a response for the probe
Phase 2 removes — leaving it queued would shift every later mock response by one
and fail somewhere far from the cause (a hazard the file's own `beforeEach`
comment already warns about).

**Solution**: repair the existing helper first, then add a concurrency test whose
fake enforces the unique constraint for real, so it fails against the pre-fix
handler rather than merely asserting the new SQL string.

- [ ] Task 3.1: Update `mockSignup` in `api-tokens-hashing.test.js` (REQ-12)
    - [ ] Drop the `existing-token probe` queued response
    - [ ] Make the `INSERT` response carry the outcome:
          `{ rows: alreadyHasToken ? [] : [{ token: '<digest>' }] }`
    - [ ] Re-run TC-1 through TC-3 and confirm they still pass and still assert
          what they were written to assert — TC-3's "repeat caller gets no token"
          must now be satisfied by the conflict path, not by the deleted probe
- [ ] Task 3.2: New file
      `cloud/functions/test/api-token-one-per-user-race.test.js`
    - [ ] Build a `query` fake backed by a `Map` keyed on
          `workspace_id|created_by` that genuinely enforces uniqueness: it honours
          `ON CONFLICT … DO NOTHING` by returning `{ rows: [] }` when the key is
          taken, and returns the inserted row otherwise
    - [ ] TC-R1: fire two `POST /auth/token` calls with `Promise.all` for the same
          `uid`; assert the fake's store holds exactly one row for that key, and
          exactly one of the two responses has a `token`
    - [ ] TC-R2: interleave deliberately — have the fake resolve both handlers'
          workspace/member upserts before either reaches the insert, so the two
          inserts are genuinely concurrent rather than accidentally serialised by
          promise scheduling
    - [ ] TC-R3: the discriminating control. Run the same interleaving against a
          `SELECT`-then-`INSERT` sequence and assert it yields **two** rows,
          proving the harness can detect the bug and that TC-R1 passing means
          something
    - [ ] TC-R4: assert no `SELECT … FROM api_tokens WHERE workspace_id` probe
          statement is issued by the handler at all
- [ ] Task 3.3: Optional real-Postgres concurrency test, skipped when
      `LC_TEST_DATABASE_URL` is unset so CI stays green without a database
    - [ ] Create the table and index in a scratch schema, fire N concurrent
          inserts through `pg`, assert exactly one row survives
    - [ ] If this proves awkward to gate cleanly inside the Jest run, drop it and
          record the manual verification from Task 1.4 instead — do not leave a
          test that is silently skipped everywhere and therefore proves nothing
- [ ] Task 3.4: `cd cloud/functions && npm test` — full suite green, including
      `api.test.js`, `worker-identity.test.js`, and `ported-worker-routes.test.js`
      (those three exercise the `auth` middleware's `api_tokens` lookup, which
      this track does not touch, so any failure there is a real regression)

**Impact**: The regression is pinned by a test that fails without the fix. The
pre-existing hashing guarantees keep their coverage.

---

## Phase 4: Operational documentation

**Problem**: The fix carries two facts an operator must know and neither is
discoverable from the diff: the migration must precede the function deploy, and
applying it revokes duplicate credentials.

**Solution**: put both where someone deploying will actually encounter them.

- [ ] Task 4.1: Note the ordering requirement in `scripts/deploy.sh` near the
      Atlas step, confirming the existing `[1/4]` migrations-then-functions order
      is load-bearing for this change and not merely conventional
- [ ] Task 4.2: Add a short subsection to `conductor/product.md`'s remote-api
      area recording that `api_tokens` now holds at most one row per
      `(workspace_id, created_by)`, and that no list/revoke endpoint exists yet
      (the Non-Goal this track leaves open)
- [ ] Task 4.3: Confirm no other code assumes multiple tokens per user —
      re-grep `api_tokens` across the repo and check `cloud/functions/reader.js:73`
      and `cloud/functions/index.js:255`, both of which look up by `token` and are
      unaffected

**Impact**: A future deploy or incident has the context in the repo rather than
in this track's history.

---

## Verification Summary

Before marking any task `[x]`, run the thing and read the output. Specifically:

| Claim | Command that proves it |
|-------|------------------------|
| Migration applies to dirty data | Task 1.4 scratch database, twice |
| Schema sources match reality | `atlas migrate validate`; `atlas migrate diff` proposes no `api_tokens` index change |
| Handler is syntactically sound | `node --check cloud/functions/index.js` |
| Race is fixed and the test can see it | `cd cloud/functions && npm test` with TC-R3 passing as the control |
| Nothing else regressed | Full `cloud/functions` Jest suite green |

## Open Questions

- **Does production actually contain duplicates, and how many?** Task 1.1's audit
  query answers this, but it needs to be run against the real database before the
  migration is applied. The Neon MCP connection is not available in this session,
  so this is deliberately left as a pre-deploy step rather than answered here.
- **Should the deleted duplicates be captured before deletion?** A
  `CREATE TABLE api_tokens_deduped_backup AS SELECT …` ahead of the `DELETE`
  would make the revocation reversible. Not planned above, because restoring a
  credential nobody can read back has little value — but if the audit query
  returns a large count, reconsider before applying.
