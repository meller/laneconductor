-- Add integrations column to projects and tracks
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "integrations" jsonb DEFAULT '{}';
ALTER TABLE "tracks" ADD COLUMN IF NOT EXISTS "integrations" jsonb DEFAULT '{}';
