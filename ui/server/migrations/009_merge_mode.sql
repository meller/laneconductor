-- Migration: Per-track merge mode (pr vs direct) + PR tracking fields
-- Track 10018: Per-Track Merge Mode (PR vs Direct) with Worktrees Approval Workflow

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS merge_mode TEXT;        -- 'pr' | 'direct' | NULL (resolves to 'pr')
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS pr_number INTEGER;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS pr_url TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS pr_status TEXT;         -- 'open' | 'checks-failed' | 'conflicted' | 'closed' | 'merged' | NULL
