-- Modify "api_tokens" table
ALTER TABLE "public"."api_tokens" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
-- Modify "tracks" table
ALTER TABLE "public"."tracks" ADD COLUMN "track_type" text NULL DEFAULT 'dev', ADD COLUMN "kpi_target" integer NULL, ADD COLUMN "kpi_actual" integer NULL, ADD COLUMN "kpi_metric" text NULL, ADD COLUMN "kpi_source" text NULL, ADD COLUMN "kpi_source_config" text NULL, ADD COLUMN "kpi_threshold" integer NULL, ADD COLUMN "kpi_window" text NULL, ADD COLUMN "kpi_snapshot" jsonb NULL, ADD COLUMN "kpi_measured_at" timestamp NULL, ADD COLUMN "kpi_check_after" timestamp NULL, ADD COLUMN "kpi_scheduled_at" timestamp NULL, ADD COLUMN "kpi_maps_to" text NULL;
-- Modify "workspace_members" table
ALTER TABLE "public"."workspace_members" ALTER COLUMN "joined_at" SET DEFAULT CURRENT_TIMESTAMP;
-- Modify "workspaces" table
ALTER TABLE "public"."workspaces" DROP CONSTRAINT "workspaces_github_org_key", ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
-- Create index "workspaces_github_org_key" to table: "workspaces"
CREATE UNIQUE INDEX "workspaces_github_org_key" ON "public"."workspaces" ("github_org");
-- Modify "projects" table
ALTER TABLE "public"."projects" DROP CONSTRAINT "projects_workspace_id_fkey", ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
