// Track folder naming, resolution, numbering and file templates. Pure: operates on directory-name
// lists, so it works for both backends. Resolution goes through the repo's own decideTrackFolder
// (conductor/services/track-folder.mjs) so both naming conventions behave exactly as elsewhere.
import { decideTrackFolder } from '../../conductor/services/track-folder.mjs';
import { fail } from './errors.mjs';
import { parseMarkers } from './markers.mjs';

const FOLDER_RE = /^(?:[A-Za-z]+-)?(\d+)-/;

export const isTrackFolder = (name) => FOLDER_RE.test(name);

export function trackNumberOfFolder(name) {
  const m = name.match(FOLDER_RE);
  return m ? Number(m[1]) : null;
}

/** `10106`, `AM-10106` (any case) or a full folder name -> { number }. */
export function parseTrackRef(ref) {
  const m = String(ref ?? '').trim().match(/^(?:[A-Za-z]+-)?(\d+)(?:-.*)?$/);
  if (!m) throw fail('VALIDATION_FAILED', `Not a track reference: ${JSON.stringify(ref)}`, { hint: 'Use the track number, e.g. 10106 or AM-10106.' });
  return { number: Number(m[1]) };
}

export function resolveTrack(dirNames, ref) {
  const { number } = parseTrackRef(ref);
  const matches = dirNames.filter((n) => isTrackFolder(n) && trackNumberOfFolder(n) === number);
  if (matches.length === 0) throw fail('TRACK_NOT_FOUND', `No track folder for number ${number}`, { hint: 'Call list_tracks to see the tracks that exist.' });
  if (matches.length > 1) {
    throw fail('AMBIGUOUS_TRACK', `Track number ${number} has ${matches.length} folders: ${matches.sort().join(', ')}`, {
      details: { folders: matches.sort() },
      hint: 'Ask the human which folder is canonical; do not guess.',
    });
  }
  const decision = decideTrackFolder({ dirNames: matches, trackNumber: String(number), registeredFolder: null, registeredExists: false });
  return decision.folder ?? matches[0];
}

export function nextNumber(localDirs, upstreamDirs = []) {
  let max = 0;
  for (const n of [...localDirs, ...upstreamDirs]) {
    const v = trackNumberOfFolder(n);
    if (v !== null && v > max) max = v;
  }
  return max + 1;
}

export function slugify(title) {
  const s = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return s || 'track';
}

export function defaultInitials(dirNames, requested) {
  if (requested) return requested.toUpperCase();
  const counts = new Map();
  for (const n of dirNames) {
    const m = n.match(/^([A-Za-z]+)-\d+-/);
    if (m) counts.set(m[1].toUpperCase(), (counts.get(m[1].toUpperCase()) ?? 0) + 1);
  }
  let best = null;
  for (const [k, v] of counts) if (!best || v > best[1]) best = [k, v];
  return best ? best[0] : 'XX';
}

const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

export function buildTrackFiles({ number, initials, title, problem, type = 'dev', trackKind, autoRun = 'no', mergeMode = 'direct', dependsOn }) {
  if (typeof title !== 'string' || title.trim() === '' || title.length > 120 || /[\r\n]/.test(title)) {
    throw fail('VALIDATION_FAILED', 'title must be a single line of 1 to 120 characters');
  }
  if (typeof problem !== 'string' || problem.trim() === '') throw fail('VALIDATION_FAILED', 'problem is required');
  const bad = problem.split('\n').find((l) => /^## /.test(l) || /^\*\*[A-Za-z][A-Za-z0-9 ]{0,39}\*\*: ?/.test(l));
  if (bad !== undefined) {
    throw fail('VALIDATION_FAILED', `problem contains a line that would be read as structure: ${JSON.stringify(bad.slice(0, 60))}`, {
      hint: 'Avoid lines starting with "## " or "**Name**:" in the problem text (they would break index.md markers). Rephrase them.',
    });
  }
  const id = `${initials}-${number}`;
  const folder = `${id}-${slugify(title)}`;
  const summary = oneLine(problem).slice(0, 200);
  const header = [
    `# Track ${id}: ${title.trim()}`,
    '',
    '**Lane**: plan',
    '**Lane Status**: queue',
    '**Progress**: 0%',
    '**Phase**: New',
    ...(trackKind ? [`**Track Kind**: ${trackKind}`] : []),
    `**Type**: ${type}`,
    `**Merge Mode**: ${mergeMode}`,
    `**Auto Run**: ${autoRun}`,
    `**Author**: ${initials}`,
    ...(dependsOn && dependsOn.length ? [`**Depends On**: ${dependsOn.join(', ')}`] : []),
    `**Problem**: ${problem.trim()}`,
    `**Summary**: ${summary}`,
    '',
  ].join('\n');
  // Sanity: the header we built must read back with the markers we meant to write.
  const back = parseMarkers(header).values;
  if (back['Lane'] !== 'plan' || back['Summary'] !== summary) throw fail('VALIDATION_FAILED', 'Could not build a valid index.md from the given title and problem');
  const files = {
    index: header,
    spec: `# Spec: ${title.trim()}\n\n## Problem Statement\n\n${problem.trim()}\n\n## Requirements\n\n(To be written in the plan lane.)\n`,
    plan: `# Track ${number}: ${title.trim()}\n\n(Plan to be written in the plan lane.)\n`,
    test: `# Tests: Track ${number} - ${title.trim()}\n\n(Test cases to be added)\n`,
    conversation: `# Conversation: Track ${id}\n\n`,
  };
  return { id, folder, files };
}
