# Track TU-10059: 156 tracks rows have a NULL project_id and leak into unscoped views

**Lane**: review
**Lane Status**: running
**Progress**: 0%
**Phase**: New
**Type**: dev
**Author**: TU
**Created By**: test@example.com
**Problem**: The local Postgres tracks table holds 156 rows with project_id IS NULL, out of 807 total. They are invisible on the project board, which queries WHERE t.project_id = $1 (ui/server/index.mjs:748), but any view that does not filter by project — All Projects mode — renders them alongside real tracks. Reported live: track 1067 showed in the app's implement lane while the real project-1 row for 1067 is done/success. There are three 1067 rows: implement/queue with project_id NULL, done/success under project 877, and done/success under project 1. The NULL row is what surfaced. This is broad, not a one-off: track_number 001 exists nine times across projects 1, 3, 94, 99, 162, 855, 922, 925 plus a NULL row, and 002/003/004/005/008/009/010/011/012/1002/1003 each exist six or seven times in the same shape. Every duplicate set includes exactly one NULL-project row, which points at a single historical import or seeding path that inserted without a project_id rather than ongoing corruption — no rows reference a non-existent project id, so the integrity problem is specifically the NULL. Scope: find the write path that produced them and close it, decide whether the 156 rows are deletable or need reassignment to a real project, and make unscoped views project-safe so an orphan row can never again present as a live track. A NOT NULL constraint or a partial index on project_id is worth evaluating once the rows are cleaned. Do not bulk-delete without confirming none carry unique history — some are dated 2026-04 and 2026-05 and may predate the projects table's current shape. Note: the worker cannot fix this itself even in principle — every sync query is project-scoped (WHERE project_id = $1), so these 156 rows are permanently outside anything the worker ever reads, and the worker has no track-delete path at all (the only DELETE in laneconductor.sync.mjs is a generic HTTP helper, never called for tracks) — it only ever upserts. This needs a deliberate one-off cleanup, not patience.
**Summary**: The local Postgres tracks table holds 156 rows with project_id IS NULL, out of 807 total. They are invisible on the project board, which queries WHERE t.project_id = $1 (ui/server/index.mjs:748),…
**Merge Mode**: direct
**Auto Run**: yes
