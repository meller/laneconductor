import { z } from 'zod';
import { ENVELOPE_RESERVE, MAX_TEXT_CHARS } from '../envelope.mjs';
import { STALE_RUNNING_HOURS, staleRunning } from '../claims.mjs';
import { damagedHeaders } from '../markers.mjs';
import { dependencyState, readyToResume } from '../dependencies.mjs';
import { epicsOf } from '../epics.mjs';
import { planLogFindings } from '../plan-log.mjs';
import { SUMMARY_PATH, checkSummary, rowOf } from '../summary.mjs';
import { projectField, publishable, readEntries, readOnly, sizeOf, workflowLanes } from './common.mjs';

const input = z.object({
  project: projectField,
  lane: z.string().optional().describe('Only tracks in this lane, e.g. plan, implement.'),
  lane_status: z.string().optional().describe('Only tracks with this lane status: queue, running, success, failure, waiting.'),
  query: z.string().optional().describe('Case-insensitive text to find in the title, id or summary.'),
  include_done: z.boolean().optional().describe('Also list done:success tracks.'),
  limit: z.number().int().min(1).max(200).optional().describe('Maximum tracks returned (default 50, max 200).'),
});

const EPIC_CHILD_CAP = 15;
const shortId = (folder) => folder.match(/^(?:[A-Za-z]+-)?\d+/)?.[0] ?? folder;

export const listTracks = {
  name: 'list_tracks',
  title: 'List tracks',
  description: 'List tracks (newest first) with lane, status, progress and a short summary. Use it to find a track or see what is in flight; done:success tracks are hidden unless include_done.\nExample: "is there a track about CSV" -> list_tracks {query: "csv"}',
  annotations: readOnly,
  input,
  async run({ store, ctx, args }) {
    const limit = args.limit ?? 50;
    const entries = await readEntries(store, { withPlan: true });
    const warnings = [];
    const rows = entries.map((e) => ({ ...rowOf(e.folder, e.index), ...(e.tracked === false ? { untracked: true } : {}) }));
    const drafts = rows.filter((r) => r.untracked).map((r) => r.folder);
    if (drafts.length) warnings.push(`Not committed (not in git yet; left out of conductor/tracks-summary.md): ${drafts.join(', ')}`);
    const damagedFolders = [];
    const staleFolders = [];
    const logFolders = entries.filter((e) => e.plan && planLogFindings(e.plan.content).flagged).map((e) => e.folder);
    for (const r of rows) {
      if (r.source === null) warnings.push(`${r.folder}: no index.md`);
      else if (r.lane === null) warnings.push(`${r.folder}: index.md has no **Lane** marker`);
      const idx = entries.find((x) => x.folder === r.folder)?.index;
      if (idx && damagedHeaders(idx.content).length) damagedFolders.push(r.folder);
      if (idx && staleRunning(idx.content, new Date(ctx.now()).getTime())) staleFolders.push(r.folder);
    }
    if (damagedFolders.length) warnings.push(`header_damaged in ${damagedFolders.length} track${damagedFolders.length === 1 ? '' : 's'} (a marker is repeated; the first is used): ${damagedFolders.slice(0, 4).map(shortId).join(', ')}${damagedFolders.length > 4 ? ', ...' : ''}. get_track names the lines.`);
    if (staleFolders.length) warnings.push(`stale_running: ${staleFolders.slice(0, 4).map(shortId).join(', ')}${staleFolders.length > 4 ? ', ...' : ''} running over ${STALE_RUNNING_HOURS}h (Run Started). get_track says how to release.`);
    if (logFolders.length) warnings.push(`plan_has_log in ${logFolders.length} track${logFolders.length === 1 ? '' : 's'} (plan.md holds dated status or a log): ${logFolders.slice(0, 3).map(shortId).join(', ')}${logFolders.length > 3 ? ', ...' : ''}. get_track says what to move to history.md.`);
    const byNumber = new Map();
    for (const r of rows) byNumber.set(r.number, [...(byNumber.get(r.number) ?? []), r.folder]);
    for (const [n, folders] of byNumber) if (folders.length > 1) warnings.push(`Duplicate track number ${n}: ${folders.sort().join(', ')}`);
    // The rows above come from the track files themselves; the summary file is only checked, so a
    // stale or hand-edited one is reported instead of being believed.
    const staleReasons = [];
    const cur = (await store.readFiles([SUMMARY_PATH])).get(SUMMARY_PATH);
    const check = checkSummary(cur?.content ?? null, publishable(entries), await workflowLanes(store));
    if (check.status !== 'ok') {
      staleReasons.push('track_summary_regenerated');
      warnings.push(`${check.reason}; this list was regenerated from a scan of the track folders. The next track write rewrites the file.`);
    }
    const deps = dependencyState(rows);
    // A very large epic lists its first EPIC_CHILD_CAP children and says how many more there are, so one epic cannot fill the response.
    const epics = new Map(epicsOf(rows, { max: EPIC_CHILD_CAP }).map((e) => [e.row.number, e.table]));
    const present = (list) => list.map(({ source, waiting_on, waiting_reason, ...r }) => ({ ...r, ...(deps.get(r.number) ?? {}), ...(epics.has(r.number) ? { children_line: epics.get(r.number).line, children: epics.get(r.number).children, ...(epics.get(r.number).more ? { children_more: epics.get(r.number).more } : {}) } : {}) }));
    const q = args.query?.toLowerCase();
    const matches = rows
      .filter((r) => (args.lane ? r.lane === args.lane : true))
      .filter((r) => (args.lane_status ? r.lane_status === args.lane_status : true))
      // Track AM-10135: only shipped work is quiet. done:queue is gated but not merged, done:failure a failed merge, done:waiting a PR open.
      .filter((r) => (args.include_done || args.lane === 'done' ? true : !(r.lane === 'done' && r.lane_status === 'success')))
      .filter((r) => (q ? `${r.title} ${r.id} ${r.summary}`.toLowerCase().includes(q) : true))
      .sort((a, b) => b.number - a.number);
    let shown = matches.slice(0, limit);
    let truncated = matches.length > shown.length;
    const budget = MAX_TEXT_CHARS - ENVELOPE_RESERVE;
    while (shown.length > 1 && sizeOf(present(shown)) > budget) {
      shown = shown.slice(0, Math.floor(shown.length * 0.9));
      truncated = true;
    }
    if (truncated) warnings.push(`Showing ${shown.length} of ${matches.length} tracks; narrow with lane, query or limit.`);
    // Track AM-10135: a done track whose `track-N` branch exists says whether it is merged (`git merge-base --is-ancestor`). Looked up for
    // gated, failed and waiting done tracks (cheap and exactly where the status can be wrong) and, when done tracks were asked for, for all.
    const askedDone = args.include_done || args.lane === 'done';
    const toCheck = shown.filter((r) => r.lane === 'done' && (askedDone || r.lane_status !== 'success'));
    if (toCheck.length && typeof store.branchMergeStates === 'function') {
      const states = await store.branchMergeStates('track-');
      for (const r of toCheck) {
        const merged = states.get(`track-${r.number}`);
        if (merged === undefined) continue;
        r.merged = merged;
        if (!merged && r.lane_status === 'success') warnings.push(`${r.id} is done:success but its branch track-${r.number} has commits the state branch lacks: it may not be merged.`);
        if (merged && r.lane_status === 'queue') warnings.push(`${r.id} is done:queue but its branch track-${r.number} is already merged: set it to done:success.`);
      }
    }
    const filtered = Boolean(args.lane || args.lane_status || args.query);
    return {
      data: {
        // `blocked_by` (dependency numbers not yet done:success) and `ready_to_resume` appear only on tracks that have dependencies.
        tracks: present(shown),
        total: matches.length,
        truncated,
        ...(readyToResume(rows).length ? { ready_to_resume: readyToResume(rows) } : {}),
      },
      warnings,
      staleReasons,
      empty: filtered && matches.length === 0,
      summary: `${shown.length} of ${matches.length} track${matches.length === 1 ? '' : 's'}.`,
    };
  },
};
