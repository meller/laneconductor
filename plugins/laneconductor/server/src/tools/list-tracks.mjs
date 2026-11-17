import { z } from 'zod';
import { ENVELOPE_RESERVE, MAX_TEXT_CHARS } from '../envelope.mjs';
import { SUMMARY_PATH, checkSummary, rowOf } from '../summary.mjs';
import { projectField, publishable, readEntries, readOnly, sizeOf, workflowLanes } from './common.mjs';

const input = z.object({
  project: projectField,
  lane: z.string().optional().describe('Only tracks in this lane, e.g. plan, implement.'),
  lane_status: z.string().optional().describe('Only tracks with this lane status: queue, running, success, failure, waiting.'),
  query: z.string().optional().describe('Case-insensitive text to find in the title, id or summary.'),
  include_done: z.boolean().optional().describe('Include tracks in the done lane (default false).'),
  limit: z.number().int().min(1).max(200).optional().describe('Maximum tracks returned (default 50, max 200).'),
});

export const listTracks = {
  name: 'list_tracks',
  title: 'List tracks',
  description: 'List this project\'s tracks (newest number first) with lane, status, progress and a short summary. Use it to find a track or to see what is in flight before planning; done tracks are hidden unless include_done.',
  annotations: readOnly,
  input,
  async run({ store, args }) {
    const limit = args.limit ?? 50;
    const entries = await readEntries(store);
    const warnings = [];
    const rows = entries.map((e) => ({ ...rowOf(e.folder, e.index), ...(e.tracked === false ? { untracked: true } : {}) }));
    const drafts = rows.filter((r) => r.untracked).map((r) => r.folder);
    if (drafts.length) warnings.push(`Not committed (not in git yet; left out of conductor/tracks-summary.md): ${drafts.join(', ')}`);
    for (const r of rows) {
      if (r.source === null) warnings.push(`${r.folder}: no index.md`);
      else if (r.lane === null) warnings.push(`${r.folder}: index.md has no **Lane** marker`);
    }
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
      warnings.push(`${check.reason}; this list was regenerated from a scan of the track folders. The next track write (or \`lc summary\`) rewrites the file.`);
    }
    const q = args.query?.toLowerCase();
    const matches = rows
      .filter((r) => (args.lane ? r.lane === args.lane : true))
      .filter((r) => (args.lane_status ? r.lane_status === args.lane_status : true))
      .filter((r) => (args.include_done || args.lane === 'done' ? true : r.lane !== 'done'))
      .filter((r) => (q ? `${r.title} ${r.id} ${r.summary}`.toLowerCase().includes(q) : true))
      .sort((a, b) => b.number - a.number);
    let shown = matches.slice(0, limit);
    let truncated = matches.length > shown.length;
    const budget = MAX_TEXT_CHARS - ENVELOPE_RESERVE;
    while (shown.length > 1 && sizeOf(shown) > budget) {
      shown = shown.slice(0, Math.floor(shown.length * 0.9));
      truncated = true;
    }
    if (truncated) warnings.push(`Showing ${shown.length} of ${matches.length} tracks; narrow with lane, query or limit.`);
    const filtered = Boolean(args.lane || args.lane_status || args.query);
    return {
      data: { tracks: shown.map(({ source, ...r }) => r), total: matches.length, truncated },
      warnings,
      staleReasons,
      empty: filtered && matches.length === 0,
      summary: `${shown.length} of ${matches.length} track${matches.length === 1 ? '' : 's'}.`,
    };
  },
};
