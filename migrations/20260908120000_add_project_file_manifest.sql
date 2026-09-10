-- Track 10080 Phase 4: worker-pushed file manifest, the fallback source for
-- GET /api/projects/:id/files (composer autocomplete) when a project's
-- repo_path isn't reachable from the API host (remote-api mode). Keyed to
-- the project, not the worker, since a repository's file list is a
-- property of the repository, not of any one worker reporting on it.
--
-- Hand-trimmed to just these additive columns, following the same
-- convention as 20260905215931_add_collector_health.sql.
ALTER TABLE "public"."projects" ADD COLUMN "file_manifest" jsonb NULL;
ALTER TABLE "public"."projects" ADD COLUMN "file_manifest_digest" text NULL;
ALTER TABLE "public"."projects" ADD COLUMN "file_manifest_updated_at" timestamp NULL;
