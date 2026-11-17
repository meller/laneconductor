// The documents behind the board's track detail (track AM-10106, Phase 5d Task 7). The pure parts:
// which tracks get a docs file, what a docs file holds (with the privacy scan applied), how the
// GitHub link for a done track is derived. Reading files and writing the site is lc-board.mjs's job.
import { scanText } from './scan.mjs';
import { resolveTrack } from './tracks.mjs';

export const MAX_DOC_CHARS = 60000;
export const MAX_DOCS = 200;
export const TRUNCATED_NOTE = '\n\n[truncated]';
/** The fields of a docs file, in order, and the file each one comes from. */
export const DOC_FIELDS = [['index', 'index.md'], ['plan', 'plan.md'], ['spec', 'spec.md'], ['test', 'test.md']];
export const CONVERSATION_FIELD = ['conversation', 'conversation.md'];

export const capText = (text) => (text.length > MAX_DOC_CHARS ? `${text.slice(0, MAX_DOC_CHARS)}${TRUNCATED_NOTE}` : text);

/**
 * Which tracks get a docs file: live, not done, not archived, and with a folder that is the one
 * folder for its number (a number shared by two live folders is flagged by the board's check and
 * gets no docs, because `docs/<number>.json` could not tell them apart). At most `max` are kept:
 * the oldest backlog tracks (lowest number) are dropped first, then the lowest-numbered of the rest.
 * @param {{ tracks: { number: number, folder: string, lane: string | null, archived?: boolean }[] }} board
 * @returns {{ keep: { number: number, folder: string }[], dropped: number }}
 */
export function selectDocTracks(board, { max = MAX_DOCS } = {}) {
  const live = board.tracks.filter((t) => !t.archived);
  const folders = live.map((t) => t.folder);
  const candidates = live.filter((t) => {
    if (t.lane === 'done') return false;
    try { return resolveTrack(folders, String(t.number)) === t.folder; } catch { return false; }
  });
  const dropOrder = [...candidates].sort((a, b) => (b.lane === 'backlog') - (a.lane === 'backlog') || a.number - b.number || a.folder.localeCompare(b.folder));
  const dropped = Math.max(0, candidates.length - max);
  const dropSet = new Set(dropOrder.slice(0, dropped).map((t) => t.folder));
  return { keep: candidates.filter((t) => !dropSet.has(t.folder)).map((t) => ({ number: t.number, folder: t.folder })), dropped };
}

const pluralMatches = (n) => `${n} match${n === 1 ? '' : 'es'}`;

/**
 * One docs file. `texts` maps field name -> file text (null/undefined when the file does not exist).
 * A file with any scan match is NOT embedded: its field is left out and `withheld[field]` says why
 * (a count, never the matched text). `conversation` is only read when `includeConversation` is true.
 * @returns {{ doc: object, withheld: { field: string, file: string, matches: number, lines: number[] }[] }}
 */
export function buildDoc({ number, folder, texts, includeConversation = false }) {
  const doc = { n: number, folder };
  const withheldDoc = {};
  const withheld = [];
  const fields = includeConversation ? [...DOC_FIELDS, CONVERSATION_FIELD] : DOC_FIELDS;
  for (const [field, file] of fields) {
    const text = texts[field];
    if (field === 'conversation' && (text === null || text === undefined)) continue; // no conversation file: no tab
    if (text === null || text === undefined || text === '') { if (field !== 'conversation') doc[field] = ''; continue; }
    const hits = scanText(text);
    if (hits.length) {
      withheldDoc[field] = `possible secret or personal data (${pluralMatches(hits.length)})`;
      withheld.push({ field, file, matches: hits.length, lines: [...new Set(hits.map((h) => h.line))].slice(0, 10) });
      continue;
    }
    doc[field] = capText(text);
  }
  if (withheld.length) doc.withheld = withheldDoc;
  return { doc, withheld };
}

/**
 * `https://github.com/<owner>/<repo>` from a git remote URL (ssh scp-style, ssh://, https, with or
 * without credentials or a .git suffix), or null when it is not a github.com remote.
 */
export function githubBase(remote) {
  const s = String(remote ?? '').trim();
  const m = /^(?:git@github\.com:|ssh:\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/|https?:\/\/(?:[^@/]+@)?github\.com\/|git:\/\/github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(s);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

/** The GitHub page of one track folder on `branch`. Folder names are path-encoded. */
export const githubFolderUrl = (base, branch, folder) => `${base}/tree/${branch.split('/').map(encodeURIComponent).join('/')}/conductor/tracks/${encodeURIComponent(folder)}`;
