// Helpers shared by the tool handlers. Everything here talks to a StateStore, never to the
// filesystem or git directly, so the same handlers run over LocalGitStore and (Phase 7) GitHubStore.
import { z } from 'zod';
import { blobSha } from '../blob.mjs';
import { countUnparsedLines, parseEntries } from '../conversation.mjs';
import { fail } from '../errors.mjs';
import { LANES } from '../guides.mjs';
import { STATUSES, markerFingerprint, parseMarkers } from '../markers.mjs';
import { SUMMARY_PATH, generateSummary, summaryStamp } from '../summary.mjs';
import { isTrackFolder, resolveTrack, trackIdentity } from '../tracks.mjs';
import { guideLaneMap, nearestLane } from '../vocabulary.mjs';
import { describeNext, resolveNext } from '../../../conductor/services/workflow-transitions.mjs';

export const TRACKS_DIR = 'conductor/tracks';
export const FILE_NAMES = ['index', 'spec', 'plan', 'test', 'conversation'];
export const WRITABLE_FILES = ['index', 'spec', 'plan', 'test'];
export const trackPath = (folder, name) => `${TRACKS_DIR}/${folder}/${name}.md`;

export const projectField = z.string().optional().describe('Repo path; default: the server\'s repo.');
export const trackField = z.union([z.string(), z.number()]).transform(String).describe('Track number, e.g. 10106 or AM-10106.');

export const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export async function trackDirNames(store) {
  const entries = await store.listDir(TRACKS_DIR);
  return entries.filter((e) => e.type === 'dir' && isTrackFolder(e.name)).map((e) => e.name);
}

export async function resolveTrackFolder(store, ref) {
  return resolveTrack(await trackDirNames(store), ref);
}

const FALLBACK_LANES = ['plan', 'implement', 'review', 'quality-gate', 'done'];

/** The parsed conductor/workflow.json, or null when it is missing or not valid JSON. */
export async function readWorkflow(store) {
  const f = (await store.readFiles(['conductor/workflow.json'])).get('conductor/workflow.json');
  if (!f) return null;
  try {
    const wf = JSON.parse(f.content);
    return wf && typeof wf === 'object' ? wf : null;
  } catch {
    return null;
  }
}

export async function workflowLanes(store) {
  const lanes = Object.keys((await readWorkflow(store))?.lanes ?? {});
  return lanes.length ? lanes : FALLBACK_LANES;
}

/**
 * The ONE resolver of track AM-10131 (conductor/services/workflow-transitions.mjs) bound to this project: the project's own lane
 * names resolve through the same guide-lane mapping as `valid.guide_lanes` (track AM-10128), so `implement` finds `in-progress`.
 */
export function transitionOpts(workflow) {
  const lanes = [...new Set([...Object.keys(workflow?.lanes ?? {}), 'backlog'])];
  return { mapLane: (name) => nearestLane(name, lanes) };
}
export const resolveOutcome = (workflow, lane, outcome) => resolveNext(workflow, lane, outcome, transitionOpts(workflow));

/**
 * What a write may use here, so the first write succeeds: this project's lanes (workflow.json, plus `backlog`), the fixed statuses, and
 * which lane of this project each skill lane guide stands for (`implement` -> `in-progress` in a project that names it so). Additive
 * field `valid` of get_track and get_context. Track AM-10131 adds where a finished lane action sends the track: `next` (get_track:
 * for the track's lane, `{ success, failure }` as `lane:status`, or null for no automatic move; `next_error` says why when there is
 * none for lack of a lane) and `next_by_lane` (get_context: the same for every lane).
 */
export async function workflowVocabulary(store, { trackLane, withNext = 'none' } = {}) {
  const wf = await readWorkflow(store);
  const lanes = [...new Set([...(await workflowLanes(store)), 'backlog'])];
  const valid = { lanes, statuses: STATUSES, guide_lanes: guideLaneMap(LANES, lanes) };
  const opts = transitionOpts(wf);
  if (withNext === 'track') {
    const d = describeNext(wf, trackLane, opts);
    valid.next = d.ok ? d.next : null;
    if (d.ok) valid.next_lane = d.lane;
    else valid.next_error = wf ? d.message : 'conductor/workflow.json is missing or not valid JSON; no transitions are known';
  } else if (withNext === 'lanes') {
    valid.next_by_lane = {};
    for (const lane of lanes) {
      const d = describeNext(wf, lane, opts);
      valid.next_by_lane[lane] = d.ok ? d.next : null;
    }
  }
  return valid;
}

/** Marker values as `base.markers` carries them (long values fingerprinted). */
export function baseMarkers(indexContent) {
  const { values } = parseMarkers(indexContent);
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, markerFingerprint(v)]));
}

export function displayMarkers(indexContent) {
  const { values } = parseMarkers(indexContent);
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.length > 200 ? `${v.slice(0, 200)}…` : v]));
}

/** Reads the named files of a track and returns Map(name -> {content, sha}|null). */
export async function readTrackFiles(store, folder, names) {
  const paths = names.map((n) => trackPath(folder, n));
  const got = await store.readFiles(paths);
  return new Map(names.map((n, i) => [n, got.get(paths[i])]));
}

export function conversationSummary(content, tail) {
  const all = content ? parseEntries(content) : [];
  const entries = all.slice(-tail).map((e) => (e.body.length > 4000 ? { ...e, body: e.body.slice(0, 4000), body_truncated: true } : e));
  return { entries, total: all.length, unparsed_lines: content ? countUnparsedLines(content) : 0 };
}

/**
 * Every track folder with its index.md (`{ content, sha }` or null), in the shape the summary generator
 * takes, plus `tracked`: whether that index.md is in git at HEAD. A track that is not in git yet (an
 * unpublished draft) is `tracked: false`; stores without `trackedFiles` count every track as tracked.
 */
export async function readEntries(store) {
  const dirs = await trackDirNames(store);
  const got = await store.readFiles(dirs.map((d) => `${TRACKS_DIR}/${d}/index.md`));
  const tracked = store.trackedFiles ? await store.trackedFiles(TRACKS_DIR) : null;
  return dirs.map((folder) => ({ folder, index: got.get(`${TRACKS_DIR}/${folder}/index.md`) ?? null, tracked: tracked ? tracked.has(`${TRACKS_DIR}/${folder}/index.md`) : true }));
}

/** The entries a COMMITTED summary may list: tracked ones, plus the folders in `include` (the write's own track). */
export const publishable = (entries, include = []) => entries.filter((e) => e.tracked !== false || include.includes(e.folder));

/**
 * The summary file change to add to a track write, or null when it would not change. `pending` maps
 * folder -> the index.md text this write is about to produce. The file is regenerated, never merged,
 * so it carries no precondition (a hand edit is simply replaced). Untracked draft tracks are left out
 * unless `includeUntracked` (only the summary script's `--include-untracked`, which writes a file but commits nothing).
 */
export async function summaryChange(tx, nowMs, pending, { includeUntracked = false } = {}) {
  let entries = await readEntries(tx);
  for (const [folder, content] of pending) {
    const e = { folder, index: { content, sha: blobSha(content) }, tracked: true };
    const i = entries.findIndex((x) => x.folder === folder);
    if (i === -1) entries.push(e);
    else entries[i] = e;
  }
  // Privacy: only tracks whose index.md is in git, or is written by this very commit (pending), may appear in a committed file.
  if (!includeUntracked) entries = publishable(entries, [...pending.keys()]);
  const lanes = await workflowLanes(tx);
  const cur = (await tx.readFiles([SUMMARY_PATH])).get(SUMMARY_PATH);
  const stamp = cur ? summaryStamp(cur.content) : null;
  if (stamp && generateSummary(entries, { lanes, generatedAt: stamp }).text === cur.content) return null;
  const generatedAt = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { path: SUMMARY_PATH, content: generateSummary(entries, { lanes, generatedAt }).text };
}

export { trackIdentity };
export const sizeOf = (v) => JSON.stringify(v).length;
export { blobSha, fail };
