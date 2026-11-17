import { z } from 'zod';
import { fail } from '../errors.mjs';
import { baseMarkers, projectField, summaryChange, trackPath, TRACKS_DIR, FILE_NAMES, trackIdentity } from './common.mjs';
import { buildTrackFiles, defaultInitials, nextNumber } from '../tracks.mjs';
import { blobSha } from '../blob.mjs';

const input = z.object({
  project: projectField,
  title: z.string().min(1).max(120).describe('Short single-line title.'),
  problem: z.string().min(1).describe('The problem or request in plain markdown (no "## " headings and no "**Name**:" lines).'),
  type: z.enum(['dev', 'marketing', 'sales', 'support', 'other']).optional().describe('Track type (default dev).'),
  track_kind: z.enum(['bug', 'feature']).optional(),
  author_initials: z.string().regex(/^[A-Za-z]{1,6}$/).optional().describe('Folder prefix, e.g. AM. Defaults to the most common prefix in this project.'),
  auto_run: z.enum(['yes', 'no']).optional().describe('Default no.'),
  merge_mode: z.enum(['direct', 'pr']).optional().describe('Default direct.'),
  depends_on: z.array(z.union([z.string(), z.number()]).transform(String)).optional().describe('Track numbers that must be done first.'),
});

export const createTrack = {
  name: 'create_track',
  title: 'Create a track',
  description: 'Create a new track folder (index.md, spec.md, plan.md, test.md, conversation.md) in the plan lane, queued, and commit it. Allocates the next number. Search with list_tracks first so you extend an existing track instead of duplicating it. Returns a `base` usable directly with update_track.',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  input,
  async run({ store, ctx, args }) {
    const dependsOn = (args.depends_on ?? []).map((d) => d.replace(/^[A-Za-z]+-/, ''));
    if (dependsOn.some((d) => !/^\d+$/.test(d))) throw fail('VALIDATION_FAILED', 'depends_on must be track numbers');
    let lastConflict = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await store.transaction(async (tx) => {
        const dirs = (await tx.listDir(TRACKS_DIR)).filter((e) => e.type === 'dir').map((e) => e.name);
        const number = nextNumber(dirs, await tx.upstreamDirs?.(TRACKS_DIR) ?? []);
        const t = buildTrackFiles({
          number, initials: defaultInitials(dirs, args.author_initials), title: args.title, problem: args.problem,
          type: args.type ?? 'dev', trackKind: args.track_kind, autoRun: args.auto_run ?? 'no', mergeMode: args.merge_mode ?? 'direct', dependsOn,
        });
        const changes = FILE_NAMES.map((n) => ({ path: trackPath(t.folder, n), content: t.files[n] }));
        const preconditions = changes.map((c) => ({ path: c.path, sha: null }));
        const sum = await summaryChange(tx, ctx.now(), new Map([[t.folder, t.files.index]]));
        if (sum) changes.push(sum);
        const msg = `chore(track-${number}): create_track ${changes.map((c) => c.path.split('/').pop()).join(' ')} via lc-connector\n\nSurface: ${ctx.surface()}`;
        const r = await tx.commitFiles({ preconditions, changes, message: msg });
        return { r, t, number, msg };
      });
      if (!res.r.ok) {
        lastConflict = res.r.conflict;
        continue;
      }
      const head = await store.head();
      const warnings = [];
      if (res.r.commitError) warnings.push(`Files were written but not committed: ${res.r.commitError}`);
      else if (res.r.ignored?.length) warnings.push(`Not committed (gitignored, decision D5): ${res.r.ignored.map((p) => p.split('/').pop()).join(', ')}.`);
      return {
        data: {
          track: trackIdentity(res.t.folder, res.t.files.index),
          files_created: FILE_NAMES.map((n) => trackPath(res.t.folder, n)),
          commit: res.r.commit ? { sha: res.r.commit, message: res.msg.split('\n')[0] } : null,
          ...(res.r.commitError ? { commit_error: res.r.commitError } : {}),
          base: {
            commit: head.commit,
            files: Object.fromEntries(FILE_NAMES.map((n) => [n, blobSha(res.t.files[n])])),
            markers: baseMarkers(res.t.files.index),
          },
        },
        warnings,
        summary: `Created track ${res.t.id} (${res.t.folder}) in lane plan.`,
      };
    }
    throw fail('NUMBER_COLLISION', 'Could not allocate a free track number after 3 attempts', { details: lastConflict, hint: 'Another session is creating tracks at the same time; retry.' });
  },
};
