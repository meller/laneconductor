-- Track 10053: lift the pre-spawn block counter into the Atlas migration set.
--
-- These four columns were added by ui/server/migrations/013_track_10040_prespawn_block.sql.
-- That directory has a runner, but only a local one: runMigration() in
-- ui/server/index.mjs replays it on every local API server startup. The cloud
-- database is served by cloud/functions/index.js, which has no equivalent, and
-- is only ever migrated by scripts/migrate.sh (`atlas migrate apply` over this
-- directory). So these columns are present on every developer machine and were
-- absent from the cloud one — confirmed by introspecting the live cloud schema
-- — which is why porting POST /track/:num/prespawn-block to the cloud function
-- needs this first.
--
-- Types are copied verbatim from 013 so a database that already has the
-- columns keeps exactly the shape the local collector was written against —
-- note prespawn_blocked_at is TIMESTAMPTZ, not TIMESTAMP.
--
-- IF NOT EXISTS (unusual for this directory, where migrations are plain ADD
-- COLUMN) is deliberate: every existing developer database already ran 013, so
-- a bare ADD COLUMN would fail for all of them on the next `atlas migrate
-- apply`. This makes the migration a no-op there and the real thing in the
-- cloud.
--
-- Reconciling the whole ui/server/migrations/ directory is deliberately out of
-- scope here — see this track's spec.md Open Items.

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS prespawn_block_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS prespawn_block_kind TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS prespawn_block_reason TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS prespawn_blocked_at TIMESTAMPTZ;
