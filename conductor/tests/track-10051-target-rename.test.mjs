#!/usr/bin/env node
// conductor/tests/track-10051-target-rename.test.mjs
// Track 10051 Phase 1 (TC-1.1 … TC-1.10): the compatibility seam for the
// 'collectors' -> 'targets' rename.
//
// Why this module exists at all: `.laneconductor.json`'s `collectors` key
// and `.env`'s COLLECTOR_<n>_TOKEN already exist on every user's disk, and
// those tokens ALSO live in CI secrets and GCP Secret Manager entries this
// codebase cannot reach. So the rename is dual-read / single-write:
//   - read `targets ?? collectors`, preferring `targets`
//   - write only `targets` (dropping `collectors` on a write the user
//     already triggered)
//   - NEVER rewrite a user's .env
//
// Config was previously parsed independently in six places (bin/lc.mjs,
// laneconductor.sync.mjs, lock.mjs, unlock.mjs, collector/index.mjs,
// ProjectConfigSettings.jsx). Six hand-rolled fallbacks would drift, which
// is the whole reason this is one shared module rather than an inline
// `?? config.collectors` at each call site.
//
// Run: node --test conductor/tests/track-10051-target-rename.test.mjs

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  readTargets,
  writeTargets,
  resolveTargetToken,
  resolveTargetEnv,
} from '../services/sync-targets.mjs';

// Each test mutates process.env; snapshot and restore so cases stay independent.
const TOUCHED = [
  'TARGET_0_TOKEN', 'COLLECTOR_0_TOKEN',
  'TARGET_1_TOKEN', 'COLLECTOR_1_TOKEN',
  'TARGET_2_TOKEN', 'COLLECTOR_2_TOKEN',
  'TARGET_PORT', 'COLLECTOR_PORT',
  'TARGET_URL', 'COLLECTOR_URL',
  'TARGET_TOKEN_ENV', 'COLLECTOR_TOKEN_ENV',
];
let saved = {};

beforeEach(() => {
  saved = {};
  for (const k of TOUCHED) { saved[k] = process.env[k]; delete process.env[k]; }
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ── readTargets: config key dual-read (REQ-1) ────────────────────────────────

describe('readTargets — legacy `collectors` key still works (REQ-1)', () => {
  it('TC-1.1: reads a legacy-only config', () => {
    const cfg = { collectors: [{ url: 'http://a' }] };
    assert.deepEqual(readTargets(cfg), [{ url: 'http://a' }]);
  });

  it('TC-1.2: reads a new-only config', () => {
    const cfg = { targets: [{ url: 'http://b' }] };
    assert.deepEqual(readTargets(cfg), [{ url: 'http://b' }]);
  });

  it('TC-1.3: prefers `targets` when both keys are present', () => {
    const cfg = { targets: [{ url: 'http://b' }], collectors: [{ url: 'http://a' }] };
    assert.deepEqual(readTargets(cfg), [{ url: 'http://b' }],
      'a half-migrated config must not fan out to the stale legacy URL');
  });

  it('TC-1.4: returns [] for a config with neither key, without throwing', () => {
    assert.deepEqual(readTargets({}), []);
  });

  it('TC-1.4b: tolerates null/undefined config (local-fs has no config at all)', () => {
    assert.deepEqual(readTargets(null), []);
    assert.deepEqual(readTargets(undefined), []);
  });

  it('TC-1.4c: an explicitly empty `targets` array is respected, not treated as unset', () => {
    // Distinguishing [] from "unset" matters: `targets: []` is how a project
    // is deliberately put into local-fs mode. Falling through to a stale
    // `collectors` here would silently resurrect sync the user turned off.
    const cfg = { targets: [], collectors: [{ url: 'http://a' }] };
    assert.deepEqual(readTargets(cfg), []);
  });
});

// ── writeTargets: single-write + opportunistic migration (REQ-2) ─────────────

describe('writeTargets — writes `targets`, drops `collectors` (REQ-2)', () => {
  it('TC-1.5: sets `targets` and removes the legacy key entirely', () => {
    const cfg = { project: { name: 'x' }, collectors: [{ url: 'http://a' }] };
    writeTargets(cfg, [{ url: 'http://b' }]);
    assert.deepEqual(cfg.targets, [{ url: 'http://b' }]);
    assert.equal('collectors' in cfg, false,
      'leaving `collectors` behind would make readTargets ambiguous forever');
  });

  it('TC-1.5b: preserves unrelated config keys', () => {
    const cfg = { mode: 'local-api', project: { id: 1 }, collectors: [] };
    writeTargets(cfg, [{ url: 'http://b' }]);
    assert.equal(cfg.mode, 'local-api');
    assert.deepEqual(cfg.project, { id: 1 });
  });

  it('TC-1.5c: is a no-op on the legacy key when there was none', () => {
    const cfg = { targets: [{ url: 'http://a' }] };
    writeTargets(cfg, [{ url: 'http://b' }]);
    assert.deepEqual(cfg.targets, [{ url: 'http://b' }]);
    assert.equal('collectors' in cfg, false);
  });
});

// ── resolveTargetToken: env dual-read (REQ-3) ────────────────────────────────

describe('resolveTargetToken — legacy COLLECTOR_<n>_TOKEN still authenticates (REQ-3)', () => {
  it('TC-1.6: falls back to COLLECTOR_<n>_TOKEN when only that is set', () => {
    process.env.COLLECTOR_0_TOKEN = 'lc_legacy';
    assert.equal(resolveTargetToken(0), 'lc_legacy');
  });

  it('TC-1.7: reads TARGET_<n>_TOKEN when only that is set', () => {
    process.env.TARGET_0_TOKEN = 'lc_new';
    assert.equal(resolveTargetToken(0), 'lc_new');
  });

  it('TC-1.8: prefers TARGET_<n>_TOKEN when both are set', () => {
    process.env.TARGET_0_TOKEN = 'lc_new';
    process.env.COLLECTOR_0_TOKEN = 'lc_legacy';
    assert.equal(resolveTargetToken(0), 'lc_new');
  });

  it('TC-1.9: returns null when neither is set, without throwing', () => {
    assert.equal(resolveTargetToken(2), null);
  });

  it('TC-1.9b: indexes are independent (index 1 does not read index 0)', () => {
    process.env.COLLECTOR_0_TOKEN = 'lc_zero';
    assert.equal(resolveTargetToken(1), null);
  });

  it('TC-1.9c: an empty-string token is treated as absent, not as a valid token', () => {
    // An empty COLLECTOR_0_TOKEN= line in .env is common; sending
    // `Authorization: Bearer ` is worse than sending no header at all.
    process.env.COLLECTOR_0_TOKEN = '';
    assert.equal(resolveTargetToken(0), null);
  });
});

// ── resolveTargetEnv: the other COLLECTOR_* vars (REQ-4) ─────────────────────

describe('resolveTargetEnv — PORT/URL/TOKEN_ENV dual-read (REQ-4)', () => {
  it('TC-1.10: falls back to COLLECTOR_PORT', () => {
    process.env.COLLECTOR_PORT = '8092';
    assert.equal(resolveTargetEnv('PORT'), '8092');
  });

  it('TC-1.10b: prefers TARGET_PORT over COLLECTOR_PORT', () => {
    process.env.TARGET_PORT = '9000';
    process.env.COLLECTOR_PORT = '8092';
    assert.equal(resolveTargetEnv('PORT'), '9000');
  });

  it('TC-1.10c: covers URL and TOKEN_ENV the same way', () => {
    process.env.COLLECTOR_URL = 'http://legacy';
    process.env.COLLECTOR_TOKEN_ENV = 'MY_TOKEN';
    assert.equal(resolveTargetEnv('URL'), 'http://legacy');
    assert.equal(resolveTargetEnv('TOKEN_ENV'), 'MY_TOKEN');
  });

  it('TC-1.10d: returns null for an unset name', () => {
    assert.equal(resolveTargetEnv('PORT'), null);
  });
});
