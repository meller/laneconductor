-- Track 10055: `<lane>:waiting` is a first-class status on every lane, and a
-- park with no explanation is unusable — the card says "paused" and nobody
-- knows what unblocks it. This column holds the one-line reason, mirroring the
-- `**Waiting Reason**` marker in the track's index.md (which stays
-- authoritative; this is the synced copy the board and Inbox read).
--
-- Nullable with no default and no backfill: the overwhelming majority of
-- tracks are not parked, and the existing `done:waiting` tracks predate the
-- marker — they surface with the resolved fallback reason rather than a
-- fabricated one.
--
-- No enum change needed: `waiting` was added to "LaneActionStatus" by
-- 20260304181909_enable_rls.sql.

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS waiting_reason TEXT;
