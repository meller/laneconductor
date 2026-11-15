# Postgres schema (parked: local-api and remote-api modes only)

`local-fs` mode has no database. These are the two copies of the schema that lived in the old
SKILL.md. They differ and neither is declared the winner: the repo's own schema lives in
`migrations/*.sql` and `prisma/schema.sql`, so check those before relying on either.

How they differ:
- Copy A (from `setup collection`) has `projects.create_quality_gate` and the
  `tracks.lane_action_status` / `lane_action_result` columns, a `lane_status` default of
  `'planning'`, `last_updated_by` default `'worker'`, and `UNIQUE(project_id, track_number)`.
- Copy B (the reference section) has no `create_quality_gate` or `lane_action_*` columns, a
  `lane_status` default of `'backlog'`, `last_updated_by` default `'human'`, and adds
  `created_by_email` and `author` with `UNIQUE(project_id, created_by_email, track_number)`
  (NULL emails are each distinct in Postgres).

## Copy A: created by `setup collection` (local-api)

Run through `psql -h <host> -p <port> -U <user> -d <dbname> -f <file>`, or a one-off node script.
```sql
CREATE TABLE IF NOT EXISTS projects (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  repo_path       TEXT UNIQUE NOT NULL,
  git_remote      TEXT,
  git_global_id   UUID UNIQUE,
  primary_cli     TEXT DEFAULT 'claude',
  primary_model   TEXT,
  secondary_cli   TEXT,
  secondary_model TEXT,
  create_quality_gate BOOLEAN DEFAULT false,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tracks (
  id               SERIAL PRIMARY KEY,
  project_id       INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  track_number     TEXT NOT NULL,
  title            TEXT NOT NULL,
  lane_status      TEXT DEFAULT 'planning',  -- planning|backlog|in-progress|review|done
  lane_action_status TEXT DEFAULT 'waiting', -- waiting|running|done
  lane_action_result TEXT,                   -- success|error|timeout
  progress_percent INTEGER DEFAULT 0,
  current_phase    TEXT,
  content_summary  TEXT,
  sync_status      TEXT DEFAULT 'synced',
  last_updated_by  TEXT DEFAULT 'worker',
  last_heartbeat   TIMESTAMP DEFAULT NOW(),
  created_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, track_number)
);
```

## Copy B: DB schema reference

```sql
CREATE TABLE IF NOT EXISTS projects (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  repo_path       TEXT UNIQUE NOT NULL,
  git_remote      TEXT,
  git_global_id   UUID UNIQUE,            -- UUID v5 from git_remote (URL namespace); null if no remote
  primary_cli     TEXT DEFAULT 'claude',  -- claude|agy|gemini|other
  primary_model   TEXT,
  secondary_cli   TEXT,                   -- optional second agent
  secondary_model TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tracks (
  id               SERIAL PRIMARY KEY,
  project_id       INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  track_number     TEXT NOT NULL,
  title            TEXT NOT NULL,
  lane_status      TEXT DEFAULT 'backlog',  -- backlog|in-progress|review|quality-gate|done
  progress_percent INTEGER DEFAULT 0,
  current_phase    TEXT,
  content_summary  TEXT,
  sync_status      TEXT DEFAULT 'synced',
  last_updated_by  TEXT DEFAULT 'human',
  last_heartbeat   TIMESTAMP DEFAULT NOW(),
  created_at       TIMESTAMP DEFAULT NOW(),
  created_by_email TEXT,                    -- author email (NULL for legacy tracks)
  author           TEXT,                    -- author initials (e.g. AM); NULL for legacy tracks
  UNIQUE(project_id, created_by_email, track_number)  -- NULL emails are each distinct in Postgres
);
```
