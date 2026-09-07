# Tests: Track AM-10074 — one api_token per user, enforced by the database

## Test Commands

```bash
# Cloud Functions suite (Jest) — the primary suite for this track
cd cloud/functions && npm test

# Just this track's new race regression file
cd cloud/functions && npx jest test/api-token-one-per-user-race.test.js

# Just the pre-existing hashing tests this track must not break
cd cloud/functions && npx jest test/api-tokens-hashing.test.js

# Syntax check on the modified handler
node --check cloud/functions/index.js

# Migration integrity
atlas migrate validate --env local

# Schema drift — must propose no api_tokens index change after Phase 1
atlas migrate diff --env local --dry-run
```

### Scratch database for the migration tests (Phase 1)

```bash
createdb lc_10074_scratch
psql -d lc_10074_scratch -c "
  CREATE TABLE api_tokens (
    token        TEXT PRIMARY KEY,
    workspace_id UUID,
    created_by   TEXT NOT NULL,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );"
# … seed, apply migration, assert (see TC-M1..TC-M5) …
dropdb lc_10074_scratch
```

## Test Cases

### Phase 1 — Migration (`TC-M*`, run against the scratch database)

- [ ] **TC-M1: dedupe keeps the oldest row.** Seed three rows sharing one
      `(workspace_id, created_by)` with `created_at` of `t0 < t1 < t2`. Apply the
      migration. Expected: one row remains, and its `token` is the `t0` row's.
- [ ] **TC-M2: a NULL `created_at` counts as oldest and survives.** Seed a group
      whose members are `(created_at NULL)`, `(created_at t1)`, `(created_at t2)`.
      Expected: the NULL row is the survivor. This is the case a comparison-based
      `DELETE … USING` would have skipped, leaving duplicates behind and making
      the next statement fail.
- [ ] **TC-M3: `CREATE UNIQUE INDEX` succeeds on the deduplicated table.**
      Expected: the migration exits 0 and `\d api_tokens` lists
      `api_tokens_workspace_id_created_by_key` as UNIQUE over
      `(workspace_id, created_by)`.
- [ ] **TC-M4: idempotent.** Apply the migration a second time on the same
      database. Expected: exits 0, deletes zero rows, does not error on the
      already-present index.
- [ ] **TC-M5: NULL `workspace_id` rows are left alone.** Seed two rows with
      `workspace_id IS NULL` sharing a `created_by`. Expected: both survive, the
      index still builds. Documents spec.md D-3 as tested behaviour rather than
      an accident.
- [ ] **TC-M6: distinct users are untouched.** Seed rows for three different
      `created_by` values under one `workspace_id`. Expected: all three survive.
- [ ] **TC-M7: post-apply verification query returns zero rows.**
      `SELECT workspace_id, created_by, count(*) FROM api_tokens
       WHERE workspace_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;`
- [ ] **TC-M8: `atlas migrate validate` passes** after `atlas migrate hash`, and
      `atlas migrate diff` proposes no further `api_tokens` index change.

### Phase 2 + 3 — Handler and race (`TC-R*`, in
`cloud/functions/test/api-token-one-per-user-race.test.js`)

The fake `query` here is backed by a `Map` that genuinely enforces uniqueness on
`workspace_id|created_by`, honouring `ON CONFLICT … DO NOTHING` by returning
`{ rows: [] }` when the key is taken. Without that, these tests would assert the
shape of a SQL string rather than the behaviour it produces.

- [ ] **TC-R1: two concurrent calls mint exactly one token.** Fire two
      `POST /auth/token` requests for the same `uid` via `Promise.all`. Expected:
      the store holds exactly one row for that key, and exactly one of the two
      response bodies has a `token` property.
- [ ] **TC-R2: the two inserts are genuinely concurrent.** Hold both handlers at
      a barrier until each has completed its workspace and member upserts, then
      release. Expected: same as TC-R1. Guards against a green TC-R1 that only
      passed because promise scheduling happened to serialise the two handlers.
- [ ] **TC-R3: the control — the old design fails this harness.** Run the same
      interleaving against a `SELECT`-then-`INSERT` sequence. Expected: **two**
      rows. If this test does not fail the old code, TC-R1 proves nothing.
- [ ] **TC-R4: no existence probe is issued.** Expected: no executed SQL matches
      `/SELECT[\s\S]*FROM api_tokens[\s\S]*workspace_id/`. The check-then-act
      pattern is gone, not merely guarded.
- [ ] **TC-R5: the insert names the conflict target.** Expected: the `INSERT INTO
      api_tokens` statement contains `ON CONFLICT (workspace_id, created_by)`,
      `DO NOTHING`, and `RETURNING token`.
- [ ] **TC-R6: a missing index surfaces as a legible error.** Make the fake throw
      `{ code: '42P10' }` from the insert. Expected: 500, and `details` names the
      index and states the migration has not been applied — not a bare
      `err.message`.

### Phase 2 — Response contract (`TC-C*`, extending
`cloud/functions/test/api-tokens-hashing.test.js`)

- [ ] **TC-C1: first-time caller.** Insert returns one row. Expected: 200,
      `body.token` matches `/^lc_[0-9a-f]{48}$/`, `body.workspace_id` set.
- [ ] **TC-C2: repeat caller.** Insert returns zero rows (conflict). Expected:
      200, `body.workspace_id` set, `body.token` undefined. This is the assertion
      TC-3 of the existing file makes today via the deleted probe; it must keep
      passing through the new path.
- [ ] **TC-C3: only the digest is stored (REQ-4 regression).** Expected: the
      `INSERT` binds `sha256(body.token)` as `$1`, and `body.token` appears in no
      bind parameter of any statement — the existing TC-1/TC-2 invariants,
      re-verified after the rewrite.
- [ ] **TC-C4: `mockSignup` queues exactly as many responses as the handler
      consumes.** With the probe removed the count drops from four to three. A
      leftover queued response silently shifts every assertion in the *next* test,
      which is exactly the failure mode the file's `beforeEach` comment warns
      about — so verify by running the file's tests in both orders, not by
      reading the helper.

### Phase 4 — Non-regression sweep

- [ ] **TC-S1: the `auth` middleware still authenticates.**
      `npx jest test/worker-identity.test.js test/ported-worker-routes.test.js` —
      both mock an `api_tokens` lookup miss and are untouched by this track, so a
      failure there is a real regression.
- [ ] **TC-S2: `cloud/functions/reader.js` is unaffected.** Its lookup
      (`reader.js:73`) selects by `token`, never by
      `(workspace_id, created_by)`. Confirm by inspection plus a green
      `api.test.js`.

## Acceptance Criteria

- [ ] TC-M1 through TC-M8 pass against a real Postgres scratch database
- [ ] TC-R3 fails against the pre-fix handler and passes against the fixed one —
      the test discriminates the bug
- [ ] TC-R1, TC-R2, TC-R4, TC-R5, TC-R6 pass
- [ ] TC-C1 through TC-C4 pass
- [ ] `cd cloud/functions && npm test` is green in full, no skipped tests that
      were expected to run
- [ ] `node --check cloud/functions/index.js` clean
- [ ] `atlas migrate validate` clean; `atlas migrate diff` proposes no
      `api_tokens` index change
- [ ] No regressions in worker authentication (TC-S1, TC-S2)
