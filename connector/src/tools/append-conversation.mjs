import { z } from 'zod';
import { appendTurn, CONVERSATION_AUTHORS, formatTurn } from '../conversation.mjs';
import { fail } from '../errors.mjs';
import { projectField, trackField, trackPath, TRACKS_DIR } from './common.mjs';
import { resolveTrack } from '../tracks.mjs';

const input = z.object({
  project: projectField,
  track: trackField,
  author: z.enum(CONVERSATION_AUTHORS).describe('"claude" for your own comments; "human" only to relay the human\'s own words.'),
  body: z.string().describe('Plain message text. Do not add "> **author**:" or ">" prefixes; the connector formats the turn.'),
});

export const appendConversation = {
  name: 'append_conversation',
  title: 'Append to a track conversation',
  description: 'Append one comment to a track\'s conversation.md in the format the sync parser requires. Append-only: no base needed. Pass the plain text only. Use author "human" only to relay the human\'s own words.',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  input,
  async run({ store, ctx, args }) {
    formatTurn(args.author, args.body); // fail fast, before taking the write lock
    const res = await store.transaction(async (tx) => {
      const dirs = (await tx.listDir(TRACKS_DIR)).filter((e) => e.type === 'dir').map((e) => e.name);
      const folder = resolveTrack(dirs, args.track);
      const path = trackPath(folder, 'conversation');
      const cur = (await tx.readFiles([path])).get(path);
      const m = folder.match(/^(?:([A-Za-z]+)-)?(\d+)-/);
      const header = `# Conversation: Track ${m[1] ? `${m[1]}-` : ''}${m[2]}\n\n`;
      const next = appendTurn(cur ? cur.content : header, args.author, args.body);
      const msg = `chore(track-${Number(m[2])}): append_conversation conversation.md via lc-connector\n\nSurface: ${ctx.surface()}`;
      const r = await tx.commitFiles({ preconditions: [{ path, sha: cur ? cur.sha : null }], changes: [{ path, content: next }], message: msg });
      return { r, folder, msg };
    });
    if (!res.r.ok) throw fail('WRITE_FAILED', 'conversation.md changed outside the connector while appending', { details: res.r.conflict, hint: 'Retry the append.' });
    const warnings = [];
    if (res.r.commitError) warnings.push(`Appended but not committed: ${res.r.commitError}`);
    return {
      data: {
        track: { folder: res.folder },
        appended: { author: args.author, lines: args.body.replace(/\s+$/, '').split('\n').length },
        commit: res.r.commit ? { sha: res.r.commit, message: res.msg.split('\n')[0] } : null,
        ...(res.r.commitError ? { commit_error: res.r.commitError } : {}),
      },
      warnings,
      summary: `Appended a ${args.author} comment to ${res.folder}.`,
    };
  },
};
