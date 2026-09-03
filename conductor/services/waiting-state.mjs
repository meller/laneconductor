// conductor/services/waiting-state.mjs
// Track 10055: `<lane>:waiting` means one thing on EVERY lane — "this lane
// action stopped on purpose and cannot continue until a human does
// something; nothing will claim it until a human resumes it."
//
// `done:waiting` (pr-mode merge, PR open on GitHub) is one *instance* of that
// rule — the human action needed is approving the PR — not a separate
// mechanism. Track 10035 built it as a done-lane special case; this module is
// the general form.
//
// A park with no explanation is unusable: the card says "paused" and nobody
// knows what unblocks it. Hence the `**Waiting Reason**` marker, and
// resolveWaitingReason()'s guarantee that a reason always exists even when
// the agent forgot to write one.
//
// Pure module, no I/O — same style as parse-status.mjs / merge-mode.mjs, so
// it can be unit tested without importing laneconductor.sync.mjs (which runs
// chokidar watchers and setIntervals at import time).

const MARKER_RE = /\*\*Waiting Reason\*\*:[ \t]*([^\n]*)/i;
// Matches the whole line including its newline, for removal.
const MARKER_LINE_RE = /^[ \t]*\*\*Waiting Reason\*\*:[^\n]*\n?/im;

/**
 * The reason shown when a lane action parked without writing one and left no
 * blocking question behind either. Deliberately actionable rather than
 * decorative — this is what a human reads on the card.
 */
export const WAITING_REASON_FALLBACK =
  'Paused for human input — the lane action did not record a reason. Check the conversation and the run log.';

/**
 * Reads the `**Waiting Reason**` marker out of an index.md.
 *
 * @param {string} content
 * @returns {string|null} the trimmed reason, or null when absent/empty
 */
export function parseWaitingReason(content) {
  if (typeof content !== 'string') return null;
  const m = content.match(MARKER_RE);
  if (!m) return null;
  const value = m[1].trim();
  return value.length ? value : null;
}

/**
 * Sets the `**Waiting Reason**` marker, updating it in place when present and
 * appending it otherwise. Follows the sparse-emission convention used by
 * `**Workspace**` / `**Merge Mode**`: the line exists only while it means
 * something.
 *
 * The reason is flattened to a single line — every marker in index.md is a
 * one-liner, and a multi-line value would silently truncate at the first
 * newline on the next parse.
 *
 * @param {string} content
 * @param {string} reason
 * @returns {string}
 */
export function writeWaitingReason(content, reason) {
  const flat = String(reason ?? '').replace(/\s*\n+\s*/g, ' ').trim();
  if (!flat) return clearWaitingReason(content);
  const line = `**Waiting Reason**: ${flat}`;
  if (MARKER_RE.test(content)) return content.replace(MARKER_RE, line);
  return `${content.trimEnd()}\n${line}\n`;
}

/**
 * Removes the marker. Called whenever a track leaves `waiting` — on resume,
 * or on the next run that reaches any other outcome. A stale reason left
 * behind on a running track is worse than none: it reads as current.
 *
 * @param {string} content
 * @returns {string} unchanged when the marker was absent
 */
export function clearWaitingReason(content) {
  if (typeof content !== 'string' || !MARKER_RE.test(content)) return content;
  return content.replace(MARKER_LINE_RE, '');
}

/**
 * Decides what reason to record for a park (REQ-3). Order: what the agent
 * explicitly wrote, then the blocking question the run ended on, then a
 * generic fallback.
 *
 * `synthesized` tells the caller whether to warn — an agent that parks
 * without writing a reason is doing something the SKILL.md protocol asks it
 * not to, and that should be visible in the worker log rather than silently
 * papered over.
 *
 * @param {object} opts
 * @param {string|null} [opts.markerReason] - from parseWaitingReason()
 * @param {string|null} [opts.blockedQuestion] - from extractBlockedQuestion()
 * @returns {{reason: string, synthesized: boolean}}
 */
export function resolveWaitingReason({ markerReason = null, blockedQuestion = null } = {}) {
  const marker = typeof markerReason === 'string' ? markerReason.trim() : '';
  if (marker) return { reason: marker, synthesized: false };

  const question = typeof blockedQuestion === 'string' ? blockedQuestion.trim() : '';
  if (question) {
    // First non-empty line: the question's opening sentence is the useful
    // part on a card; the full text is already in conversation.md.
    const firstLine = question.split('\n').map(l => l.trim()).find(Boolean);
    if (firstLine) return { reason: firstLine, synthesized: true };
  }

  return { reason: WAITING_REASON_FALLBACK, synthesized: true };
}
