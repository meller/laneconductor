// conductor/tests/capacity-probe-throttle.test.mjs
// Confirmed live 2026-09-01: checkClaudeCapacity() (laneconductor.sync.mjs)
// spawned a real `claude -p test` CLI process — a real API call — on every
// single invocation, with zero caching. Called from inside the 5s
// auto-launch tick whenever a worker is idle with capacity to claim more
// work, that meant one full Claude API probe every 5 seconds per idle
// worker, indefinitely. This tests the pure throttle decision extracted to
// close that gap.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideCapacityProbe, DEFAULT_CAPACITY_CHECK_TTL_MS } from '../services/capacity-probe-throttle.mjs';

describe('decideCapacityProbe', () => {
  it('does a real probe (skip: false) when there is no cache at all', () => {
    const result = decideCapacityProbe({ cached: undefined, nowMs: 1000 });
    assert.equal(result.skip, false);
  });

  it('does a real probe when the cached entry has no lastCapacityCheckAt (e.g. DB-sourced cache from isProviderAvailable)', () => {
    const result = decideCapacityProbe({ cached: { status: 'ok', reset_at: null }, nowMs: 1000 });
    assert.equal(result.skip, false);
  });

  it('does a real probe once the TTL window has elapsed', () => {
    const cached = { status: 'ok', reset_at: null, lastCapacityCheckAt: 0 };
    const result = decideCapacityProbe({ cached, nowMs: DEFAULT_CAPACITY_CHECK_TTL_MS, ttlMs: DEFAULT_CAPACITY_CHECK_TTL_MS });
    assert.equal(result.skip, false);
  });

  it('THE FIX: reuses a fresh "ok" result instead of probing — this is what stops the every-5s spawn', () => {
    const cached = { status: 'ok', reset_at: null, lastCapacityCheckAt: 1000 };
    const result = decideCapacityProbe({ cached, nowMs: 1000 + 5000, ttlMs: DEFAULT_CAPACITY_CHECK_TTL_MS });
    assert.deepEqual(result, { skip: true, available: true });
  });

  it('reuses a fresh "exhausted, no reset_at" result as unavailable, without probing', () => {
    const cached = { status: 'exhausted', reset_at: null, lastCapacityCheckAt: 1000 };
    const result = decideCapacityProbe({ cached, nowMs: 1000 + 5000, ttlMs: DEFAULT_CAPACITY_CHECK_TTL_MS });
    assert.deepEqual(result, { skip: true, available: false });
  });

  it('reuses a fresh "exhausted" result as unavailable while still before reset_at', () => {
    const cached = { status: 'exhausted', reset_at: new Date(2000).toISOString(), lastCapacityCheckAt: 1000 };
    const result = decideCapacityProbe({ cached, nowMs: 1500, ttlMs: DEFAULT_CAPACITY_CHECK_TTL_MS });
    assert.deepEqual(result, { skip: true, available: false });
  });

  it('reuses a fresh "exhausted" result as available once reset_at has passed, without probing', () => {
    const cached = { status: 'exhausted', reset_at: new Date(1200).toISOString(), lastCapacityCheckAt: 1000 };
    const result = decideCapacityProbe({ cached, nowMs: 1300, ttlMs: DEFAULT_CAPACITY_CHECK_TTL_MS });
    assert.deepEqual(result, { skip: true, available: true });
  });

  // Track 10062 TC-12b/TC-12c: a fresh `auth_required` cache entry must
  // read as unavailable (isBlockingProviderStatus), not available — before
  // this fix `auth_required !== 'exhausted'` made it read as available.
  it('TC-12b: a fresh "auth_required" entry is treated as unavailable, without probing', () => {
    const cached = { status: 'auth_required', reset_at: null, lastCapacityCheckAt: 1000 };
    const result = decideCapacityProbe({ cached, nowMs: 1000 + 5000, ttlMs: DEFAULT_CAPACITY_CHECK_TTL_MS });
    assert.deepEqual(result, { skip: true, available: false });
  });

  it('TC-12c: an "auth_required" entry past the TTL triggers a real re-probe (recovery is automatic)', () => {
    const cached = { status: 'auth_required', reset_at: null, lastCapacityCheckAt: 0 };
    const result = decideCapacityProbe({ cached, nowMs: DEFAULT_CAPACITY_CHECK_TTL_MS, ttlMs: DEFAULT_CAPACITY_CHECK_TTL_MS });
    assert.equal(result.skip, false);
  });
});
