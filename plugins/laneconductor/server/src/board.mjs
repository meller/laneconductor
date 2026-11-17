// Board data (plan Phase 5d, Task 1): one pure function from the tracks' index.md files to a plain
// object a dashboard can render. A snapshot, never a source of truth: it is rebuilt from the files
// and never written back. Privacy: only titles, lanes, status, progress, phase and dependencies
// leave the index.md header; no other file (conversation, spec, plan, test) is read, and the
// Problem/Summary text is not copied. Pure (no store, no clock): the caller passes the stamp.
import { parseMarkers } from './markers.mjs';
import { lintTracks, rowOf } from './summary.mjs';
import { trackNumberOfFolder } from './tracks.mjs';

export const DEFAULT_LANES = ['plan', 'implement', 'review', 'quality-gate', 'done'];
const ARCHIVE_RE = /^_(?:duplicate|quarantine)-/;
const PHASE_MAX = 200;

export const isArchivedFolder = (name) => ARCHIVE_RE.test(name);

const one = (v) => (v === null ? null : v.replace(/\s+/g, ' ').trim());
const yesNo = (v) => {
  const s = (v ?? '').trim().toLowerCase();
  return s === 'yes' ? true : s === 'no' ? false : null;
};

function trackOf(e, archived) {
  // Archived folders are named `_duplicate-<number>-<slug>`; drop the prefix so the usual parsing applies.
  const name = archived ? e.folder.replace(ARCHIVE_RE, '') : e.folder;
  const r = rowOf(name, e.index);
  const v = e.index ? parseMarkers(e.index.content).values : {};
  const merge = v['Merge Mode']?.trim();
  return {
    row: { ...r, folder: e.folder },
    track: {
      number: r.number,
      folder: e.folder,
      title: r.title,
      lane: one(r.lane),
      lane_status: one(r.lane_status),
      progress: r.progress,
      phase: r.phase === null ? null : r.phase.replace(/\s+/g, ' ').slice(0, PHASE_MAX),
      depends_on: r.depends_on,
      auto_run: yesNo(v['Auto Run']),
      merge_mode: merge || null,
      source_hash: r.source,
      ...(archived ? { archived: true } : {}),
    },
  };
}

/**
 * @param {{ folder: string, index: { content: string, sha?: string } | null }[]} entries
 * @param {{ lanes?: string[], generatedAt: string, project?: string }} opts
 */
export function buildBoard(entries, { lanes = DEFAULT_LANES, generatedAt, project = null } = {}) {
  const laneList = [...new Set(['backlog', ...(lanes?.length ? lanes : DEFAULT_LANES)])];
  const active = [];
  const archived = [];
  for (const e of entries) {
    if (!e || typeof e.folder !== 'string') continue;
    const isArch = isArchivedFolder(e.folder);
    if (trackNumberOfFolder(isArch ? e.folder.replace(ARCHIVE_RE, '') : e.folder) === null) continue; // not a track folder
    (isArch ? archived : active).push(e);
  }
  const act = active.map((e) => trackOf(e, false));
  const arc = archived.map((e) => trackOf(e, true));

  // Lint only the live folders: archived copies share their track's number and would read as clashes.
  const lint = lintTracks(active, act.map((a) => a.row), laneList);
  const reasonsByFolder = new Map(lint.map((l) => [l.folder, [...l.problems]]));
  act.forEach(({ row }) => {
    const reasons = reasonsByFolder.get(row.folder) ?? [];
    if (row.waiting_for_reply) reasons.push('waiting for a human reply');
    if (row.lane_status === 'failure' && row.lane !== 'done') reasons.push('lane status is failure');
    if (reasons.length) reasonsByFolder.set(row.folder, reasons);
  });

  const laneIdx = (t) => { const i = laneList.indexOf(t.lane); return i === -1 ? laneList.length : i; };
  const tracks = [...act, ...arc].map((a) => ({ ...a.track, ...(a.track.archived ? {} : { needs_attention: reasonsByFolder.has(a.track.folder) }) }))
    .sort((a, b) => laneIdx(a) - laneIdx(b) || b.number - a.number || (a.archived ? 1 : 0) - (b.archived ? 1 : 0) || a.folder.localeCompare(b.folder));

  const by_lane = Object.fromEntries(laneList.map((l) => [l, 0]));
  for (const t of tracks) {
    if (t.archived) continue;
    const k = t.lane !== null && t.lane in by_lane ? t.lane : 'unknown';
    by_lane[k] = (by_lane[k] ?? 0) + 1;
  }
  const needs_attention = act
    .filter(({ row }) => reasonsByFolder.has(row.folder))
    .map(({ row }) => ({ number: row.number, folder: row.folder, reasons: reasonsByFolder.get(row.folder) }))
    .sort((a, b) => b.number - a.number || a.folder.localeCompare(b.folder));

  return {
    project,
    generated_at: generatedAt,
    lanes: laneList,
    tracks,
    counts: { by_lane, needs_attention: needs_attention.length, archived: arc.length },
    needs_attention,
  };
}

/** True when two boards hold the same data (`generated_at` is ignored). */
export const sameBoard = (a, b) => JSON.stringify({ ...a, generated_at: null }) === JSON.stringify({ ...b, generated_at: null });
