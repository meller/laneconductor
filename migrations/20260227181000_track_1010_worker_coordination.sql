-- Track 1010: Worker Coordination Architecture
-- Add worker coordination fields to tracks table
-- Create track_locks table for lock tracking

-- Add columns to tracks table for worker coordination
ALTER TABLE "tracks" ADD COLUMN "worktree_path" TEXT;
ALTER TABLE "tracks" ADD COLUMN "git_branch" TEXT;
ALTER TABLE "tracks" ADD COLUMN "git_lock_commit" TEXT;
ALTER TABLE "tracks" ADD COLUMN "locked_by" TEXT;

-- Create track_locks table for git lock tracking
CREATE TABLE "track_locks" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER,
    "track_id" INTEGER,
    "track_number" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "machine" TEXT NOT NULL,
    "locked_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "pattern" VARCHAR(20) DEFAULT 'cli',
    "lock_file_path" TEXT,

    CONSTRAINT "track_locks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "track_locks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "track_locks_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Create unique constraint on project_id and track_number
CREATE UNIQUE INDEX "track_locks_project_id_track_number_key" ON "track_locks"("project_id", "track_number");
