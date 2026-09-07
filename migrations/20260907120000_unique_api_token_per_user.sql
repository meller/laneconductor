-- Track 10074: make "at most one api_token per user" a database invariant.
--
-- POST /auth/token (cloud/functions/index.js) enforced this rule with a
-- SELECT-then-INSERT, no transaction, and nothing in the schema backed it —
-- api_tokens' only key is token itself. Two concurrent calls for the same
-- (workspace_id, created_by) (realistic: the UI fires this on every
-- onAuthStateChanged, and two tabs or a fast reload both fire it) could both
-- pass the SELECT before either INSERT committed, minting two live tokens for
-- one user. This migration adds the unique index the handler's ON CONFLICT
-- clause (see the same-day handler change) now relies on to make that
-- atomic instead of racy.
--
-- Dedupe BEFORE index, not just at index-creation time: before PR #25/track
-- 10070 the endpoint minted unconditionally on every onAuthStateChanged, so
-- production almost certainly already holds duplicate (workspace_id,
-- created_by) rows, and CREATE UNIQUE INDEX would abort the deploy outright
-- if applied first.
--
-- Keep-oldest policy (track 10074 spec.md D-2): the token a worker actually
-- holds is overwhelmingly likely to be the first one issued for that user —
-- raw tokens live outside the database (.env COLLECTOR_<n>_TOKEN,
-- collectors[].token in .laneconductor.json, or GCP Secret Manager) and are
-- pasted in once, early, during setup. Every later row was minted by a
-- browser sign-in whose response body the UI discards without reading
-- (AuthContext.jsx), making those rows unusable by construction. Deleting a
-- duplicate is a real revocation, though: if any later row's token actually
-- reached a live caller through a path not visible in this repo, that
-- worker starts getting 401s once this runs, and there is no list/revoke
-- endpoint yet to see the damage after the fact. Run the audit query below
-- BEFORE applying, so the blast radius is known rather than discovered.
--
-- ORDER BY created_at ASC NULLS FIRST, not a plain ASC: created_at is
-- nullable and only gained its DEFAULT CURRENT_TIMESTAMP in migration
-- 20260506151159_add_track_type_kpi_fields.sql, so a NULL created_at marks a
-- row older than that migration — exactly the row this policy wants to
-- keep. A comparison-based `DELETE ... USING x WHERE a.created_at <
-- x.created_at` would instead have left every NULL-created_at duplicate
-- untouched (NULL < anything is NULL, not true) and then failed at
-- CREATE UNIQUE INDEX with those rows still in place.
--
-- workspace_id IS NULL rows are excluded from the dedupe and from the index
-- (a plain unique index treats NULLs as distinct, so they'd never conflict
-- anyway). This is safe: the handler always binds wsRows[0].id from a
-- RETURNING id upsert, so it can never insert a NULL workspace_id. Postgres
-- 15's NULLS NOT DISTINCT would close this theoretical gap, but nothing else
-- in this schema needs a version floor that high — not worth it here.
--
-- Idempotent: the DELETE matches nothing once no group has a duplicate, and
-- CREATE UNIQUE INDEX IF NOT EXISTS is a no-op if this migration (or an
-- equivalent one) already ran.
--
-- DEPLOY ORDER IS LOAD-BEARING. The handler's `INSERT ... ON CONFLICT
-- (workspace_id, created_by) DO NOTHING RETURNING token` raises Postgres
-- error 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
-- specification") if this index does not exist yet. This migration MUST be
-- applied before the function deploy that ships the new handler.
-- scripts/deploy.sh already applies Atlas migrations at step [1/4], ahead of
-- the function deploy at a later step, so the default deploy path is
-- correct — this is a rider on it, not a special case.
--
-- Pre-flight audit query — run this against production BEFORE applying,
-- to size how many rows/users this will affect:
--   SELECT workspace_id, created_by, count(*)
--     FROM api_tokens
--    WHERE workspace_id IS NOT NULL
--    GROUP BY 1, 2
--   HAVING count(*) > 1
--    ORDER BY 3 DESC;
--
-- Post-apply verification — this must return zero rows:
--   SELECT workspace_id, created_by, count(*)
--     FROM api_tokens
--    WHERE workspace_id IS NOT NULL
--    GROUP BY 1, 2
--   HAVING count(*) > 1;

DELETE FROM api_tokens
WHERE token IN (
  SELECT token FROM (
    SELECT token,
           row_number() OVER (
             PARTITION BY workspace_id, created_by
             ORDER BY created_at ASC NULLS FIRST, token ASC
           ) AS rn
      FROM api_tokens
     WHERE workspace_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_workspace_id_created_by_key
  ON api_tokens (workspace_id, created_by);
