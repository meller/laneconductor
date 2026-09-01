-- Track 10047 (REQ-3): bounded session resume needs a measurement taken at
-- the end of one run to be available at the start of the next.
-- last_context_tokens is nullable — null means "never measured" (a
-- non-claude CLI, or a run predating this column), which the cap policy
-- (session-cap.mjs) treats as unknown, never as zero.
ALTER TABLE "public"."track_sessions" ADD COLUMN "last_context_tokens" integer NULL;
ALTER TABLE "public"."track_sessions" ADD COLUMN "resume_count" integer NOT NULL DEFAULT 0;
