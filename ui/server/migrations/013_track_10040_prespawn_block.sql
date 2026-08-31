-- Migration: pre-spawn block counter
-- Track 10040 Phase 5 (REQ-1, 8, 9): a cause-generic, DB-persisted counter
-- of consecutive pre-spawn blocks (the workspace guard's dirty-checkout /
-- main-mode-lock throw sites, plus reserved kinds for other components —
-- see conductor/services/prespawn-block.mjs). DB-persisted rather than
-- filesystem-only per track 10039's cross-track request: its dispatcher-
-- only mode has no local conductor/tracks/ to hold a sibling file.

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS prespawn_block_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS prespawn_block_kind TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS prespawn_block_reason TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS prespawn_blocked_at TIMESTAMPTZ;
