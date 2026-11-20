// Generated track summary (plan Phase 3b): one deterministic function from the tracks' index.md
// files to conductor/tracks-summary.md. Pure (no store, no clock): the caller passes the entries and
// the stamp. Rows depend only on committed content, so any machine can regenerate and compare.
import { blobSha } from './blob.mjs';
import { servesList } from './kpis.mjs';
import { parseMarkers, validateIndex } from './markers.mjs';
import { OUTCOME_MISSING, dateMalformedTexts, isOutcomeMissing } from './owner-steps.mjs';
import { PLAN_LOG_PROBLEM, planLogFindings } from './plan-log.mjs';
import { trackIdentity, trackNumberOfFolder } from './tracks.mjs';

export const SUMMARY_PATH = 'conductor/tracks-summary.md';
const STAMP_RE = /^Generated: (\S+)$/m;
const SOURCE_CHARS = 12;

const numbersOf = (text) => (text ?? '').split(/[,\s]+/).map((s) => s.replace(/^[A-Za-z]+-/, '')).filter((s) => /^\d+$/.test(s));

const clip200 = (s) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > 200 ? `${t.slice(0, 200)}…` : t; };
const PRIORITIES = ['high', 'normal', 'low'];
const partOf = (value, own) => { const n = Number(numbersOf(value)[0]); return Number.isInteger(n) && n > 0 && n !== own ? n : null; };

/** One track's row from its folder name and index.md `{ content, sha }` (null when the file is missing). */
export function rowOf(folder, idx) {
  const ident = trackIdentity(folder, idx?.content ?? '');
  if (!idx) return { number: ident.number, id: ident.id, folder, title: ident.title, lane: null, lane_status: null, progress: null, phase: null, type: null, summary: '', waiting_for_reply: false, depends_on: [], waiting_on: [], source: null };
  const v = parseMarkers(idx.content).values;
  const progress = parseInt(v['Progress'] ?? '', 10);
  return {
    number: ident.number,
    id: ident.id,
    folder,
    title: ident.title,
    lane: v['Lane']?.trim() ?? null,
    lane_status: v['Lane Status']?.trim() ?? null,
    progress: Number.isFinite(progress) ? progress : null,
    phase: v['Phase']?.trim() ?? null,
    type: v['Type']?.trim() ?? null,
    summary: (v['Summary'] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    waiting_for_reply: (v['Waiting for reply'] ?? '').trim().toLowerCase() === 'yes',
    depends_on: numbersOf(v['Depends On']),
    waiting_on: numbersOf(v['Waiting On Tracks']),
    // Track AM-10136: a park with a stated reason that is not a wait for tracks (a question, an approval); present only when set.
    ...((v['Waiting Reason'] ?? '').trim() ? { waiting_reason: true } : {}),
    source: (idx.sha ?? blobSha(idx.content)).slice(0, SOURCE_CHARS),
    // Track AM-10145: the optional marker `**Part Of**: <epic number>` (the epic's status is derived, never stored) and `**Priority**`
    // (read by `next`). Present only when set, so a track that uses neither is unchanged.
    ...(partOf(v['Part Of'], ident.number) === null ? {} : { part_of: partOf(v['Part Of'], ident.number) }),
    ...(PRIORITIES.includes((v['Priority'] ?? '').trim().toLowerCase()) ? { priority: v['Priority'].trim().toLowerCase() } : {}),
    // Track AM-10147 (owner steps): present only when set, so a track that uses none of them is unchanged. The row holds no clock: the computed
    // flags (overdue, ready_to_measure) come from owner-steps.mjs `ownerFlags(row, now)`. The two date fields keep the raw text so a malformed one
    // can be reported; `kpi_check_after` is the existing run-window marker, read here only to compute `ready_to_measure`.
    ...(clip200(v['Owner Action']) ? { owner_action: clip200(v['Owner Action']) } : {}),
    ...('Owner Action Due' in v ? { owner_action_due: v['Owner Action Due'] } : {}),
    ...(clip200(v['Result']) ? { result: clip200(v['Result']) } : {}),
    ...('KPI Check After' in v ? { kpi_check_after: v['KPI Check After'] } : {}),
    // Track AM-10152: the KPIs this track serves (ids or metric names), present only when named.
    ...(servesList(v['Serves']).length ? { serves: servesList(v['Serves']) } : {}),
  };
}

/**
 * Lint: tracks whose markers cannot be trusted. Each item is `{ id, folder, problems: [...] }`.
 * "Lane Status running with no live run" is not checked: the files hold no run registry, so a
 * running status cannot be told apart from a live one.
 */
export function lintTracks(entries, rows, lanes) {
  const out = [];
  const byNumber = new Map();
  rows.forEach((r) => byNumber.set(r.number, [...(byNumber.get(r.number) ?? []), r.folder]));
  entries.forEach((e, i) => {
    const problems = e.index ? validateIndex(e.index.content, lanes) : ['no index.md'];
    const same = byNumber.get(rows[i].number);
    if (same.length > 1) problems.push(`track number ${rows[i].number} is used by ${same.length} folders`);
    // Track AM-10136: a parked track nobody can explain. A done:waiting track is a PR waiting for review, not a park.
    const v = e.index ? parseMarkers(e.index.content).values : {};
    if (rows[i].lane_status === 'waiting' && rows[i].lane !== 'done' && !(v['Waiting Reason'] ?? '').trim() && !rows[i].owner_action) problems.push('Lane Status is waiting but there is no **Waiting Reason**');
    // Track AM-10147: advisory only. A date marker that is not a real date; a closed marketing or sales track with a KPI block and no outcome
    // (the caller attaches `spec` only for the few tracks that could be flagged: see common.mjs `attachSpecs`).
    problems.push(...dateMalformedTexts(rows[i]));
    if (e.index && isOutcomeMissing(v, e.spec)) problems.push(OUTCOME_MISSING);
    // Track AM-10146: a plan that has become a log (entries carry `plan` only when the caller read the plan.md files).
    if (e.plan && planLogFindings(e.plan.content).flagged) problems.push(PLAN_LOG_PROBLEM);
    if (problems.length) out.push({ id: rows[i].id, folder: e.folder, problems });
  });
  return out;
}

const cell = (s, max = 100) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return (t.length > max ? `${t.slice(0, max - 1)}…` : t).replace(/\|/g, '\\|');
};

/**
 * @param {{ folder: string, index: { content: string, sha?: string } | null }[]} entries
 * @param {{ lanes: string[], generatedAt: string }} opts
 */
export function generateSummary(entries, { lanes, generatedAt }) {
  const sorted = entries.filter((e) => trackNumberOfFolder(e.folder) !== null).sort((a, b) => trackNumberOfFolder(a.folder) - trackNumberOfFolder(b.folder) || a.folder.localeCompare(b.folder));
  const rows = sorted.map((e) => rowOf(e.folder, e.index));
  const attention = lintTracks(sorted, rows, lanes);
  const lines = [
    "<!-- GENERATED by lc-connector from each track's index.md. Never hand-edit: the next track write regenerates it. -->",
    '# Track summary',
    '',
    `Generated: ${generatedAt}`,
    '',
    `${rows.length} track${rows.length === 1 ? '' : 's'}. Source is the first ${SOURCE_CHARS} characters of the git blob sha of each track's index.md; a reader that finds a different value regenerates this file.`,
    '',
    '## Needs attention',
    '',
    ...(attention.length ? attention.map((a) => `- ${cell(a.folder, 120)}: ${a.problems.map((p) => cell(p, 160)).join('; ')}`) : ['None.']),
    '',
    '## Tracks',
    '',
    '| ID | Title | Lane | Status | Progress | Phase | Depends on | Source |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${cell(r.id)} | ${cell(r.title)} | ${cell(r.lane ?? '-')} | ${cell(r.lane_status ?? '-')} | ${r.progress === null ? '-' : `${r.progress}%`} | ${cell(r.phase ?? '-', 80)} | ${r.depends_on.join(', ') || '-'} | ${r.source ?? '-'} |`),
    '',
  ];
  return { text: lines.join('\n'), rows, attention };
}

export const summaryStamp = (text) => text?.match(STAMP_RE)?.[1] ?? null;

/**
 * Compares an existing summary with what the entries produce now (the committed stamp is reused, so
 * only content can differ).
 * @returns {{ status: 'ok' | 'missing' | 'stale', reason?: string }}
 */
export function checkSummary(text, entries, lanes) {
  if (text === null || text === undefined) return { status: 'missing', reason: `${SUMMARY_PATH} does not exist` };
  const stamp = summaryStamp(text);
  if (!stamp) return { status: 'stale', reason: `${SUMMARY_PATH} has no Generated stamp` };
  if (generateSummary(entries, { lanes, generatedAt: stamp }).text !== text) return { status: 'stale', reason: `${SUMMARY_PATH} does not match the track files` };
  return { status: 'ok' };
}
