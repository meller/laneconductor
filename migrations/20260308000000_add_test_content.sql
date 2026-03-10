-- Track 1043: Add test_content column to tracks table
-- Stores the content of test.md for each track (cached for UI rendering)
ALTER TABLE "public"."tracks" ADD COLUMN IF NOT EXISTS "test_content" TEXT;
