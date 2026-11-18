// Owner steps: a track that stops at a real-world action only the owner can do. Three optional markers carry it (`Owner Action`, `Owner Action Due`,
// `Result`); the run window is the existing `KPI Check After`. Everything here is pure: dates are UTC calendar dates, the clock is always passed in
// (rows and the generated summary stay free of one), and a malformed date is reported, never guessed.

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// The daemon-era quality gate wrote `KPI Check After` as `Date.toISOString()`; a hand-written one is usually a plain day. Both are read.
const STAMP_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z$/;

/** `YYYY-MM-DD` when `value` is exactly that and a real calendar day (2026-02-30 and 0000-01-01 are not), else null. No trimming, no loose parsing. */
export function parseDay(value) {
  const m = typeof value === 'string' ? DAY_RE.exec(value) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? value : null;
}

/** The UTC day of a time in ms. */
export const todayOf = (nowMs) => new Date(nowMs).toISOString().slice(0, 10);

/** `KPI Check After`: a real day or a full UTC timestamp (`2026-11-25T09:30:00Z`). Returns `{ day, at? }` (`at` in ms for a timestamp) or null. */
export function parseCheckAfter(value) {
  const day = parseDay(value);
  if (day) return { day };
  const m = typeof value === 'string' ? STAMP_RE.exec(value) : null;
  if (!m || !parseDay(m[1])) return null;
  const [hh, mm, ss] = [Number(m[2]), Number(m[3]), Number(m[4] ?? 0)];
  if (hh > 23 || mm > 59 || ss > 59) return null;
  const at = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${String(ss).padStart(2, '0')}.${(m[5] ?? '0').padEnd(3, '0')}Z`);
  return Number.isFinite(at) ? { day: m[1], at } : null;
}

/**
 * The computed flags of one row at a given time (the row is `rowOf`'s; both fields are absent when unset):
 *   overdue            a waiting track with an Owner Action whose due day is before today (UTC); due today is not overdue
 *   ready_to_measure   a waiting track whose KPI Check After is today or earlier (a timestamp: not later than now)
 * A track that is not waiting sets neither. A malformed date sets nothing (see `dateProblems`).
 */
export function ownerFlags(row, nowMs) {
  const out = {};
  if (row.lane_status !== 'waiting') return out;
  const today = todayOf(nowMs);
  const due = row.owner_action ? parseDay(row.owner_action_due) : null;
  if (due && due < today) out.overdue = true;
  const check = row.kpi_check_after === undefined ? null : parseCheckAfter(row.kpi_check_after);
  if (check && (check.at !== undefined ? check.at <= nowMs : check.day <= today)) out.ready_to_measure = true;
  return out;
}

// The first line, whitespace runs folded but the edges kept: a stray trailing space is the reason a date is rejected and must show.
const one = (s, max) => { const t = String(s).split('\n')[0].replace(/[ \t]+/g, ' '); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

/** The date markers of a row that are present and not a real date: `[{ marker, value }]`. An empty value is malformed too. */
export function dateProblems(row) {
  const out = [];
  if (row.owner_action_due !== undefined && !parseDay(row.owner_action_due)) out.push({ marker: 'Owner Action Due', value: row.owner_action_due });
  if (row.kpi_check_after !== undefined && !parseCheckAfter(row.kpi_check_after)) out.push({ marker: 'KPI Check After', value: row.kpi_check_after });
  return out;
}

/** The `date_malformed` text of one problem: the marker and the value as written (quoted, so a trailing space shows), and what is expected. */
export const dateMalformedText = ({ marker, value }, { stamp = false } = {}) =>
  `date_malformed: ${marker} ${JSON.stringify(one(value, 40))} is not a real date (${stamp ? 'YYYY-MM-DD or a UTC timestamp' : 'YYYY-MM-DD'})`;

export const dateMalformedTexts = (row) => dateProblems(row).map((p) => dateMalformedText(p, { stamp: p.marker === 'KPI Check After' }));

const nonBlank = (v) => typeof v === 'string' && v.trim() !== '';
const OUTCOME_TYPES = new Set(['marketing', 'sales']);

/**
 * Could this index.md be `outcome_missing`? A marketing or sales track at done:success with neither `KPI Actual` nor `Result` (a blank line counts as
 * none). `values` is the marker map of parseMarkers. Whether the track has a `## KPI` block is decided by the caller from spec.md (`hasKpiBlock`).
 */
export const outcomeCandidate = (values) => (values['Lane'] ?? '') === 'done' && (values['Lane Status'] ?? '') === 'success'
  && OUTCOME_TYPES.has((values['Type'] ?? '').trim().toLowerCase()) && !nonBlank(values['KPI Actual']) && !nonBlank(values['Result']);

/** A `## KPI` heading in spec.md (older tracks without one are exempt from `outcome_missing`). */
export const hasKpiBlock = (specText) => /^## KPI[ \t]*\r?$/m.test(specText ?? '');

/** `values` (parseMarkers) and the spec entry `{ content }` or null/undefined (not read: no verdict). */
export const isOutcomeMissing = (values, spec) => Boolean(spec) && outcomeCandidate(values) && hasKpiBlock(spec.content);

export const OUTCOME_MISSING = 'outcome_missing: a marketing or sales track is done:success with a ## KPI block but no **KPI Actual** and no **Result**';

// ---- next: the two states --------------------------------------------------------------------------------------------------------

/** A track's due day as a sortable number of days (a missing or malformed one sorts last), for the `do the owner action` state. */
export const NO_DUE = 1e9;
export const dueDays = (due) => { const d = parseDay(due); return d ? Math.floor(Date.parse(`${d}T00:00:00Z`) / 864e5) : NO_DUE; };

/** The reason a card gives for a due date: `due 2026-11-20`, `overdue since 2026-11-10`, or why there is none. */
export function dueText(row, today) {
  if (row.owner_action_due === undefined) return 'no due date';
  const d = parseDay(row.owner_action_due);
  if (!d) return 'the due date is not a real YYYY-MM-DD date, so it is listed last';
  return d < today ? `overdue since ${d}` : d === today ? 'due today' : `due ${d}`;
}
