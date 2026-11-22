// Track AM-10115 Phase 0: the board manifest and the partial-publish plan.
// The board script writes `manifest.json` into the site it generates: a content hash for the page and for each data file. Claude publishes
// the manifest with the board, and on the next refresh reads it back from the live artifact and passes it to `lc-board.mjs --previous`,
// which then names only the files that changed (the Artifact tool keeps files an update leaves out, and `null` removes one).
// Pure functions: no I/O except the hash, so the diff is testable without a repository.
import crypto from 'node:crypto';

export const MANIFEST_FILE = 'manifest.json';
// A tiny index the open page polls (about 60 bytes: the board's generated time). Written with every board, always published, never hashed.
export const VERSION_FILE = 'version.json';
export const MANIFEST_VERSION = 1;
// The only paths a board site can hold. A manifest that names anything else is not ours (it is read back from a place others may edit).
const SITE_PATH = /^(board\.json|docs\/\d+\.json|docs-done\/\d+\.json|ctx\/[a-z-]+\.json)$/;
const SHA = /^[0-9a-f]{64}$/;

/** sha256 (hex) over the exact bytes. */
export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** True when a written docs/ctx file carries a privacy-scan withheld marker (the whole file, or a part of a multi-file tab). */
export function carriesWithheld(text) {
  try {
    const doc = JSON.parse(text);
    // A shard of finished-track documents (docs-done/<k>.json) carries a withheld marker when any document in it does.
    if (doc && doc.docs && typeof doc.docs === 'object') return Object.values(doc.docs).some((d) => Boolean(d && d.withheld));
    return Boolean(doc && (doc.withheld || (typeof doc.md === 'string' && doc.md.includes('*withheld: '))));
  } catch { return false; }
}

/**
 * The manifest of one generated site. `files` is { "<path>": Buffer|string } for every published data file (not the page, not the manifest).
 * A file that carries a withheld marker is left OUT, so it is never "unchanged": every refresh sends it again until the cause is gone.
 */
export function buildManifest({ pageBytes, files }) {
  const out = {};
  for (const p of Object.keys(files).sort()) {
    if (p !== 'board.json' && carriesWithheld(String(files[p]))) continue;
    out[p] = sha256(files[p]);
  }
  return { version: MANIFEST_VERSION, page: sha256(pageBytes), files: out };
}

/** The previous manifest from its text (as read from the live artifact), or null when it is missing, not JSON, a wrong version or malformed. */
export function parseManifest(text) {
  let m;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || typeof m !== 'object' || m.version !== MANIFEST_VERSION || typeof m.page !== 'string' || !SHA.test(m.page)) return null;
  if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files)) return null;
  for (const [p, h] of Object.entries(m.files)) if (!SITE_PATH.test(p) || typeof h !== 'string' || !SHA.test(h)) return null;
  return { version: m.version, page: m.page, files: { ...m.files } };
}

/**
 * What to publish. `current` is the new manifest, `allFiles` every data file of the site (withheld ones included, they are published
 * with a placeholder), `previous` the parsed previous manifest or null, `liveBoardSha` the hash of the board.json read from the live
 * artifact (optional: when given it must equal the previous manifest's board.json hash, else the manifest is stale and the answer is full).
 * Returns { mode, reason?, changed, removed, pageChanged, publish }; `publish` is { "<path>": "<path>" | null } plus the manifest itself.
 */
export function planPublish({ current, allFiles, previous, liveBoardSha }) {
  const sorted = [...allFiles].sort();
  const full = (reason) => ({ mode: 'full', reason, changed: sorted, removed: [], pageChanged: true, publish: publishMap(sorted, []) });
  if (!previous) return full('no-previous-manifest');
  if (liveBoardSha !== undefined && liveBoardSha !== previous.files['board.json']) return full('live-board-mismatch');
  const changed = sorted.filter((p) => current.files[p] === undefined || previous.files[p] !== current.files[p]);
  const removed = Object.keys(previous.files).filter((p) => !sorted.includes(p)).sort();
  return { mode: 'partial', changed, removed, pageChanged: previous.page !== current.page, publish: publishMap(changed, removed) };
}

function publishMap(changed, removed) {
  const publish = {};
  for (const p of changed) publish[p] = p;
  for (const p of removed) publish[p] = null;
  publish[MANIFEST_FILE] = MANIFEST_FILE;
  publish[VERSION_FILE] = VERSION_FILE;
  return publish;
}
