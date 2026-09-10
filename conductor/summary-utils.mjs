// conductor/summary-utils.mjs
// Pure **Summary**-parsing helpers used by both syncTrack (FS→DB push) and
// index.md's own read side. Extracted from laneconductor.sync.mjs (which
// runs side effects — chokidar watchers, setIntervals — at import time, so
// isn't safe to import directly just to unit test a pure function; same
// reason conductor/sync-timestamp-utils.mjs exists).
//
// Track 1081, Mechanism 2: parseSummaryMarker()/parseSummary() used to
// truncate their return value to 200 chars via truncateSummary() before it
// was pushed to the DB as content_summary. content_summary is an unbounded
// Postgres TEXT column, and the only place it's rendered
// (ui/src/components/TrackCard.jsx) already visually clips it with CSS
// (line-clamp-3) — the truncation was never load-bearing. Worse, it was
// actively destructive: the next DB→FS pull cycle found the DB's (now
// truncated) content_summary "newer" than the file — deterministically,
// within ~10-15s, with zero concurrent editing required — and wrote it back
// into the file's **Summary** marker, permanently discarding everything
// past 200 characters. Fix: these two functions no longer truncate.
// truncateSummary() itself is unchanged and still used directly by
// laneconductor.sync.mjs's parseCurrentPhaseMarker for **Phase** (track
// 1114's own, unrelated, intentional bound on that field).

// Truncate at a word boundary and mark truncation with an ellipsis, instead of
// a hard mid-word `.slice(n)` cut that reads as corrupted/cut-off text.
export function truncateSummary(text, maxLen = 200) {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

export function parseSummaryMarker(content) {
  const m = content.match(/\*\*Summary\*\*:[ \t]*([^\n]*)/i);
  if (!m) return null;
  const value = m[1].trim();
  return value ? value : null; // an empty marker isn't a real value — let the caller fall back
}

export function parseSummary(content) {
  const marker = parseSummaryMarker(content);
  if (marker !== null) return marker;

  // Fallback: no explicit Summary marker — derive one from a **Problem**: line.
  // Problem text is often a wrapped, multi-line paragraph (e.g. under a phase
  // heading in plan.md), so capture until a blank line, the next **marker**,
  // a heading, or end of string — not just up to the first '\n' — and collapse
  // the captured whitespace/newlines before truncating.
  const match = content.match(/\*\*Problem\*\*:\s*([\s\S]+?)(?=\n\s*\n|\n\*\*|\n#|$)/i);
  return match ? match[1].replace(/\s+/g, ' ').trim() : null;
}
