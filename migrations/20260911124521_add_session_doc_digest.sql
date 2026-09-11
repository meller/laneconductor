-- Track AM-10090 (REQ-6): a resumed session's stored claude_session_id needs
-- a fingerprint of the track documents it last saw, so the next resume
-- decision can detect that a different session/human rewrote them out from
-- under it. Nullable — null means "never recorded" (a row that predates
-- this column, or a session whose run never got far enough to measure it),
-- which hasTrackDocDrift() (conductor/services/track-doc-digest.mjs) treats
-- as "no drift", never as a mismatch (REQ-10) — treating unknown as drift
-- would cold-start every existing session on upgrade.
ALTER TABLE "public"."track_sessions" ADD COLUMN "doc_digest" text NULL;
