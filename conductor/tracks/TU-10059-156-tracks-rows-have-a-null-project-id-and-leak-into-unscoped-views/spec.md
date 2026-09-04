# Spec: Close the NULL `project_id` write path and remove the 156 orphan track rows

## Problem Statement

The local Postgres `tracks` table holds **156 rows with `project_id IS NULL`** (out of
811 total, verified live 2026-09-04). Such a row is unreachable by every part of the
product: it is invisible to the board, to the worker, and to the API. It is pure
dead weight that also blocks a `NOT NULL` integrity constraint on the column.

### What the investigation confirmed, and what it corrected

The track was filed from a live sighting (track 1067 appearing in the `implement`
lane). Investigating the write and read paths confirmed the row count but **corrected
three of the premises the track was filed on**. They are recorded here because two of
them would have sent the implementation in the wrong direction.

| Filed premise | Finding |
|---|---|
| 156 NULL rows out of 807 | **Confirmed** (811 total now). |
| They "leak into unscoped views" / All Projects mode | **Refuted.** Every unscoped read inner-joins `projects` (`JOIN projects p ON p.id = t.project_id`) at `ui/server/index.mjs` lines 663, 684, 710, 986, 1057, 3267, and at `cloud/functions/index.js` lines 566, 614, 659, 680, 749, 1291, 1309. An inner join drops NULL rows. `SELECT count(*) FROM tracks t JOIN projects p ON p.id=t.project_id WHERE t.project_id IS NULL` returns **0**. No endpoint can render an orphan row. |
| A "single historical import or seeding path" | **Refuted.** The rows span **13 distinct days from 2026-03-08 to 2026-08-12**, and all 156 carry `last_updated_by='worker'`. This is a recurring write-path defect, not one bad import. |
| "Exactly one NULL row per track_number → evidence of a single import" | **Refuted, and it is an artifact.** A partial unique index, `tracks_track_number_null_project_key ON tracks(track_number) WHERE project_id IS NULL`, physically forbids a second NULL row per track number. The one-per-number shape is the index doing its job, not evidence about origin. |

The 1067 sighting is therefore **not** explained by the NULL row. Both real 1067 rows
(project 1 and project 877 `chesstrainer`) are `done/success`, and the NULL row cannot
render. Reproducing that sighting is explicitly out of scope here (REQ-7).

### Root cause

`ui/server/index.mjs:2677`, inside `POST /track` — the endpoint every filesystem sync
funnels through:

```js
const projectId = req.worker_project_id || (req.query.project_id ? parseInt(req.query.project_id) : null);
```

`collectorAuth` deliberately does **not** reject an unrecognised `machine_token` on a
local single-tenant collector; it calls `next()` with `req.worker_project_id` unset. So
when a caller presents no recognised token *and* no `project_id` query parameter,
`projectId` is `null`, and **nothing guards it** before the insert at line 2861.

The insert then does the damage, because its conflict target cannot fire:

```sql
INSERT INTO tracks (project_id, track_number, ...) VALUES ($1, ...)
ON CONFLICT (project_id, track_number) DO UPDATE SET ...
```

In Postgres a unique index treats NULLs as distinct, so `ON CONFLICT (project_id,
track_number)` **never matches a NULL-`project_id` row**. The upsert silently degrades
into a plain insert and creates an orphan instead of updating the intended row.

The sibling collector at `conductor/collector/index.mjs:232` gets this right — it falls
back to `project.id` rather than `null`. `ui/server/index.mjs` is the only divergent path.

Every one of the 156 rows was inserted once and never touched again (`last_heartbeat =
created_at` on all of them), which is the partial index working as designed: once one
NULL row exists for a track number, later NULL-`project_id` syncs raise a unique
violation and 500 rather than accumulating.

### Who is calling it

All 7 rows that exist under no real project are test fixtures with timestamp-suffixed
titles (`Concurrency A 1776105185643`, `E2e Test 1786520711470`, `Test Normal Plan A`,
`TEST-001 Test Track`). The producer is the test suites POSTing to `/track` without a
project id — consistent with the date clustering and the `worker` flag.

### Schema drift (secondary defect)

The partial index is the only thing bounding this, and it is **not in the declared
schema**. `prisma/schema.prisma:124` declares `project_id Int?` and does not declare
the index; migration `20260304102459_update_schema.sql:8` therefore **drops** it as
undeclared drift, while the live database still has it. A database rebuilt from
migrations today would lack the index, and the same bug would accumulate NULL rows
without bound.

## Deletability assessment

Required by the track before any bulk delete. Verified live:

| Check | Result |
|---|---|
| NULL rows with a counterpart row under a real project | 149 of 156 |
| NULL rows with **no** counterpart anywhere | 7 — all test fixtures, listed above |
| `track_comments` attached to any NULL row | **0** |
| `track_locks` referencing any NULL row | **0** |

No orphan row carries conversation history, a lock, or unique product history. The
`index_content` on 155 of them is a stale copy of a file that still exists on disk.
**All 156 are safe to delete**, and the "may predate the projects table's current
shape" concern is resolved: the two oldest (2026-04-14, 2026-05-13) are both test
fixtures.

## Requirements

- **REQ-1** — `POST /track` in `ui/server/index.mjs` MUST reject a request that resolves
  to no project id with `400`, before reaching the insert. It MUST NOT write a row with
  `project_id IS NULL`. The error body must name the missing parameter so a caller can
  act on it.
- **REQ-2** — Auditing the other 26 `projectId` resolution sites sharing this idiom in
  `ui/server/index.mjs` is in scope. Read and update paths degrade safely today (they
  match zero rows), so they are **not** required to change; any that can write a row
  must be guarded like REQ-1. Record the audit result either way.
- **REQ-3** — Delete all 156 existing `project_id IS NULL` rows via a reviewable
  migration. The migration MUST delete only rows where `project_id IS NULL` and MUST
  report the number of rows removed.
- **REQ-4** — After REQ-3, `tracks.project_id` MUST be `NOT NULL`, enforced in the
  database and declared in `prisma/schema.prisma`. This is the durable fix: a row with
  no project is unreachable by every read path in the product, so it has no legitimate
  state to represent.
- **REQ-5** — Resolve the schema drift. Once REQ-4 lands, `NOT NULL` makes the partial
  index `tracks_track_number_null_project_key` unreachable (its `WHERE` clause can never
  be true), so it MUST be dropped in the same migration rather than re-declared. The
  declared schema and the live database MUST agree afterwards.
- **REQ-6** — The test suites that produced these rows MUST pass an explicit
  `project_id`, so they keep passing against the REQ-1 guard.
- **REQ-7** — Reproducing the original 1067 sighting is **out of scope**. It is not
  caused by the NULL rows. If it recurs after this track, it needs its own track. This
  requirement exists to stop the scope being widened silently.
- **REQ-8** — The refuted "unscoped views leak" premise MUST be locked down by a
  regression test asserting the unscoped reads cannot return a projectless row, so the
  property this track relied on cannot regress unnoticed.

## Acceptance Criteria

- [ ] A sync POST to `/track` carrying no resolvable project id is rejected with `400`
      and creates no row. Verified by issuing the request against a running collector
      and confirming `SELECT count(*) FROM tracks WHERE project_id IS NULL` is unchanged.
- [ ] `SELECT count(*) FROM tracks WHERE project_id IS NULL` returns **0** after the
      cleanup migration runs.
- [ ] Inserting a track row with a NULL `project_id` is rejected by the database itself
      with a `not-null constraint` error.
- [ ] `prisma/schema.prisma` declares `project_id Int` (not `Int?`), and a schema-diff
      against the live database reports no drift on the `tracks` table.
- [ ] The existing test suites pass unchanged in count against the new guard — no test
      is deleted or skipped to get there.
- [ ] The unscoped `/api/tracks` read path returns no projectless row, asserted by a
      test rather than by inspection.
- [ ] A normal worker sync for a real project still succeeds end to end, verified
      against a running collector and confirmed by the row's updated `last_heartbeat`.

## Data Model Changes

```sql
-- 1. cleanup (REQ-3), must run first
DELETE FROM tracks WHERE project_id IS NULL;

-- 2. enforce (REQ-4)
ALTER TABLE tracks ALTER COLUMN project_id SET NOT NULL;

-- 3. drop the now-unreachable partial index (REQ-5)
DROP INDEX IF EXISTS tracks_track_number_null_project_key;
```

`prisma/schema.prisma`: `project_id Int?` → `project_id Int`, and the `projects`
relation loses its optional marker to match.

## Out of Scope

- Reproducing or fixing the 1067 lane sighting (REQ-7).
- Deduplicating the same `track_number` across different real projects — that is
  legitimate data (nine real projects each own a track `001`), and All Projects mode
  showing them together is correct behaviour, not a defect.
- Any change to `conductor/collector/index.mjs`, which already resolves the project id
  correctly.
