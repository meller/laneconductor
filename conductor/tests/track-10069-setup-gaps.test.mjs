// Track 10069 Phase 1 (REQ-16): setup-gaps.mjs — spec.md D4's seven-condition table.

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

test('TC-1.4: fully configured fixture returns []', () => {
  assert.deepEqual(computeSetupGaps(FULLY_CONFIGURED), []);
});

test('TC-1.5: no-projects is blocking', () => {
  const gaps = computeSetupGaps({ ...FULLY_CONFIGURED, projectCount: 0 });
  assert.deepEqual(gaps.map(g => [g.id, g.severity]), [['no-projects', 'blocking']]);
});

test('TC-1.5: no-workers is blocking', () => {
  const gaps = computeSetupGaps({ ...FULLY_CONFIGURED, hasOnlineWorker: false });
  assert.deepEqual(gaps.map(g => [g.id, g.severity]), [['no-workers', 'blocking']]);
});

test('TC-1.5: no-provider is blocking (unconfigured CLI)', () => {
  const gaps = computeSetupGaps({ ...FULLY_CONFIGURED, primaryCliConfigured: false });
  assert.deepEqual(gaps.map(g => [g.id, g.severity]), [['no-provider', 'blocking']]);
});

test('TC-1.5: no-provider is blocking (unreachable CLI)', () => {
  const gaps = computeSetupGaps({ ...FULLY_CONFIGURED, primaryProviderReachable: false });
  assert.deepEqual(gaps.map(g => [g.id, g.severity]), [['no-provider', 'blocking']]);
});

test('TC-1.5: no-manager is advisory', () => {
  const gaps = computeSetupGaps({ ...FULLY_CONFIGURED, hasManagerWorker: false });
  assert.deepEqual(gaps.map(g => [g.id, g.severity]), [['no-manager', 'advisory']]);
});

test('TC-1.5: no-conductor-context is advisory (missing product.md)', () => {
  const gaps = computeSetupGaps({ ...FULLY_CONFIGURED, hasProductMd: false });
  assert.deepEqual(gaps.map(g => [g.id, g.severity]), [['no-conductor-context', 'advisory']]);
});

test('TC-1.5: no-conductor-context is advisory (missing tech-stack.md)', () => {
  const gaps = computeSetupGaps({ ...FULLY_CONFIGURED, hasTechStackMd: false });
  assert.deepEqual(gaps.map(g => [g.id, g.severity]), [['no-conductor-context', 'advisory']]);
});

test('TC-1.5: no-quality-gate is advisory, only when create_quality_gate is set', () => {
  const gaps = computeSetupGaps({ ...FULLY_CONFIGURED, hasQualityGateMd: false });
  assert.deepEqual(gaps.map(g => [g.id, g.severity]), [['no-quality-gate', 'advisory']]);

  const noGateRequested = computeSetupGaps({ ...FULLY_CONFIGURED, createQualityGate: false, hasQualityGateMd: false });
  assert.deepEqual(noGateRequested, []);
});

test('TC-1.5: no-tracks is advisory', () => {
  const gaps = computeSetupGaps({ ...FULLY_CONFIGURED, trackCount: 0 });
  assert.deepEqual(gaps.map(g => [g.id, g.severity]), [['no-tracks', 'advisory']]);
});

test('TC-1.6: every gap carries a non-empty remedy', () => {
  const allGapsFixture = {
    projectCount: 0, hasOnlineWorker: false, hasManagerWorker: false,
    primaryCliConfigured: false, primaryProviderReachable: false,
    hasProductMd: false, hasTechStackMd: false,
    createQualityGate: true, hasQualityGateMd: false,
    trackCount: 0,
  };
  const gaps = computeSetupGaps(allGapsFixture);
  assert.ok(gaps.length === 7, `expected all 7 gaps, got ${gaps.length}`);
  for (const g of gaps) {
    assert.ok(typeof g.remedy === 'string' && g.remedy.length > 0, `${g.id} missing remedy`);
  }
});
