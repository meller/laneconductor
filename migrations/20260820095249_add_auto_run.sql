-- Modify "tracks" table
ALTER TABLE "public"."tracks" ADD COLUMN "auto_run" boolean NOT NULL DEFAULT false;
