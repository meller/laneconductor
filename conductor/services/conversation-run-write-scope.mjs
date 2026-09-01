// conductor/services/conversation-run-write-scope.mjs
// Track AM-10046 Phase 2 (REQ-1, REQ-2, REQ-6): a conversation-reply run
// (label 'local-fs-answer') is not a lane transition. It exists to append a
// reply to conversation.md and clear **Waiting for reply** — nothing else.
// Before this module existed, three separate write sites (the reply prompt's
// own /laneconductor pulse instruction, cmd_type feeding the dispatched
// skill's step-0 "claim the track" instruction, and the exit handler's
// resolveTransition(null, laneStatus, ...) fallback) each independently
// pushed the DISPATCH-TIME lane snapshot back to disk, unconditionally.
// Confirmed live 2026-08-31 (track AM-10045): six-flip **Lane** oscillation
// over ~90 seconds from exactly this pattern racing a concurrent lane
// action.
//
// This module is the single place that answers "what may a conversation
// run write" — every one of those three sites routes its decision through
// it instead of assuming "everything a normal run can write."
//
// Pure module, no I/O — mirrors lane-regression-guard.mjs's style.

/**
 * @param {object} opts
 * @param {boolean} opts.isConversationRun - true when label === 'local-fs-answer'
 * @returns {{canWriteLane: boolean, canWriteLaneStatus: boolean}}
 */
export function getConversationRunWriteScope({ isConversationRun }) {
  if (isConversationRun) {
    // A reply run's only legitimate markers are **Waiting for reply**
    // (handled separately — see the exit handler's existing 3b block) and
    // conversation.md content. Lane/Lane Status belong to the lane state
    // machine, which a reply did not enter.
    return { canWriteLane: false, canWriteLaneStatus: false };
  }
  return { canWriteLane: true, canWriteLaneStatus: true };
}

// Track AM-10046 Phase 4 (REQ-6): what a conversation-reply dispatch calls
// itself — for the run marker's `action` field (conductor/.runs/<track>.json,
// read by orphan-reconcile's classifyOrphanedDispatch) and for local logging.
// Never a lane name: an orphaned reply run must never be classified as an
// orphaned lane action (e.g. a crashed 'done' dispatch triggering merge-
// specific artifact-copy reasoning for what was actually just a comment).
export const CONVERSATION_REPLY_ACTION = 'conversation-reply';
