-- Track 10085: lift merge_mode and workspace_mode into the Atlas migration set.
--
-- These two columns were added by ui/server/migrations/009_merge_mode.sql and
-- 010_workspace_mode.sql. That directory has a runner, but only a local one:
-- runMigration() in ui/server/index.mjs replays it on every local API server
-- startup. The cloud database is served by cloud/functions/index.js, which has
-- no equivalent, and is only ever migrated by scripts/migrate.sh
-- (`atlas migrate apply` over this directory). So these columns were present on
-- every developer machine and absent from the cloud one — confirmed missing
-- from prisma/schema.prisma, prisma/schema.sql, cloud/schema.sql, and every
-- prior file in this directory, the same way track 10053 confirmed the
-- prespawn-block columns were missing (see
-- 20260903120000_add_prespawn_block_columns.sql for that precedent).
--
-- pr_number, pr_url, and pr_status (also added by 009_merge_mode.sql) are
-- deliberately NOT included here — cloud's POST /track handler does not read
-- or write them, and porting them is out of this track's scope (AM-10085 only
-- covers the fields POST /track omits; see its spec.md).
--
-- Type is copied verbatim from 009/010 (plain nullable TEXT, no DEFAULT — both
-- resolve their default at read time via resolveMergeMode()/
-- resolveWorkspaceMode(), not a DB default).
--
-- IF NOT EXISTS is deliberate, same reasoning as 20260903120000: any database
-- that already has these columns (e.g. one that separately ran
-- ui/server/migrations/) makes this a no-op there and the real fix on cloud.

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS merge_mode TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS workspace_mode TEXT;
