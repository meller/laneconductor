// conductor/tests/track-doc-digest.test.mjs
// Track AM-10090 Phase 1: pure-module tests for track-doc-digest.mjs.
// See conductor/tracks/AM-10090-.../test.md TC-1 through TC-9.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseForDigest,
  extractStableIndexMarkers,
  computeTrackDocDigest,
  hasTrackDocDrift,
  STABLE_INDEX_MARKERS,
} from '../services/track-doc-digest.mjs';

const BASE_INDEX = [
  '# Track AM-10090: Title',
  '',
  '**Lane**: plan',
  '**Lane Status**: running',
  '**Progress**: 42%',
  '**Phase**: Some phase',
  '**Type**: dev',
  '**Auto Run**: yes',
  '**Merge Mode**: direct',
  '**Last Run**: claude/claude-opus-5 (primary)',
  '**Waiting for reply**: no',
  '**Summary**: A summary line.',
].join('\n');

describe('track-doc-digest (Track AM-10090)', () => {
  it('TC-1: identical inputs produce an identical digest', () => {
    const docs = { indexMd: BASE_INDEX, specMd: 'spec body', planMd: 'plan body', testMd: 'test body' };
    const d1 = computeTrackDocDigest(docs);
    const d2 = computeTrackDocDigest({ ...docs });
    assert.equal(d1, d2);
    assert.match(d1, /^[0-9a-f]{64}$/);
  });

  it('TC-2: changing spec.md changes the digest', () => {
    const base = { indexMd: BASE_INDEX, specMd: 'spec body', planMd: 'plan body', testMd: 'test body' };
    const changed = { ...base, specMd: 'spec body CHANGED' };
    assert.notEqual(computeTrackDocDigest(base), computeTrackDocDigest(changed));
  });

  it('TC-3: changing plan.md changes the digest', () => {
    const base = { indexMd: BASE_INDEX, specMd: 'spec body', planMd: 'plan body', testMd: 'test body' };
    const changed = { ...base, planMd: 'plan body CHANGED' };
    assert.notEqual(computeTrackDocDigest(base), computeTrackDocDigest(changed));
  });

  it('TC-4: changing test.md changes the digest', () => {
    const base = { indexMd: BASE_INDEX, specMd: 'spec body', planMd: 'plan body', testMd: 'test body' };
    const changed = { ...base, testMd: 'test body CHANGED' };
    assert.notEqual(computeTrackDocDigest(base), computeTrackDocDigest(changed));
  });

  it('TC-5 (REQ-3, load-bearing): mutating only volatile index.md markers leaves the digest unchanged', () => {
    const base = { indexMd: BASE_INDEX, specMd: 'spec body', planMd: 'plan body', testMd: 'test body' };
    const baseDigest = computeTrackDocDigest(base);

    const volatileMutations = [
      BASE_INDEX.replace('**Lane**: plan', '**Lane**: implement'),
      BASE_INDEX.replace('**Lane Status**: running', '**Lane Status**: success'),
      BASE_INDEX.replace('**Progress**: 42%', '**Progress**: 100%'),
      BASE_INDEX.replace('**Phase**: Some phase', '**Phase**: Different phase'),
      BASE_INDEX.replace('**Last Run**: claude/claude-opus-5 (primary)', '**Last Run**: claude/claude-sonnet-5 (primary)'),
      BASE_INDEX.replace('**Waiting for reply**: no', '**Waiting for reply**: yes'),
      BASE_INDEX + '\n**PR URL**: https://github.com/example/pr/1',
      BASE_INDEX + '\n**KPI Actual**: 99',
    ];

    for (const mutatedIndex of volatileMutations) {
      const mutatedDigest = computeTrackDocDigest({ ...base, indexMd: mutatedIndex });
      assert.equal(mutatedDigest, baseDigest, `expected no drift for mutation:\n${mutatedIndex}`);
    }
  });

  it('TC-6 (REQ-2): mutating any stable marker changes the digest', () => {
    const base = { indexMd: BASE_INDEX, specMd: 'spec body', planMd: 'plan body', testMd: 'test body' };
    const baseDigest = computeTrackDocDigest(base);

    const stableMutations = {
      Summary: BASE_INDEX.replace('**Summary**: A summary line.', '**Summary**: A DIFFERENT summary.'),
      Type: BASE_INDEX.replace('**Type**: dev', '**Type**: marketing'),
      'Auto Run': BASE_INDEX.replace('**Auto Run**: yes', '**Auto Run**: no'),
      'Merge Mode': BASE_INDEX.replace('**Merge Mode**: direct', '**Merge Mode**: pr'),
      Workspace: BASE_INDEX + '\n**Workspace**: main',
      'Track Kind': BASE_INDEX + '\n**Track Kind**: feature',
      Model: BASE_INDEX + '\n**Model**: claude-haiku-4-5',
    };

    for (const [marker, mutatedIndex] of Object.entries(stableMutations)) {
      const mutatedDigest = computeTrackDocDigest({ ...base, indexMd: mutatedIndex });
      assert.notEqual(mutatedDigest, baseDigest, `expected drift when mutating ${marker}`);
    }

    // Sanity: every STABLE_INDEX_MARKERS entry has a corresponding case above.
    assert.deepEqual(Object.keys(stableMutations).sort(), [...STABLE_INDEX_MARKERS].sort());
  });

  it('TC-7 (REQ-5): CRLF, trailing whitespace, and trailing blank lines are normalised away', () => {
    const plain = 'line one\nline two\nline three';
    const crlf = 'line one\r\nline two\r\nline three';
    const trailingWs = 'line one   \nline two\t\nline three';
    const trailingBlankLines = 'line one\nline two\nline three\n\n\n';

    const baseDigest = computeTrackDocDigest({ indexMd: BASE_INDEX, specMd: plain, planMd: 'p', testMd: 't' });
    assert.equal(computeTrackDocDigest({ indexMd: BASE_INDEX, specMd: crlf, planMd: 'p', testMd: 't' }), baseDigest);
    assert.equal(computeTrackDocDigest({ indexMd: BASE_INDEX, specMd: trailingWs, planMd: 'p', testMd: 't' }), baseDigest);
    assert.equal(computeTrackDocDigest({ indexMd: BASE_INDEX, specMd: trailingBlankLines, planMd: 'p', testMd: 't' }), baseDigest);

    // And normaliseForDigest itself, directly:
    assert.equal(normaliseForDigest(crlf), normaliseForDigest(plain));
    assert.equal(normaliseForDigest(trailingWs), normaliseForDigest(plain));
    assert.equal(normaliseForDigest(trailingBlankLines), normaliseForDigest(plain));
  });

  it('TC-8 (REQ-5): a missing file digests differently from a present-but-empty file', () => {
    const withMissingSpec = computeTrackDocDigest({ indexMd: BASE_INDEX, specMd: null, planMd: 'p', testMd: 't' });
    const withEmptySpec = computeTrackDocDigest({ indexMd: BASE_INDEX, specMd: '', planMd: 'p', testMd: 't' });
    assert.notEqual(withMissingSpec, withEmptySpec);

    const withUndefinedSpec = computeTrackDocDigest({ indexMd: BASE_INDEX, planMd: 'p', testMd: 't' });
    assert.equal(withUndefinedSpec, withMissingSpec, 'undefined and null should be treated identically');
  });

  it('TC-9 (REQ-10): hasTrackDocDrift treats a null/absent stored digest as no drift', () => {
    assert.deepEqual(
      hasTrackDocDrift({ storedDigest: null, currentDigest: 'abc123' }),
      { drift: false, reason: null }
    );
    assert.deepEqual(
      hasTrackDocDrift({ storedDigest: undefined, currentDigest: 'abc123' }),
      { drift: false, reason: null }
    );
    assert.deepEqual(
      hasTrackDocDrift({ storedDigest: 'abc123', currentDigest: 'def456' }),
      { drift: true, reason: 'doc-drift' }
    );
    assert.deepEqual(
      hasTrackDocDrift({ storedDigest: 'abc123', currentDigest: 'abc123' }),
      { drift: false, reason: null }
    );
  });

  it('extractStableIndexMarkers: returns only allowlisted markers, in fixed order, ignoring absent ones', () => {
    const partial = '**Lane**: plan\n**Type**: dev\n**Summary**: hi';
    const extracted = extractStableIndexMarkers(partial);
    assert.equal(extracted, '**Summary**: hi\n**Type**: dev');
    assert.equal(extractStableIndexMarkers(null), '');
    assert.equal(extractStableIndexMarkers(''), '');
  });
});
