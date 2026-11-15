// Helpers shared by the tool handlers. Everything here talks to a StateStore, never to the
// filesystem or git directly, so the same handlers run over LocalGitStore and (Phase 7) GitHubStore.
import { z } from 'zod';
import { blobSha } from '../blob.mjs';
import { countUnparsedLines, parseEntries } from '../conversation.mjs';
import { fail } from '../errors.mjs';
import { markerFingerprint, parseMarkers, trackTitle } from '../markers.mjs';
import { isTrackFolder, resolveTrack } from '../tracks.mjs';

export const TRACKS_DIR = 'conductor/tracks';
export const FILE_NAMES = ['index', 'spec', 'plan', 'test', 'conversation'];
export const WRITABLE_FILES = ['index', 'spec', 'plan', 'test'];
export const trackPath = (folder, name) => `${TRACKS_DIR}/${folder}/${name}.md`;

export const projectField = z.string().optional().describe('Repository to use; defaults to the server\'s configured repo.');
export const trackField = z.union([z.string(), z.number()]).transform(String).describe('Track number, e.g. 10106 or AM-10106.');

export const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export async function trackDirNames(store) {
  const entries = await store.listDir(TRACKS_DIR);
  return entries.filter((e) => e.type === 'dir' && isTrackFolder(e.name)).map((e) => e.name);
}

export async function resolveTrackFolder(store, ref) {
  return resolveTrack(await trackDirNames(store), ref);
}

export async function workflowLanes(store) {
  const m = await store.readFiles(['conductor/workflow.json']);
  const f = m.get('conductor/workflow.json');
  const fallback = ['plan', 'implement', 'review', 'quality-gate', 'done'];
  if (!f) return fallback;
  try {
    const lanes = Object.keys(JSON.parse(f.content).lanes ?? {});
    return lanes.length ? lanes : fallback;
  } catch {
    return fallback;
  }
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

export function trackIdentity(folder, indexContent) {
  const m = folder.match(/^(?:([A-Za-z]+)-)?(\d+)-/);
  const number = Number(m[2]);
  return { number, id: m[1] ? `${m[1]}-${number}` : String(number), folder, title: (indexContent && trackTitle(indexContent)) || folder };
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

export const sizeOf = (v) => JSON.stringify(v).length;
export { blobSha, fail };
