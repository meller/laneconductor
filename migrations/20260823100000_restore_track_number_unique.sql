-- Restore (project_id, track_number) unique index so the collector API's
-- ON CONFLICT upsert keeps working. The author-prefix constraint is kept
-- alongside it for new multi-user installs that want the extra protection.
-- Primary collision prevention is folder naming (AM-NNN vs BM-NNN), not DB.
CREATE UNIQUE INDEX IF NOT EXISTS "tracks_project_id_track_number_key"
  ON "public"."tracks" ("project_id", "track_number");
