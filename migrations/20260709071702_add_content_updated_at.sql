-- Modify "tracks" table
ALTER TABLE "public"."tracks" ADD COLUMN "content_updated_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP;
