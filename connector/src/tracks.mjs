// Track folder naming, resolution, numbering and file templates. Pure: operates on directory-name
// lists, so it works for both backends. Resolution goes through the repo's own decideTrackFolder
// (conductor/services/track-folder.mjs) so both naming conventions behave exactly as elsewhere.
import { decideTrackFolder } from '../../conductor/services/track-folder.mjs';
import { fail } from './errors.mjs';
import { parseMarkers, trackTitle } from './markers.mjs';

const FOLDER_RE = /^(?:[A-Za-z]+-)?(\d+)-/;
const FOLDER_RE_FULL = /^(?:([A-Za-z]+)-)?(\d+)-/;

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

/** `{ number, id, folder, title }` from a folder name and (optionally) its index.md text. */
export function trackIdentity(folder, indexContent) {
  const m = folder.match(FOLDER_RE_FULL);
  const number = Number(m[2]);
  return { number, id: m[1] ? `${m[1]}-${number}` : String(number), folder, title: (indexContent && trackTitle(indexContent)) || folder };
}

export function nextNumber(localDirs, upstreamDirs = []) {
  let max = 0;
  for (const n of [...localDirs, ...upstreamDirs]) {
    const v = trackNumberOfFolder(n);
    if (v !== null && v > max) max = v;
  }
  return max + 1;
}

/** Track numbers used by more than one folder name across the given folder lists: `[{ number, folders: [...] }]`, by number. */
export function duplicateNumbers(...lists) {
  const by = new Map();
  for (const name of lists.flat()) {
    const n = trackNumberOfFolder(name);
    if (n === null) continue;
    if (!by.has(n)) by.set(n, new Set());
    by.get(n).add(name);
  }
  return [...by].filter(([, f]) => f.size > 1).map(([number, f]) => ({ number, folders: [...f].sort() })).sort((a, b) => a.number - b.number);
}

// Track AM-10143 (owner rule: search first, the default is update, not create). Pure word overlap between a new request and the existing
// tracks; it only informs the caller, it never blocks a create.
const STOP = new Set('the and for with from that this into when then than not are was were has have had its but can does did out all any one new add use using make made via per also over under only about after before more less should would could will let get got our your their they them you who why how what which where while each every some such just like'.split(' '));
const stem = (w) => (w.length > 5 ? w.replace(/(ing|ed|es)$/, '') : w).replace(/(?<=\w{3})s$/, '');
export const wordsOf = (text) => new Set(String(text ?? '').toLowerCase().normalize('NFKD').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem));

/**
 * Up to `limit` existing tracks (any lane) that share words with a new request, best first. `rows` come from rowOf (number, id, title,
 * lane, lane_status, summary). A title word counts double. `strong` is true when most title words, or enough of them, are shared.
 */
export function similarTracks(rows, { title, problem }, limit = 5) {
  const t = wordsOf(title);
  const p = new Set([...wordsOf(String(problem ?? '').slice(0, 400))].filter((w) => !t.has(w)));
  if (!t.size) return { similar: [], strong: false };
  const scored = [];
  for (const r of rows) {
    if (r.source === null || r.lane === null) continue;
    const words = wordsOf(`${r.title} ${r.summary}`);
    const st = [...t].filter((w) => words.has(w)).length;
    const sp = [...p].filter((w) => words.has(w)).length;
    const score = st * 2 + sp;
    if (st < 1 || st + sp < 2) continue;
    scored.push({ r, score, ratio: st / t.size, st });
  }
  scored.sort((a, b) => b.score - a.score || b.r.number - a.r.number);
  const top = scored.slice(0, limit);
  return {
    similar: top.map(({ r }) => ({ number: r.number, id: r.id, title: r.title, lane: r.lane, lane_status: r.lane_status })),
    strong: top.some((x) => x.st >= 2 && x.ratio >= 0.5),
  };
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

// Spec forms per track_kind (track 10116). The skill's setup/templates.md and ops/tracks.md describe
// the same sections so a hand-made track matches. No kind keeps the generic skeleton.
export const FORM_SECTIONS = {
  bug: ['Symptom', 'Steps to reproduce', 'Expected result', 'Actual result', 'Suspected area', 'Environment'],
  feature: ['The need', 'Who it is for', 'Wanted outcome', 'Acceptance criteria', 'Out of scope'],
};

function specText(title, problem, trackKind) {
  const sections = FORM_SECTIONS[trackKind];
  if (!sections) return `# Spec: ${title}\n\n## Problem Statement\n\n${problem}\n\n## Requirements\n\n(To be written in the plan lane.)\n`;
  return `# Spec: ${title}\n\n## Problem Statement\n\n${problem}\n\n${sections.map((h) => `## ${h}\n\n(To be filled in.)\n`).join('\n')}`;
}

function testText(number, title, trackKind) {
  const head = `# Tests: Track ${number} - ${title}\n\n`;
  if (trackKind !== 'bug') return `${head}(Test cases to be added)\n`;
  return `${head}- [ ] TC-1 (regression): a test that reproduces the bug (the steps in "Steps to reproduce") and FAILS before the fix; it passes after the fix and stays in the suite\n\n(More test cases to be added)\n`;
}

export function buildTrackFiles({ number, initials, title, problem, type = 'dev', trackKind, autoRun = 'no', mergeMode = 'direct', dependsOn, lane = 'plan' }) {
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
    `**Lane**: ${lane}`,
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
  if (back['Lane'] !== lane || back['Summary'] !== summary) throw fail('VALIDATION_FAILED', 'Could not build a valid index.md from the given title and problem');
  const files = {
    index: header,
    spec: specText(title.trim(), problem.trim(), trackKind),
    plan: `# Track ${number}: ${title.trim()}\n\n(Plan to be written in the plan lane.)\n`,
    test: testText(number, title.trim(), trackKind),
    conversation: `# Conversation: Track ${id}\n\n`,
  };
  return { id, folder, files };
}
