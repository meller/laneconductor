-- Drop index "projects_repo_path_key" from table: "projects"
DROP INDEX "public"."projects_repo_path_key";
-- Modify "projects" table
ALTER TABLE "public"."projects" ALTER COLUMN "repo_path" DROP NOT NULL, ADD COLUMN "dev_command" text NULL, ADD COLUMN "dev_url" text NULL, ADD COLUMN "dev_server_pid" integer NULL, ADD COLUMN "mode" text NULL DEFAULT 'local-fs';
-- Create index "projects_git_remote_key" to table: "projects"
CREATE UNIQUE INDEX "projects_git_remote_key" ON "public"."projects" ("git_remote");
-- Modify "workers" table
ALTER TABLE "public"."workers" ADD COLUMN "visibility" text NULL DEFAULT 'private';
-- Create "api_keys" table
CREATE TABLE "public"."api_keys" (
  "id" serial NOT NULL,
  "user_uid" text NOT NULL,
  "key_hash" text NOT NULL,
  "key_prefix" text NOT NULL,
  "name" text NULL,
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" timestamp NULL,
  PRIMARY KEY ("id")
);
-- Create index "api_keys_key_hash_key" to table: "api_keys"
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "public"."api_keys" ("key_hash");
-- Create "worker_permissions" table
CREATE TABLE "public"."worker_permissions" (
  "worker_id" integer NOT NULL,
  "user_uid" text NOT NULL,
  "added_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("worker_id", "user_uid"),
  CONSTRAINT "worker_permissions_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
