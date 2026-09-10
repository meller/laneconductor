// conductor/services/verdict.mjs
// Track AM-10087: `isSuccess` is just the CLI process's own exit status —
// unrelated to a review/quality-gate action's own semantic PASS/FAIL
// verdict. Without a durable, deterministic signal for that verdict,
// nothing in the sync worker's exit handler can tell "this turn ended on a
// genuinely open question" apart from "this turn's own output already
// resolved and routed its outcome, and the harness's end-of-turn
// self-assessment just happened to also tag it 'blocked'".
//
// The `**Verdict**` marker is that signal, written by the review/
// quality-gate skill steps in the same edit as their existing Lane/Lane
// Status transition write. Pure module, no I/O — same style as
// waiting-state.mjs / merge-mode.mjs — so it can be unit tested without
// importing laneconductor.sync.mjs.

const MARKER_RE = /\*\*Verdict\*\*:[ \t]*([^\n]*)/i;
// Matches the whole line including its newline, for removal.
const MARKER_LINE_RE = /^[ \t]*\*\*Verdict\*\*:[^\n]*\n?/im;

/**
 * Reads the `**Verdict**` marker out of an index.md.
 *
 * @param {string} content
 * @returns {'pass'|'fail'|null} null when absent, empty, or unrecognized —
 *   never guessed.
 */
export function parseVerdict(content) {
  if (typeof content !== 'string') return null;
  const m = content.match(MARKER_RE);
  if (!m) return null;
  const value = m[1].trim().toLowerCase();
  if (value === 'pass' || value === 'fail') return value;
  return null;
}

/**
 * Sets the `**Verdict**` marker, updating it in place when present and
 * appending it otherwise. Follows the sparse-emission convention used by
 * `**Waiting Reason**` / `**Merge Mode**`.
 *
 * @param {string} content
 * @param {'pass'|'fail'} verdict
 * @returns {string}
 */
export function writeVerdict(content, verdict) {
  const flat = String(verdict ?? '').trim().toLowerCase();
  if (flat !== 'pass' && flat !== 'fail') return clearVerdict(content);
  const line = `**Verdict**: ${flat}`;
  if (MARKER_RE.test(content)) return content.replace(MARKER_RE, line);
  return `${content.trimEnd()}\n${line}\n`;
}

/**
 * Removes the marker. Called at claim time (step 0) by the review/
 * quality-gate skill steps, so a run that gets short-circuited before
 * reaching its own transition step never leaves a stale value behind for a
 * later run's exit handler to misread.
 *
 * @param {string} content
 * @returns {string} unchanged when the marker was absent
 */
export function clearVerdict(content) {
  if (typeof content !== 'string' || !MARKER_RE.test(content)) return content;
  return content.replace(MARKER_LINE_RE, '');
}
