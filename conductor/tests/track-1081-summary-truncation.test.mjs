#!/usr/bin/env node
// conductor/tests/track-1081-summary-truncation.test.mjs
// Track 1081, Mechanism 2: parseSummaryMarker()/parseSummary() used to
// unconditionally truncate any **Summary** value to 200 chars via
// truncateSummary() before it was pushed to the DB as content_summary. Since
// content_summary is an unbounded Postgres TEXT column (see
// prisma/schema.prisma) and the only place it's rendered
// (ui/src/components/TrackCard.jsx) already visually clips it with CSS
// (line-clamp-3), the truncation was never load-bearing — it just gave the
// DB a lossy copy. The next pullTracksMetadataFromDB cycle (every 5s) then
// found the DB "newer" than the file (content_updated_at bumps on any
// content_summary change, and isConcurrentEdit's 10s grace period expires on
// its own within a couple of cycles even with zero concurrent edits) and
// wrote that truncated copy back into the file's **Summary** marker,
// permanently discarding everything past 200 characters. Confirmed live:
// this very track's own index.md **Summary** marker was truncated to exactly
// 200 chars mid-word before this fix.
//
// Fix: extracted the pure summary-parsing helpers out of
// conductor/laneconductor.sync.mjs (which cannot be imported directly for
// unit testing — it runs chokidar watchers and setIntervals as import-time
// side effects, same reason conductor/sync-timestamp-utils.mjs exists) into
// conductor/summary-utils.mjs, and removed the truncateSummary() call from
// both Summary-returning paths. truncateSummary() itself is unchanged and
// still used by parseCurrentPhaseMarker for **Phase** (track 1114's
// intentional, unrelated bound).
//
// Run: node --test conductor/tests/track-1081-summary-truncation.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { truncateSummary, parseSummaryMarker, parseSummary } from '../summary-utils.mjs';

describe('parseSummaryMarker', () => {
  it('TC-2: returns a >200-char Summary value in full, unchanged', () => {
    const long = 'x'.repeat(500);
    const content = `# Track 1: Title\n\n**Summary**: ${long}\n`;
    assert.equal(parseSummaryMarker(content), long);
  });

  it('TC-3: returns a short Summary value unchanged', () => {
    const content = '# Track 1: Title\n\n**Summary**: short value\n';
    assert.equal(parseSummaryMarker(content), 'short value');
  });

  it('TC-4: returns null for an empty Summary marker', () => {
    const content = '# Track 1: Title\n\n**Summary**: \n';
    assert.equal(parseSummaryMarker(content), null);
  });

  it('TC-5: returns null when no Summary marker is present', () => {
    const content = '# Track 1: Title\n\nNo marker here.\n';
    assert.equal(parseSummaryMarker(content), null);
  });
});

describe('parseSummary', () => {
  it('TC-6: derives a long Problem block in full, unchanged, when no Summary marker exists', () => {
    const longProblem = 'y'.repeat(500);
    const content = `# Track 1: Title\n\n## Phase 1: Name\n\n**Problem**: ${longProblem}\n**Solution**: something\n`;
    assert.equal(parseSummary(content), longProblem);
  });

  it('TC-7: prefers an explicit Summary marker over the Problem fallback', () => {
    const content = '# Track 1: Title\n\n**Summary**: explicit summary\n\n**Problem**: fallback text\n';
    assert.equal(parseSummary(content), 'explicit summary');
  });
});

describe('truncateSummary (regression — still used by parseCurrentPhaseMarker for **Phase**)', () => {
  it('TC-8: still truncates at a word boundary with an ellipsis when called directly', () => {
    const long = 'a'.repeat(250);
    const result = truncateSummary(long, 200);
    assert.ok(result.length <= 200);
    assert.ok(result.endsWith('…'));
  });

  it('TC-8b: returns short text unchanged', () => {
    assert.equal(truncateSummary('short', 200), 'short');
  });
});
