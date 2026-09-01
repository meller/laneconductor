-- Migration: bounded session resume
-- Track 10047 (REQ-3): a measurement taken at the end of one lane-action
-- run needs to be available at the start of the next, so the worker can
-- decide whether to keep resuming a session or retire it and cold-start.
-- last_context_tokens is nullable — null means "never measured" (a
-- non-claude CLI, or a run predating this column), which the cap policy
-- (conductor/services/session-cap.mjs) treats as unknown, never as zero.

ALTER TABLE track_sessions ADD COLUMN IF NOT EXISTS last_context_tokens INTEGER;
ALTER TABLE track_sessions ADD COLUMN IF NOT EXISTS resume_count INTEGER NOT NULL DEFAULT 0;
