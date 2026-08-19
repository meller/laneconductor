#!/usr/bin/env node
// conductor/tests/track-1117-model-discovery-merge.test.mjs
// Track 1117 Bug 3 (TC-8/TC-9/TC-10): refreshModels()'s merge of live model
// discovery with static per-provider presets (services/model-discovery-merge.mjs).
//
// Run: node --test conductor/tests/track-1117-model-discovery-merge.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDiscoveredWithPresets } from '../services/model-discovery-merge.mjs';

describe('mergeDiscoveredWithPresets', () => {
  // TC-8: a successful, non-empty discovery result must not have any
  // preset id appended that discovery itself omitted.
  it('TC-8: does not append a preset id absent from a successful, non-empty discovery result', () => {
    const discovered = [
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    ];
    const presets = [
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku' }, // retired — omitted by discovery on purpose
    ];
    const result = mergeDiscoveredWithPresets(discovered, presets);
    assert.deepEqual(result, discovered);
    assert.ok(!result.some(m => m.id === 'claude-3-5-haiku'), 'a real discovery\'s omission must be trusted, not overridden by the static preset');
  });

  // TC-9: a failed/empty discovery result must still fall back to presets —
  // preserved existing behavior.
  it('TC-9: falls back to presets when discovery failed/returned empty', () => {
    const presets = [
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    ];
    assert.deepEqual(mergeDiscoveredWithPresets([], presets), presets);
  });

  // TC-10: regression fixture reproducing this session's exact finding —
  // mock discovery returning a Claude model list without claude-3-5-haiku.
  it('TC-10 (regression): discovery excluding claude-3-5-haiku means the merged result also excludes it', () => {
    const discovered = [
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ];
    const presets = [
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku' },
    ];
    const merged = mergeDiscoveredWithPresets(discovered, presets);
    assert.ok(!merged.some(m => m.id === 'claude-3-5-haiku'), 'claude-3-5-haiku must not survive in the merged/cached list once discovery stops reporting it');
  });

  it('an empty presets list with successful discovery just returns discovery', () => {
    const discovered = [{ id: 'claude-opus-5', label: 'Claude Opus 5' }];
    assert.deepEqual(mergeDiscoveredWithPresets(discovered, []), discovered);
  });

  it('both empty returns empty', () => {
    assert.deepEqual(mergeDiscoveredWithPresets([], []), []);
  });

  it('defaults missing args to empty arrays without throwing', () => {
    assert.deepEqual(mergeDiscoveredWithPresets(), []);
  });
});
