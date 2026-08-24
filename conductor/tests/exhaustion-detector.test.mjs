// Track 1112 dogfood incident (2026-08-13): the implement run for track
// 1112 itself got mis-classified as "provider claude quota exhausted" and
// silently re-queued, even though the actual claude-cli output had no real
// rate-limit error anywhere in it. Root cause: the exhaustion check used
// bare `content.includes('429')` / `content.includes('resets')` against the
// FULL raw stream-json transcript. `'429'` is a 3-character digit run that
// shows up by chance inside ordinary UUIDs/hashes in any long log (verified
// live against conductor/logs/dispatch-implement-1112-*.log — 51 hits, zero
// of them a real API error); `'resets'` is an ordinary English word that
// shows up in normal coding conversation ("the test resets state..."). Both
// are common enough in a real multi-hour coding session to false-positive
// essentially every time, not as an edge case.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isProviderExhausted } from '../services/exhaustion-detector.mjs';

describe('isProviderExhausted', () => {
  it('does not flag a claude log where "429" only appears inside a UUID', () => {
    const content = 'session_id":"ea0104a3-afcb-46cc-b723-2b27eafcf1ec","uuid":"6fc4814a-eca0-429d-b481-34567dc16062"';
    assert.equal(isProviderExhausted(content, 'claude'), false);
  });

  it('does not flag a claude log where "resets" appears in ordinary prose', () => {
    const content = 'Fixed the bug where the test resets state between runs instead of isolating them.';
    assert.equal(isProviderExhausted(content, 'claude'), false);
  });

  it('flags a claude log with a standalone 429 status code', () => {
    const content = '{"type":"error","status_code":429,"message":"Rate limited, please retry"}';
    assert.equal(isProviderExhausted(content, 'claude'), true);
  });

  it('flags a claude log with a "resets Nam/pm" reset-time message', () => {
    const content = 'You have hit your usage limit. It resets 7am.';
    assert.equal(isProviderExhausted(content, 'claude'), true);
  });

  it('flags a claude log containing "Overloaded"', () => {
    assert.equal(isProviderExhausted('Error: Overloaded, try again later', 'claude'), true);
  });

  it('flags a gemini log with "quota will reset after"', () => {
    const content = 'TerminalQuotaError: You have exhausted your capacity. Your quota will reset after 1h34m27s.';
    assert.equal(isProviderExhausted(content, 'gemini'), true);
  });

  it('flags a gemini log with "exhausted your capacity" alone', () => {
    assert.equal(isProviderExhausted('You have exhausted your capacity on this model.', 'gemini'), true);
  });

  it('does not flag an unrelated non-error claude log', () => {
    const content = 'Implemented the feature, all tests pass, committing now.';
    assert.equal(isProviderExhausted(content, 'claude'), false);
  });

  it('returns false for empty content or unknown cli', () => {
    assert.equal(isProviderExhausted('', 'claude'), false);
    assert.equal(isProviderExhausted('anything', 'unknown-cli'), false);
  });
});
