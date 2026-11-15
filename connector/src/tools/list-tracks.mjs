import { z } from 'zod';
import { ENVELOPE_RESERVE, MAX_TEXT_CHARS } from '../envelope.mjs';
import { parseMarkers, trackTitle } from '../markers.mjs';
import { trackNumberOfFolder } from '../tracks.mjs';
import { TRACKS_DIR, projectField, readOnly, sizeOf, trackDirNames, trackIdentity } from './common.mjs';

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
    const dirs = await trackDirNames(store);
    const reads = await store.readFiles(dirs.map((d) => `${TRACKS_DIR}/${d}/index.md`));
    const warnings = [];
    const byNumber = new Map();
    const rows = [];
    for (const folder of dirs) {
      const n = trackNumberOfFolder(folder);
      byNumber.set(n, [...(byNumber.get(n) ?? []), folder]);
      const idx = reads.get(`${TRACKS_DIR}/${folder}/index.md`);
      const ident = trackIdentity(folder, idx?.content ?? '');
      if (!idx) {
        warnings.push(`${folder}: no index.md`);
        rows.push({ number: ident.number, id: ident.id, folder, title: ident.title, lane: null, lane_status: null, progress: null, phase: null, type: null, summary: '', waiting_for_reply: false, depends_on: [] });
        continue;
      }
      const v = parseMarkers(idx.content).values;
      if (!('Lane' in v)) warnings.push(`${folder}: index.md has no **Lane** marker`);
      const progress = parseInt(v['Progress'] ?? '', 10);
      rows.push({
        number: ident.number,
        id: ident.id,
        folder,
        title: trackTitle(idx.content) ?? folder,
        lane: v['Lane']?.trim() ?? null,
        lane_status: v['Lane Status']?.trim() ?? null,
        progress: Number.isFinite(progress) ? progress : null,
        phase: v['Phase']?.trim() ?? null,
        type: v['Type']?.trim() ?? null,
        summary: (v['Summary'] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
        waiting_for_reply: (v['Waiting for reply'] ?? '').trim().toLowerCase() === 'yes',
        depends_on: (v['Depends On'] ?? '').split(/[,\s]+/).map((s) => s.replace(/^[A-Za-z]+-/, '')).filter((s) => /^\d+$/.test(s)),
      });
    }
    for (const [n, folders] of byNumber) if (folders.length > 1) warnings.push(`Duplicate track number ${n}: ${folders.sort().join(', ')}`);
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
    return {
      data: { tracks: shown, total: matches.length, truncated },
      warnings,
      summary: `${shown.length} of ${matches.length} track${matches.length === 1 ? '' : 's'}.`,
    };
  },
};
