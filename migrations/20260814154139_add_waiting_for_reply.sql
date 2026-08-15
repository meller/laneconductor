-- Modify "tracks" table
ALTER TABLE "public"."tracks" ADD COLUMN "waiting_for_reply" boolean NOT NULL DEFAULT false;
