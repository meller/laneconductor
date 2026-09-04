# Track TU-10059: 156 tracks rows have a NULL project_id

Phases are ordered by dependency: close the hole before draining the pool, and drain
the pool before the `NOT NULL` constraint can be applied at all. Do not reorder 1→4.

## Phase 1: Close the write path

**Problem**: `ui/server/index.mjs:2677` resolves `projectId` to `null` when neither a
recognised `machine_token` nor a `project_id` parameter is present, and nothing guards
that before the insert at line 2861. The insert's `ON CONFLICT (project_id,
track_number)` cannot fire on a NULL, so the upsert degrades to a plain insert and
produces an orphan row.

**Solution**: Reject the request at `400` before any query runs, matching the
`track_number` validation already sitting a few lines above it.

- [x] Add a guard in `POST /track` immediately after the `projectId` resolution at
      `ui/server/index.mjs:2677`: if `projectId` is null, `NaN`, or otherwise not a
      positive integer, return `400` with a body naming the missing parameter.
    - [x] Place it before the `oldTrack` lookup at line 2683, so no query runs with a
          null project id.
    - [x] Match the existing 400 style used for `Invalid track_number` at line 2669.
    - [x] Guard against `parseInt` returning `NaN` for a non-numeric `project_id`
          parameter, not just against `null` — `NaN` reaches the insert identically.
- [x] Audit the other 26 sites sharing the `req.worker_project_id || (req.query...)`
      idiom (REQ-2). Reads and updates match zero rows and degrade safely; confirm none
      of them can insert a row, and guard any that can.
    - [x] Confirm `ui/server/index.mjs:897` stays as-is — it uses `req.params.id` and
          already 404s on an unknown project.
    - [x] Record the audit conclusion in this file, so Phase 2's reviewer can check it
          rather than redo it.
- [x] Leave `conductor/collector/index.mjs:232` untouched — it already falls back to
      `project.id`.

### Audit result (REQ-2)

All 26 other sites sharing `const projectId = req.worker_project_id || (req.query...)`
were read individually. 24 are `SELECT`/`UPDATE`/`DELETE` statements keyed on
`WHERE project_id = $1 AND ...` — a null `projectId` matches zero rows and the request
degrades safely (404/`{ok:true}`/empty result), exactly as the spec predicted. Two of
those 24 (`POST /track/:num/comment` line 3525, `POST /track/:num/lock` line 3589,
`PATCH /track/:num/lane` line 3669) contain an `INSERT` further down, but each is gated
by a prior `SELECT`/`UPDATE ... RETURNING` against the same null-matching `WHERE
project_id = $1` clause, so the `INSERT` is unreachable when `projectId` is null — no
guard needed. `POST /file-sync/claim` (line 3758) already has an explicit
`if (!projectId) return res.status(400)` guard.

One site beyond `POST /track` **can** write an orphan row and needed the same fix:
`POST /provider-status` (`ui/server/index.mjs:3054`, guard added at line ~3061) does
`INSERT INTO provider_status ... ON CONFLICT (project_id, provider)`, the identical
NULL-mismatch shape (Postgres treats NULL as distinct in a unique index, so the
`ON CONFLICT` never fires and the upsert degrades to a plain insert). Checked live
against the local DB: **54 of 73** `provider_status` rows already have `project_id IS
NULL` — a bigger proportional leak than `tracks` had. Guarded with the same
`Number.isInteger(projectId) && projectId > 0` check REQ-1 uses. Cleaning up the
existing 54 orphan `provider_status` rows and adding a `NOT NULL` constraint there is
**out of scope for this track** — REQ-3/4/5 and the Data Model Changes section are
scoped to `tracks` only — but is flagged in `conversation.md` as a follow-up worth its
own track.

**Impact**: No new orphan rows can be created. This phase alone makes the problem
non-recurring, independent of the cleanup.

## Phase 2: Regression tests for the guard and the view-safety property

**Problem**: The guard is one line and easy to revert. The "unscoped views cannot
return a projectless row" property is what makes these rows harmless rather than
user-visible, and nothing currently asserts it (REQ-8).

**Solution**: Cover both before touching data, so Phase 3 runs against a proven-closed
hole.

- [ ] Add a Vitest case to `ui/server/tests/` asserting `POST /track` with no
      resolvable project id returns `400` and issues no `INSERT INTO tracks`.
      Follow the mocked-pool idiom already used in `track-10055-waiting-api.test.mjs`.
- [ ] Add a case asserting a POST **with** a valid project id still upserts, so the
      guard cannot be over-tightened into blocking normal syncs.
- [ ] Add a case asserting the unscoped `/api/tracks` query keeps its
      `JOIN projects p ON p.id = t.project_id` — the inner join is the property that
      makes an orphan row unrenderable (REQ-8).
- [ ] Update the test suites that POST to `/track` without a project id so they pass an
      explicit one (REQ-6). Do not delete or skip a test to get past the guard.
    - [ ] Locate them by the fixture titles found in the orphan rows: `Concurrency A`,
          `E2e Test`, `Test Normal Plan A`, `Test Brainstorm B`, `TEST-001`.
- [ ] Run the full `cd ui && npm test` suite and confirm the pass count does not drop.

**Impact**: The fix is pinned, and the test suites stop being the thing that produced
the rows.

## Phase 3: Delete the 156 orphan rows

**Problem**: 156 unreachable rows block the `NOT NULL` constraint in Phase 4.

**Solution**: One reviewable migration. The deletability assessment in `spec.md` already
established that no orphan row carries comments, locks, or unique history, and that all
7 rows with no real counterpart are test fixtures.

- [ ] Re-run the four deletability checks from `spec.md` immediately before writing the
      migration and confirm the numbers still hold (0 comments, 0 locks, 7 fixture-only
      orphans). Do not trust this document's counts — they were taken on 2026-09-04.
- [ ] Capture a `\copy` of all `project_id IS NULL` rows to a file outside the repo
      before deleting, so the delete is reversible if a check was wrong.
- [ ] Write `migrations/<timestamp>_delete_null_project_tracks.sql` containing
      `DELETE FROM tracks WHERE project_id IS NULL;` and nothing broader.
- [ ] Apply it and confirm `SELECT count(*) FROM tracks WHERE project_id IS NULL` is 0.
- [ ] Confirm the total row count dropped by exactly 156 and no other row was affected.

**Impact**: The table is clean and Phase 4 becomes possible.

## Phase 4: Enforce `NOT NULL` and resolve the schema drift

**Problem**: Nothing in the declared schema prevents this. `prisma/schema.prisma:124`
declares `project_id Int?`, and migration `20260304102459_update_schema.sql:8` drops the
partial index that is currently the only backstop — so a database rebuilt from
migrations would regress immediately.

**Solution**: Make the column `NOT NULL`, declare it, and drop the index that `NOT NULL`
renders unreachable.

- [ ] Add `ALTER TABLE tracks ALTER COLUMN project_id SET NOT NULL;` to a migration.
- [ ] Drop `tracks_track_number_null_project_key` in the same migration — with
      `NOT NULL` in force its `WHERE project_id IS NULL` clause can never be true, so
      keeping it would re-introduce the exact declared-vs-live drift this phase closes.
- [ ] Change `project_id Int?` → `project_id Int` in `prisma/schema.prisma`, and drop
      the optional marker on the `projects` relation so the two agree.
- [ ] Regenerate the Prisma client.
- [ ] Run a schema diff against the live database and confirm no remaining drift on
      `tracks`.
- [ ] Verify the constraint actually bites: attempt an insert with a null `project_id`
      and confirm the database rejects it with a not-null violation.

**Impact**: The defect becomes structurally impossible rather than merely fixed, and a
freshly-migrated database matches production.

## Phase 5: End-to-end verification

**Problem**: Phases 1–4 are verifiable in isolation but the real risk is over-tightening
— a guard that also rejects legitimate worker syncs would be worse than the bug.

**Solution**: Drive a real sync against a running collector.

- [ ] Restart the API server. It does not hot-reload; verifying against the old process
      is a false pass.
- [ ] Run a real worker sync for project 1 and confirm a track upsert still succeeds,
      evidenced by the row's `last_heartbeat` advancing.
- [ ] Issue a POST with no project id against the running collector and confirm a `400`
      and no new row.
- [ ] Load the board and All Projects mode and confirm tracks still render normally.
- [ ] Record the observed results — actual command output, not a description of it.

**Impact**: Confirms the fix works in the product, not only in tests.

## Notes for the implementer

- **Do not** widen scope to the 1067 sighting (REQ-7). It is not caused by these rows;
  both real 1067 rows are `done/success` and the NULL row cannot render.
- **Do not** treat same-`track_number`-across-real-projects as duplication. Nine real
  projects legitimately own a track `001`.
- The `ON CONFLICT` NULL-mismatch is the mechanism worth remembering: any future upsert
  keyed on a nullable column has this same failure mode.
