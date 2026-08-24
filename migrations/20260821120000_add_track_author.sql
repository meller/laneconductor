-- Track 10023: Author-prefixed track IDs
-- Adds created_by_email and author columns; updates unique constraint to allow
-- same track_number from different authors in the same project.

ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS created_by_email TEXT,
  ADD COLUMN IF NOT EXISTS author TEXT;

-- Replace the old (project_id, track_number) unique constraint with one that
-- allows the same number from different authors. NULLs are distinct in Postgres
-- unique indexes, so legacy rows (NULL email) each remain individually unique.
DROP INDEX IF EXISTS "tracks_project_id_track_number_key";

CREATE UNIQUE INDEX IF NOT EXISTS "tracks_project_id_author_track_number_key"
  ON "public"."tracks" ("project_id", "created_by_email", "track_number");
