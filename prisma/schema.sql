-- CreateEnum
CREATE TYPE "LaneActionStatus" AS ENUM ('queue', 'waiting', 'running', 'success', 'failure');

-- CreateTable
CREATE TABLE "api_keys" (
    "id" SERIAL NOT NULL,
    "user_uid" TEXT,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(6),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_sync_queue" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER,
    "file_path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "operation" TEXT DEFAULT 'overwrite',
    "status" VARCHAR(20) DEFAULT 'waiting',
    "worker_id" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_sync_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "project_id" INTEGER NOT NULL,
    "user_uid" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id","user_uid")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "repo_path" TEXT,
    "git_remote" TEXT,
    "git_global_id" UUID,
    "primary_cli" TEXT DEFAULT 'claude',
    "primary_model" TEXT,
    "secondary_cli" TEXT,
    "secondary_model" TEXT,
    "create_quality_gate" BOOLEAN DEFAULT false,
    "owner_uid" TEXT,
    "conductor_files" JSONB DEFAULT '{}',
    "dev_command" TEXT,
    "dev_url" TEXT,
    "dev_server_pid" INTEGER,
    "mode" TEXT DEFAULT 'local-fs',
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_status" (
    "project_id" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reset_at" TIMESTAMP(6),
    "last_error" TEXT,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_status_pkey" PRIMARY KEY ("project_id","provider")
);

-- CreateTable
CREATE TABLE "track_locks" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER,
    "track_id" INTEGER,
    "track_number" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "machine" TEXT NOT NULL,
    "locked_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "pattern" TEXT DEFAULT 'cli',
    "lock_file_path" TEXT,

    CONSTRAINT "track_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_comments" (
    "id" SERIAL NOT NULL,
    "track_id" INTEGER,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_replied" BOOLEAN DEFAULT false,
    "is_hidden" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "track_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracks" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER,
    "track_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lane_status" TEXT DEFAULT 'planning',
    "lane_action_status" "LaneActionStatus" DEFAULT 'queue',
    "lane_action_result" TEXT,
    "progress_percent" INTEGER DEFAULT 0,
    "current_phase" TEXT,
    "phase_step" TEXT,
    "content_summary" TEXT,
    "index_content" TEXT,
    "plan_content" TEXT,
    "spec_content" TEXT,
    "test_content" TEXT,
    "last_log_tail" TEXT,
    "auto_planning_launched" TIMESTAMP(6),
    "auto_implement_launched" TIMESTAMP(6),
    "auto_review_launched" TIMESTAMP(6),
    "priority" INTEGER DEFAULT 0,
    "sync_status" TEXT DEFAULT 'synced',
    "last_updated_by" TEXT DEFAULT 'worker',
    "last_heartbeat" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "last_updated_by_uid" TEXT,
    "claimed_by" TEXT,
    "active_cli" TEXT,
    "worktree_path" TEXT,
    "git_branch" TEXT,
    "git_lock_commit" TEXT,
    "locked_by" TEXT,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "uid" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "photo_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("uid")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER,
    "hostname" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "status" TEXT DEFAULT 'idle',
    "mode" TEXT DEFAULT 'polling',
    "current_task" TEXT,
    "last_heartbeat" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "machine_token" TEXT,
    "user_uid" TEXT,
    "visibility" TEXT DEFAULT 'private',

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_permissions" (
    "worker_id" INTEGER NOT NULL,
    "user_uid" TEXT NOT NULL,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_permissions_pkey" PRIMARY KEY ("worker_id","user_uid")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "projects_git_remote_key" ON "projects"("git_remote");

-- CreateIndex
CREATE UNIQUE INDEX "projects_git_global_id_key" ON "projects"("git_global_id");

-- CreateIndex
CREATE UNIQUE INDEX "track_locks_project_id_track_number_key" ON "track_locks"("project_id", "track_number");

-- CreateIndex
CREATE INDEX "idx_tracks_priority_queue" ON "tracks"("priority", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tracks_project_id_track_number_key" ON "tracks"("project_id", "track_number");

-- CreateIndex
CREATE UNIQUE INDEX "workers_machine_token_key" ON "workers"("machine_token");

-- CreateIndex
CREATE UNIQUE INDEX "workers_project_id_hostname_pid_key" ON "workers"("project_id", "hostname", "pid");

-- AddForeignKey
ALTER TABLE "file_sync_queue" ADD CONSTRAINT "file_sync_queue_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "provider_status" ADD CONSTRAINT "provider_status_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "track_locks" ADD CONSTRAINT "track_locks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "track_locks" ADD CONSTRAINT "track_locks_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "track_comments" ADD CONSTRAINT "track_comments_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "worker_permissions" ADD CONSTRAINT "worker_permissions_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

