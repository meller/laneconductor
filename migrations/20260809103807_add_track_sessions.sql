-- Create "track_sessions" table
CREATE TABLE "public"."track_sessions" (
  "track_number" text NOT NULL,
  "worker_id" integer NOT NULL,
  "claude_session_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("track_number", "worker_id"),
  CONSTRAINT "track_sessions_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
