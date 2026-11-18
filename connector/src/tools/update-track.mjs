import { z } from 'zod';
import { blobSha } from '../blob.mjs';
import { fail } from '../errors.mjs';
import { STATUSES, markerFingerprint, parseMarkers, removeMarker, setMarker, validateIndex } from '../markers.mjs';
import { resolveTrack } from '../tracks.mjs';
import { nearestLane, suggestFor } from '../vocabulary.mjs';
import { FILE_NAMES, WRITABLE_FILES, baseMarkers, projectField, readWorkflow, resolveOutcome, summaryChange, trackField, trackIdentity, trackPath, TRACKS_DIR, workflowLanes } from './common.mjs';

const MAX_FILE_CHARS = 200_000;

const baseSchema = z.object({
  commit: z.string(),
  files: z.record(z.string(), z.string().nullable()),
  markers: z.record(z.string(), z.string()),
}).describe('Verbatim `base` from get_track or create_track (or the previous update_track).');

const input = z.object({
  project: projectField,
  track: trackField,
  base: baseSchema,
  files: z.object({
    index: z.string().optional(), spec: z.string().optional(), plan: z.string().optional(), test: z.string().optional(),
    conversation: z.string().optional().describe('Not writable here; use append_conversation.'),
  }).optional().describe('Whole-file replacements (index, spec, plan, test).'),
  markers: z.record(z.string(), z.string().nullable()).optional().describe('Set (string) or remove (null) individual **Name**: value lines in index.md, e.g. {"Lane Status": "success", "Progress": "40%"}. Cannot be combined with files.index.'),
  summary: z.string().optional().describe('Shorthand for setting the **Summary** marker.'),
  outcome: z.enum(['success', 'failure']).optional().describe('Finished lane action: apply the workflow move (valid.next).'),
});

export const updateTrack = {
  name: 'update_track',
  title: 'Update a track',
  description: 'Replace track files (index, spec, plan, test) and/or set status markers in index.md, committing the change. Requires the `base` from your last read of the track: a stale file or marker is rejected with CONFLICT (re-read, merge, retry), never overwritten. Bundle status markers with the document edit in one call. Finished a lane action? Pass `outcome`.\nExample: "move 10106 to implement" -> update_track {track: 10106, base, markers: {Lane: "implement"}}',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  input,
  async run({ store, ctx, args }) {
    const { base } = args;
    const files = args.files ?? {};
    let markerEdits = { ...(args.markers ?? {}) };
    if (args.outcome !== undefined) {
      if ('Lane' in markerEdits || 'Lane Status' in markerEdits) throw fail('VALIDATION_FAILED', 'outcome cannot be combined with the Lane or Lane Status markers', { hint: 'Either pass `outcome` (the workflow decides the lane and status; see `valid.next`) or set Lane and Lane Status yourself in markers, not both. Other markers, such as Progress, can ride along with outcome.' });
      if (args.files?.index !== undefined) throw fail('VALIDATION_FAILED', 'outcome cannot be combined with files.index', { hint: 'Replace index.md whole, or pass `outcome` and individual markers.' });
    }
    if (args.summary !== undefined) {
      if ('Summary' in markerEdits) throw fail('VALIDATION_FAILED', 'Give the summary either as `summary` or as markers.Summary, not both');
      markerEdits['Summary'] = args.summary;
    }
    if ('Verdict' in markerEdits && markerEdits['Verdict'] !== null) {
      // Track AM-10137: the daemon only ever read `pass` or `fail`; anything else is an unroutable verdict, so it is refused on write.
      const v = String(markerEdits['Verdict']).trim().toLowerCase();
      if (v !== 'pass' && v !== 'fail') throw fail('VALIDATION_FAILED', `Verdict must be pass or fail (got ${JSON.stringify(markerEdits['Verdict'])})`, { hint: 'Set Verdict to pass or fail, or to null to clear it. Put findings in conversation.md.' });
      markerEdits['Verdict'] = v;
    }
    if (files.conversation !== undefined) throw fail('VALIDATION_FAILED', 'conversation.md cannot be replaced', { hint: 'Use append_conversation; it is append-only and formats the entry for you.' });
    const fileNames = WRITABLE_FILES.filter((n) => files[n] !== undefined);
    let markerNames = Object.keys(markerEdits);
    if (fileNames.length === 0 && markerNames.length === 0 && args.outcome === undefined) throw fail('VALIDATION_FAILED', 'Nothing to update', { hint: 'Pass files and/or markers.' });
    if (files.index !== undefined && markerNames.length) throw fail('VALIDATION_FAILED', 'files.index and markers cannot be combined', { hint: 'Either replace index.md whole, or set individual markers.' });
    for (const n of fileNames) if (files[n].length > MAX_FILE_CHARS) throw fail('VALIDATION_FAILED', `${n}.md is ${files[n].length} characters; the limit is ${MAX_FILE_CHARS}`);

    const res = await store.transaction(async (tx) => {
      const dirs = (await tx.listDir(TRACKS_DIR)).filter((e) => e.type === 'dir').map((e) => e.name);
      const folder = resolveTrack(dirs, args.track);
      if (!(await tx.isAncestor(base.commit))) {
        throw fail('UNKNOWN_BASE', `base.commit ${base.commit} is not the current head or one of its ancestors`, { hint: 'Re-read the track with get_track and use the `base` it returns. If the repository was rewound or switched branch, say so to the user.' });
      }
      const cur = await tx.readFiles(FILE_NAMES.map((n) => trackPath(folder, n)));
      const curOf = (n) => cur.get(trackPath(folder, n));
      // REQ-4 (ii): files being replaced
      for (const n of fileNames) {
        if (!(n in base.files)) throw fail('BASE_MISSING_FILE', `${n}.md is not in base.files`, { details: { file: n }, hint: `Read it with get_track (files ["${n}"]) first; a file that was not read, or came back truncated, cannot be overwritten.` });
      }
      const conflicts = [];
      for (const n of fileNames) {
        const f = curOf(n);
        const current = f ? f.sha : null;
        if (current !== base.files[n]) conflicts.push({ file: n, base: base.files[n], current });
      }
      // REQ-4 (ii): markers being set
      const indexNow = curOf('index')?.content ?? '';
      const curMarkers = baseMarkers(indexNow);
      // Track AM-10131: `outcome` resolves against the CURRENT lane; the Lane and Lane Status it sets go through the same marker
      // check as any write, so a base from before someone else moved the track is a CONFLICT, and the conflict is reported before a
      // refusal (the caller's picture of the lane is wrong, so "no move from here" may not even be true).
      let transition = null;
      let refusal = null;
      const derived = new Set(); // markers the outcome adds or clears by itself: not the caller's picture, so not a conflict
      if (args.outcome !== undefined) {
        if (!curOf('index')) throw fail('TRACK_NOT_FOUND', `${folder} has no index.md to move`);
        const wf = await readWorkflow(tx);
        const lane = parseMarkers(indexNow).values['Lane']?.trim() ?? '';
        const r = resolveOutcome(wf, lane, args.outcome);
        if (!r.ok) {
          refusal = fail('VALIDATION_FAILED', `Cannot apply outcome ${args.outcome}: ${wf ? r.message : 'conductor/workflow.json is missing or not valid JSON'}`, { details: { outcome: args.outcome, lane, valid_lanes: r.lanes }, hint: 'Set Lane and Lane Status yourself with markers, using one of the lanes of get_track `valid.lanes`.' });
        } else if (!r.next) {
          refusal = fail('VALIDATION_FAILED', `Cannot apply outcome ${args.outcome}: ${r.reason}`, { details: { outcome: args.outcome, lane: r.lane }, hint: `The workflow defines no automatic move out of ${r.lane} on ${args.outcome}. If a move is intended, set Lane and Lane Status yourself with markers (a deliberate skip is worth a line in the conversation).` });
        } else {
          transition = { outcome: args.outcome, from: r.lane, to: `${r.next.lane}:${r.next.status}` };
          markerEdits = { ...markerEdits, Lane: r.next.lane, 'Lane Status': r.next.status };
          // Track AM-10137: the review and quality-gate lanes produce a verdict, and the outcome IS that verdict (an explicit Verdict wins).
          if (nearestLane(r.lane, ['review', 'quality-gate']) && !('Verdict' in markerEdits)) {
            markerEdits['Verdict'] = args.outcome === 'success' ? 'pass' : 'fail';
            transition.verdict = markerEdits['Verdict'];
            derived.add('Verdict');
          }
          // Resuming a parked track: the parking markers only mean something while Lane Status is waiting.
          if (r.next.status !== 'waiting') {
            const parked = ['Waiting Reason', 'Waiting On Tracks'].filter((n) => n in curMarkers && !(n in markerEdits));
            for (const n of parked) { markerEdits[n] = null; derived.add(n); }
            if (parked.length) transition.cleared = parked;
          }
          markerNames = Object.keys(markerEdits);
        }
        if (refusal) markerNames = [...new Set([...markerNames, 'Lane', 'Lane Status'])];
      }
      for (const name of markerNames) {
        if (derived.has(name)) continue;
        const b = base.markers[name];
        const c = curMarkers[name];
        if (b !== c) conflicts.push({ marker: name, base: b ?? null, current: c ?? null });
      }
      if (conflicts.length) {
        throw fail('CONFLICT', `${conflicts.length} item${conflicts.length === 1 ? '' : 's'} changed since your base: ${conflicts.map((c) => c.file ?? `marker ${c.marker}`).join(', ')}`, {
          details: conflicts,
          hint: 'Someone else edited first. Re-read with get_track, merge their change with yours, and retry with the new base. The earlier edit is untouched.',
        });
      }
      if (refusal) throw refusal;
      // compose
      const next = {};
      for (const n of fileNames) next[n] = files[n];
      if (markerNames.length) {
        if (!curOf('index')) throw fail('TRACK_NOT_FOUND', `${folder} has no index.md to set markers in`);
        let idx = indexNow;
        for (const name of markerNames) idx = markerEdits[name] === null ? removeMarker(idx, name) : setMarker(idx, name, markerEdits[name]);
        next.index = idx;
      }
      if (next.index !== undefined) {
        const lanes = await workflowLanes(tx);
        const problems = validateIndex(next.index, lanes);
        if (problems.length) {
          // Name the nearest valid lane or status (otralingo: `implement` or `in_progress` against lanes planning, in-progress ...).
          const suggestions = suggestFor(parseMarkers(next.index).values, lanes);
          const said = Object.entries(suggestions).map(([k, v]) => `${k}: did you mean "${v}"?`);
          throw fail('VALIDATION_FAILED', `index.md would be invalid: ${problems.join('; ')}${said.length ? `. ${said.join(' ')}` : ''}`, {
            details: { valid_lanes: [...new Set([...lanes, 'backlog'])], valid_statuses: STATUSES, ...(said.length ? { suggestions } : {}) },
            hint: `Lane must be one of this project's lanes (${[...new Set([...lanes, 'backlog'])].join(', ')}); Lane Status one of ${STATUSES.join(', ')}.${said.length ? ` Suggested: ${Object.entries(suggestions).map(([k, v]) => `${k} = ${v}`).join(', ')}.` : ''}`,
          });
        }
      }
      const changed = Object.keys(next).filter((n) => next[n] !== (curOf(n)?.content ?? null));
      const number = trackIdentity(folder, indexNow).number;
      if (changed.length === 0) return { folder, changed, number, noop: true, curOf, next, transition, indexShaBefore: curOf('index')?.sha ?? null };
      const changes = changed.map((n) => ({ path: trackPath(folder, n), content: next[n] }));
      const sum = await summaryChange(tx, ctx.now(), new Map(changed.includes('index') ? [[folder, next.index]] : []));
      if (sum) changes.push(sum);
      const names = changes.map((c) => c.path.split('/').pop()).join(' ');
      const message = `chore(track-${number}): update_track ${names} via lc-connector\n\nBase: ${base.commit}${transition ? `\nOutcome: ${transition.outcome} (${transition.from} -> ${transition.to})` : ''}\nSurface: ${ctx.surface()}`;
      const r = await tx.commitFiles({
        preconditions: changed.map((n) => ({ path: trackPath(folder, n), sha: curOf(n)?.sha ?? null })),
        changes,
        message,
      });
      if (!r.ok) {
        throw fail('CONFLICT', 'A file changed outside the connector while writing', {
          details: r.conflict.map((c) => ({ file: c.path.split('/').pop().replace(/\.md$/, ''), base: c.expected, current: c.actual })),
          hint: 'Re-read with get_track and retry.',
        });
      }
      return { folder, changed, number, r, message, next, curOf, transition, summaryWritten: Boolean(sum), indexShaBefore: curOf('index')?.sha ?? null };
    });

    const head = await store.head();
    // New base: unchanged entries keep what the caller saw; written entries get their new content.
    const newBase = { commit: res.r?.commit ?? head.commit ?? base.commit, files: { ...base.files }, markers: { ...base.markers } };
    for (const n of res.changed) {
      if (n === 'index' && !fileNames.includes('index')) {
        // Marker-only edit: the whole-file base advances only if the caller had seen the file as it was.
        if (base.files.index !== undefined && base.files.index === res.indexShaBefore) newBase.files.index = blobSha(res.next.index);
        else delete newBase.files.index;
      } else {
        newBase.files[n] = blobSha(res.next[n]);
      }
    }
    if (res.changed.includes('index')) {
      if (fileNames.includes('index')) newBase.markers = baseMarkers(res.next.index);
      else {
        for (const name of markerNames) {
          if (markerEdits[name] === null) delete newBase.markers[name];
          else newBase.markers[name] = markerFingerprint(parseMarkers(res.next.index).values[name]);
        }
      }
    }
    const warnings = [];
    if (res.noop) warnings.push('Nothing changed: the new content equals the current content, so no commit was made.');
    if (res.r?.commitError) warnings.push(`Written to disk but NOT committed: ${res.r.commitError}`);
    return {
      data: {
        written: res.changed.map((n) => trackPath(res.folder, n)),
        commit: res.r?.commit ? { sha: res.r.commit, message: res.message.split('\n')[0] } : null,
        ...(res.transition ? { transition: res.transition } : {}),
        ...(res.summaryWritten ? { summary_regenerated: true } : {}),
        ...(res.r?.commitError ? { commit_error: res.r.commitError } : {}),
        base: newBase,
      },
      warnings,
      summary: res.noop ? `No change to ${res.folder}.` : `Updated ${res.changed.map((n) => `${n}.md`).join(', ')} in ${res.folder}.`,
    };
  },
};
