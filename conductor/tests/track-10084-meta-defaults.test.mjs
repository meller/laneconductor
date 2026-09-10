// conductor/tests/track-10084-meta-defaults.test.mjs
// Track 10084 Phase 1: pure unit tests for conductor/services/meta-defaults.mjs
// — loadMetaDefaults()'s never-throw file read, and the two merge helpers
// implementing spec.md REQ-2 (primary.cli/model 5-tier precedence) and
// REQ-3 (workflow.json field-level deep merge).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mergeEffectivePrimary, mergeWorkflowConfig, loadMetaDefaults } from '../services/meta-defaults.mjs';

const HARDCODED = { project: { primary: { cli: 'claude', model: null } } };

describe('mergeEffectivePrimary (TC-1.4..1.9)', () => {
  test('TC-1.4: project config wins over every other tier', () => {
    const result = mergeEffectivePrimary({
      hardcoded: HARDCODED,
      metaDefaults: { project: { primary: { cli: 'gemini', model: 'meta-model' } } },
      projectDefaults: { project: { primary: { cli: 'antigravity', model: 'defaults-model' } } },
      projectConfig: { project: { primary: { cli: 'claude', model: 'config-model' } } },
    });
    assert.deepEqual(result, { cli: 'claude', model: 'config-model' });
  });

  test('TC-1.5: project config (.laneconductor.json) wins over project defaults.json, meta, hardcoded', () => {
    const result = mergeEffectivePrimary({
      hardcoded: HARDCODED,
      metaDefaults: { project: { primary: { cli: 'gemini' } } },
      projectDefaults: { project: { primary: { cli: 'antigravity' } } },
      projectConfig: { project: { primary: { cli: 'claude' } } },
    });
    assert.equal(result.cli, 'claude');
  });

  test('TC-1.6: project defaults.json wins over meta and hardcoded when project config is silent', () => {
    const result = mergeEffectivePrimary({
      hardcoded: HARDCODED,
      metaDefaults: { project: { primary: { cli: 'gemini' } } },
      projectDefaults: { project: { primary: { cli: 'antigravity' } } },
      projectConfig: {},
    });
    assert.equal(result.cli, 'antigravity');
  });

  test('TC-1.7: meta defaults win over hardcoded when every project-level tier is silent', () => {
    const result = mergeEffectivePrimary({
      hardcoded: HARDCODED,
      metaDefaults: { project: { primary: { cli: 'gemini' } } },
      projectDefaults: {},
      projectConfig: {},
    });
    assert.equal(result.cli, 'gemini');
  });

  test('TC-1.8: hardcoded fallback wins when every tier including meta is silent', () => {
    const result = mergeEffectivePrimary({
      hardcoded: HARDCODED,
      metaDefaults: {},
      projectDefaults: {},
      projectConfig: {},
    });
    assert.equal(result.cli, 'claude');
  });

  test('TC-1.9: inheritMetaDefaults: false skips the meta tier entirely, even when it has a value', () => {
    const result = mergeEffectivePrimary({
      hardcoded: HARDCODED,
      metaDefaults: { project: { primary: { cli: 'gemini' } } },
      projectDefaults: {},
      projectConfig: {},
      inheritMetaDefaults: false,
    });
    assert.equal(result.cli, 'claude');
  });

  test('field-level: project config setting only cli still inherits model from a lower tier', () => {
    const result = mergeEffectivePrimary({
      hardcoded: HARDCODED,
      metaDefaults: { project: { primary: { model: 'meta-model' } } },
      projectDefaults: {},
      projectConfig: { project: { primary: { cli: 'antigravity' } } },
    });
    assert.deepEqual(result, { cli: 'antigravity', model: 'meta-model' });
  });
});

describe('mergeWorkflowConfig (TC-1.10..1.13)', () => {
  const globalCanonical = {
    lanes: {
      plan: { parallel_limit: 3, max_retries: 1, on_success: 'plan:success', on_failure: 'backlog' },
      review: { parallel_limit: 2, max_retries: 2, on_success: 'quality-gate:queue', on_failure: 'implement:queue' },
    },
    global: { total_parallel_limit: 3 },
  };

  test('TC-1.10: project overriding only lanes.review.max_retries still inherits every other lane from meta', () => {
    const meta = {
      lanes: {
        plan: { parallel_limit: 5 },
        review: { max_retries: 4 },
      },
    };
    const project = { lanes: { review: { max_retries: 9 } } };

    const merged = mergeWorkflowConfig({ projectWorkflow: project, metaWorkflow: meta, globalCanonicalWorkflow: globalCanonical });

    assert.equal(merged.lanes.review.max_retries, 9); // project wins
    assert.equal(merged.lanes.plan.parallel_limit, 5); // inherited from meta
    assert.equal(merged.lanes.plan.on_success, 'plan:success'); // inherited from canonical (meta didn't mention it)
  });

  test('TC-1.11: a lane meta does not mention at all falls through to globalCanonicalWorkflow', () => {
    const meta = { lanes: { review: { max_retries: 4 } } };
    const merged = mergeWorkflowConfig({ projectWorkflow: null, metaWorkflow: meta, globalCanonicalWorkflow: globalCanonical });
    assert.deepEqual(merged.lanes.plan, globalCanonical.lanes.plan);
  });

  test('TC-1.12: project value always wins over meta for the same lane+key even when both are set', () => {
    const meta = { lanes: { plan: { parallel_limit: 5 } } };
    const project = { lanes: { plan: { parallel_limit: 1 } } };
    const merged = mergeWorkflowConfig({ projectWorkflow: project, metaWorkflow: meta, globalCanonicalWorkflow: globalCanonical });
    assert.equal(merged.lanes.plan.parallel_limit, 1);
  });

  test('TC-1.13: inheritMetaDefaults: false yields the same result as metaWorkflow omitted entirely', () => {
    const meta = { lanes: { plan: { parallel_limit: 5 } } };
    const project = { lanes: { review: { max_retries: 9 } } };

    const withOptOut = mergeWorkflowConfig({ projectWorkflow: project, metaWorkflow: meta, globalCanonicalWorkflow: globalCanonical, inheritMetaDefaults: false });
    const withoutMeta = mergeWorkflowConfig({ projectWorkflow: project, metaWorkflow: undefined, globalCanonicalWorkflow: globalCanonical });

    assert.deepEqual(withOptOut, withoutMeta);
    assert.equal(withOptOut.lanes.plan.parallel_limit, 3); // canonical's value, not meta's 5
  });

  test('global block merges the same way as lanes', () => {
    const meta = { global: { total_parallel_limit: 10 } };
    const project = {};
    const merged = mergeWorkflowConfig({ projectWorkflow: project, metaWorkflow: meta, globalCanonicalWorkflow: globalCanonical });
    assert.equal(merged.global.total_parallel_limit, 10);
  });
});

describe('loadMetaDefaults (TC-1.1..1.3) — real temp file, injected path', () => {
  let dir, path;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'lc-meta-defaults-'));
    mkdirSync(join(dir, 'conductor'), { recursive: true });
    path = join(dir, 'conductor', 'meta-defaults.json');
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  test('TC-1.1: missing file returns {}, does not throw', () => {
    assert.doesNotThrow(() => loadMetaDefaults(path));
    assert.deepEqual(loadMetaDefaults(path), {});
  });

  test('TC-1.2: malformed JSON degrades to {}, does not throw', () => {
    writeFileSync(path, '{ not valid json');
    assert.doesNotThrow(() => loadMetaDefaults(path));
    assert.deepEqual(loadMetaDefaults(path), {});
  });

  test('TC-1.3: valid file returns the parsed object unchanged', () => {
    const payload = { project: { primary: { cli: 'claude', model: 'haiku' } } };
    writeFileSync(path, JSON.stringify(payload));
    assert.deepEqual(loadMetaDefaults(path), payload);
  });
});
