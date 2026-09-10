// conductor/services/dependency-resume.mjs
// Track AM-10086: nothing re-polls a track parked at `<lane>:waiting` once
// its blocking condition resolves — `autoLaunchLocalFs`'s own `**Depends
// On**` gate (Track AM-1119 Phase 3) only evaluates tracks sitting in
// `queue`, never ones already parked. This module holds the entire "may
// this specific parked track be resumed automatically" decision, so it is
// unit-testable without importing laneconductor.sync.mjs (which starts
// chokidar watchers and setIntervals at import time) — same pattern as
// parse-status.mjs / merge-mode.mjs / waiting-state.mjs.
//
// The core design decision (see spec.md): only DEPENDENCY parks are ever
// auto-resumable. A bare `**Depends On**` marker is not attribution on its
// own — a track can legitimately depend on another track and be parked for
// a completely unrelated, human-judgment reason (an approval request, a
// genuine question). Attribution requires either the authoritative
// `**Waiting On Tracks**` marker, or `**Depends On**` together with a
// `**Waiting Reason**` that actually names one of those dependency numbers.
// Every other park is left exactly as it is — this module fails closed.
//
// A second, deliberate divergence from `autoLaunchLocalFs`'s existing gate:
// a dependency is only "satisfied" at lane `done` AND lane action status
// `success` — not lane `done` alone. Since Track 10035 made merging itself
// a `done`-lane action, `done:queue` means "quality-gate passed, not merged
// yet". The incident this track fixes was literally "AM-1000 unmerged";
// resuming on `done:queue` would resume a track whose stated blocker is
// still true, producing a park-resume-park loop instead of a fix. Whether
// `autoLaunchLocalFs`'s own gate should be tightened the same way is a real
// but separate question (spec.md's Out of Scope) — this module does not
// touch that gate.
//
// REQ-10 (found live while planning this track, on this track's own
// index.md): every regex below is line-anchored (`^...$m` / `^...m`), unlike
// the pre-existing `parseDependsOn()`/`parseWaitingReason()` in
// laneconductor.sync.mjs / waiting-state.mjs, which matched a marker name
// quoted anywhere in prose (e.g. inside a `**Problem**` field describing an
// incident) rather than only a real marker line. A marker means a marker,
// not a mention of one.

const WAITING_ON_TRACKS_RE = /^[ \t]*\*\*Waiting On Tracks\*\*:[ \t]*([^\n]*)$/im;
const AUTO_RESUMED_RE = /^[ \t]*\*\*Auto Resumed\*\*:[ \t]*([^\n]*)$/im;

/**
 * Normalises a track-number-ish token the way every other marker in this
 * file does: strip a leading `INITIALS-` prefix, then strip leading zeros.
 * Shared by every parser below so `AM-1000`, `1000`, and `01000` all
 * collapse to `'1000'`.
 *
 * @param {string} token
 * @returns {string}
 */
function normalizeTrackNumber(token) {
  return String(token ?? '')
    .trim()
    .replace(/^[a-zA-Z0-9]+-(?=\d)/, '')
    .replace(/^0+(?=\d)/, '');
}

/**
 * Reads `**Waiting On Tracks**: NNN[, NNN]` — the authoritative attribution
 * marker (REQ-2). An agent writes this when it parks specifically because
 * those tracks have not yet shipped, making the park mechanically
 * resumable instead of needing a human.
 *
 * @param {string} content
 * @returns {string[]} normalised, deduplicated, non-empty track numbers;
 *   `[]` when the marker is absent, empty, or contains no valid numbers
 *   (fails closed rather than throwing on malformed input — REQ-7).
 */
export function parseWaitingOnTracks(content) {
  if (typeof content !== 'string') return [];
  const m = content.match(WAITING_ON_TRACKS_RE);
  if (!m) return [];
  const raw = m[1].trim();
  if (!raw) return [];
  const nums = raw
    .split(',')
    .map(normalizeTrackNumber)
    .filter(s => /^\d+$/.test(s));
  return [...new Set(nums)];
}

/**
 * Sets `**Waiting On Tracks**`, sparse-emission style (present only while
 * it means something) — mirrors `writeWaitingReason`/`writeAutoResumedMarker`
 * below. Updates the existing line in place when present, appends otherwise.
 *
 * @param {string} content
 * @param {string[]} nums
 * @returns {string}
 */
export function writeWaitingOnTracks(content, nums) {
  const list = Array.isArray(nums) ? nums.filter(Boolean) : [];
  if (!list.length) return clearWaitingOnTracks(content);
  const line = `**Waiting On Tracks**: ${list.join(', ')}`;
  if (WAITING_ON_TRACKS_RE.test(content)) return content.replace(WAITING_ON_TRACKS_RE, line);
  return `${content.trimEnd()}\n${line}\n`;
}

/**
 * Removes the `**Waiting On Tracks**` marker line entirely, including its
 * trailing newline. Called whenever a track leaves `waiting` — a stale
 * dependency list left on a running or resumed track is as misleading as a
 * stale `**Waiting Reason**` would be.
 *
 * @param {string} content
 * @returns {string} unchanged when the marker was absent
 */
export function clearWaitingOnTracks(content) {
  if (typeof content !== 'string' || !WAITING_ON_TRACKS_RE.test(content)) return content;
  return content.replace(new RegExp(WAITING_ON_TRACKS_RE.source + '\\n?', 'im'), '');
}

/**
 * Reads `**Auto Resumed**: <ISO> deps=<n,n>` — the loop guard (REQ-6). A
 * track carrying this marker with a given dependency set has already been
 * auto-resumed once for exactly that set; it will not be auto-resumed again
 * for the same set (a second park on already-satisfied dependencies means
 * the dependency was never really the blocker, and needs a human).
 *
 * @param {string} content
 * @returns {{ at: string, deps: string[] } | null}
 */
export function parseAutoResumedMarker(content) {
  if (typeof content !== 'string') return null;
  const m = content.match(AUTO_RESUMED_RE);
  if (!m) return null;
  const raw = m[1].trim();
  const depsMatch = raw.match(/deps=([^\s]*)/i);
  if (!depsMatch) return null;
  const at = raw.slice(0, depsMatch.index).trim();
  const deps = [...new Set(depsMatch[1].split(',').map(normalizeTrackNumber).filter(s => /^\d+$/.test(s)))];
  return { at, deps };
}

/**
 * Writes the `**Auto Resumed**` marker, sparse-emission style. `deps`
 * should already be the normalised set that was actually checked and found
 * shipped — `decideAutoResume()` supplies this.
 *
 * @param {string} content
 * @param {string[]} deps
 * @param {Date} [at] - defaults to now; parameterised for tests
 * @returns {string}
 */
export function writeAutoResumedMarker(content, deps, at = new Date()) {
  const list = Array.isArray(deps) ? [...new Set(deps.filter(Boolean))] : [];
  const line = `**Auto Resumed**: ${at.toISOString()} deps=${list.join(',')}`;
  if (AUTO_RESUMED_RE.test(content)) return content.replace(AUTO_RESUMED_RE, line);
  return `${content.trimEnd()}\n${line}\n`;
}

/**
 * Removes the `**Auto Resumed**` marker line entirely. Called on any human
 * resume (Phase 3) so a genuinely new future dependency set can be
 * auto-resumed again — the marker's job is only to block an immediate
 * repeat of the SAME dependency set, not to permanently disqualify a track.
 *
 * @param {string} content
 * @returns {string} unchanged when the marker was absent
 */
export function clearAutoResumedMarker(content) {
  if (typeof content !== 'string' || !AUTO_RESUMED_RE.test(content)) return content;
  return content.replace(new RegExp(AUTO_RESUMED_RE.source + '\\n?', 'im'), '');
}

// Line-anchored counterparts of laneconductor.sync.mjs's parseDependsOn()
// and waiting-state.mjs's parseWaitingReason() (REQ-10). Duplicated rather
// than imported: this module must not depend on laneconductor.sync.mjs
// (import-time side effects), and waiting-state.mjs's own MARKER_RE is one
// of the two parsers this track found broken — fixing it in place there is
// Phase 3b's job, not this module's. These two are used ONLY for the
// "inferred" attribution path below.

const DEPENDS_ON_LINE_RE = /^[ \t]*\*\*Depends On\*\*:[ \t]*([^\n]*)$/im;
const WAITING_REASON_LINE_RE = /^[ \t]*\*\*Waiting Reason\*\*:[ \t]*([^\n]*)$/im;

function parseDependsOnLineAnchored(content) {
  if (typeof content !== 'string') return [];
  const m = content.match(DEPENDS_ON_LINE_RE);
  if (!m) return [];
  return [...new Set(m[1].split(',').map(normalizeTrackNumber).filter(s => /^\d+$/.test(s)))];
}

function parseWaitingReasonLineAnchored(content) {
  if (typeof content !== 'string') return null;
  const m = content.match(WAITING_REASON_LINE_RE);
  if (!m) return null;
  const value = m[1].trim();
  return value.length ? value : null;
}

/**
 * The attribution rule (spec.md's "Attribution — two paths, one
 * authoritative"). Decides which track numbers, if any, this park's
 * `**Waiting Reason**` is actually about.
 *
 * @param {object} opts
 * @param {string} opts.content - the parked track's index.md content
 * @returns {{ deps: string[], source: 'marker'|'inferred'|null }}
 */
export function resolveBlockedDependencies({ content }) {
  const marker = parseWaitingOnTracks(content);
  if (marker.length) return { deps: marker, source: 'marker' };

  const dependsOn = parseDependsOnLineAnchored(content);
  if (!dependsOn.length) return { deps: [], source: null };

  const reason = parseWaitingReasonLineAnchored(content);
  if (!reason) return { deps: [], source: null };

  // Intersection: only dependency numbers the reason text actually names.
  // Matched as a whole number (word boundary on both sides) so a reason
  // naming "10001" never falsely attributes to a **Depends On** of "1000".
  const mentioned = dependsOn.filter(dep => new RegExp(`(?<!\\d)${dep}(?!\\d)`).test(reason));
  if (!mentioned.length) return { deps: [], source: null };
  return { deps: mentioned, source: 'inferred' };
}

/**
 * Whether a single dependency track has actually shipped — lane `done` AND
 * lane action status `success` (see module header for why this is
 * deliberately stricter than `done` alone). An absent entry — the
 * dependency track number resolves to no known track — is treated as
 * unmet, never satisfied (REQ-7 / AC-9): fails closed on bad data exactly
 * as on real non-satisfaction.
 *
 * @param {string} trackNumber - normalised bare track number
 * @param {Record<string, {lane: string, laneActionStatus: string}>} stateByTrackNumber
 * @returns {boolean}
 */
export function isDependencyShipped(trackNumber, stateByTrackNumber) {
  const state = stateByTrackNumber?.[trackNumber];
  if (!state) return false;
  return state.lane === 'done' && state.laneActionStatus === 'success';
}

/**
 * The full decision (spec.md's eligibility rule, all four conditions).
 *
 * @param {object} opts
 * @param {string} opts.content - the parked track's index.md content
 * @param {Record<string, {lane: string, laneActionStatus: string}>} opts.stateByTrackNumber
 * @returns {{ resume: boolean, deps: string[], source: 'marker'|'inferred'|null, skipReason: string|null }}
 */
export function decideAutoResume({ content, stateByTrackNumber }) {
  const laneActionStatusMatch = content?.match(/^[ \t]*\*\*Lane Status\*\*:[ \t]*([^\n]*)$/im);
  const laneActionStatus = laneActionStatusMatch?.[1]?.trim().toLowerCase();
  if (laneActionStatus !== 'waiting') {
    return { resume: false, deps: [], source: null, skipReason: 'not-waiting' };
  }

  const { deps, source } = resolveBlockedDependencies({ content });
  if (!deps.length) {
    return { resume: false, deps: [], source: null, skipReason: 'no-attribution' };
  }

  const unmet = deps.filter(dep => !isDependencyShipped(dep, stateByTrackNumber));
  if (unmet.length) {
    return { resume: false, deps, source, skipReason: `unmet:${unmet.join(',')}` };
  }

  const autoResumed = parseAutoResumedMarker(content);
  if (autoResumed) {
    const sameSet =
      autoResumed.deps.length === deps.length &&
      autoResumed.deps.every(d => deps.includes(d));
    if (sameSet) {
      return { resume: false, deps, source, skipReason: 'already-auto-resumed' };
    }
  }

  return { resume: true, deps, source, skipReason: null };
}
