/**
 * LaneConductor Canonical Constants
 * Centrally defines the valid lanes and action statuses to ensure consistency
 * across the CLI, Heartbeat Worker, and UI.
 */

export const Lanes = {
  PLANNING: 'planning',         // The staging/drafting lane
  PLAN: 'plan',                 // Alias/Legacy for planning
  IMPLEMENT: 'implement',       // Active development
  REVIEW: 'review',             // Human or AI review
  QUALITY_GATE: 'quality-gate', // Automated checks
  DONE: 'done',                 // Completed
  BACKLOG: 'backlog'            // Deferred work
};

export const LaneActionStatus = {
  QUEUE: 'queue',     // Waiting for a worker to pick it up
  RUNNING: 'running', // Worker is currently active
  SUCCESS: 'success', // Last run finished successfully
  FAILURE: 'failure', // Last run failed
  BLOCKED: 'blocked'  // Max retries reached or human intervention required
};

/**
 * Maps common variations/aliases to the canonical lane names.
 */
export const LaneAliases = {
  'planning': Lanes.PLAN,
  'in-progress': Lanes.IMPLEMENT,
  'implementing': Lanes.IMPLEMENT,
  'completed': Lanes.DONE,
  'success': Lanes.DONE
};

/**
 * Maps old lane status values to the new enum.
 */
export const ActionStatusAliases = {
  'waiting': LaneActionStatus.QUEUE,
  'done': LaneActionStatus.SUCCESS
};
