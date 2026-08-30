/**
 * LaneConductor Canonical Constants
 * Centrally defines the valid lanes and action statuses to ensure consistency
 * across the CLI, Heartbeat Worker, and UI.
 */

export const Lanes = {
  PLAN: 'plan',                 // Planning/drafting lane
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
  BLOCKED: 'blocked', // Max retries reached or human intervention required
  // Track 10035: distinct from QUEUE — a pr-mode done-lane merge action that
  // successfully opened a PR is genuinely finished with nothing left for a
  // worker to do, but isn't 'success' either (approval/merge happens on
  // GitHub, outside this system). Matches the Postgres enum value added by
  // migrations/20260304181909_enable_rls.sql (`ALTER TYPE "LaneActionStatus"
  // ADD VALUE 'waiting' AFTER 'queue'`) — the DB already accepted this value
  // before this file did; ActionStatusAliases below used to alias the
  // literal string 'waiting' back down to QUEUE, which silently clobbered
  // every done:waiting write moments after it landed (parseLaneStatus() is
  // what the generic file-sync path re-derives lane_action_status from).
  WAITING: 'waiting',
};

// Track 10040 REQ-13: the single source of truth for "which lanes can a
// worker claim a queued action in" and "which lanes can a track be placed
// in at all". Adding a lane means editing exactly this file — every SQL/JS
// site that used to hand-list lane names (and silently missed one when
// track 10035 added DONE as claimable) now derives from these instead.
export const CLAIMABLE_LANES = [Lanes.PLAN, Lanes.IMPLEMENT, Lanes.REVIEW, Lanes.QUALITY_GATE, Lanes.DONE];
// backlog is deliberately absent — nothing auto-claims a backlog track.

export const MOVABLE_LANES = [...CLAIMABLE_LANES, Lanes.BACKLOG];

/**
 * Maps common variations/aliases to the canonical lane names.
 */
export const LaneAliases = {
  'planning': Lanes.PLAN,
  'in-progress': Lanes.IMPLEMENT,
  'implementing': Lanes.IMPLEMENT,
  'complete': Lanes.DONE,
  'completed': Lanes.DONE,
  'success': Lanes.DONE
};

/**
 * Maps old lane status values to the new enum.
 */
export const ActionStatusAliases = {
  'idle': LaneActionStatus.QUEUE,
  'done': LaneActionStatus.SUCCESS,
  'complete': LaneActionStatus.SUCCESS,
  'completed': LaneActionStatus.SUCCESS
};
