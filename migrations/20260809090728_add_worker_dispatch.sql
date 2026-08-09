-- Create "worker_dispatch" table
CREATE TABLE "public"."worker_dispatch" (
  "id" serial NOT NULL,
  "worker_id" integer NOT NULL,
  "track_number" text NULL,
  "action" text NOT NULL,
  "payload" jsonb NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_at" timestamptz NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "worker_dispatch_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_worker_dispatch_worker_status" to table: "worker_dispatch"
CREATE INDEX "idx_worker_dispatch_worker_status" ON "public"."worker_dispatch" ("worker_id", "status");
