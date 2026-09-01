// conductor/services/session-resume-policy.mjs
// Track 10047: resolveTrackSession() (laneconductor.sync.mjs) used to
// resume the same claude_session_id forever, for a track's entire
// lifetime, once one existed — no proactive cap. Every resumed turn
// re-pays (at the cached-token rate, but non-zero, and compounding) for
// the ENTIRE accumulated conversation. Confirmed live 2026-09-01: track
// AM-10045's review session hit a hard "Prompt is too long" failure after
// many resumes; AM-10046's implement session reached 406K cached input
// tokens on a single turn, still climbing.
//
// Every spawn (fresh OR resumed) already injects rich file-based context
// on every turn — index.md, spec.md, plan.md, test.md, and a conversation
// tail (laneconductor.sync.mjs's "Context Injection Preparation" block) —
// so a session that cold-starts past this cap is not starting blind; that
// file-based record is the durable, authoritative continuity mechanism
// this codebase already relies on elsewhere.
//
// Resume COUNT (not raw token size) is the proxy used here deliberately:
// tracking actual cached-token size would need either a DB schema change
// or parsing rotating log files, both real work; resume count is a
// reasonable, low-risk approximation using the same file-based counter
// convention already established for pre-spawn-block tracking
// (.prespawn-block-count). A more precise size-based policy is a valid
// future improvement, not a blocker for closing the unbounded-growth gap.
//
// Pure module, no I/O — mirrors this codebase's other extraction style
// (workspace-mode.mjs, lane-regression-guard.mjs, track-folder.mjs).

export const DEFAULT_MAX_RESUME_COUNT = 8;

/**
 * @param {object} opts
 * @param {number} opts.resumeCount - how many times this session has
 *   already been resumed (0 = never resumed yet)
 * @param {number} [opts.maxResumeCount]
 * @returns {boolean} true when the session should be retired (cold-start
 *   a fresh one) instead of resumed again
 */
export function shouldRetireSession({ resumeCount, maxResumeCount = DEFAULT_MAX_RESUME_COUNT }) {
  return resumeCount >= maxResumeCount;
}
