// Track AM-10141: a `running` claim is stamped with `**Run Started**` (ISO time) and `**Run By**` (who took it), so a crashed
// run shows up instead of looking alive forever. The connector writes the stamps when Lane Status becomes running and removes
// them when it changes to anything else, so releasing a claim is just moving the track to queue.
import { parseMarkers } from './markers.mjs';

export const STALE_RUNNING_HOURS = 6;

const iso = (now) => new Date(now).toISOString();

const MAX_CLIENT_NAME = 24;
const MAX_BY_IN_WARNING = 40;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** `Run By` text: the client name is capped (a long name must not push the stale_running warning past the 200 character bound). */
export const runBy = (client, session) => `${clip(String(client ?? 'unknown').replace(/\s+/g, ' ').trim() || 'unknown', MAX_CLIENT_NAME)} ${session}`;

/**
 * The extra marker edits a Lane Status change implies. `values` are the current markers, `edits` what the caller sets.
 * Returns null when there is nothing to add; a value of null removes the marker.
 */
export function claimStamps(values, edits, { now, who }) {
  const laneMoved = 'Lane' in edits && edits['Lane'] !== null && edits['Lane'].trim().toLowerCase() !== values['Lane'];
  // A Lane-only move while the track is running is a new claim on the new lane: it is re-stamped.
  const status = typeof edits['Lane Status'] === 'string' ? edits['Lane Status'].trim().toLowerCase() : laneMoved && values['Lane Status'] === 'running' ? 'running' : null;
  if (status === null) return null;
  const out = {};
  if (status === 'running') {
    const wasRunning = values['Lane Status'] === 'running';
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
  return `stale_running: running since ${s.since} (${s.hours}h${s.by ? `, by ${clip(s.by, MAX_BY_IN_WARNING)}` : ''}). If nobody works on it, ask the human, then set Lane Status to queue; the stamps go.`;
}

/** The newest conversation turn is the human's and the file changed since the caller's read: true when the caller should be warned. */
export function humanCommentSince(baseSha, currentSha, entries) {
  if (baseSha === undefined || baseSha === currentSha) return false;
  const last = entries[entries.length - 1];
  return Boolean(last && last.author === 'human');
}
