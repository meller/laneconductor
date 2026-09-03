# Track TU-10056: 156 tracks rows have a NULL project_id and leak into unscoped views

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Author**: TU
**Created By**: test@example.com
**Summary**: The local Postgres tracks table holds 156 rows with project_id IS NULL, out of 807 total. They are invisible on the project board, which queries WHERE t.project_id = $1 (ui/server/index.mjs:748),…
