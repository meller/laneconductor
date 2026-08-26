-- Migration: Durable reap outcome on worker_dispatch
-- Track 10032: F18 claim-timeout — surface the outcome in the UI
--
-- reaped_at/reap_reason record what reapStaleDispatches() did (reassign or
-- fail) on a row that no longer changes once written — unlike `result`,
-- which the reassigned worker's own completion PATCH later overwrites.

ALTER TABLE worker_dispatch ADD COLUMN IF NOT EXISTS reaped_at   TIMESTAMPTZ NULL;
ALTER TABLE worker_dispatch ADD COLUMN IF NOT EXISTS reap_reason TEXT NULL;
