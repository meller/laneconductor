-- Modify "workers" table
ALTER TABLE "public"."workers" ADD COLUMN "mode" text NULL DEFAULT 'polling';
