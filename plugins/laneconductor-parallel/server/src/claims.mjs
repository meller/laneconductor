// Track AM-10141: a `running` claim is stamped with `**Run Started**` (ISO time) and `**Run By**` (who took it), so a crashed
// run shows up instead of looking alive forever. The connector writes the stamps when Lane Status becomes running and removes
// them when it changes to anything else, so releasing a claim is just moving the track to queue.
import { parseMarkers } from './markers.mjs';

export const STALE_RUNNING_HOURS = 6;

const iso = (now) => new Date(now).toISOString();

/**
 * The extra marker edits a Lane Status change implies. `values` are the current markers, `edits` what the caller sets.
 * Returns null when there is nothing to add; a value of null removes the marker.
 */
export function claimStamps(values, edits, { now, who }) {
  if (!('Lane Status' in edits) || edits['Lane Status'] === null) return null;
  const status = edits['Lane Status'].trim().toLowerCase();
  const out = {};
  if (status === 'running') {
    const wasRunning = values['Lane Status'] === 'running';
    const laneMoved = 'Lane' in edits && edits['Lane'] !== null && edits['Lane'].trim().toLowerCase() !== values['Lane'];
    if (!wasRunning || laneMoved) {
      if (!('Run Started' in edits)) out['Run Started'] = iso(now);
      if (!('Run By' in edits)) out['Run By'] = who;
    }
  } else {
    for (const name of ['Run Started', 'Run By']) if (name in values && !(name in edits)) out[name] = null;
  }
  return Object.keys(out).length ? out : null;
}

/** `{ since, hours, by }` when the index says running and its Run Started is older than the limit; null otherwise (an unstamped claim cannot be judged). */
export function staleRunning(indexContent, nowMs, limitHours = STALE_RUNNING_HOURS) {
  const v = parseMarkers(indexContent).values;
  if (v['Lane Status'] !== 'running') return null;
  const since = Date.parse((v['Run Started'] ?? '').trim());
  if (!Number.isFinite(since)) return null;
  const hours = (nowMs - since) / 3_600_000;
  if (hours < limitHours) return null;
  return { since: new Date(since).toISOString(), hours: Math.floor(hours), by: (v['Run By'] ?? '').trim() || null };
}

export function staleRunningWarning(s) {
  return `stale_running: running since ${s.since} (${s.hours}h${s.by ? `, by ${s.by}` : ''}). If nobody works on it, ask the human, then set Lane Status to queue; the stamps go.`;
}

/** The newest conversation turn is the human's and the file changed since the caller's read: true when the caller should be warned. */
export function humanCommentSince(baseSha, currentSha, entries) {
  if (baseSha === undefined || baseSha === currentSha) return false;
  const last = entries[entries.length - 1];
  return Boolean(last && last.author === 'human');
}
