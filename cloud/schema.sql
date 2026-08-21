-- LaneConductor Cloud (Supabase) Schema Additions

CREATE TABLE IF NOT EXISTS workspaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_org      TEXT UNIQUE NOT NULL,
  display_name    TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  firebase_uid    TEXT NOT NULL,
  github_username TEXT NOT NULL,
  role            TEXT DEFAULT 'member',
  joined_at       TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (workspace_id, firebase_uid)
);

CREATE TABLE IF NOT EXISTS api_tokens (
  token           TEXT PRIMARY KEY,
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by      TEXT NOT NULL, -- firebase_uid
  created_at      TIMESTAMP DEFAULT NOW()
);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS git_global_id UUID UNIQUE,
  ADD COLUMN IF NOT EXISTS workspace_id  UUID REFERENCES workspaces(id);

ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;

-- Track 10023: author-prefixed IDs
ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS created_by_email TEXT,
  ADD COLUMN IF NOT EXISTS author TEXT;

DROP INDEX IF EXISTS "tracks_project_id_track_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "tracks_project_id_author_track_number_key"
  ON "public"."tracks" ("project_id", "created_by_email", "track_number");

CREATE INDEX IF NOT EXISTS idx_tracks_priority_waiting ON tracks (priority DESC, created_at ASC) WHERE lane_action_status = 'waiting';
