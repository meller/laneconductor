// Lane and status vocabulary (track AM-10128, the otralingo finding). A project's conductor/workflow.json names its own lanes
// (otralingo: planning, backlog, in-progress, review, quality-gate, done) while the skill and the lane guides say `plan` and
// `implement`; the statuses are fixed (queue, running, success, failure, waiting) and people write `in_progress`. A write with the
// wrong name is rightly refused, but "not one of: ..." leaves the caller guessing. `nearest` finds the valid name the caller most
// likely meant, so the error can say "did you mean ...". Pure functions, no I/O.
import { STATUSES } from './markers.mjs';

// Words people use for the same lane, grouped; a group matches the project's lane that is any member.
const LANE_GROUPS = [
  ['plan', 'planning', 'planned', 'spec', 'design'],
  ['implement', 'implementing', 'implementation', 'in-progress', 'inprogress', 'doing', 'develop', 'development', 'dev', 'build', 'wip'],
  ['review', 'reviewing', 'in-review', 'code-review'],
  ['quality-gate', 'qualitygate', 'quality', 'gate', 'qa', 'test', 'testing'],
  ['merge', 'merging', 'merged'],
  ['done', 'complete', 'completed', 'finished', 'closed', 'shipped', 'released'],
  ['backlog', 'todo', 'icebox', 'later'],
];
const STATUS_GROUPS = [
  ['queue', 'queued', 'pending', 'ready', 'new', 'todo'],
  ['running', 'in-progress', 'inprogress', 'active', 'started', 'working', 'doing', 'wip', 'in-flight'],
  ['success', 'succeeded', 'passed', 'pass', 'ok', 'complete', 'completed', 'done'],
  ['failure', 'failed', 'fail', 'error', 'errored'],
  ['waiting', 'blocked', 'on-hold', 'hold', 'paused', 'waiting-for-human'],
];

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/**
 * The valid name nearest to `given`, or null. Order: the same word with other punctuation or case (`In_Progress`); a word of the
 * same group (`implement` -> `in-progress`); a prefix either way (`plan` -> `planning`); a small edit distance.
 */
export function nearest(given, candidates, groups) {
  const g = norm(given);
  if (!g || !candidates.length) return null;
  const by = new Map(candidates.map((c) => [norm(c), c]));
  if (by.has(g)) return by.get(g);
  for (const group of groups) {
    if (!group.includes(g)) continue;
    const hit = group.find((w) => by.has(w));
    if (hit) return by.get(hit);
  }
  const pre = [...by.keys()].filter((k) => k.length >= 3 && g.length >= 3 && (k.startsWith(g) || g.startsWith(k)));
  if (pre.length === 1) return by.get(pre[0]);
  let best = null;
  let bestD = Infinity;
  for (const k of by.keys()) {
    const d = distance(g, k);
    if (d < bestD) { best = k; bestD = d; }
  }
  return best !== null && bestD <= Math.max(1, Math.floor(Math.min(g.length, best.length) / 3)) ? by.get(best) : null;
}

export const nearestLane = (given, lanes) => nearest(given, lanes, LANE_GROUPS);
export const nearestStatus = (given, statuses = STATUSES) => nearest(given, statuses, STATUS_GROUPS);

/** The lane of this project that a skill lane-guide name (plan, implement, ...) stands for. */
export function guideLaneMap(guides, lanes) {
  return Object.fromEntries(guides.map((g) => [g, nearestLane(g, lanes)]));
}

/** `{ Lane?: name, 'Lane Status'?: name }`: a suggestion for each marker value that is not valid, when there is one. */
export function suggestFor(values, lanes, statuses = STATUSES) {
  const out = {};
  const allowed = [...new Set([...lanes, 'backlog'])];
  if ('Lane' in values && !allowed.includes(values['Lane'].trim())) {
    const s = nearestLane(values['Lane'], allowed);
    if (s) out['Lane'] = s;
  }
  if ('Lane Status' in values && !statuses.includes(values['Lane Status'].trim())) {
    const s = nearestStatus(values['Lane Status'], statuses);
    if (s) out['Lane Status'] = s;
  }
  return out;
}
