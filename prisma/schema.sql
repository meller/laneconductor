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
    "integrations" JSONB DEFAULT '{}',
    "dev_command" TEXT,
    "dev_url" TEXT,
    "dev_server_pid" INTEGER,
    "mode" TEXT DEFAULT 'local-fs',
    "workspace_id" UUID,
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
-- Track 1086: one resumable Claude session per (worker, track) pair, so a
-- lane action and a later conversation reply for the same track on the same
-- worker can --resume instead of cold-starting and re-reading all context.
CREATE TABLE "track_sessions" (
    "track_number" TEXT NOT NULL,
    "worker_id" INTEGER NOT NULL,
    "claude_session_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "track_sessions_pkey" PRIMARY KEY ("track_number","worker_id")
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
    "integrations" JSONB DEFAULT '{}',
    "auto_planning_launched" TIMESTAMP(6),
    "auto_implement_launched" TIMESTAMP(6),
    "auto_review_launched" TIMESTAMP(6),
    "priority" INTEGER DEFAULT 0,
    "sync_status" TEXT DEFAULT 'synced',
    "last_updated_by" TEXT DEFAULT 'worker',
    "last_heartbeat" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "content_updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "last_updated_by_uid" TEXT,
    "created_by_uid" TEXT,
    "assignee_uid" TEXT,
    "claimed_by" TEXT,
    "active_cli" TEXT,
    "worktree_path" TEXT,
    "git_branch" TEXT,
    "git_lock_commit" TEXT,
    "locked_by" TEXT,
    "track_type" TEXT DEFAULT 'dev',
    "kpi_target" INTEGER,
    "kpi_actual" INTEGER,
    "kpi_metric" TEXT,
    "kpi_source" TEXT,
    "kpi_source_config" TEXT,
    "kpi_threshold" INTEGER,
    "kpi_window" TEXT,
    "kpi_snapshot" JSONB,
    "kpi_measured_at" TIMESTAMP(6),
    "kpi_check_after" TIMESTAMP(6),
    "kpi_scheduled_at" TIMESTAMP(6),
    "kpi_maps_to" TEXT,
    "waiting_for_reply" BOOLEAN NOT NULL DEFAULT false,

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
-- Track 1085: per-worker command inbox, separate from the general
-- auto-launch queue. track_number is null for project-level actions
-- (e.g. deploy); payload is a generic per-action parameter bag so future
-- action types don't need their own dedicated column.
-- Track 1102 F10c: worker_id is nullable and its FK is ON DELETE SET NULL
-- (not CASCADE) so deleting a workers row — F10's soft de-registration
-- normally avoids this, but a manual row deletion can still happen — never
-- again erases this table's history, including all worker_adhoc_chat the
-- Activity panel reads through it.
CREATE TABLE "worker_dispatch" (
    "id" SERIAL NOT NULL,
    "worker_id" INTEGER,
    "track_number" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMPTZ(6),

    CONSTRAINT "worker_dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER,
    "hostname" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "worker_number" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT DEFAULT 'idle',
    "mode" TEXT DEFAULT 'polling',
    "current_task" TEXT,
    "last_heartbeat" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "machine_token" TEXT,
    "user_uid" TEXT,
    "visibility" TEXT DEFAULT 'private',
    -- Track 1091: 'project' (default, unchanged) or 'manager' — a manager
    -- worker isn't scoped to any project (project_id stays null for it) and
    -- is a machine-level singleton, see workers_one_manager_per_host below.
    "type" TEXT NOT NULL DEFAULT 'project',
    -- Track 1096: the CLI/model this worker's primary session runs, and the
    -- model list it discovered on its own machine (null = use UI presets;
    -- see conductor/laneconductor.sync.mjs's discoverAvailableModels).
    "cli" TEXT,
    "model" TEXT,
    "available_models" JSONB,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Track 1089: remote hosts a project's workers can be provisioned onto.
CREATE TABLE "provision_targets" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER REFERENCES "projects"("id") ON DELETE CASCADE,
    "user_uid" TEXT,
    "host" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provision_targets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "unique_project_host" UNIQUE ("project_id", "host")
);

-- CreateTable
CREATE TABLE "worker_permissions" (
    "worker_id" INTEGER NOT NULL,
    "user_uid" TEXT NOT NULL,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_permissions_pkey" PRIMARY KEY ("worker_id","user_uid")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "github_org" TEXT NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "workspace_id" UUID NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "github_username" TEXT NOT NULL,
    "role" TEXT DEFAULT 'member',
    "joined_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("workspace_id","firebase_uid")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "token" TEXT NOT NULL,
    "workspace_id" UUID,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("token")
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
CREATE INDEX "idx_worker_dispatch_worker_status" ON "worker_dispatch"("worker_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workers_machine_token_key" ON "workers"("machine_token");

-- CreateIndex
CREATE UNIQUE INDEX "workers_project_id_hostname_worker_number_key" ON "workers"("project_id", "hostname", "worker_number");

-- CreateIndex
-- Track 1091: at most one 'manager'-type worker per hostname, machine-wide.
-- A plain unique constraint on (project_id, hostname) wouldn't work here —
-- Postgres treats each NULL project_id as distinct, so multiple manager
-- rows (project_id always null) would NOT violate it; this partial index
-- is what actually enforces the singleton.
CREATE UNIQUE INDEX "workers_one_manager_per_host" ON "workers"("hostname") WHERE "type" = 'manager';

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_github_org_key" ON "workspaces"("github_org");

-- AddForeignKey
ALTER TABLE "file_sync_queue" ADD CONSTRAINT "file_sync_queue_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "provider_status" ADD CONSTRAINT "provider_status_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "track_locks" ADD CONSTRAINT "track_locks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "track_locks" ADD CONSTRAINT "track_locks_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "track_comments" ADD CONSTRAINT "track_comments_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "track_sessions" ADD CONSTRAINT "track_sessions_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "worker_dispatch" ADD CONSTRAINT "worker_dispatch_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "worker_permissions" ADD CONSTRAINT "worker_permissions_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

