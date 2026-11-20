// Board data (plan Phase 5d, Task 1): one pure function from the tracks' index.md files to a plain
// object a dashboard can render. A snapshot, never a source of truth: it is rebuilt from the files
// and never written back. Privacy: only titles, lanes, status, progress, phase and dependencies
// (and the track type when it is not dev, the priority when it is not normal, and for the few tracks that have them the owner-step markers:
// Owner Action text, its due date, Result, and KPI Check After on a waiting track) leave the index.md header; the conversation, plan and test files are
// not read, spec.md only to ask whether it has a `## KPI` heading (the caller attaches it as `spec`, see bin/lc-board.mjs, for `outcome_missing`; its text is
// never copied), and the Problem/Summary text is not copied. Pure (no store, no clock): the caller passes the stamp. Overdue and ready-to-measure are NOT
// computed here: they depend on today's date, so the page works them out when it is opened (src/owner-steps.mjs holds the rules the page repeats).
import { parseMarkers } from './markers.mjs';
import { epicsOf } from './epics.mjs';
import { staleRunning } from './claims.mjs';
import { lintTracks, rowOf } from './summary.mjs';
import { trackNumberOfFolder } from './tracks.mjs';
import { dependencyState } from './dependencies.mjs';
import { actionOf } from './board-actions.mjs';
import { resolveNext } from '../../conductor/services/workflow-transitions.mjs';

/** The lanes the page draws when a project has no conductor/workflow.json (or one without lanes). */
export const DEFAULT_PAGE_LANES = ['backlog', 'planning', 'in-progress', 'review', 'quality-gate', 'done'];
export const DEFAULT_LANES = ['plan', 'implement', 'review', 'quality-gate', 'done'];
const ARCHIVE_RE = /^_(?:duplicate|quarantine)-/;
const PHASE_MAX = 200;
const DONE_ATTENTION = {
  queue: 'done:queue: passed the gate, not merged yet',
  failure: 'done:failure: the merge failed',
  waiting: 'done:waiting: waiting on a human (a PR is open)',
};

export const isArchivedFolder = (name) => ARCHIVE_RE.test(name);

// A marker value can run over following lines (legacy index.md files with no `## ` heading let the
// body flow into the last marker), so every value is cut at its first line before it is published.
const one = (v, max = 100) => (v === null || v === undefined ? null : v.split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, max));
// Lint messages quote the offending marker value; quote only its first line.
const safeReason = (r) => one(r.replace(/^(\*\*[A-Za-z ]+\*\*) "([\s\S]*)" (is not one of:)/, (_, name, val, rest) => `${name} "${one(val, 40)}" ${rest}`), 200);
/** The track types a card can show (the `**Type**` marker); absence means dev. */
export const TRACK_TYPES = ['dev', 'marketing', 'sales', 'support', 'other'];
/** The type to publish: one of the four non-dev words, or null (dev, absent, empty or unknown values all read as dev). */
export const publishedType = (raw) => {
  const s = one(raw ?? null, 40)?.toLowerCase() ?? '';
  return TRACK_TYPES.includes(s) && s !== 'dev' ? s : null;
};
// A date marker as written (edges kept, so a stray space shows as the reason it is not a date); the page judges it with the same strict rule at render.
const rawDate = (v) => String(v).split('\n')[0].replace(/[ \t]+/g, ' ').slice(0, 40);
const yesNo = (v) => {
  const s = (v ?? '').trim().toLowerCase();
  return s === 'yes' ? true : s === 'no' ? false : null;
};

// The tracks a track waits for, as numbers, each once and never itself (`Depends On` first, then `Waiting On Tracks`); at most 12.
const blockedBy = (r) => [...new Set([...(r.depends_on ?? []), ...(r.waiting_on ?? [])].map(Number).filter((n) => Number.isInteger(n) && n !== r.number))].slice(0, 12);
// The KPI a track serves: the `**Serves**` marker, else '' when it has `KPI Check After`, else null (no KPI marker).
const servesOf = (v, r) => (one(v['Serves'] ?? null, 60) ? one(v['Serves'], 60) : r.kpi_check_after !== undefined ? '' : null);

function trackOf(e, archived) {
  // Archived folders are named `_duplicate-<number>-<slug>`; drop the prefix so the usual parsing applies.
  const name = archived ? e.folder.replace(ARCHIVE_RE, '') : e.folder;
  const r = rowOf(name, e.index);
  const v = e.index ? parseMarkers(e.index.content).values : {};
  const merge = one(v['Merge Mode'] ?? null, 40);
  const type = publishedType(v['Type']);
  return {
    row: { ...r, folder: e.folder },
    track: {
      number: r.number,
      folder: e.folder,
      title: r.title,
      lane: one(r.lane),
      lane_status: one(r.lane_status),
      progress: r.progress,
      phase: one(r.phase, PHASE_MAX),
      depends_on: r.depends_on,
      auto_run: yesNo(one(v['Auto Run'] ?? null)),
      merge_mode: merge || null,
      source_hash: r.source,
      ...(type ? { type } : {}),
      // `**Priority**` is read by the same row reader `next` uses (first marker wins, case-insensitive, anything else is absent); only high and low are published.
      ...(r.priority === 'high' || r.priority === 'low' ? { priority: r.priority } : {}),
      // Track AM-10147 (owner steps): only for the tracks that have them. The due date and the check date are published as written; today's date is the
      // page's, so nothing here goes stale. The check date matters only while the track waits (a waiting track whose window ended is ready to measure).
      ...(r.owner_action ? { owner_action: r.owner_action, ...(r.owner_action_due !== undefined ? { owner_action_due: rawDate(r.owner_action_due) } : {}) } : {}),
      ...(r.result ? { result: r.result } : {}),
      ...(r.lane_status === 'waiting' && r.kpi_check_after !== undefined ? { kpi_check_after: rawDate(r.kpi_check_after) } : {}),
      // Deep links on the page: the tracks this one waits for (Depends On and Waiting On Tracks), and the KPI it serves. `kpi` is the `**Serves**` marker as written
      // (60 characters at most), or '' when the track only has a `KPI Check After` (it has a KPI, the name is in its spec). Absent when there is neither.
      ...(blockedBy(r).length ? { blocked_by: blockedBy(r) } : {}),
      ...(servesOf(v, r) !== null ? { kpi: servesOf(v, r) } : {}),
      ...(archived ? { archived: true } : {}),
    },
  };
}

/**
 * @param {{ folder: string, index: { content: string, sha?: string } | null }[]} entries
 * @param {{ lanes?: string[], generatedAt: string, project?: string, workflow?: object | null }} opts workflow: the parsed conductor/workflow.json, used only to say which lane a finished lane leads to (card actions)
 */
export function buildBoard(entries, { lanes = DEFAULT_LANES, generatedAt, project = null, workflow = null } = {}) {
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
  const reasonsByFolder = new Map(lint.map((l) => [l.folder, l.problems.map(safeReason)]));
  const deps = dependencyState(act.map((a) => a.row));
  const actionByFolder = new Map();
  act.forEach(({ row }, i) => {
    const reasons = reasonsByFolder.get(row.folder) ?? [];
    const stale = active[i].index ? staleRunning(active[i].index.content, Date.parse(generatedAt)) : null;
    if (stale) reasons.push(`running for ${stale.hours}h with no sign of life`);
    if (row.waiting_for_reply) reasons.push('waiting for a human reply');
    if (row.lane_status === 'failure' && row.lane !== 'done') reasons.push('lane status is failure');
    // Track AM-10135: in the done lane only `success` means shipped; the other statuses are work somebody still has to finish.
    if (row.lane === 'done' && DONE_ATTENTION[row.lane_status]) reasons.push(DONE_ATTENTION[row.lane_status]);
    if (reasons.length) reasonsByFolder.set(row.folder, reasons);
    // Track AM-10115: the next step and its exact command, from this track's own markers only.
    const action = actionOf({ row, stale, dep: deps.get(row.number) ?? null, lanes: laneList, workflow, nowMs: Date.parse(generatedAt) });
    if (action) actionByFolder.set(row.folder, action);
  });

  const laneIdx = (t) => { const i = laneList.indexOf(t.lane); return i === -1 ? laneList.length : i; };
  const tracks = [...act, ...arc].map((a) => ({ ...a.track, ...(a.track.archived ? {} : { needs_attention: reasonsByFolder.has(a.track.folder) }), ...(actionByFolder.has(a.track.folder) && !a.track.archived ? { action: actionByFolder.get(a.track.folder) } : {}) }))
    .sort((a, b) => laneIdx(a) - laneIdx(b) || b.number - a.number || (a.archived ? 1 : 0) - (b.archived ? 1 : 0) || a.folder.localeCompare(b.folder));

  const by_lane = Object.fromEntries(laneList.map((l) => [l, 0]));
  for (const t of tracks) {
    if (t.archived) continue;
    const k = t.lane !== null && t.lane in by_lane ? t.lane : 'unknown';
    by_lane[k] = (by_lane[k] ?? 0) + 1;
  }
  const needs_attention = act
    .filter(({ row }) => reasonsByFolder.has(row.folder))
    .map(({ row }) => ({ number: row.number, folder: row.folder, reasons: reasonsByFolder.get(row.folder), ...(actionByFolder.has(row.folder) ? { action: actionByFolder.get(row.folder) } : {}) }))
    .sort((a, b) => b.number - a.number || a.folder.localeCompare(b.folder));

  const epics = epicsOf(act.map((a) => a.row)).map(({ row, table }) => ({
    number: row.number,
    title: row.title,
    folder: row.folder,
    done: table.done,
    total: table.total,
    children: table.children.map((c) => ({ id: c.id, title: c.title, lane: c.lane, lane_status: c.lane_status, progress: c.progress })),
  }));

  return {
    project,
    generated_at: generatedAt,
    lanes: laneList,
    tracks,
    counts: { by_lane, needs_attention: needs_attention.length, archived: arc.length },
    needs_attention,
    // Track AM-10145: derived from the children's own markers (`Part Of`), never stored in the epic. Present only when there is one.
    ...(epics.length ? { epics } : {}),
  };
}

/** True when two boards hold the same data (`generated_at` is ignored). */
export const sameBoard = (a, b) => JSON.stringify({ ...a, generated_at: null }) === JSON.stringify({ ...b, generated_at: null });

const FLOW_MAX_LANES = 30;
const clip = (v, n = 60) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * The lanes of a project's workflow as the Workflow tab draws them (track AM-10115): each lane with where it sends success and
 * failure ('lane:status', or null: no automatic move), computed with the shared resolver conductor/services/workflow-transitions.mjs,
 * the same function the card actions use. Only names, targets and a short note leave the file: no models, no limits, no settings.
 * An unknown or old format never throws: a lane the resolver cannot read is listed by name with a note. Returns null when there is no
 * `lanes` object (nothing to draw).
 * @param {object|null} workflow the parsed conductor/workflow.json
 * @returns {{ lanes: { name: string, success: string|null, failure: string|null, note: string }[] } | null}
 */
export function workflowFlow(workflow) {
  const lanes = workflow && typeof workflow === 'object' && workflow.lanes && typeof workflow.lanes === 'object' && !Array.isArray(workflow.lanes) ? workflow.lanes : null;
  const names = lanes ? Object.keys(lanes).slice(0, FLOW_MAX_LANES) : [];
  if (!names.length) return null;
  return {
    lanes: names.map((name) => {
      const out = { name: clip(name, 40), success: null, failure: null, note: '' };
      const dir = [];
      try {
        for (const outcome of ['success', 'failure']) {
          const r = resolveNext(workflow, name, outcome);
          if (!r.ok) throw new Error('unreadable');
          out[outcome] = r.next ? clip(`${r.next.lane}:${r.next.status}`, 60) : null;
          if (!r.next) dir.push(outcome);
        }
        out.note = dir.length === 2 ? 'no automatic move out of this lane' : dir.length === 1 ? `no automatic move on ${dir[0]}` : '';
      } catch { out.success = null; out.failure = null; out.note = 'the targets of this lane are in a format the board does not read'; }
      return out;
    }),
  };
}

const PREFIX_RE = /^([A-Za-z]{1,6})-\d+/;
const prefixOf = (folder) => (PREFIX_RE.exec(folder ?? '') ?? [])[1] ?? '';

/**
 * The data the static board page (`board-page.html`) renders, from a `buildBoard` result: live tracks
 * only (archived copies are left out). Short keys keep the file small. Only titles, lanes, status,
 * progress, phase and check reasons: the same privacy surface as the board itself. The documents are
 * separate files (`docs/<n>.json`); this only says which tracks have one.
 *   commit (only when it could be read): the head of the state branch the board was built from, as `commit` (full sha) and `commit_short` (7 characters);
 *           the page compares it with the connector's provenance commit to say whether the board is still current. A hash, never text of a file
 *   lanes:  the project's workflow lanes in flow order (the page draws every lane but backlog and done as a column)
 *   tracks: n number, p initials prefix of the folder (AM), t title, l lane, s lane status,
 *           g progress, h phase (cut at 130 chars), a needs attention,
 *           d a docs file is published for this track,
 *           pr (only when the track's `**Priority**` is high or low) the priority; absent means normal. The page sorts each lane and the backlog high, normal, low (stable, newest first inside a priority),
 *           y (only when the track's `**Type**` is marketing, sales, support or other) the type; absent means dev, so an old board.json without it reads as all dev,
 *           oa, od, rs, kc (only for a track that has them; see owner-steps.mjs): oa the Owner Action text (200 chars at most), od its Owner Action Due as written (absent: no due date;
 *              the page checks it is a real YYYY-MM-DD and works out overdue when it opens, in UTC), rs the Result one-liner, kc KPI Check After as written (only while the track waits:
 *              the page says "ready to measure" once that day is today or earlier). An old board.json without them renders as before,
 *           bb (only when the track waits for tracks) the numbers of Depends On and Waiting On Tracks; the page turns each into a link that opens that track,
 *           kp (only when the track has a KPI marker) the `**Serves**` text, or '' when only a `KPI Check After` is set; the page turns it into a link to the KPIs tab of the Project drawer,
 *           x (only when there is a next step) the next step: c the exact command (or null when nothing is to be run), w one short reason,
 *           gh (done tracks, only when there is a github.com remote) the track folder on GitHub
 *   attn:   n number, p prefix, t title, r reasons, x the next step (as on a track; only when there is one)
 *   epics (only when a track is named by `Part Of`): n number, p prefix, t title, d children done, c children [i id, t title, l lane, s status, g progress]
 *   project_docs (only when there is a project definition to read): the Project drawer's tabs, [k key, t title, f 'ctx/<key>.json'];
 *           the files are separate, like the track documents; `board.include_docs: false` leaves this out
 *   wf (only with project_docs and a workflow.json with lanes): { lanes: [{ name, success, failure, note }] } for the Workflow tab, see `workflowFlow`
 *   next (only when the next step could be worked out): the What's next panel, { s state id, head, cmd (the exact command, or null when there is nothing to run),
 *           what, why, n track number or null, others [{ n, cmd, w }] (at most 5, ranked), primer [six bullets] }; see src/next.mjs `nextCard`.
 *           Titles and commands only, never document text; it stays when `board.include_docs` is false
 *   docs_dropped (only when > 0): tracks left without a docs file because of the file cap
 * @param {object} board a `buildBoard` result
 * @param {{ lanes?: string[], docFolders?: Iterable<string>, docsDropped?: number, githubFolderUrl?: ((folder: string) => string) | null, commit?: string | null }} [docs]
 */
export function boardPageData(board, { docFolders = [], docsDropped = 0, githubFolderUrl = null, lanes = null, projectDocs = [], wf = null, next = null, commit = null } = {}) {
  const live = board.tracks.filter((t) => !t.archived);
  const titleOf = new Map(live.map((t) => [t.folder, t.title]));
  const withDocs = new Set(docFolders);
  return {
    project: board.project,
    generated_at: board.generated_at,
    ...(typeof commit === 'string' && /^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(commit) ? { commit: commit.toLowerCase(), commit_short: commit.slice(0, 7).toLowerCase() } : {}),
    lanes: lanes?.length ? [...lanes] : [...DEFAULT_PAGE_LANES],
    tracks: live.map((t) => ({
      n: t.number, p: prefixOf(t.folder), t: t.title ?? '', l: t.lane, s: t.lane_status, g: t.progress || 0, h: (t.phase ?? '').slice(0, 130), a: Boolean(t.needs_attention),
      d: withDocs.has(t.folder),
      ...(t.type ? { y: t.type } : {}),
      ...(t.priority ? { pr: t.priority } : {}),
      ...(t.owner_action ? { oa: t.owner_action, ...(t.owner_action_due !== undefined ? { od: t.owner_action_due } : {}) } : {}),
      ...(t.result ? { rs: t.result } : {}),
      ...(t.kpi_check_after !== undefined ? { kc: t.kpi_check_after } : {}),
      ...(t.blocked_by ? { bb: t.blocked_by } : {}),
      ...(t.kpi !== undefined ? { kp: t.kpi } : {}),
      ...(t.action ? { x: t.action } : {}),
      ...(t.lane === 'done' && githubFolderUrl ? { gh: githubFolderUrl(t.folder) } : {}),
    })),
    attn: board.needs_attention
      .filter((a) => titleOf.has(a.folder))
      .map((a) => ({ n: a.number, p: prefixOf(a.folder), t: titleOf.get(a.folder) ?? '', r: a.reasons, ...(a.action ? { x: a.action } : {}) })),
    ...(board.epics?.length ? { epics: board.epics.map((e) => ({ n: e.number, p: prefixOf(e.folder), t: e.title ?? '', d: e.done, c: e.children.map((c) => ({ i: c.id, t: c.title ?? '', l: c.lane, s: c.lane_status, g: c.progress || 0 })) })) } : {}),
    ...(projectDocs.length ? { project_docs: projectDocs.map(({ k, t, f }) => ({ k, t, f })) } : {}),
    ...(projectDocs.length && wf ? { wf } : {}),
    ...(next ? { next } : {}),
    ...(docsDropped > 0 ? { docs_dropped: docsDropped } : {}),
  };
}

/** Where the static page lives; it is shipped byte for byte and never carries data. */
export const BOARD_PAGE_PATH = new URL('./board-page.html', import.meta.url);
