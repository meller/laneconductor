# Spec: Make "one api_token per user" a database invariant, not a check-then-act race

## Problem Statement

`POST /auth/token` (`cloud/functions/index.js:435`) enforces "mint at most one
token per user" in application code:

```js
const { rows: existing } = await query(
  'SELECT 1 FROM api_tokens WHERE workspace_id = $1 AND created_by = $2 LIMIT 1',
  [workspace_id, decoded.uid]
);
if (existing.length > 0) return res.json({ workspace_id });

const token = 'lc_' + crypto.randomBytes(24).toString('hex');
await query(`INSERT INTO api_tokens (token, workspace_id, created_by) VALUES ($1, $2, $3)`,
  [hashToken(token), workspace_id, decoded.uid]);
```

Two statements, no transaction, and `api_tokens` has no unique index on
`(workspace_id, created_by)` — `token` is the sole primary key
(`cloud/schema.sql:19`, `prisma/schema.sql:232`, `prisma/schema.prisma:258`).
Nothing anywhere enforces the invariant the code claims to hold. This is a
textbook TOCTOU (time-of-check to time-of-use) race.

The trigger is not hypothetical. The single caller is
`ui/src/contexts/AuthContext.jsx:76`, inside `onAuthStateChanged`. Two open
browser tabs, a fast reload, or any double-fire of that Firebase callback issues
two concurrent `POST /auth/token` calls for the same
`(workspace_id, created_by)` pair. Both `SELECT`s can return zero rows before
either `INSERT` commits, and both then insert. The distinct token digests do not
collide on the `token` primary key, so both succeed silently.

**What this is not.** It grants no unauthorized access. The caller is already
authenticated by `admin.auth().verifyIdToken` before any of this runs. The
damage is that an already-legitimate user's account accumulates more live,
valid, unrevoked credentials than intended — which matters precisely because
there is still no list or revoke endpoint for `api_tokens` (a gap this track
does not close; see Non-Goals).

Found during PR #25's review (track 10070, merged as `bac2902`), independently
by three separate review angles.

### Why the race matters more than the row count suggests

The one-token rule was added by PR #25 for a real reason: only the SHA-256
digest is stored now, so a repeat caller cannot be handed its earlier token
back. Minting unconditionally therefore accumulated one permanently
unreadable-but-valid credential per sign-in, forever. The race reintroduces
exactly that accumulation under concurrency, and the accumulated rows are
equally unreachable — the UI discards the response body entirely
(`AuthContext.jsx:76-81` awaits the `fetch` and never reads it), so nobody can
even enumerate what was minted.

## Requirements

- **REQ-1** — `api_tokens` gains a unique index on `(workspace_id, created_by)`
  so the "at most one" rule is enforced by Postgres, not by application
  sequencing.
- **REQ-2** — The handler's `SELECT`-then-`INSERT` pair is replaced by a single
  atomic statement:
  `INSERT INTO api_tokens (token, workspace_id, created_by) VALUES ($1,$2,$3)
   ON CONFLICT (workspace_id, created_by) DO NOTHING RETURNING token`.
  Zero returned rows means the caller already had a token; one returned row
  means this call minted it.
- **REQ-3** — Observable response behaviour is unchanged. A first-time caller
  still receives `{ token, workspace_id }`; a repeat caller still receives
  `{ workspace_id }` with no `token` key. Status codes are unchanged.
- **REQ-4** — The raw token still never reaches the database. Only
  `hashToken(token)` is bound, and the invariant asserted by TC-2 of
  `api-tokens-hashing.test.js` (the raw token appears in no bind parameter of
  any statement) continues to hold.
- **REQ-5** — A forward migration in `migrations/` deduplicates any existing
  rows that violate the new index **before** creating it, so applying it to a
  database with pre-existing duplicates succeeds rather than aborting the
  deploy. Duplicates are near-certain in production: before PR #25 the endpoint
  minted unconditionally on every `onAuthStateChanged`.
- **REQ-6** — Deduplication keeps the **oldest** row per
  `(workspace_id, created_by)` and deletes the rest. See Design Decisions for
  why oldest, and what is knowingly given up.
- **REQ-7** — The migration is idempotent: re-running it is a no-op, and it does
  not fail if the index already exists.
- **REQ-8** — The declarative schema sources are updated to match the migrated
  state, so `atlas migrate diff` does not propose re-adding the index:
  `cloud/schema.sql`, `prisma/schema.sql`, and `prisma/schema.prisma`.
  `migrations/atlas.sum` is rehashed (`atlas migrate hash`).
- **REQ-9** — Deploy ordering is documented and enforced by the existing
  pipeline. `ON CONFLICT (workspace_id, created_by)` raises Postgres error
  `42P10` ("no unique or exclusion constraint matching the ON CONFLICT
  specification") if the index is absent, so the migration MUST be applied
  before the function is deployed. `scripts/deploy.sh` already applies Atlas
  migrations at step `[1/4]` ahead of the function deploy, so the default path
  is correct; the requirement is that this is stated in the migration header
  and not silently depended upon.
- **REQ-10** — A mis-ordered deploy fails loudly and legibly rather than as an
  anonymous 500. The handler maps a caught `42P10` to a response whose
  `details` names the missing index and the required migration.
- **REQ-11** — Regression tests cover the concurrent case, not just the
  sequential one, and would fail against the pre-fix implementation.
- **REQ-12** — The existing suite still passes. `mockSignup` in
  `cloud/functions/test/api-tokens-hashing.test.js:79` queues a response for the
  now-removed existing-token probe; leaving it queued shifts every subsequent
  mock response by one. This must be updated as part of the change, not left to
  be discovered as a mystery failure.

## Design Decisions

### D-1: `ON CONFLICT ... DO NOTHING RETURNING`, not catch-`23505`

A plain `INSERT` with a `try/catch` on Postgres error `23505` (unique violation)
would also be atomic, and has the incidental property of degrading to today's
behaviour rather than erroring if the index is missing. It is still the wrong
choice here, because `query()` (`cloud/functions/index.js:93`) transparently
retries once on a recoverable pool error:

```js
if (isRecoverablePoolError(err)) { pool = null; return getPool().query(sql, params); }
```

If the first attempt commits and the connection then drops, the retry re-runs
the same `INSERT`. Under catch-`23505`, that retry violates its own just-written
row and is misread as "this user already had a token" — the caller is told it
has a token it was never given, and the one that was minted is unreachable
forever. `ON CONFLICT ... DO NOTHING RETURNING token` makes the retry idempotent
in the wrong direction too (the retry returns zero rows), but the failure mode
is identical, so this alone does not separate them.

What does separate them: `ON CONFLICT` is declarative and self-documenting at
the call site, needs no error-code control flow, and cannot mask an unrelated
unique violation. `token` is also a primary key, so a bare catch-`23505` would
swallow a PK collision as well — cryptographically impossible with 24 random
bytes, but the code should not depend on that to be correct.

### D-2: Keep the oldest duplicate

Deleting a row revokes a live credential, so which duplicate survives is a real
operational decision, not a formality.

Keep the oldest, because a token that a worker actually holds is overwhelmingly
likely to be the first one issued for that user. Raw tokens live outside the
database — `.env` `COLLECTOR_<n>_TOKEN`, `collectors[].token` in
`.laneconductor.json`, or GCP Secret Manager — and are pasted in once during
setup, early. Every later row was minted by a browser sign-in whose response
body the UI discards without reading, making those rows unusable by construction.

**What this gives up, stated plainly:** if a user ever obtained a token from a
*later* sign-in through some path not visible in this repo's current code, this
migration revokes it and that worker starts receiving 401s. There is no list or
revoke endpoint to inspect the damage afterward. The migration therefore ships
with an audit query in its header to run *before* applying, so the blast radius
is known rather than discovered.

### D-3: `workspace_id` is nullable — plain unique index, NULLs stay distinct

`api_tokens.workspace_id` is `UUID NULL`. A plain unique index treats NULLs as
distinct, so rows with a NULL `workspace_id` would not be deduplicated and would
never conflict. This is acceptable and deliberate: the handler always binds
`wsRows[0].id` from a `RETURNING id` upsert, so it cannot insert NULL. Postgres
15's `NULLS NOT DISTINCT` would close the theoretical gap at the cost of a hard
version floor that nothing else in this schema requires. Not worth it; noted so
the omission is a decision rather than an oversight.

## Acceptance Criteria

- [ ] Two concurrent `POST /auth/token` calls for the same authenticated user
      result in exactly one `api_tokens` row, and exactly one of the two
      responses carries a `token`.
- [ ] The same test, run against the pre-fix `SELECT`-then-`INSERT` handler,
      produces two rows — i.e. the test actually discriminates the bug.
- [ ] A first-time caller receives `{ token, workspace_id }` with the token
      matching `/^lc_[0-9a-f]{48}$/`.
- [ ] A repeat caller receives `{ workspace_id }` and no `token` key, with the
      handler issuing no separate existence probe.
- [ ] `\d api_tokens` on a migrated database shows a unique index on
      `(workspace_id, created_by)`.
- [ ] Applying the migration to a database seeded with duplicate
      `(workspace_id, created_by)` rows succeeds, leaves exactly one row per
      pair, and leaves the oldest one.
- [ ] Applying the migration twice in a row succeeds with no error and no
      further row deletions.
- [ ] `cd cloud/functions && npm test` passes in full, including the
      pre-existing hashing tests.
- [ ] `atlas migrate validate` passes against the rehashed `atlas.sum`.
- [ ] `atlas migrate diff` proposes no index change for `api_tokens` after the
      declarative schema files are updated.
- [ ] The raw token appears in no bind parameter of any statement (REQ-4
      regression holds).

## Data Model Changes

```sql
CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_workspace_id_created_by_key
  ON api_tokens (workspace_id, created_by);
```

Preceded in the same migration by the deduplication delete — keep rank 1 per
group, tie-broken on `token` so the result is deterministic when two rows share
a `created_at`:

```sql
DELETE FROM api_tokens
WHERE token IN (
  SELECT token FROM (
    SELECT token,
           row_number() OVER (
             PARTITION BY workspace_id, created_by
             ORDER BY created_at ASC NULLS FIRST, token ASC
           ) AS rn
      FROM api_tokens
     WHERE workspace_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);
```

`NULLS FIRST` rather than the SQL default: `created_at` is nullable and only
gained its `DEFAULT CURRENT_TIMESTAMP` in migration
`20260506151159_add_track_type_kpi_fields.sql`, so a NULL there marks a row
older than that migration — exactly the row this policy wants to keep. A
comparison-based `DELETE … USING` formulation would instead have left every
NULL-`created_at` duplicate in place (`NULL < x` is NULL, not true) and then
failed at `CREATE UNIQUE INDEX`, taking the deploy down with it.

## API Contracts

`POST /auth/token` — unchanged contract.

| Case | Status | Body |
|------|--------|------|
| First token for this user | 200 | `{ token: "lc_…", workspace_id }` |
| User already has a token | 200 | `{ workspace_id }` |
| Missing/invalid Firebase ID token | 401 | `{ error: … }` |
| Index missing (migration not applied) | 500 | `{ error, details }` naming the missing index (REQ-10) |

## Non-Goals

- **A list/revoke endpoint for `api_tokens`.** Still absent, still a real gap,
  explicitly out of scope here. This track makes the invariant true; it does not
  add the tooling to inspect or rotate what already exists.
- **Rotating tokens exposed by past leaks.** Same position track 10070 took.
- **Fixing the UI's discard of the response body.** The UI awaiting `/auth/token`
  and never reading the result is arguably its own defect, but changing it would
  alter what users can obtain and belongs in its own track.
- **The Firebase Hosting rewrite gap (track 10052)** and the missing
  version/capability handshake (track 10061). Unrelated, already tracked.
