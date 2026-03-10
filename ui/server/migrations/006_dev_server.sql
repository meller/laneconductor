-- Migration: Add dev server configuration columns to projects table
-- Track 1014: Dev Server Quick-Start from Kanban Card

ALTER TABLE projects ADD COLUMN IF NOT EXISTS dev_command TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS dev_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS dev_server_pid INTEGER;
