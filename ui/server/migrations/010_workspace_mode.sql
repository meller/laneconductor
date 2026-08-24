-- Migration: Per-track workspace mode (main-direct vs branch-per-track)
-- Track 1115: Workspace Mode — main-direct vs branch-per-track

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS workspace_mode TEXT;    -- 'main' | 'branch' | NULL (resolves to 'branch')
