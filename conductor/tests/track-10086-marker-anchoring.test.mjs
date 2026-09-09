#!/usr/bin/env node
// conductor/tests/track-10086-marker-anchoring.test.mjs
// Track AM-10086 Phase 3b (REQ-10 / AC-10): parseDependsOn() in
// laneconductor.sync.mjs and parseWaitingReason() in waiting-state.mjs must
// be line-anchored, not matching a marker name quoted anywhere in prose.
//
// Fixture: conductor/tests/fixtures/track-10086-prefix-index.md is this
// track's OWN pre-fix index.md (git commit cf756b9e), captured verbatim
// before its **Problem**/**Summary** prose was de-bolded — the literal file
// that reproduced the bug live during this track's own planning. Kept as a
// permanent regression fixture rather than reconstructed inline, so a
// future edit to this test can't accidentally "fix" the fixture along with
// the assertion.
//
// Run: node --test conductor/tests/track-10086-marker-anchoring.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWaitingReason } from '../services/waiting-state.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, 'fixtures/track-10086-prefix-index.md'), 'utf8');

// parseDependsOn() lives in laneconductor.sync.mjs, which is not importable
// in a unit test (chokidar watchers / setIntervals fire at module load) — so
// this test exercises the exact regex laneconductor.sync.mjs now uses,
// duplicated here as a literal string specifically so a future edit to
// that regex without updating this test fails loudly instead of silently
// testing something else. The regex itself is also asserted verbatim
// against the source file below, so the two can't drift apart unnoticed.
const PARSE_DEPENDS_ON_RE = /^[ \t]*\*\*Depends On\*\*:[ \t]*([^\n]*)$/im;
function parseDependsOnLikeSyncWorker(content) {
  const match = content.match(PARSE_DEPENDS_ON_RE);
  if (!match) return [];
  return match[1].split(',').map(s => s.trim().replace(/^0+(?=\d)/, '')).filter(Boolean);
}

describe('REQ-10: parseDependsOn is line-anchored', () => {
  it('TC-7.1: returns [] against this track\'s own pre-fix index.md prose', () => {
    assert.deepEqual(parseDependsOnLikeSyncWorker(FIXTURE), []);
  });

  it('the fixture genuinely reproduces the bug against the OLD unanchored regex (sanity check on the fixture itself)', () => {
    const oldUnanchoredRe = /\*\*Depends On\*\*:\s*([^\n]+)/i;
    const match = FIXTURE.match(oldUnanchoredRe);
    assert.ok(match, 'fixture should still contain the literal marker text mid-prose');
    assert.notEqual(match[1].trim(), '1000', 'the old regex should capture prose, not a clean dependency list — proving this fixture is a real regression case, not a no-op');
  });

  it('TC-7.3: a real Depends On at line start still parses correctly (anchoring must not break the real case)', () => {
    const content = '**Lane**: implement\n**Depends On**: 1000, 1002\n';
    assert.deepEqual(parseDependsOnLikeSyncWorker(content), ['1000', '1002']);
  });

  it('TC-7.4: a marker preceded by leading whitespace still parses', () => {
    const content = '  **Depends On**: 1000\n';
    assert.deepEqual(parseDependsOnLikeSyncWorker(content), ['1000']);
  });

  it('laneconductor.sync.mjs actually contains this exact anchored regex (keeps this test honest about what it verifies)', () => {
    const syncSource = readFileSync(join(__dirname, '../laneconductor.sync.mjs'), 'utf8');
    assert.match(syncSource, /function parseDependsOn\(content\) \{\s*\n\s*const match = content\.match\(\/\^\[ \\t\]\*\\\*\\\*Depends On\\\*\\\*:\[ \\t\]\*\(\[\^\\n\]\*\)\$\/im\);/);
  });
});

describe('REQ-10: parseWaitingReason (waiting-state.mjs) is line-anchored', () => {
  it('TC-7.2: returns null against this track\'s own pre-fix index.md prose', () => {
    assert.equal(parseWaitingReason(FIXTURE), null);
  });

  it('TC-7.3-equivalent: a real Waiting Reason at line start still parses correctly', () => {
    const content = '**Lane Status**: waiting\n**Waiting Reason**: AM-1000 unmerged; awaiting merge order\n';
    assert.equal(parseWaitingReason(content), 'AM-1000 unmerged; awaiting merge order');
  });

  it('TC-7.4-equivalent: a marker preceded by leading whitespace still parses (matches MARKER_LINE_RE\'s existing tolerance)', () => {
    const content = '  **Waiting Reason**: reason text\n';
    assert.equal(parseWaitingReason(content), 'reason text');
  });
});
