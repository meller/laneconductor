// conductor/services/track-doc-digest.mjs
// Track AM-10090: a resumed lane-action session (FRESH_SESSION: false) skips
// re-reading a track's authored documents entirely (spawnCli's context-
// injection gate — see conductor/laneconductor.sync.mjs's isFresh check).
// The only compensating signal, extractUnansweredHumanTail() (track 10020),
// is empty whenever a human's message has already been answered by a
// DIFFERENT session — which is exactly what happened live on track AM-1020:
// a stale session was re-dispatched after a fresh planning pass had already
// rewritten spec.md/plan.md and answered the human, and it clobbered both
// files back to its own pre-respec conclusion, repeatedly, with no signal
// anywhere that its cached understanding no longer matched disk.
//
// This module gives resolveTrackSession() (laneconductor.sync.mjs) a way to
// detect that mismatch: a stable digest of the track's authored documents,
// computed identically at capture time (end of a run) and compare time
// (start of the next resume decision). A mismatch means someone other than
// this session's own last run rewrote the track's documents, and the caller
// should cold-start instead of resuming.
//
// Pure module, no I/O — mirrors this codebase's other extraction style
// (session-cap.mjs, workspace-mode.mjs, lane-regression-guard.mjs).
//
// REQ-3 is the load-bearing design decision in this file: STABLE_INDEX_MARKERS
// is an ALLOWLIST, not a blocklist. The worker patches **Lane**, **Lane
// Status**, **Progress**, **Phase**, **Last Run**, **Waiting for reply**, and
// **PR/KPI *** markers on nearly every run — plan, implement, review,
// quality-gate, and the various reconcilers all write these between a
// session's turns. If any of those were included in the digest, EVERY
// resumed session would appear to have drifted on its very next dispatch,
// silently deleting the entire benefit of track 1086's persistent sessions.
// A future maintainer "helpfully" adding **Lane** to this list would
// reintroduce exactly that regression — don't.

import { createHash } from 'node:crypto';

// Only markers that represent a HUMAN or PLANNING decision about the track,
// never ones the worker itself patches as part of routine lane bookkeeping.
// Sorted here in the fixed order digest computation uses (REQ-2).
export const STABLE_INDEX_MARKERS = [
  'Summary',
  'Type',
  'Auto Run',
  'Merge Mode',
  'Workspace',
  'Track Kind',
  'Model',
];

// A distinct sentinel for "file does not exist at all", so a missing file
// never hashes the same as a present-but-empty one (REQ-5, TC-8).
const ABSENT_SENTINEL = '\0absent';

/**
 * Normalise document content before hashing so cosmetic differences never
 * force a false-positive drift detection (REQ-5):
 *   - CRLF -> LF
 *   - strip trailing whitespace on each line
 *   - strip trailing blank lines
 *
 * @param {string|null|undefined} content
 * @returns {string} normalised content, or '' for null/undefined
 */
export function normaliseForDigest(content) {
  if (content === null || content === undefined) return '';
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

/**
 * Extract only the allowlisted STABLE_INDEX_MARKERS lines from index.md
 * content, in a fixed (not source) order, so reordering markers by hand is
 * never itself a drift signal.
 *
 * @param {string|null|undefined} indexMd
 * @returns {string} one `**Marker**: value` line per present stable marker,
 *   newline-joined; markers absent from the file simply don't contribute
 */
export function extractStableIndexMarkers(indexMd) {
  if (!indexMd) return '';
  const lines = [];
  for (const marker of STABLE_INDEX_MARKERS) {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = indexMd.match(new RegExp(`^\\*\\*${escaped}\\*\\*:\\s*(.*)$`, 'm'));
    if (match) {
      lines.push(`**${marker}**: ${match[1].trim()}`);
    }
  }
  return lines.join('\n');
}

/**
 * Compute a stable SHA-256 digest over a track's authored documents: the
 * REQ-2 stable subset of index.md, plus the full content of spec.md,
 * plan.md, and test.md. conversation.md is deliberately excluded (REQ-4) —
 * it's append-only from multiple writers between runs, and genuinely new
 * human input there is already handled by extractUnansweredHumanTail().
 *
 * @param {object} docs
 * @param {string|null} [docs.indexMd]
 * @param {string|null} [docs.specMd]
 * @param {string|null} [docs.planMd]
 * @param {string|null} [docs.testMd]
 * @returns {string} hex-encoded SHA-256 digest
 */
export function computeTrackDocDigest({ indexMd = null, specMd = null, planMd = null, testMd = null } = {}) {
  const hash = createHash('sha256');
  // Each section labelled and separated so e.g. an empty spec.md can never
  // collide with a differently-empty plan.md, and a missing file's
  // ABSENT_SENTINEL can never collide with real content that happens to
  // contain the same bytes.
  const sections = [
    ['index', indexMd === null || indexMd === undefined ? ABSENT_SENTINEL : normaliseForDigest(extractStableIndexMarkers(indexMd))],
    ['spec', specMd === null || specMd === undefined ? ABSENT_SENTINEL : normaliseForDigest(specMd)],
    ['plan', planMd === null || planMd === undefined ? ABSENT_SENTINEL : normaliseForDigest(planMd)],
    ['test', testMd === null || testMd === undefined ? ABSENT_SENTINEL : normaliseForDigest(testMd)],
  ];
  for (const [label, content] of sections) {
    hash.update(`\0${label}\0${content}`);
  }
  return hash.digest('hex');
}

/**
 * Decide whether a resumed session's stored digest has drifted from the
 * track's current documents. A null/absent storedDigest ALWAYS means "no
 * drift" (REQ-10) — it means either this is the first run ever to compute a
 * digest, or the row predates this feature. Treating unknown as a mismatch
 * would cold-start every existing session on upgrade, which is exactly the
 * kind of regression REQ-3's allowlist exists to avoid elsewhere in this
 * file.
 *
 * @param {object} opts
 * @param {string|null|undefined} opts.storedDigest
 * @param {string|null|undefined} opts.currentDigest
 * @returns {{drift: boolean, reason: 'doc-drift'|null}}
 */
export function hasTrackDocDrift({ storedDigest, currentDigest }) {
  if (!storedDigest) return { drift: false, reason: null };
  if (!currentDigest) return { drift: false, reason: null };
  if (storedDigest === currentDigest) return { drift: false, reason: null };
  return { drift: true, reason: 'doc-drift' };
}
