-- Add value to enum type: "LaneActionStatus"
ALTER TYPE "LaneActionStatus" ADD VALUE 'waiting' AFTER 'queue';
-- Create index "idx_tracks_priority_waiting" to table: "tracks"
CREATE INDEX "idx_tracks_priority_waiting" ON "public"."tracks" ("priority" DESC, "created_at") WHERE (lane_action_status = 'waiting'::public."LaneActionStatus");
-- Create "workspaces" table
CREATE TABLE "public"."workspaces" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "github_org" text NOT NULL,
  "display_name" text NULL,
  "created_at" timestamp NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "workspaces_github_org_key" UNIQUE ("github_org")
);
-- Create "api_tokens" table
CREATE TABLE "public"."api_tokens" (
  "token" text NOT NULL,
  "workspace_id" uuid NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp NULL DEFAULT now(),
  PRIMARY KEY ("token"),
  CONSTRAINT "api_tokens_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Modify "projects" table
ALTER TABLE "public"."projects" ADD COLUMN "workspace_id" uuid NULL, ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- Create "workspace_members" table
CREATE TABLE "public"."workspace_members" (
  "workspace_id" uuid NOT NULL,
  "firebase_uid" text NOT NULL,
  "github_username" text NOT NULL,
  "role" text NULL DEFAULT 'member',
  "joined_at" timestamp NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "firebase_uid"),
  CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Enable ROW LEVEL SECURITY
ALTER TABLE "public"."api_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."track_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tracks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."workers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."workspace_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."workspaces" ENABLE ROW LEVEL SECURITY;
