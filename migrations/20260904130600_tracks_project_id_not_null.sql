-- Track 10059 REQ-4/REQ-5: enforce tracks.project_id NOT NULL and resolve the
-- resulting schema drift.
--
-- REQ-3 (previous migration) deleted every existing project_id IS NULL row,
-- so this constraint has nothing left to reject on backfill.
--
-- The partial unique index below (tracks_track_number_null_project_key,
-- added by 20260302143808_add_null_project_unique_index.sql) exists only to
-- bound how many project_id IS NULL rows could accumulate per track_number —
-- it is the sole reason this defect stayed at "one orphan row per number"
-- instead of growing unbounded. With project_id NOT NULL enforced, its
-- `WHERE project_id IS NULL` predicate can never be true again, so it is
-- dropped in the same migration rather than re-declared: keeping an
-- unreachable index around is exactly the declared-vs-live drift this track
-- exists to close (prisma/schema.prisma never declared it in the first
-- place — see the app-level guard in ui/server/index.mjs POST /track for
-- the write-path half of this fix).
ALTER TABLE tracks ALTER COLUMN project_id SET NOT NULL;

DROP INDEX IF EXISTS "tracks_track_number_null_project_key";
