// conductor/services/session-cap.mjs
// Track 10047: resolveTrackSession() (laneconductor.sync.mjs) used to
// resume the same claude_session_id forever once one existed for a track
// — no cap. A resumed run's prompt carries only the unanswered human tail
// (spec.md Correction 1 — NOT the full file-based context project docs
// get on a fresh spawn), so --resume was the session's ONLY continuity
// mechanism, and every resumed turn re-pays (cached rate, but non-zero,
// compounding) for the whole accumulated conversation regardless.
//
// Confirmed live 2026-09-01: track AM-10045's review session hard-failed
// on "Prompt is too long" after many resumes; AM-10046's implement session
// reached 406K cached tokens on a single turn. Measured across all 363
// stream-json logs under conductor/logs/ with assistant-level token usage
// (last-assistant cache_read + cache_creation; see
// stream-json-tail.mjs's extractSessionContextTokens for why NOT the
// result event):
//   p50 peak within a single lane action:  164,159
//   p90 peak within a single lane action:  498,594
//   max peak within a single lane action:  932,930
//   runs exceeding 150,000 in ONE action:  209/363 (57%)
//   runs exceeding 200,000 in ONE action:  142/363 (39%)
//   runs exceeding 400,000 in ONE action:   50/363 (13%)
// A 150-200K cap (the threshold this track's own intake description
// originally proposed) would fire after nearly every single lane action —
// track 1102's own session-resume feature would silently never survive to
// be resumed. 400,000 sits above the p90 single-action working range and
// well below the observed 620K-725K dead zone (six consecutive resumed
// runs on track 1102 that inherited ~724K tokens and did essentially
// nothing — 2-3 assistant messages — before ending).
//
// Resume COUNT is retained only as a fallback for when token data is
// unavailable, never as the primary signal: track 1102 hit ~724K within a
// handful of resumes, while other sessions stay under 150K across many —
// count does not track growth, actual token size does.
//
// Pure module, no I/O — mirrors this codebase's other extraction style
// (workspace-mode.mjs, lane-regression-guard.mjs, track-folder.mjs).

export const DEFAULT_MAX_CONTEXT_TOKENS = 400_000;
export const DEFAULT_MAX_RESUMES = 12;

/**
 * @param {object} opts
 * @param {number|null|undefined} opts.lastContextTokens - the prior run's
 *   measured context size (extractSessionContextTokens), or null/undefined
 *   if never measured (e.g. a non-claude CLI, or a collector predating
 *   this feature)
 * @param {number|null|undefined} opts.resumeCount - how many times this
 *   exact session has been resumed so far
 * @param {number} [opts.maxContextTokens] - 0 disables this check
 * @param {number} [opts.maxResumes] - 0 disables this check; only
 *   consulted when lastContextTokens is null/undefined (REQ-5)
 * @returns {{cap: boolean, reason: 'context-tokens'|'resume-count'|null}}
 */
export function shouldCapSession({
  lastContextTokens,
  resumeCount,
  maxContextTokens = DEFAULT_MAX_CONTEXT_TOKENS,
  maxResumes = DEFAULT_MAX_RESUMES,
}) {
  if (typeof lastContextTokens === 'number') {
    if (maxContextTokens > 0 && lastContextTokens >= maxContextTokens) {
      return { cap: true, reason: 'context-tokens' };
    }
    return { cap: false, reason: null };
  }
  // Token data unknown — fall back to resume count, never cap on
  // genuinely unknown data (REQ-10: undefined resumeCount -> no cap).
  if (typeof resumeCount === 'number' && maxResumes > 0 && resumeCount >= maxResumes) {
    return { cap: true, reason: 'resume-count' };
  }
  return { cap: false, reason: null };
}
