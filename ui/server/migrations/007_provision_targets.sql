-- Migration: Add provision_targets table for remote worker provisioning
-- Track 1089: Remote Worker Provisioning

CREATE TABLE IF NOT EXISTS provision_targets (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  user_uid TEXT,
  host TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_project_host UNIQUE (project_id, host)
);
