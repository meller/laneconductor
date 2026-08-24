-- Modify "tracks" table
ALTER TABLE "public"."tracks" ADD COLUMN "dismissed_at" timestamptz NULL;
