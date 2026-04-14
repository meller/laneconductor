# Track 018: git_global_id Schema + Population

## Phase 1: DB Migration

**Problem**: `projects` table has no cross-machine project identity column.
**Solution**: Add `git_global_id UUID UNIQUE` via `ALTER TABLE IF NOT EXISTS` (idempotent).

- [x] Task 1: Run migration SQL against local `laneconductor` DB
    - `ALTER TABLE projects ADD COLUMN IF NOT EXISTS git_global_id UUID UNIQUE;`
- [x] Task 2: Verify column exists with `\d projects` or `SELECT column_name FROM information_schema.columns`

**Impact**: Schema gains the column; existing rows have `git_global_id = NULL` until backfilled.

---

## Phase 2: Backfill Existing Rows

**Problem**: Existing project row (id=1, laneconductor) has `git_global_id = NULL`.
**Solution**: Derive UUID v5 from `git_remote` and UPDATE.

- [x] Task 1: Read `git_remote` from projects table for id=1
- [x] Task 2: Derive UUID v5 (URL namespace + normalised remote URL) using built-in `crypto`
- [x] Task 3: `UPDATE projects SET git_global_id = $1 WHERE id = 1`
- [x] Task 4: Verify with `SELECT git_global_id FROM projects WHERE id = 1`

**Impact**: Existing project row gains a stable, deterministic cross-machine ID.

---

## Phase 3: Wire into Collector UPSERT

**Problem**: New projects set up via `setup collection` won't have `git_global_id` populated.
**Solution**: Compute UUID v5 in the collector's project UPSERT path and include it in the INSERT/UPDATE.

- [x] Task 1: Add `gitGlobalId()` helper to `conductor/collector/index.mjs`
- [x] Task 2: Update the `POST /track` (or project UPSERT) endpoint to compute + store `git_global_id`
    - Use `git_remote` from the incoming payload or from the existing project row
- [x] Task 3: Update `GET /project` to return `git_global_id` in the response

**Impact**: All future `setup collection` runs automatically populate the field.

---

## Phase 4: SKILL.md Documentation

**Problem**: SKILL.md `setup collection` section doesn't mention `git_global_id`.
**Solution**: Add a note explaining the field, how it's derived, and why it's not stored in `.laneconductor.json`.

- [x] Task 1: Update SKILL.md `setup collection` section — add `git_global_id` note
- [x] Task 2: Update SKILL.md DB Schema Reference section — add column to `projects` table

**Impact**: Future `setup collection` runs will be self-documenting.

## ✅ REVIEWED
