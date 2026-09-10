// conductor/tests/track-10087-verdict-marker.test.mjs
//
// Track AM-10087: pure unit tests for the `**Verdict**` marker helper.
// See track-10087-blocked-verdict-override.test.mjs for the real-worker
// spawn test that reproduces the AM-1018 shape end to end.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseVerdict, writeVerdict, clearVerdict } from '../services/verdict.mjs';

describe('parseVerdict', () => {
  test('returns pass for **Verdict**: pass', () => {
    assert.equal(parseVerdict('**Verdict**: pass'), 'pass');
  });

  test('returns fail for **Verdict**: fail', () => {
    assert.equal(parseVerdict('**Verdict**: fail'), 'fail');
  });

  test('is case-insensitive', () => {
    assert.equal(parseVerdict('**Verdict**: PASS'), 'pass');
    assert.equal(parseVerdict('**Verdict**: Fail'), 'fail');
  });

  test('returns null when the marker is absent', () => {
    assert.equal(parseVerdict('# Track: nothing here\n**Lane**: review\n'), null);
  });

  test('returns null for an empty marker value', () => {
    assert.equal(parseVerdict('**Verdict**:   \n'), null);
  });

  test('returns null for an unrecognized value — never guessed', () => {
    assert.equal(parseVerdict('**Verdict**: maybe'), null);
  });

  test('returns null for non-string input', () => {
    assert.equal(parseVerdict(null), null);
    assert.equal(parseVerdict(undefined), null);
  });
});

describe('writeVerdict', () => {
  test('updates an existing marker in place (no duplicate line)', () => {
    const before = '# Track\n\n**Lane**: review\n**Verdict**: pass\n**Progress**: 90%\n';
    const after = writeVerdict(before, 'fail');
    assert.equal(after, '# Track\n\n**Lane**: review\n**Verdict**: fail\n**Progress**: 90%\n');
    assert.equal((after.match(/\*\*Verdict\*\*/g) || []).length, 1);
  });

  test('appends the marker when absent, without disturbing other markers', () => {
    const before = '# Track\n\n**Lane**: review\n**Lane Status**: running\n**Progress**: 90%';
    const after = writeVerdict(before, 'pass');
    assert.match(after, /\*\*Lane\*\*: review/);
    assert.match(after, /\*\*Lane Status\*\*: running/);
    assert.match(after, /\*\*Progress\*\*: 90%/);
    assert.match(after, /\*\*Verdict\*\*: pass\n$/);
  });
});

describe('clearVerdict', () => {
  test('removes the marker entirely', () => {
    const before = '# Track\n\n**Lane**: review\n**Verdict**: fail\n**Progress**: 90%\n';
    const after = clearVerdict(before);
    assert.doesNotMatch(after, /\*\*Verdict\*\*/);
    assert.match(after, /\*\*Lane\*\*: review/);
    assert.match(after, /\*\*Progress\*\*: 90%/);
  });

  test('is a no-op when the marker is already absent', () => {
    const before = '# Track\n\n**Lane**: review\n**Progress**: 90%\n';
    assert.equal(clearVerdict(before), before);
  });
});
