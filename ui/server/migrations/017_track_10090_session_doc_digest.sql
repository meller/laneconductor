-- Migration: session document drift detection
-- Track AM-10090 (REQ-6): a resumed session's stored claude_session_id needs
-- a fingerprint of the track documents it last saw, so the next resume
-- decision can detect that a different session/human rewrote them out from
-- under it. Nullable — null means "never recorded", which the cap policy
-- (conductor/services/track-doc-digest.mjs's hasTrackDocDrift()) treats as
-- "no drift", never as a mismatch.

ALTER TABLE track_sessions ADD COLUMN IF NOT EXISTS doc_digest TEXT;
