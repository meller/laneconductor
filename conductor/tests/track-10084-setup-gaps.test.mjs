// conductor/tests/track-10084-setup-gaps.test.mjs
// Track 10084 Phase 4 (REQ-5/REQ-6): setup-gaps.mjs's new workerMode +
// primaryProviderReachableAnywhere inputs. Sibling to
// track-10069-setup-gaps.test.mjs (which already covers TC-4.1's default-path
// parity in full) — this file covers only the new manager-driven behavior.

import { test } from 'node:test';
import assert from 'node:assert';
import { computeSetupGaps } from '../services/setup-gaps.mjs';

const FULLY_CONFIGURED = {
  projectCount: 1,
  hasOnlineWorker: true,
  hasManagerWorker: true,
  primaryCliConfigured: true,
  primaryProviderReachable: true,
  hasProductMd: true,
  hasTechStackMd: true,
  createQualityGate: true,
  hasQualityGateMd: true,
  trackCount: 3,
};

test('TC-4.1: default workerMode omitted entirely still reproduces the exact fully-configured pass', () => {
  assert.deepEqual(computeSetupGaps(FULLY_CONFIGURED), []);
});

test('TC-4.1: explicit workerMode: "dedicated" is byte-for-byte identical to omitting it', () => {
  const withDefault = computeSetupGaps({ ...FULLY_CONFIGURED, hasOnlineWorker: false });
  const withExplicit = computeSetupGaps({ ...FULLY_CONFIGURED, hasOnlineWorker: false, workerMode: 'dedicated' });
  assert.deepEqual(withExplicit, withDefault);
  assert.deepEqual(withExplicit.map(g => [g.id, g.severity]), [['no-workers', 'blocking']]);
});

test('TC-4.2: manager-driven + no worker -> advisory manager-driven-no-worker, not blocking', () => {
  const gaps = computeSetupGaps({ ...FULLY_CONFIGURED, hasOnlineWorker: false, workerMode: 'manager-driven' });
  assert.deepEqual(gaps.map(g => [g.id, g.severity]), [['manager-driven-no-worker', 'advisory']]);
  assert.ok(!gaps.some(g => g.severity === 'blocking'));
});

test('TC-4.3: manager-driven + unreachable here but reachable elsewhere -> no no-provider gap', () => {
  const gaps = computeSetupGaps({
    ...FULLY_CONFIGURED,
    workerMode: 'manager-driven',
    primaryProviderReachable: false,
    primaryProviderReachableAnywhere: true,
  });
  assert.ok(!gaps.some(g => g.id === 'no-provider'), `expected no no-provider gap, got: ${JSON.stringify(gaps)}`);
});

test('TC-4.4: manager-driven + unreachable everywhere -> no-provider still blocking (no free pass with zero evidence)', () => {
  const gaps = computeSetupGaps({
    ...FULLY_CONFIGURED,
    workerMode: 'manager-driven',
    primaryProviderReachable: false,
    primaryProviderReachableAnywhere: false,
  });
  assert.ok(gaps.some(g => g.id === 'no-provider' && g.severity === 'blocking'), `expected blocking no-provider, got: ${JSON.stringify(gaps)}`);
});

test('TC-4.5: dedicated (explicit) + unreachable here but reachable elsewhere -> no-provider still blocking (cross-project inheritance is manager-driven only)', () => {
  const gaps = computeSetupGaps({
    ...FULLY_CONFIGURED,
    workerMode: 'dedicated',
    primaryProviderReachable: false,
    primaryProviderReachableAnywhere: true,
  });
  assert.ok(gaps.some(g => g.id === 'no-provider' && g.severity === 'blocking'), `expected blocking no-provider, got: ${JSON.stringify(gaps)}`);
});

test('unconfigured CLI still blocks even for manager-driven + reachable-anywhere (inheritance only covers reachability, not configuration)', () => {
  const gaps = computeSetupGaps({
    ...FULLY_CONFIGURED,
    workerMode: 'manager-driven',
    primaryCliConfigured: false,
    primaryProviderReachable: false,
    primaryProviderReachableAnywhere: true,
  });
  assert.ok(gaps.some(g => g.id === 'no-provider' && g.severity === 'blocking'), `expected blocking no-provider, got: ${JSON.stringify(gaps)}`);
});
