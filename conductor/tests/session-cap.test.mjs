// conductor/tests/session-cap.test.mjs
// Track 10047, Phase 1 (TC-1..TC-9): extractSessionContextTokens +
// shouldCapSession, pure and unit-tested before anything wires them in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSessionContextTokens } from '../stream-json-tail.mjs';
import { shouldCapSession, DEFAULT_MAX_CONTEXT_TOKENS, DEFAULT_MAX_RESUMES } from '../services/session-cap.mjs';

function assistantLine(usage) {
  return JSON.stringify({ type: 'assistant', message: { content: [], usage } });
}
function resultLine(cacheRead) {
  return JSON.stringify({ type: 'result', usage: { cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0 } });
}

test('TC-1: last assistant event usage -> cache_read + cache_creation', () => {
  const log = assistantLine({ cache_read_input_tokens: 148710, cache_creation_input_tokens: 212 });
  assert.equal(extractSessionContextTokens(log), 148922);
});

test('TC-2: no assistant events at all -> null, not 0', () => {
  const log = [resultLine(500), JSON.stringify({ type: 'system', subtype: 'status' })].join('\n');
  assert.equal(extractSessionContextTokens(log), null);
});

test('TC-3: multiple assistant events -> the LAST one wins', () => {
  const log = [
    assistantLine({ cache_read_input_tokens: 15171, cache_creation_input_tokens: 0 }),
    assistantLine({ cache_read_input_tokens: 147896, cache_creation_input_tokens: 0 }),
    assistantLine({ cache_read_input_tokens: 148710, cache_creation_input_tokens: 0 }),
  ].join('\n');
  assert.equal(extractSessionContextTokens(log), 148710);
});

test('TC-4 (the correction that matters most): a trailing result event with a 14x-inflated cumulative sum must be ignored', () => {
  const log = [
    assistantLine({ cache_read_input_tokens: 148710, cache_creation_input_tokens: 212 }),
    resultLine(2152229),
  ].join('\n');
  assert.equal(extractSessionContextTokens(log), 148922);
});

test('TC-5: malformed/truncated JSONL lines interleaved with valid ones are skipped, not fatal', () => {
  const log = [
    assistantLine({ cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }),
    '{not valid json',
    '',
    assistantLine({ cache_read_input_tokens: 200, cache_creation_input_tokens: 50 }),
    '{"type":"assistant","message":{"con', // truncated mid-line
  ].join('\n');
  assert.equal(extractSessionContextTokens(log), 250);
});

test('TC-6: empty string / null input -> null, no throw', () => {
  assert.equal(extractSessionContextTokens(''), null);
  assert.equal(extractSessionContextTokens(null), null);
});

test('TC-7: over the token threshold -> capped, reason context-tokens', () => {
  const r = shouldCapSession({ lastContextTokens: 500000, resumeCount: 1, maxContextTokens: 400000, maxResumes: 12 });
  assert.deepEqual(r, { cap: true, reason: 'context-tokens' });
});

test('TC-8: under the token threshold -> not capped (guards against an over-aggressive 150-200K default)', () => {
  const r = shouldCapSession({ lastContextTokens: 164000, resumeCount: 3, maxContextTokens: 400000, maxResumes: 12 });
  assert.deepEqual(r, { cap: false, reason: null });
});

test('TC-9a: token data unknown, resume count over its cap -> capped, reason resume-count', () => {
  const r = shouldCapSession({ lastContextTokens: null, resumeCount: 15, maxResumes: 12 });
  assert.deepEqual(r, { cap: true, reason: 'resume-count' });
});

test('TC-9b: token data unknown, resume count under its cap -> not capped', () => {
  const r = shouldCapSession({ lastContextTokens: null, resumeCount: 2 });
  assert.deepEqual(r, { cap: false, reason: null });
});

test('TC-9c: both thresholds 0 -> disabled, never caps', () => {
  const r = shouldCapSession({ lastContextTokens: 900000, resumeCount: 99, maxContextTokens: 0, maxResumes: 0 });
  assert.deepEqual(r, { cap: false, reason: null });
});

test('TC-9d: token check takes precedence over resume count when both would independently cap', () => {
  const r = shouldCapSession({ lastContextTokens: 900000, resumeCount: 99, maxContextTokens: 400000 });
  assert.deepEqual(r, { cap: true, reason: 'context-tokens' });
});

test('TC-9e: all inputs undefined -> never cap on unknown data', () => {
  const r = shouldCapSession({});
  assert.deepEqual(r, { cap: false, reason: null });
});

test('defaults are exported and match the calibrated values', () => {
  assert.equal(DEFAULT_MAX_CONTEXT_TOKENS, 400000);
  assert.equal(DEFAULT_MAX_RESUMES, 12);
});
