-- Track 1112 Phase 7: worktree visibility panel
-- Compact worktree inventory a worker reports on each heartbeat (the same
-- shape as `lc worktrees --json`). Reported state, not a durable record —
-- overwritten every heartbeat, never historized. Null means the worker
-- hasn't reported yet (e.g. just started, or its host has no worktrees).
ALTER TABLE workers ADD COLUMN IF NOT EXISTS worktrees JSONB;
