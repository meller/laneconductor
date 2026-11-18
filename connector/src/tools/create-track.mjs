import { z } from 'zod';
import { fail } from '../errors.mjs';
import { baseMarkers, projectField, readEntries, summaryChange, trackPath, TRACKS_DIR, FILE_NAMES, trackIdentity, workflowLanes } from './common.mjs';
import { buildTrackFiles, defaultInitials, duplicateNumbers, nextNumber, similarTracks, trackNumberOfFolder } from '../tracks.mjs';
import { rowOf } from '../summary.mjs';
import { blobSha } from '../blob.mjs';
import { nearestLane } from '../vocabulary.mjs';

const REF_TIP_CAP = 100;

/** The softer note: a number of this branch that an unmerged branch names differently. One line, at most 200 characters, final period kept. */
function elsewhereNote(here, entries) {
  const byNumber = new Map();
  for (const n of here) {
    const v = trackNumberOfFolder(n);
    if (v !== null) byNumber.set(v, (byNumber.get(v) ?? new Set()).add(n));
  }
  const seen = new Set();
  const found = [];
  for (const e of entries) {
    if (e.merged) continue;
    const v = trackNumberOfFolder(e.name);
    const names = v === null ? null : byNumber.get(v);
    if (!names || names.has(e.name) || seen.has(`${v}/${e.ref}`)) continue;
    seen.add(`${v}/${e.ref}`);
    found.push(`${v} also named differently on branch ${e.ref.length > 50 ? `${e.ref.slice(0, 49)}…` : e.ref}`);
  }
  if (!found.length) return null;
  const tail = ' (not merged yet). Merge or delete that branch, or ask which one keeps it.';
  let text = '';
  for (let shown = Math.min(found.length, 3); shown >= 1; shown--) {
    text = `Track number ${found.slice(0, shown).join('; ')}${found.length > shown ? `; +${found.length - shown} more` : ''}${tail}`;
    if (text.length <= 200) break;
  }
  return text;
}

const input = z.object({
  project: projectField,
  title: z.string().min(1).max(120).describe('Short single-line title.'),
  problem: z.string().min(1).describe('The problem or request in plain markdown (no "## " headings and no "**Name**:" lines).'),
  type: z.enum(['dev', 'marketing', 'sales', 'support', 'other']).optional().describe('Track type (default dev).'),
  track_kind: z.enum(['bug', 'feature']).optional().describe('Writes the bug or feature form into spec.md.'),
  author_initials: z.string().regex(/^[A-Za-z]{1,6}$/).optional().describe('Folder prefix, e.g. AM (default: the most common here).'),
  auto_run: z.enum(['yes', 'no']).optional().describe('Default no.'),
  merge_mode: z.enum(['direct', 'pr']).optional().describe('Default direct.'),
  depends_on: z.array(z.union([z.string(), z.number()]).transform(String)).optional().describe('Track numbers that must be done first.'),
});

export const createTrack = {
  name: 'create_track',
  title: 'Create a track',
  description: 'Create a new track folder (index.md, spec.md, plan.md, test.md, conversation.md) in the plan lane, queued, and commit it. Allocates the next number. Search with list_tracks first and update a fitting track instead (default yes). Returns `similar_tracks` and a `base` usable directly with update_track.\nExample: "flag a bug: export fails" -> create_track {title: "Export fails", problem: "...", track_kind: "bug"}',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  input,
  async run({ store, ctx, args }) {
    const dependsOn = (args.depends_on ?? []).map((d) => d.replace(/^[A-Za-z]+-/, ''));
    if (dependsOn.some((d) => !/^\d+$/.test(d))) throw fail('VALIDATION_FAILED', 'depends_on must be track numbers');
    let lastConflict = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await store.transaction(async (tx) => {
        const dirs = (await tx.listDir(TRACKS_DIR)).filter((e) => e.type === 'dir').map((e) => e.name);
        // A project that names its planning lane otherwise (otralingo: `planning`) gets that name, not `plan`.
        const similar = similarTracks((await readEntries(tx, { tracked: false })).map((e) => rowOf(e.folder, e.index)), { title: args.title, problem: args.problem });
        const initialLane = nearestLane('plan', await workflowLanes(tx)) ?? 'plan';
        // Track AM-10143: numbers taken on other branches (local or remote-tracking) count too, so two worktrees do not hand out the same one.
        const upstreamNames = await tx.upstreamDirs?.(TRACKS_DIR) ?? [];
        const others = (await tx.refDirs?.(TRACKS_DIR)) ?? { entries: [], capped: false };
        const upstream = [...upstreamNames, ...others.entries.map((e) => e.name)];
        const number = nextNumber(dirs, upstream);
        // A number is DUPLICATED when two different folder names carry it on the state branch (this checkout) or its upstream. A folder
        // that only an unmerged branch carries is a softer note, and goes away when that branch is merged or deleted.
        const duplicates = duplicateNumbers(dirs, upstreamNames).slice(0, 5);
        const elsewhere = elsewhereNote([...dirs, ...upstreamNames], others.entries);
        const capped = others.capped;
        // Track AM-10136: a dependency on a track that does not exist can never be met, so it is refused instead of parked forever.
        const known = new Set([...dirs, ...upstream].map(trackNumberOfFolder).filter((n) => n !== null).map(String));
        const unknown = dependsOn.filter((d) => !known.has(String(Number(d))));
        if (unknown.length) throw fail('VALIDATION_FAILED', `depends_on names track${unknown.length > 1 ? 's' : ''} that do not exist: ${unknown.join(', ')}`, { details: { unknown_dependencies: unknown }, hint: 'Check the number with list_tracks. Create the track it depends on first, or leave depends_on out and say so in the problem text.' });
        const t = buildTrackFiles({
          number, initials: defaultInitials(dirs, args.author_initials), title: args.title, problem: args.problem,
          type: args.type ?? 'dev', trackKind: args.track_kind, lane: initialLane, autoRun: args.auto_run ?? 'no', mergeMode: args.merge_mode ?? 'direct', dependsOn,
        });
        const changes = FILE_NAMES.map((n) => ({ path: trackPath(t.folder, n), content: t.files[n] }));
        const preconditions = changes.map((c) => ({ path: c.path, sha: null }));
        const sum = await summaryChange(tx, ctx.now(), new Map([[t.folder, t.files.index]]));
        if (sum) changes.push(sum);
        const msg = `chore(track-${number}): create_track ${changes.map((c) => c.path.split('/').pop()).join(' ')} via lc-connector\n\nSurface: ${ctx.surface()}`;
        const r = await tx.commitFiles({ preconditions, changes, message: msg });
        return { r, t, number, msg, lane: initialLane, similar, duplicates, elsewhere, capped };
      });
      if (!res.r.ok) {
        lastConflict = res.r.conflict;
        continue;
      }
      const head = await store.head();
      const warnings = [];
      if (res.r.commitError) warnings.push(`Files were written but not committed: ${res.r.commitError}`);
      else if (res.r.ignored?.length) warnings.push(`Not committed (gitignored, decision D5): ${res.r.ignored.map((p) => p.split('/').pop()).join(', ')}.`);
      if (res.duplicates.length) warnings.push(`Duplicate track numbers: ${res.duplicates.map((d) => `${d.number} (${d.folders.length} folders)`).join(', ')}. Ask the person, then run the repair-duplicates command; it renames the newer folder.`);
      if (res.elsewhere) warnings.push(res.elsewhere);
      if (res.capped) warnings.push(`Track numbers: checked the ${REF_TIP_CAP} newest branch tips only; a number used on an older branch may be handed out again.`);
      const { similar, strong } = res.similar;
      if (strong) warnings.push(`Similar track${similar.length > 1 ? 's' : ''} already exist${similar.length > 1 ? '' : 's'}: ${similar.map((x) => `${x.id} (${x.lane})`).join(', ')}. If this duplicates one, ask the person "Update track N? [default: yes]" and move the content there.`);
      return {
        data: {
          track: trackIdentity(res.t.folder, res.t.files.index),
          similar_tracks: similar,
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
        summary: `Created track ${res.t.id} (${res.t.folder}) in lane ${res.lane}.`,
      };
    }
    throw fail('NUMBER_COLLISION', 'Could not allocate a free track number after 3 attempts', { details: lastConflict, hint: 'Another session is creating tracks at the same time; retry.' });
  },
};
