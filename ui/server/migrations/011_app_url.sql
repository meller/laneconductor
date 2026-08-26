-- Migration: Live deployed app URL
-- Track AM-1119 Phase 4: Deploy-to-URL + app_url plumbing

ALTER TABLE projects ADD COLUMN IF NOT EXISTS app_url TEXT;    -- live deployed URL, set by the generated deploy track's own implement run; NULL until deployed
