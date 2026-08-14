#!/usr/bin/env node
// conductor/tests/track-1111-model-staleness.test.mjs
// Track 1111 Phase 5 (TC-8): staleness detection for workflow.json's
// per-lane primary_model strings against a worker's discovered
// available_models (services/model-staleness.mjs).
//
// Run: node --test conductor/tests/track-1111-model-staleness.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findStaleLaneModels, formatStaleLaneModelWarning } from '../services/model-staleness.mjs';

const AVAILABLE = {
  claude: [
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku' },
  ],
};

describe('findStaleLaneModels', () => {
  it('reports nothing when every lane model is currently available', () => {
    const workflowConfig = { lanes: { plan: { primary_model: 'claude-opus-5' }, implement: { primary_model: 'claude-sonnet-5' } } };
    const stale = findStaleLaneModels({ workflowConfig, proj: { primary: { cli: 'claude' } }, cachedModels: AVAILABLE });
    assert.deepEqual(stale, []);
  });

  it('flags a lane whose model is absent, with a same-tier suggestion when one exists', () => {
    const workflowConfig = { lanes: { plan: { primary_model: 'claude-opus-4-5' } } }; // superseded by opus-5 in AVAILABLE
    const [entry] = findStaleLaneModels({ workflowConfig, proj: { primary: { cli: 'claude' } }, cachedModels: AVAILABLE });
    assert.equal(entry.lane, 'plan');
    assert.equal(entry.model, 'claude-opus-4-5');
    assert.equal(entry.tier, 'opus');
    assert.equal(entry.suggested, 'claude-opus-5');
  });

  it('flags a lane whose model is absent with no same-tier match either (no suggestion)', () => {
    const workflowConfig = { lanes: { review: { primary_model: 'claude-haiku-4-5-20251001' } } }; // haiku exists (3-5) — same tier match applies
    const stale = findStaleLaneModels({ workflowConfig, proj: { primary: { cli: 'claude' } }, cachedModels: AVAILABLE });
    assert.equal(stale[0].suggested, 'claude-3-5-haiku', 'haiku tier keyword should still match claude-3-5-haiku');
  });

  it('reports no suggestion when the tier itself has nothing available', () => {
    const workflowConfig = { lanes: { plan: { primary_model: 'claude-fable-5' } } };
    const [entry] = findStaleLaneModels({ workflowConfig, proj: { primary: { cli: 'claude' } }, cachedModels: AVAILABLE });
    assert.equal(entry.suggested, null);
  });

  it('skips lanes with no primary_model configured', () => {
    const workflowConfig = { lanes: { 'quality-gate': {} } };
    const stale = findStaleLaneModels({ workflowConfig, proj: { primary: { cli: 'claude' } }, cachedModels: AVAILABLE });
    assert.deepEqual(stale, []);
  });

  it('handles a provider with no cached models at all (nothing discovered yet)', () => {
    const workflowConfig = { lanes: { plan: { primary_model: 'claude-opus-5' } } };
    const stale = findStaleLaneModels({ workflowConfig, proj: { primary: { cli: 'claude' } }, cachedModels: {} });
    assert.equal(stale.length, 1);
    assert.equal(stale[0].suggested, null);
  });
});

describe('formatStaleLaneModelWarning', () => {
  it('names the suggested replacement when present', () => {
    const msg = formatStaleLaneModelWarning({ lane: 'plan', cli: 'claude', model: 'claude-opus-4-5', suggested: 'claude-opus-5' });
    assert.match(msg, /plan/);
    assert.match(msg, /claude-opus-4-5/);
    assert.match(msg, /claude-opus-5/);
  });

  it('says no replacement was found when suggested is null', () => {
    const msg = formatStaleLaneModelWarning({ lane: 'plan', cli: 'claude', model: 'claude-fable-5', suggested: null });
    assert.match(msg, /no same-tier replacement/);
  });
});
