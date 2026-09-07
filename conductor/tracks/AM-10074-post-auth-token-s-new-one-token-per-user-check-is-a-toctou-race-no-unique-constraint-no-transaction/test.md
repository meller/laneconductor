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

- [x] **TC-M1: dedupe keeps the oldest row.** Seed three rows sharing one
      `(workspace_id, created_by)` with `created_at` of `t0 < t1 < t2`. Apply the
      migration. Expected: one row remains, and its `token` is the `t0` row's.
      Verified against a real local Postgres scratch DB — `tok_a_t0` survived.
- [x] **TC-M2: a NULL `created_at` counts as oldest and survives.** Seed a group
      whose members are `(created_at NULL)`, `(created_at t1)`, `(created_at t2)`.
      Expected: the NULL row is the survivor. This is the case a comparison-based
      `DELETE … USING` would have skipped, leaving duplicates behind and making
      the next statement fail. Verified — `tok_b_null` survived.
- [x] **TC-M3: `CREATE UNIQUE INDEX` succeeds on the deduplicated table.**
      Expected: the migration exits 0 and `\d api_tokens` lists
      `api_tokens_workspace_id_created_by_key` as UNIQUE over
      `(workspace_id, created_by)`. Verified.
- [x] **TC-M4: idempotent.** Apply the migration a second time on the same
      database. Expected: exits 0, deletes zero rows, does not error on the
      already-present index. Verified — second apply: `DELETE 0`, index-exists
      NOTICE, exit 0.
- [x] **TC-M5: NULL `workspace_id` rows are left alone.** Seed two rows with
      `workspace_id IS NULL` sharing a `created_by`. Expected: both survive, the
      index still builds. Documents spec.md D-3 as tested behaviour rather than
      an accident. Verified — both `tok_c_null_ws_*` rows survived.
- [x] **TC-M6: distinct users are untouched.** Seed rows for three different
      `created_by` values under one `workspace_id`. Expected: all three survive.
      Verified.
- [x] **TC-M7: post-apply verification query returns zero rows.**
      `SELECT workspace_id, created_by, count(*) FROM api_tokens
       WHERE workspace_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;`
      Verified — returned 0 rows.
- [x] **TC-M8: `atlas migrate validate` passes** after `atlas migrate hash` —
      confirmed (both ran clean, no diagnostics). `atlas migrate diff` against
      the real target could not be run in this sandboxed session: `atlas.hcl`'s
      `dev`/`url` point at a remote Neon database this session has no network
      access to (same limitation the plan phase hit with the Neon MCP — see
      plan.md's Open Questions), and replaying the full ~90-migration history
      against a scratch local Postgres from empty hits an unrelated pre-existing
      issue (migration `20260304181909` uses an enum value in the same
      transaction as the `ALTER TYPE ... ADD VALUE` that adds it, which Postgres
      forbids — nothing to do with this track). `atlas migrate diff` against the
      real database is deferred to the pre-deploy step, alongside the audit
      query plan.md already calls out.

### Phase 2 + 3 — Handler and race (`TC-R*`, in
`cloud/functions/test/api-token-one-per-user-race.test.js`)

The fake `query` here is backed by a `Map` that genuinely enforces uniqueness on
`workspace_id|created_by`, honouring `ON CONFLICT … DO NOTHING` by returning
`{ rows: [] }` when the key is taken. Without that, these tests would assert the
shape of a SQL string rather than the behaviour it produces.

- [x] **TC-R1: two concurrent calls mint exactly one token.** Fire two
      `POST /auth/token` requests for the same `uid` via `Promise.all`. Expected:
      the store holds exactly one row for that key, and exactly one of the two
      response bodies has a `token` property. Passing.
- [x] **TC-R2: the two inserts are genuinely concurrent.** Hold both handlers at
      a barrier until each has completed its workspace and member upserts, then
      release. Expected: same as TC-R1. Guards against a green TC-R1 that only
      passed because promise scheduling happened to serialise the two handlers.
      Passing.
- [x] **TC-R3: the control — the old design fails this harness.** Run the same
      interleaving against a `SELECT`-then-`INSERT` sequence. Expected: **two**
      rows. If this test does not fail the old code, TC-R1 proves nothing.
      Passing — confirms the harness discriminates the bug.
- [x] **TC-R4: no existence probe is issued.** Expected: no executed SQL matches
      `/SELECT[\s\S]*FROM api_tokens[\s\S]*workspace_id/`. The check-then-act
      pattern is gone, not merely guarded. Passing.
- [x] **TC-R5: the insert names the conflict target.** Expected: the `INSERT INTO
      api_tokens` statement contains `ON CONFLICT (workspace_id, created_by)`,
      `DO NOTHING`, and `RETURNING token`. Passing.
- [x] **TC-R6: a missing index surfaces as a legible error.** Make the fake throw
      `{ code: '42P10' }` from the insert. Expected: 500, and `details` names the
      index and states the migration has not been applied — not a bare
      `err.message`. Passing.

### Phase 2 — Response contract (`TC-C*`, extending
`cloud/functions/test/api-tokens-hashing.test.js`)

- [x] **TC-C1: first-time caller.** Insert returns one row. Expected: 200,
      `body.token` matches `/^lc_[0-9a-f]{48}$/`, `body.workspace_id` set.
      Covered by `api-tokens-hashing.test.js` TC-1 — passing.
- [x] **TC-C2: repeat caller.** Insert returns zero rows (conflict). Expected:
      200, `body.workspace_id` set, `body.token` undefined. This is the assertion
      TC-3 of the existing file makes today via the deleted probe; it must keep
      passing through the new path. Covered by TC-3 (updated) — passing.
- [x] **TC-C3: only the digest is stored (REQ-4 regression).** Expected: the
      `INSERT` binds `sha256(body.token)` as `$1`, and `body.token` appears in no
      bind parameter of any statement — the existing TC-1/TC-2 invariants,
      re-verified after the rewrite. Passing.
- [x] **TC-C4: `mockSignup` queues exactly as many responses as the handler
      consumes.** With the probe removed, `mockSignup` now queues exactly 3
      responses (workspaces upsert, members upsert, INSERT) in both branches —
      no leftover queued response to shift a later test. Confirmed by running
      the full file (11 tests) — all pass in file order.

### Phase 4 — Non-regression sweep

- [x] **TC-S1: the `auth` middleware still authenticates.**
      `npx jest test/worker-identity.test.js test/ported-worker-routes.test.js` —
      both mock an `api_tokens` lookup miss and are untouched by this track, so a
      failure there is a real regression. 54/54 pass.
- [x] **TC-S2: `cloud/functions/reader.js` is unaffected.** Its lookup
      (`reader.js:73`) selects by `token`, never by
      `(workspace_id, created_by)`. Confirmed by inspection — unchanged by this
      track. `api.test.js` has one pre-existing failure unrelated to this track
      (the `/health` route-manifest assertion, track 10061 territory) — confirmed
      by re-running it with this track's changes reverted, where it fails
      identically.

## Acceptance Criteria

- [x] TC-M1 through TC-M8 pass against a real Postgres scratch database (TC-M8's
      `atlas migrate diff` against the real remote target is deferred — see
      TC-M8 above)
- [x] TC-R3 fails against the pre-fix handler and passes against the fixed one —
      the test discriminates the bug
- [x] TC-R1, TC-R2, TC-R4, TC-R5, TC-R6 pass
- [x] TC-C1 through TC-C4 pass
- [x] `cd cloud/functions && npm test` — 78/79 pass; the one failure is
      pre-existing and unrelated (see TC-S2)
- [x] `node --check cloud/functions/index.js` clean
- [x] `atlas migrate validate` clean (after `atlas migrate hash`); `atlas migrate
      diff` against the real target deferred to the pre-deploy step (see TC-M8)
- [x] No regressions in worker authentication (TC-S1, TC-S2)
