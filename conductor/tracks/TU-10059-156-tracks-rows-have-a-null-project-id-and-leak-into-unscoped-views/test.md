# Tests: Track TU-10059 — 156 tracks rows have a NULL project_id

## Test Commands

```bash
# Server/API unit + integration suite (Vitest) — primary suite for this track
cd ui && npm test

# A single file while iterating
cd ui && npm test -- server/tests/track-10059-null-project-guard.test.mjs

# Live database assertions (local Postgres)
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d laneconductor -c \
  "SELECT count(*) FROM tracks WHERE project_id IS NULL;"
```

## Test Cases

### Phase 1 + 2: `POST /track` project-id guard

- [ ] **TC-1**: POST `/track` with a valid `track_number` and **no** `project_id`
      parameter and **no** recognised `machine_token` — expected: `400`, response body
      names the missing project id, and no `INSERT INTO tracks` is issued against the
      mocked pool.
- [ ] **TC-2**: POST `/track` with `?project_id=1` and a valid body — expected: `200`,
      and the `INSERT INTO tracks` upsert **is** issued. This is the over-tightening
      guard: TC-1 must not be satisfiable by rejecting everything.
- [ ] **TC-3**: POST `/track` with a non-numeric `?project_id=abc` — expected: `400`,
      no insert. `parseInt` yields `NaN` here, which reaches the insert identically to
      `null` if only null is checked.
- [ ] **TC-4**: POST `/track` with a recognised `machine_token` that resolves
      `req.worker_project_id`, and no `project_id` parameter — expected: `200` and a
      normal upsert. The guard must not break token-identified workers.
- [ ] **TC-5**: The unscoped `/api/tracks` query retains
      `JOIN projects p ON p.id = t.project_id` — expected: the assembled SQL contains
      the inner join. This pins the property (REQ-8) that makes a projectless row
      unrenderable, which the investigation relied on.

### Phase 3: Cleanup migration

- [ ] **TC-6**: Before the migration, record `SELECT count(*) FROM tracks` and
      `SELECT count(*) FROM tracks WHERE project_id IS NULL` — expected: a non-zero
      NULL count (156 as of 2026-09-04) to confirm the migration has something to do.
- [ ] **TC-7**: After the migration — expected: NULL count is exactly `0`.
- [ ] **TC-8**: After the migration — expected: total row count dropped by exactly the
      NULL count recorded in TC-6, proving no row with a real `project_id` was touched.
- [ ] **TC-9**: `SELECT count(*) FROM track_comments` is unchanged across the migration
      — expected: identical before and after. No orphan row had comments, so the
      `ON DELETE CASCADE` must remove nothing.

### Phase 4: `NOT NULL` constraint and schema drift

- [ ] **TC-10**: `INSERT INTO tracks (project_id, track_number, title) VALUES (NULL,
      'zz-test', 'x')` — expected: rejected with a not-null violation on
      `tracks.project_id`. Run inside a transaction and roll back.
- [ ] **TC-11**: `\d tracks` — expected: `project_id` shows `not null`, and
      `tracks_track_number_null_project_key` is **absent** (unreachable once the column
      is `NOT NULL`, so keeping it would be fresh drift).
- [ ] **TC-12**: `prisma/schema.prisma` declares `project_id Int` — expected: no `?`
      marker, and the `projects` relation is non-optional to match.
- [ ] **TC-13**: A schema diff of the declared schema against the live database —
      expected: no reported drift on the `tracks` table. This is the check that would
      have caught the original defect, where the live partial index was absent from the
      declared schema.

### Phase 2 + 6: Test-suite callers

- [ ] **TC-14**: `cd ui && npm test` — expected: the total passing count is greater than
      or equal to the pre-change count. A drop means a caller was skipped rather than
      fixed (REQ-6).
- [ ] **TC-15**: After a full suite run against a live database, `SELECT count(*) FROM
      tracks WHERE project_id IS NULL` — expected: `0`. The suites were the original
      producer, so this is the direct proof they no longer create orphans.

### Phase 5: End-to-end against a running collector

- [ ] **TC-16**: Restart the API server, then run a real worker sync for project 1 —
      expected: the track upserts and its `last_heartbeat` advances. The server does not
      hot-reload; testing against the pre-change process is a false pass.
- [ ] **TC-17**: `curl -X POST` to the running collector's `/track` with no project id —
      expected: `400`, and the NULL count stays `0`.
- [ ] **TC-18**: Load the board and All Projects mode in the UI — expected: tracks
      render as before, with no missing project and no console error. Record a
      screenshot or the actual API response as evidence.

## Acceptance Criteria

- [ ] TC-1 through TC-5 pass (write path closed, normal syncs unaffected, view-safety
      property pinned).
- [ ] TC-6 through TC-9 pass (cleanup removed exactly the orphans and nothing else).
- [ ] TC-10 through TC-13 pass (database rejects the row shape; declared and live
      schemas agree).
- [ ] TC-14 and TC-15 pass with no test deleted or skipped to get there.
- [ ] TC-16 through TC-18 performed against a restarted server, with real observed
      output recorded — not a description of expected output.
- [ ] No regression in the existing `ui` suite.
