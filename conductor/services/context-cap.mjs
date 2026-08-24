// conductor/services/context-cap.mjs
//
// Confirmed live (dogfooding 2026-08-24): spawnCli's contextPrompt (project
// docs + a track's own index/spec/plan/test/conversation.md, all embedded
// into a single argv element passed to spawn()) is not bounded — and on the
// host machine, spawn() throws `E2BIG` once a single argv element exceeds
// ~131072 bytes (an OS execve() limit, not a content-quality concern).
// A track's own conversation.md has no natural size bound — it grows for as
// long as the track is worked on — so it's the one file most likely to
// cross that ceiling on any sufficiently long-lived track, independent of
// anything unusual about that track's content. Extracted as its own module
// (rather than inlined into laneconductor.sync.mjs) so it's unit-testable
// directly, matching this codebase's established pattern for pure logic
// extracted out of that file.

// A byte cut that lands mid-character (common with multi-byte UTF-8 — this
// repo's own conversation.md files are full of ✅⚠️❌) decodes to a U+FFFD
// replacement character, which is itself 3 bytes and can be LONGER than the
// partial sequence it replaces — silently pushing the result back OVER the
// byte budget it was supposed to enforce (confirmed: naively slicing
// '✅⚠️❌'.repeat(5000) to 500 bytes round-trips to 501). A hand-rolled
// "back off while it's a UTF-8 continuation byte" check isn't sufficient on
// its own — it correctly skips continuation bytes, but a cut that lands
// right after a valid LEADING byte with too few of its continuation bytes
// still present passes that check while still being invalid (confirmed:
// this exact bug reproduced on emoji-with-variation-selector sequences like
// ⚠️). TextDecoder's fatal mode is the actually-correct primitive — back
// off one byte at a time (at most 3 hops for any UTF-8 sequence) until it
// decodes clean.
const strictDecoder = new TextDecoder('utf-8', { fatal: true });

// Keeps [start, end) fixed at `start`, backs `end` off (at most 3 hops for
// any UTF-8 sequence) until it decodes clean. Used for the head-truncation
// case (keepTail=false), where `start` is already a real boundary (0).
function sliceHeadAtCharBoundary(buf, start, end) {
  let e = end;
  while (e > start) {
    try { strictDecoder.decode(buf.subarray(start, e)); return buf.subarray(start, e); }
    catch { e--; }
  }
  return buf.subarray(start, start);
}

// Keeps [start, end) fixed at `end`, advances `start` off (at most 3 hops)
// until it decodes clean. Used for the tail-truncation case (keepTail=true),
// where `end` is already a real boundary (buf.length) but `start` is an
// arbitrary cut point that needs to land cleanly.
function sliceTailAtCharBoundary(buf, start, end) {
  let s = start;
  while (s < end) {
    try { strictDecoder.decode(buf.subarray(s, end)); return buf.subarray(s, end); }
    catch { s++; }
  }
  return buf.subarray(end, end);
}

/**
 * Caps a doc's content to a byte budget before it goes into spawnCli's
 * argv-embedded context prompt.
 *
 * @param content    the raw file content (or null/undefined if unread)
 * @param maxBytes   the byte budget for this doc
 * @param keepTail   when true, keeps the END of the content instead of the
 *                    start — for conversation.md, where the most recently
 *                    written activity is what matters most for continuing
 *                    work, not whatever was first ever posted to it.
 */
export function capContentForArgv(content, maxBytes, keepTail = false) {
  if (!content) return content;
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) return content;
  const note = keepTail
    ? `[…truncated — showing the most recent ~${Math.round(maxBytes / 1000)}KB only…]\n\n`
    : '';
  const suffix = keepTail ? '' : `\n\n[…truncated — showing the first ~${Math.round(maxBytes / 1000)}KB only…]`;
  const budget = maxBytes - Buffer.byteLength(note, 'utf8') - Buffer.byteLength(suffix, 'utf8');
  const buf = Buffer.from(content, 'utf8');
  const sliced = keepTail
    ? sliceTailAtCharBoundary(buf, buf.length - budget, buf.length).toString('utf8')
    : sliceHeadAtCharBoundary(buf, 0, budget).toString('utf8');
  return keepTail ? note + sliced : sliced + suffix;
}
