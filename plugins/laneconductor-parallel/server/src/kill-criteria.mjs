// Kill criteria (plan.md "Kill criteria"): thresholds are data, fixed before the beta starts, and
// evaluated by health_report. The verdict is advice for the human, who makes the keep / change /
// remove call. Verdicts: ok | warn | breach | insufficient_data.
export const THRESHOLDS = {
  errorRate: 0.05, errorMinCalls: 50, errorsPerSession: 3, // KC-2
  overrideRate: 0.5, overrideMinOutcomes: 20, itemOverrideMinOutcomes: 5, // KC-3
  coverageMin: 0.3, // KC-4
  remoteSessionsMin: 3, // KC-6
  staleReadRate: 0.25, // KC-7
  contextTokensMax: 2000, // KC-8
};

/** Tools whose reads count toward KC-7. */
export const READ_TOOLS = ['list_tracks', 'get_track', 'get_context'];

export const KILL_CRITERIA = [
  { id: 'KC-1', metric: 'Silent overwrites or corrupted track files attributable to the connector', threshold: '> 0', consequence: 'Stop the beta at once and disconnect until fixed', manual: 'Judged by the human from git history; the connector has no signal for it.' },
  { id: 'KC-2', metric: 'Connector error rate (tool_error / calls, correct-behaviour codes excluded)', threshold: `> ${THRESHOLDS.errorRate * 100}% over >= ${THRESHOLDS.errorMinCalls} calls, or > ${THRESHOLDS.errorsPerSession} in one session`, consequence: 'Change; if still over after one fix iteration, remove' },
  { id: 'KC-3', metric: 'Advice override rate: deviated / (followed + deviated)', threshold: `> ${THRESHOLDS.overrideRate * 100}% overall with >= ${THRESHOLDS.overrideMinOutcomes} outcomes; per item with >= ${THRESHOLDS.itemOverrideMinOutcomes}`, consequence: 'Change the advice (rewrite or prune the guides)' },
  { id: 'KC-4', metric: 'Outcome reporting coverage: served items with an outcome / serves', threshold: `< ${THRESHOLDS.coverageMin * 100}%`, consequence: 'Follow/deviate signal unusable; judge KC-3 by human review. Not a kill on its own' },
  { id: 'KC-5', metric: 'Efficiency over 5 paired "plan X" runs (tokens, wall-clock, re-prompts)', threshold: 'no better than 10% below the skill baseline', consequence: 'No measurable saving: remove the connector from Claude Code', manual: 'Measured by hand and recorded in beta-report.md (AC-f).' },
  { id: 'KC-6', metric: 'Remote use: distinct remote sessions in the window', threshold: `< ${THRESHOLDS.remoteSessionsMin}`, consequence: 'Park the remote half' },
  { id: 'KC-7', metric: 'Remote stale-read rate: stale remote reads / remote reads', threshold: `> ${THRESHOLDS.staleReadRate * 100}%`, consequence: 'Revisit the push policy (D4), or park the remote half' },
  { id: 'KC-8', metric: 'Context overhead: estimated tokens of instructions + tool list per session', threshold: `> ${THRESHOLDS.contextTokensMax}`, consequence: 'Trim instructions and descriptions (change, not kill)' },
];

/**
 * @param {object} s stats from health.mjs: calls, countedErrors, worstSession, serves, servesReported,
 *   followed, deviated, flaggedItems, remoteReads, remoteStaleReads, remoteSessions, windowClosed, contextTokens
 */
export function evaluateKillCriteria(s) {
  const T = THRESHOLDS;
  const pct = (x) => (x === null ? null : Math.round(x * 1000) / 10);
  const out = {};
  const errRate = s.calls ? s.countedErrors / s.calls : null;
  const sessionBreach = s.worstSession > T.errorsPerSession;
  out['KC-2'] = { value: pct(errRate), n: s.calls, verdict: sessionBreach || (s.calls >= T.errorMinCalls && errRate > T.errorRate) ? 'breach' : s.calls < T.errorMinCalls ? 'insufficient_data' : 'ok', ...(sessionBreach ? { note: `${s.worstSession} errors in one session` } : {}) };
  const decided = s.followed + s.deviated;
  const override = decided ? s.deviated / decided : null;
  const flagged = s.flaggedItems.length ? `flagged for rewrite: ${s.flaggedItems.join(', ')}` : undefined;
  out['KC-3'] = { value: pct(override), n: decided, verdict: decided < T.overrideMinOutcomes ? 'insufficient_data' : override > T.overrideRate ? 'breach' : s.flaggedItems.length ? 'warn' : 'ok', ...(flagged ? { note: flagged } : {}) };
  const coverage = s.serves ? s.servesReported / s.serves : null;
  out['KC-4'] = { value: pct(coverage), n: s.serves, verdict: !s.serves ? 'insufficient_data' : coverage < T.coverageMin ? 'breach' : 'ok' };
  out['KC-6'] = { value: s.remoteSessions, n: s.remoteSessions, verdict: s.remoteSessions >= T.remoteSessionsMin ? 'ok' : s.windowClosed ? 'breach' : 'insufficient_data', ...(s.remoteSessions < T.remoteSessionsMin && !s.windowClosed ? { note: 'the window is still open' } : {}) };
  const stale = s.remoteReads ? s.remoteStaleReads / s.remoteReads : null;
  out['KC-7'] = { value: pct(stale), n: s.remoteReads, verdict: !s.remoteReads ? 'insufficient_data' : stale > T.staleReadRate ? 'breach' : 'ok' };
  out['KC-8'] = { value: s.contextTokens, n: 1, verdict: s.contextTokens === null ? 'insufficient_data' : s.contextTokens > T.contextTokensMax ? 'breach' : 'ok', note: 'characters / 4 of the instructions plus tools/list (names, descriptions, input schemas); Claude Code defers the schemas under tool search' };
  return KILL_CRITERIA.map(({ manual, ...kc }) => ({
    ...kc,
    ...(manual ? { value: null, n: 0, verdict: 'insufficient_data', note: manual } : out[kc.id]),
  }));
}
