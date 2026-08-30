-- Migration: worker code staleness detection
-- Track 10040 Phase 2 (REQ-11): the commit sha this worker's code was
-- loaded at, captured once at boot (never refreshed on the heartbeat) and
-- compared against the install dir's current HEAD by the manager's
-- staleness sweep.

ALTER TABLE workers ADD COLUMN IF NOT EXISTS code_sha TEXT;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS code_sha_captured_at TIMESTAMPTZ;
