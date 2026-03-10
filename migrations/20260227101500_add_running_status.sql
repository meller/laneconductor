-- Add "running" state to LaneActionStatus enum
-- Note: In PostgreSQL, you cannot directly add a value to an existing enum
-- so we use ALTER TYPE with ADD VALUE

ALTER TYPE "LaneActionStatus" ADD VALUE 'running' BEFORE 'success';
