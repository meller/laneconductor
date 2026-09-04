-- Track 10061 (REQ-10): persists the collector handshake verdict computed at
-- registration (conductor/services/collector-manifest.mjs's compareManifest)
-- so a mismatch is visible in the UI, not only in the worker's own log —
-- the exact gap that let tracks 10052 and 10053 run undetected until a human
-- noticed something weird and went digging.
--
-- Both nullable, no backfill, no default: a worker that has never handshaken
-- (every worker registered before this track, and any worker whose collector
-- predates the /health handshake entirely) is NOT a mismatch — it's simply
-- unknown, and NULL says that honestly rather than defaulting to a fabricated
-- "ok" or "unknown" JSON value.
--
-- Written at registration only, never on the heartbeat path — the same
-- convention `code_sha`/`code_sha_captured_at` already follow (see
-- 20260808082602_add_worker_number.sql's neighbors).

ALTER TABLE workers ADD COLUMN IF NOT EXISTS collector_api_version INTEGER;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS collector_compat JSONB;
