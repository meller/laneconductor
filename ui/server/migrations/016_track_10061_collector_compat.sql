-- Track 10061 (REQ-10): mirrors migrations/20260904140000_add_worker_collector_compat.sql
-- for this server's own self-contained migration bootstrap (runMigration(),
-- applied idempotently on every startup — see ui/server/index.mjs). Same
-- reasoning as that file: both nullable, no backfill, no default. A worker
-- that has never handshaken is unknown, not a fabricated "ok"/"unknown"
-- value, and is NOT written on the heartbeat path — registration only,
-- matching the code_sha convention.

ALTER TABLE workers ADD COLUMN IF NOT EXISTS collector_api_version INTEGER;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS collector_compat JSONB;
