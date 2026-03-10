-- Create LaneActionStatus enum type
CREATE TYPE "LaneActionStatus" AS ENUM ('queue', 'success', 'failure');

-- Update existing data: map old values to new enum values
UPDATE "tracks" SET "lane_action_status" = 'queue' WHERE "lane_action_status" = 'waiting';
UPDATE "tracks" SET "lane_action_status" = 'queue' WHERE "lane_action_status" = 'running';
UPDATE "tracks" SET "lane_action_status" = 'success' WHERE "lane_action_status" = 'done';

-- Set null values to queue (default)
UPDATE "tracks" SET "lane_action_status" = 'queue' WHERE "lane_action_status" IS NULL;

-- Create temporary column with enum type
ALTER TABLE "tracks" ADD COLUMN "lane_action_status_new" "LaneActionStatus" DEFAULT 'queue';

-- Copy data from old column to new column
UPDATE "tracks" SET "lane_action_status_new" = "lane_action_status"::"LaneActionStatus";

-- Drop old string column
ALTER TABLE "tracks" DROP COLUMN "lane_action_status";

-- Rename new column to original name
ALTER TABLE "tracks" RENAME COLUMN "lane_action_status_new" TO "lane_action_status";

-- Drop the old index
DROP INDEX IF EXISTS "idx_tracks_priority_waiting";

-- Create new index with updated name and enum value
CREATE INDEX "idx_tracks_priority_queue" ON "tracks"("priority" DESC, "created_at") WHERE "lane_action_status" = 'queue';
