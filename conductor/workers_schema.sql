CREATE TABLE IF NOT EXISTS workers (
  id              SERIAL PRIMARY KEY,
  project_id      INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  hostname        TEXT NOT NULL,
  pid             INTEGER NOT NULL,
  status          TEXT DEFAULT 'idle', -- idle|busy|offline
  current_task    TEXT,                -- e.g., 'Reviewing Track 005'
  last_heartbeat  TIMESTAMP DEFAULT NOW(),
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, hostname, pid)
);
