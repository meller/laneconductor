-- Migration: collector health
-- Track 10064: a remote collector could fail continuously (confirmed live:
-- 560 consecutive 401s) with nothing visible anywhere but the raw worker
-- log. `collector_health` is the worker's own per-collector auth/health
-- snapshot (attempts, consecutive_failures, last_error, last_success_at,
-- token_source), shipped on every /worker/register and /worker/heartbeat
-- call, so a failing collector shows up in the workers API/UI.
--
-- Declared here (the local runner, replayed on every API startup) AND in
-- migrations/20260905215931_add_collector_health.sql (the Atlas set, which
-- is what ever reaches the cloud database). Track 10053 learned the hard
-- way that a column added only to this directory is silently absent in the
-- cloud.

ALTER TABLE workers ADD COLUMN IF NOT EXISTS collector_health JSONB;
