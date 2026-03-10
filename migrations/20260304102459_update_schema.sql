-- Modify "file_sync_queue" table
ALTER TABLE "public"."file_sync_queue" ADD COLUMN "operation" text NULL DEFAULT 'overwrite';
-- Modify "track_locks" table
ALTER TABLE "public"."track_locks" ALTER COLUMN "pattern" TYPE text;
-- Drop index "idx_tracks_priority_queue" from table: "tracks"
DROP INDEX "public"."idx_tracks_priority_queue";
-- Drop index "tracks_track_number_null_project_key" from table: "tracks"
DROP INDEX "public"."tracks_track_number_null_project_key";
-- Create index "idx_tracks_priority_queue" to table: "tracks"
CREATE INDEX "idx_tracks_priority_queue" ON "public"."tracks" ("priority", "created_at");
