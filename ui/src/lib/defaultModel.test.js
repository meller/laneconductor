// ui/src/lib/defaultModel.test.js
// Track 1116 REQ-3: getDefaultProviderModel's 3-tier fallback chain.
import { describe, it, expect } from 'vitest';
import { getDefaultProviderModel } from './defaultModel.js';

describe('getDefaultProviderModel', () => {
  it('TC-0a: project with primary_cli/primary_model configured returns exactly that pair', () => {
    const project = { primary_cli: 'antigravity', primary_model: 'gemini-2.5-pro' };
    const workers = [{ cli: 'claude', available_models: ['claude-opus-5'] }];
    expect(getDefaultProviderModel(project, workers)).toEqual({ cli: 'antigravity', model: 'gemini-2.5-pro' });
  });

  it('TC-0b: no configured default, a worker reports available_models for a provider — returns that provider + first live model', () => {
    const project = {};
    const workers = [{ cli: 'antigravity', available_models: ['gemini-2.5-pro', 'gemini-2.5-flash'] }];
    expect(getDefaultProviderModel(project, workers)).toEqual({ cli: 'antigravity', model: 'gemini-2.5-pro' });
  });

  it('TC-0c: no configured default and no worker data — returns registry recommended entry', () => {
    expect(getDefaultProviderModel({}, [])).toEqual({ cli: 'claude', model: 'claude-sonnet-5' });
  });

  it('TC-0d: handles both nested (project.primary.cli) and flat (project.primary_cli) shapes without throwing', () => {
    const nested = { primary: { cli: 'claude', model: 'claude-opus-5' } };
    const flat = { primary_cli: 'claude', primary_model: 'claude-opus-5' };
    expect(getDefaultProviderModel(nested, [])).toEqual({ cli: 'claude', model: 'claude-opus-5' });
    expect(getDefaultProviderModel(flat, [])).toEqual({ cli: 'claude', model: 'claude-opus-5' });
    expect(() => getDefaultProviderModel(undefined, undefined)).not.toThrow();
    expect(() => getDefaultProviderModel(null, null)).not.toThrow();
  });

  it('cli configured but model not — prefers a live model for that specific provider over the static preset', () => {
    const project = { primary_cli: 'claude' };
    const workers = [{ cli: 'claude', available_models: ['claude-opus-5'] }];
    expect(getDefaultProviderModel(project, workers)).toEqual({ cli: 'claude', model: 'claude-opus-5' });
  });

  it('cli configured, no model, no live data for that provider — falls back to the registry recommended slot for that provider (not claude)', () => {
    const project = { primary_cli: 'antigravity' };
    expect(getDefaultProviderModel(project, [])).toEqual({ cli: 'antigravity', model: 'auto' });
  });

  it('merges across workers: skips a worker with no live models for the target provider before finding one that has them', () => {
    const project = { primary_cli: 'claude' };
    const workers = [
      { cli: 'antigravity', available_models: ['gemini-2.5-pro'] },
      { cli: 'claude', available_models: [] },
      { cli: 'claude', available_models: ['claude-sonnet-4-5'] },
    ];
    expect(getDefaultProviderModel(project, workers)).toEqual({ cli: 'claude', model: 'claude-sonnet-4-5' });
  });

  it('available_models as an object keyed by provider id is handled (not just a flat array)', () => {
    const project = {};
    const workers = [{ cli: 'claude', available_models: { claude: ['claude-sonnet-4-5'] } }];
    expect(getDefaultProviderModel(project, workers)).toEqual({ cli: 'claude', model: 'claude-sonnet-4-5' });
  });
});
