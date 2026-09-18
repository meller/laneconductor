-- Migration: Worker code-staleness verdict
-- Track AM-10099 Phase 8 (item f): the worker's own periodic
-- checkWorkerCodeStaleness() sweep result, shipped on every
-- /worker/heartbeat call so a merge that never got followed by a restart
-- is visible somewhere a human actually looks (a Kanban badge), not only
-- in a log line. Empty array = current; non-empty = at least one local
-- worker on this host is running code behind this install dir's HEAD.

ALTER TABLE workers ADD COLUMN IF NOT EXISTS code_staleness JSONB;
