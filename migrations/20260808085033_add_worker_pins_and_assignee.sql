-- Modify "tracks" table
ALTER TABLE "public"."tracks" ADD COLUMN "created_by_uid" text NULL, ADD COLUMN "assignee_uid" text NULL;
-- Create "worker_pins" table
CREATE TABLE "public"."worker_pins" (
  "project_id" integer NOT NULL,
  "user_uid" text NOT NULL,
  "worker_id" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("project_id", "user_uid", "worker_id"),
  CONSTRAINT "worker_pins_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "worker_pins_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
