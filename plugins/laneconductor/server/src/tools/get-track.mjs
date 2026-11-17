import { z } from 'zod';
import { ENVELOPE_RESERVE, MAX_TEXT_CHARS } from '../envelope.mjs';
import { baseMarkers, displayMarkers, FILE_NAMES, conversationSummary, projectField, readOnly, readTrackFiles, resolveTrackFolder, sizeOf, trackField, trackIdentity } from './common.mjs';

const input = z.object({
  project: projectField,
  track: trackField,
  files: z.array(z.enum(FILE_NAMES)).optional().describe('Which files to return (default all five).'),
  conversation_tail: z.number().int().min(0).max(200).optional().describe('Latest conversation entries to return (default 20).'),
});

export const getTrack = {
  name: 'get_track',
  title: 'Get a track',
  description: 'Read one track: its markers, files and the latest conversation entries, plus the `base` you must pass back to update_track. Large content is truncated (conversation first) with explicit flags; a truncated file cannot be overwritten.\nExample: "show track 10106" -> get_track {track: 10106}',
  annotations: readOnly,
  input,
  async run({ store, args }) {
    const wanted = args.files ?? FILE_NAMES;
    const tail = args.conversation_tail ?? 20;
    const folder = await resolveTrackFolder(store, args.track);
    const got = await readTrackFiles(store, folder, FILE_NAMES);
    const index = got.get('index');
    const indexContent = index?.content ?? '';
    const head = await store.head();
    const warnings = [];
    if (!index) warnings.push(`${folder} has no index.md`);

    const files = {};
    const baseFiles = {};
    for (const name of FILE_NAMES) {
      const f = got.get(name);
      baseFiles[name] = f ? f.sha : null; // null = "did not exist when read"; writing it is allowed
      if (!wanted.includes(name) || name === 'conversation') continue;
      files[name] = f ? { content: f.content, sha: f.sha, bytes: Buffer.byteLength(f.content), truncated: false } : null;
    }
    // Files that were not requested were never seen: they cannot be a base for a write (REQ-6).
    for (const name of FILE_NAMES) if (!wanted.includes(name) && name !== 'conversation') delete baseFiles[name];
    const conv = wanted.includes('conversation') ? conversationSummary(got.get('conversation')?.content ?? '', tail) : null;
    if (conv) {
      const f = got.get('conversation');
      files.conversation = f ? { sha: f.sha, bytes: Buffer.byteLength(f.content), truncated: false } : null;
      baseFiles.conversation = f ? f.sha : null;
    } else {
      delete baseFiles.conversation;
    }

    const data = {
      track: { ...trackIdentity(folder, indexContent), markers: displayMarkers(indexContent) },
      files,
      conversation: conv,
      base: { commit: head.commit, files: baseFiles, markers: baseMarkers(indexContent) },
    };

    // REQ-18 budget. Order once over: conversation entries (oldest first), then test, plan, spec, index.
    const budget = MAX_TEXT_CHARS - ENVELOPE_RESERVE;
    const over = () => sizeOf(data) - budget;
    if (conv) {
      while (conv.entries.length > 0 && over() > 0) {
        conv.entries.shift();
        conv.truncated = true;
      }
      if (conv.truncated) warnings.push(`Conversation truncated to the latest ${conv.entries.length} of ${conv.total} entries; use conversation_tail with files ["conversation"] for more.`);
    }
    // Then the largest file is cut (ties in the order test, plan, spec, index), so a tiny plan.md is
    // never emptied to make room for an oversized spec.md.
    const order = ['test', 'plan', 'spec', 'index'];
    while (over() > 0) {
      const candidates = order.filter((n) => data.files[n] && data.files[n].content.length > 0);
      if (!candidates.length) break;
      const name = candidates.reduce((best, n) => (data.files[n].content.length > data.files[best].content.length ? n : best));
      const f = data.files[name];
      f.content = f.content.slice(0, Math.max(0, f.content.length - Math.ceil(over() * 1.1) - 8));
      if (!f.truncated) {
        f.truncated = true;
        delete data.base.files[name];
        warnings.push(`${name}.md was truncated to fit the response limit. Fetch it alone with files ["${name}"]; a truncated file cannot be overwritten.`);
      }
      f.returned_chars = f.content.length;
    }
    const m = data.track.markers;
    return { data, warnings, summary: `Track ${data.track.id}: ${data.track.title} (lane ${m['Lane'] ?? '?'}, ${m['Lane Status'] ?? '?'}, ${m['Progress'] ?? '?'}).` };
  },
};
