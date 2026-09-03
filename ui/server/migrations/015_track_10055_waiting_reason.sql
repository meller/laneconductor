-- Migration: waiting reason
-- Track 10055: `<lane>:waiting` means "paused, a human has to act" on every
-- lane, not just `done`. A pause with no explanation is unusable, so the
-- status carries a mandatory one-line reason — this is the synced copy of the
-- track's own `**Waiting Reason**` marker, which stays authoritative.
--
-- Declared here (the local runner, replayed on every API startup) AND in
-- migrations/20260903180000_add_waiting_reason.sql (the Atlas set, which is
-- what ever reaches the cloud database). Track 10053 learned the hard way that
-- a column added only to this directory is silently absent in the cloud.

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS waiting_reason TEXT;
