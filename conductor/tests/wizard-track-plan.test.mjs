#!/usr/bin/env node
// conductor/tests/wizard-track-plan.test.mjs
// Track AM-1119 Phase 3 (Task 1, TC-7/TC-8): pure track-breakdown derivation.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTrackPlan } from '../services/wizard-track-plan.mjs';

const BRAINSTORM_SUMMARY = [
  'Project purpose: Dig for ore, avoid hazards',
  'Target users: casual browser-game players',
  'Tech stack: React + Canvas',
  'Success metrics / KPIs: 500 plays in week 1',
].join('\n');

describe('deriveTrackPlan', () => {
  it('always starts with an App Skeleton track', () => {
    const plan = deriveTrackPlan({ projectName: 'Digger Game', brainstormSummary: '', deploymentProvider: 'skip' });
    assert.equal(plan[0].title, 'App Skeleton');
  });

  it('derives a core-feature track from the purpose line, never fabricated', () => {
    const plan = deriveTrackPlan({ projectName: 'Digger Game', brainstormSummary: BRAINSTORM_SUMMARY, deploymentProvider: 'skip' });
    const feature = plan.find(t => t.title.startsWith('Core Feature'));
    assert.ok(feature, 'expected a Core Feature track');
    assert.match(feature.solution, /Dig for ore, avoid hazards/);
    assert.match(feature.solution, /casual browser-game players/);
  });

  it('derives a success-metrics track only when KPIs were provided', () => {
    const withKpis = deriveTrackPlan({ projectName: 'x', brainstormSummary: BRAINSTORM_SUMMARY, deploymentProvider: 'skip' });
    assert.ok(withKpis.some(t => t.title.startsWith('Success Metrics')));

    const withoutKpis = deriveTrackPlan({ projectName: 'x', brainstormSummary: 'Project purpose: test', deploymentProvider: 'skip' });
    assert.ok(!withoutKpis.some(t => t.title.startsWith('Success Metrics')));
  });

  it('produces no deploy track when provider is skip or absent', () => {
    const plan1 = deriveTrackPlan({ projectName: 'x', brainstormSummary: BRAINSTORM_SUMMARY, deploymentProvider: 'skip' });
    const plan2 = deriveTrackPlan({ projectName: 'x', brainstormSummary: BRAINSTORM_SUMMARY, deploymentProvider: undefined });
    for (const plan of [plan1, plan2]) {
      assert.ok(!plan.some(t => t.dependsOnAll), 'no track should carry dependsOnAll');
    }
  });

  it('ends with exactly one deploy track referencing the chosen provider, depending on all prior tracks (TC-8)', () => {
    const plan = deriveTrackPlan({ projectName: 'Digger Game', brainstormSummary: BRAINSTORM_SUMMARY, deploymentProvider: 'firebase' });
    const last = plan[plan.length - 1];
    assert.match(last.title, /^Deploy to Firebase Hosting$/);
    assert.equal(last.dependsOnAll, true);
    assert.equal(plan.filter(t => /^Deploy to/.test(t.title)).length, 1, 'exactly one deploy track');
  });

  // Track AM-1119 Phase 4 (Task 2): the deploy track's Solution must be an
  // actionable instruction (endpoint + payload), not just "record the URL".
  it('the deploy track Solution names the app-url endpoint and payload shape', () => {
    const plan = deriveTrackPlan({ projectName: 'Digger Game', brainstormSummary: BRAINSTORM_SUMMARY, deploymentProvider: 'firebase' });
    const deployTrack = plan[plan.length - 1];
    assert.match(deployTrack.solution, /\/api\/projects\/.*\/app-url/);
    assert.match(deployTrack.solution, /app_url/);
    assert.match(deployTrack.solution, /expected_url/);
  });

  it('produces between 3 and 6 tracks for a fully-filled wizard input (TC-7 shape)', () => {
    const plan = deriveTrackPlan({ projectName: 'Digger Game', brainstormSummary: BRAINSTORM_SUMMARY, deploymentProvider: 'gcp' });
    assert.ok(plan.length >= 3 && plan.length <= 6, `expected 3-6 tracks, got ${plan.length}`);
  });
});
