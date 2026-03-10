-- Create unique partial index to enforce uniqueness on track_number when project_id is NULL
DROP INDEX IF EXISTS "tracks_track_number_null_project_key";
CREATE UNIQUE INDEX "tracks_track_number_null_project_key" ON "tracks"("track_number") WHERE (project_id IS NULL);
