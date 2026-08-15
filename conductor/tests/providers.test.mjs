#!/usr/bin/env node
// conductor/tests/providers.test.mjs
// Canonical provider registry (conductor/providers.mjs) — track 10011.
//
// Run: node --test conductor/tests/providers.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDERS,
  PROVIDER_IDS,
  normalizeProviderId,
  providerIcon,
  providerLabel,
  defaultModelFor,
} from '../providers.mjs';

describe('conductor/providers.mjs', () => {
  describe('normalizeProviderId', () => {
    it('TC-1: resolves the legacy agy alias to antigravity', () => {
      assert.equal(normalizeProviderId('agy'), 'antigravity');
    });

    it('TC-2: leaves an already-canonical id unchanged', () => {
      assert.equal(normalizeProviderId('claude'), 'claude');
    });

    it('TC-3: passes through an unrecognized id unchanged', () => {
      assert.equal(normalizeProviderId('some-future-provider'), 'some-future-provider');
      assert.equal(normalizeProviderId('other'), 'other');
    });
  });

  describe('PROVIDER_IDS', () => {
    it('TC-4: matches the registry order used to drive UI dropdowns', () => {
      assert.deepEqual(PROVIDER_IDS, ['claude', 'gemini', 'copilot', 'antigravity']);
    });
  });

  describe('providerIcon', () => {
    it('TC-5: resolves the alias before lookup — agy and antigravity match', () => {
      assert.equal(providerIcon('antigravity'), providerIcon('agy'));
      assert.equal(providerIcon('agy'), PROVIDERS.antigravity.icon);
    });

    it('TC-6: returns the generic fallback for an unrecognized id, never throws/undefined', () => {
      assert.equal(providerIcon('unknown-id'), '🤖');
    });
  });

  describe('providerLabel', () => {
    it('never returns a claude-specific fallback for an unrecognized id', () => {
      assert.equal(providerLabel('some-provider'), 'Some-provider');
      assert.equal(providerLabel(null), 'AI');
    });
  });

  describe('defaultModelFor', () => {
    it('TC-7: returns the first model of the given provider, not another provider\'s', () => {
      assert.equal(defaultModelFor('gemini'), PROVIDERS.gemini.models[0].id);
      assert.notEqual(defaultModelFor('gemini'), PROVIDERS.claude.models[0].id);
    });

    it('TC-8: returns null for an unrecognized id', () => {
      assert.equal(defaultModelFor('unknown-id'), null);
    });
  });

  describe('registry shape', () => {
    it('every provider has models, icon, label; antigravity aliases agy; gemini is retired', () => {
      for (const id of PROVIDER_IDS) {
        const p = PROVIDERS[id];
        assert.ok(p.icon, `${id} missing icon`);
        assert.ok(p.label, `${id} missing label`);
        assert.ok(Array.isArray(p.models) && p.models.length > 0, `${id} missing models`);
      }
      assert.ok(PROVIDERS.antigravity.aliases.includes('agy'));
      assert.equal(PROVIDERS.gemini.retired, true);
      assert.ok(PROVIDERS.gemini.retiredMessage);
    });
  });
});
