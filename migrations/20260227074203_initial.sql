-- Create "projects" table
CREATE TABLE "public"."projects" (
  "id" serial NOT NULL,
  "name" text NOT NULL,
  "repo_path" text NOT NULL,
  "git_remote" text NULL,
  "git_global_id" uuid NULL,
  "primary_cli" text NULL DEFAULT 'claude',
  "primary_model" text NULL,
  "secondary_cli" text NULL,
  "secondary_model" text NULL,
  "create_quality_gate" boolean NULL DEFAULT false,
  "owner_uid" text NULL,
  "conductor_files" jsonb NULL DEFAULT '{}',
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
-- Create index "projects_git_global_id_key" to table: "projects"
CREATE UNIQUE INDEX "projects_git_global_id_key" ON "public"."projects" ("git_global_id");
-- Create index "projects_repo_path_key" to table: "projects"
CREATE UNIQUE INDEX "projects_repo_path_key" ON "public"."projects" ("repo_path");
-- Create "users" table
CREATE TABLE "public"."users" (
  "uid" text NOT NULL,
  "email" text NULL,
  "display_name" text NULL,
  "photo_url" text NULL,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_login_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("uid")
);
-- Create "file_sync_queue" table
CREATE TABLE "public"."file_sync_queue" (
  "id" serial NOT NULL,
  "project_id" integer NULL,
  "file_path" text NOT NULL,
  "content" text NOT NULL,
  "status" character varying(20) NULL DEFAULT 'waiting',
  "worker_id" text NULL,
  "error_message" text NULL,
  "created_at" timestamptz NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  CONSTRAINT "file_sync_queue_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create "project_members" table
CREATE TABLE "public"."project_members" (
  "project_id" integer NOT NULL,
  "user_uid" text NOT NULL,
  "role" text NOT NULL DEFAULT 'member',
  "joined_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("project_id", "user_uid"),
  CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create "provider_status" table
CREATE TABLE "public"."provider_status" (
  "project_id" integer NOT NULL,
  "provider" text NOT NULL,
  "status" text NOT NULL,
  "reset_at" timestamp NULL,
  "last_error" text NULL,
  "updated_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("project_id", "provider"),
  CONSTRAINT "provider_status_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create "tracks" table
CREATE TABLE "public"."tracks" (
  "id" serial NOT NULL,
  "project_id" integer NULL,
  "track_number" text NOT NULL,
  "title" text NOT NULL,
  "lane_status" text NULL DEFAULT 'planning',
  "lane_action_status" text NULL DEFAULT 'waiting',
  "lane_action_result" text NULL,
  "progress_percent" integer NULL DEFAULT 0,
  "current_phase" text NULL,
  "phase_step" text NULL,
  "content_summary" text NULL,
  "index_content" text NULL,
  "plan_content" text NULL,
  "spec_content" text NULL,
  "last_log_tail" text NULL,
  "auto_planning_launched" timestamp NULL,
  "auto_implement_launched" timestamp NULL,
  "auto_review_launched" timestamp NULL,
  "priority" integer NULL DEFAULT 0,
  "sync_status" text NULL DEFAULT 'synced',
  "last_updated_by" text NULL DEFAULT 'worker',
  "last_heartbeat" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  "last_updated_by_uid" text NULL,
  "claimed_by" text NULL,
  "active_cli" text NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "tracks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_tracks_priority_waiting" to table: "tracks"
CREATE INDEX "idx_tracks_priority_waiting" ON "public"."tracks" ("priority" DESC, "created_at") WHERE (lane_action_status = 'waiting'::text);
-- Create index "tracks_project_id_track_number_key" to table: "tracks"
CREATE UNIQUE INDEX "tracks_project_id_track_number_key" ON "public"."tracks" ("project_id", "track_number");
-- Create "track_comments" table
CREATE TABLE "public"."track_comments" (
  "id" serial NOT NULL,
  "track_id" integer NULL,
  "author" text NOT NULL,
  "body" text NOT NULL,
  "is_replied" boolean NULL DEFAULT false,
  "is_hidden" boolean NULL DEFAULT false,
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  CONSTRAINT "track_comments_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "public"."tracks" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create "workers" table
CREATE TABLE "public"."workers" (
  "id" serial NOT NULL,
  "project_id" integer NULL,
  "hostname" text NOT NULL,
  "pid" integer NOT NULL,
  "status" text NULL DEFAULT 'idle',
  "current_task" text NULL,
  "last_heartbeat" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  "machine_token" text NULL,
  "user_uid" text NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "workers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "workers_machine_token_key" to table: "workers"
CREATE UNIQUE INDEX "workers_machine_token_key" ON "public"."workers" ("machine_token");
-- Create index "workers_project_id_hostname_pid_key" to table: "workers"
CREATE UNIQUE INDEX "workers_project_id_hostname_pid_key" ON "public"."workers" ("project_id", "hostname", "pid");
