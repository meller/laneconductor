-- Normalize old lane_action_status values to canonical status names
-- 'waiting' -> 'queue' (old to new status name)
-- This fixes tracks synced before ActionStatusAliases were introduced

UPDATE tracks
SET lane_action_status = 'queue'
WHERE lane_action_status = 'waiting';

-- Also normalize 'done' -> 'success' for completeness
UPDATE tracks
SET lane_action_status = 'success'
WHERE lane_action_status = 'done';
