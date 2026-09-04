// conductor/tests/provider-probe-classify.test.mjs
// Track 10062: checkClaudeCapacity() (laneconductor.sync.mjs) collapsed
// every non-zero `claude -p test` exit into status: 'exhausted' with a
// rolling Date.now() + 60000 guess — including an expired OAuth login,
// confirmed live 2026-09-04, which does not self-heal by waiting. This
// tests the pure classification decision extracted to fix that, mirroring
// capacity-probe-throttle.mjs's extraction style so the decision is
// testable without spawning a real CLI process.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyClaudeProbe,
  isBlockingProviderStatus,
  formatProviderBlockReason,
  PROVIDER_STATUS,
} from '../services/provider-probe-classify.mjs';

describe('classifyClaudeProbe', () => {
  it('TC-1: code 0 → ok, available, no reset_at', () => {
    const result = classifyClaudeProbe({ code: 0, output: 'I am here.', nowMs: 1000 });
    assert.equal(result.status, 'ok');
    assert.equal(result.available, true);
    assert.equal(result.reset_at, null);
  });

  it('TC-2 (the bug): expired OAuth login classifies as auth_required, not exhausted', () => {
    const result = classifyClaudeProbe({
      code: 1,
      output: 'Failed to authenticate: OAuth session expired and could not be refreshed',
      nowMs: 1000,
    });
    assert.equal(result.status, 'auth_required');
    assert.equal(result.available, false);
    assert.equal(result.reset_at, null);
    assert.notEqual(result.status, 'exhausted');
  });

  it('TC-3: reset_at stays null for auth_required regardless of nowMs — no rolling estimate', () => {
    const output = 'Failed to authenticate: OAuth session expired and could not be refreshed';
    const first = classifyClaudeProbe({ code: 1, output, nowMs: 1000 });
    const second = classifyClaudeProbe({ code: 1, output, nowMs: 1000 + 60000 });
    assert.equal(first.reset_at, null);
    assert.equal(second.reset_at, null);
    assert.deepEqual(first, second);
  });

  it('TC-4: last_error mentions claude login; remedy distinguishes standalone CLI auth from a Claude Code app session', () => {
    const result = classifyClaudeProbe({
      code: 1,
      output: 'Failed to authenticate: OAuth session expired and could not be refreshed',
      nowMs: 1000,
    });
    assert.match(result.last_error, /claude login/i);
    assert.match(result.remedy, /claude login/i);
    assert.match(result.last_error + result.remedy, /Claude Code/i);
  });

  it('TC-5: genuine rate limit with a parseable reset time → exhausted with parsed reset_at', () => {
    const now = new Date('2026-09-04T10:00:00');
    const result = classifyClaudeProbe({
      code: 1,
      output: "You've hit your limit · resets 3pm (Europe/Berlin)",
      nowMs: now.getTime(),
    });
    assert.equal(result.status, 'exhausted');
    const resetAt = new Date(result.reset_at);
    assert.equal(resetAt.getHours(), 15);
    assert.equal(resetAt.getMinutes(), 0);
  });

  it('TC-6: "resets 10:30pm" parses the minute-bearing form', () => {
    const now = new Date('2026-09-04T10:00:00');
    const result = classifyClaudeProbe({
      code: 1,
      output: 'quota exhausted, resets 10:30pm',
      nowMs: now.getTime(),
    });
    assert.equal(result.status, 'exhausted');
    const resetAt = new Date(result.reset_at);
    assert.equal(resetAt.getHours(), 22);
    assert.equal(resetAt.getMinutes(), 30);
  });

  it('TC-7: a parsed reset time already in the past rolls to tomorrow', () => {
    const now = new Date('2026-09-04T22:00:00');
    const result = classifyClaudeProbe({
      code: 1,
      output: "You've hit your limit · resets 3pm",
      nowMs: now.getTime(),
    });
    const resetAt = new Date(result.reset_at);
    assert.equal(resetAt.getDate(), now.getDate() + 1);
    assert.equal(resetAt.getHours(), 15);
  });

  it('TC-8: exhausted but unparseable → reset_at ≈ nowMs + 15m, not nowMs + 60s', () => {
    const nowMs = 1000000;
    const result = classifyClaudeProbe({ code: 1, output: 'quota exhausted', nowMs });
    assert.equal(result.status, 'exhausted');
    const delta = new Date(result.reset_at).getTime() - nowMs;
    assert.equal(delta, 15 * 60000);
  });

  it('TC-9: an unrecognised non-zero exit → probe_failed, not exhausted, no reset_at', () => {
    const result = classifyClaudeProbe({ code: 1, output: 'Error: ENOENT spawn claude', nowMs: 1000 });
    assert.equal(result.status, 'probe_failed');
    assert.equal(result.reset_at, null);
    assert.match(result.last_error, /ENOENT spawn claude/);
    assert.notEqual(result.status, 'exhausted');
  });

  it('TC-10 (precedence): output with BOTH an auth phrase and "exhausted" classifies as auth_required', () => {
    const result = classifyClaudeProbe({
      code: 1,
      output: 'Failed to authenticate: OAuth session expired. Quota is not exhausted.',
      nowMs: 1000,
    });
    assert.equal(result.status, 'auth_required');
  });

  it('TC-11 (no false positive): a bare 401 with no auth phrasing does not classify as auth_required', () => {
    const result = classifyClaudeProbe({
      code: 1,
      output: 'GET https://api.example.com/resource?code=401 failed, byte count 401',
      nowMs: 1000,
    });
    assert.notEqual(result.status, 'auth_required');
  });

  it('TC-12: isBlockingProviderStatus is true for exhausted/auth_required/probe_failed, false for ok/available', () => {
    assert.equal(isBlockingProviderStatus('exhausted'), true);
    assert.equal(isBlockingProviderStatus('auth_required'), true);
    assert.equal(isBlockingProviderStatus('probe_failed'), true);
    assert.equal(isBlockingProviderStatus('ok'), false);
    assert.equal(isBlockingProviderStatus('available'), false);
    assert.equal(isBlockingProviderStatus(undefined), false);
  });

  it('TC-22: formatProviderBlockReason names the provider and login remedy for auth_required', () => {
    const reason = formatProviderBlockReason('claude', { status: 'auth_required', reset_at: null, last_error: 'x' });
    assert.match(reason, /claude/);
    assert.match(reason, /claude login/i);
  });

  it('TC-22: formatProviderBlockReason names the reset time for exhausted', () => {
    const reason = formatProviderBlockReason('claude', { status: 'exhausted', reset_at: '2026-09-04T15:00:00.000Z', last_error: 'Capacity exhausted' });
    assert.match(reason, /claude/);
    assert.match(reason, /2026-09-04T15:00:00\.000Z/);
  });

  it('PROVIDER_STATUS enumerates exactly the four statuses', () => {
    assert.deepEqual(PROVIDER_STATUS, {
      OK: 'ok',
      EXHAUSTED: 'exhausted',
      AUTH_REQUIRED: 'auth_required',
      PROBE_FAILED: 'probe_failed',
    });
  });
});
