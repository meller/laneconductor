#!/usr/bin/env node
// conductor/tests/track-1111-phase6-auto-update.test.mjs
// Track 1111 Phase 6 (TC-9, TC-10): opt-in, same-tier-only, auditable
// auto-update of a stale workflow.json primary_model. Reuses the exact
// `stale` entries findStaleLaneModels (Phase 5) already computes — only
// entries with a same-tier `suggested` replacement are ever applied.
//
// Run: node --test conductor/tests/track-1111-phase6-auto-update.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  findStaleLaneModels,
  applyStaleModelAutoUpdates,
  maybeAutoUpdateWorkflowModels,
} from '../services/model-staleness.mjs';

const AVAILABLE = {
  claude: [
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku' },
  ],
};

describe('applyStaleModelAutoUpdates', () => {
  it('applies only entries with a same-tier suggestion, mutating lanes in place', () => {
    const workflowConfig = {
      lanes: {
        plan: { primary_model: 'claude-opus-4-5' }, // stale, suggested: claude-opus-5
        review: { primary_model: 'claude-fable-5' }, // stale, no suggestion (no fable tier available)
      },
    };
    const stale = findStaleLaneModels({ workflowConfig, proj: { primary: { cli: 'claude' } }, cachedModels: AVAILABLE });
    const applied = applyStaleModelAutoUpdates(workflowConfig, stale);

    assert.deepEqual(applied, [{ lane: 'plan', from: 'claude-opus-4-5', to: 'claude-opus-5' }]);
    assert.equal(workflowConfig.lanes.plan.primary_model, 'claude-opus-5');
    assert.equal(workflowConfig.lanes.review.primary_model, 'claude-fable-5', 'no suggestion → left untouched');
  });

  it('never crosses tiers (no opus→sonnet or similar substitution possible via this path)', () => {
    // suggested is always tier-matched by findStaleLaneModels itself; this
    // just confirms applyStaleModelAutoUpdates doesn't add its own logic
    // that could bypass that.
    const workflowConfig = { lanes: { plan: { primary_model: 'claude-opus-4-5' } } };
    const stale = findStaleLaneModels({ workflowConfig, proj: { primary: { cli: 'claude' } }, cachedModels: AVAILABLE });
    applyStaleModelAutoUpdates(workflowConfig, stale);
    assert.match(workflowConfig.lanes.plan.primary_model, /opus/);
  });

  it('returns an empty list when there is nothing to apply', () => {
    const workflowConfig = { lanes: { plan: { primary_model: 'claude-opus-5' } } };
    const stale = findStaleLaneModels({ workflowConfig, proj: { primary: { cli: 'claude' } }, cachedModels: AVAILABLE });
    assert.deepEqual(applyStaleModelAutoUpdates(workflowConfig, stale), []);
  });
});

describe('maybeAutoUpdateWorkflowModels — opt-in gate (TC-9)', () => {
  it('does nothing when global.auto_update_stale_models is unset (default off)', () => {
    const workflowConfig = { lanes: { plan: { primary_model: 'claude-opus-4-5' } } };
    const stale = findStaleLaneModels({ workflowConfig, proj: { primary: { cli: 'claude' } }, cachedModels: AVAILABLE });
    let writeCalled = false, commitCalled = false;
    const applied = maybeAutoUpdateWorkflowModels({
      workflowConfig, staleEntries: stale,
      writeFile: () => { writeCalled = true; },
      commit: () => { commitCalled = true; },
    });
    assert.deepEqual(applied, []);
    assert.equal(writeCalled, false);
    assert.equal(commitCalled, false);
    assert.equal(workflowConfig.lanes.plan.primary_model, 'claude-opus-4-5', 'unopted-in project must never be auto-updated');
  });

  it('does nothing when global.auto_update_stale_models is explicitly false', () => {
    const workflowConfig = { global: { auto_update_stale_models: false }, lanes: { plan: { primary_model: 'claude-opus-4-5' } } };
    const stale = findStaleLaneModels({ workflowConfig, proj: { primary: { cli: 'claude' } }, cachedModels: AVAILABLE });
    let called = false;
    maybeAutoUpdateWorkflowModels({ workflowConfig, staleEntries: stale, writeFile: () => { called = true; }, commit: () => { called = true; } });
    assert.equal(called, false);
  });

  it('does nothing when opted in but no stale entry has a suggestion', () => {
    const workflowConfig = { global: { auto_update_stale_models: true }, lanes: { plan: { primary_model: 'claude-fable-5' } } };
    const stale = findStaleLaneModels({ workflowConfig, proj: { primary: { cli: 'claude' } }, cachedModels: AVAILABLE });
    let called = false;
    const applied = maybeAutoUpdateWorkflowModels({ workflowConfig, staleEntries: stale, writeFile: () => { called = true; }, commit: () => { called = true; } });
    assert.deepEqual(applied, []);
    assert.equal(called, false);
  });
});

describe('maybeAutoUpdateWorkflowModels — opted-in same-tier update (TC-10)', () => {
  it('applies a same-tier update, writes the file, and commits — never cross-tier', () => {
    const workflowConfig = {
      global: { auto_update_stale_models: true },
      lanes: {
        plan: { primary_model: 'claude-opus-4-5' },      // stale → claude-opus-5
        implement: { primary_model: 'claude-sonnet-5' }, // current, untouched
      },
    };
    const stale = findStaleLaneModels({ workflowConfig, proj: { primary: { cli: 'claude' } }, cachedModels: AVAILABLE });

    let writtenContent = null;
    const commitMessages = [];
    const applied = maybeAutoUpdateWorkflowModels({
      workflowConfig, staleEntries: stale,
      writeFile: (content) => { writtenContent = content; },
      commit: (message) => { commitMessages.push(message); },
    });

    assert.deepEqual(applied, [{ lane: 'plan', from: 'claude-opus-4-5', to: 'claude-opus-5' }]);
    assert.equal(workflowConfig.lanes.plan.primary_model, 'claude-opus-5');
    assert.equal(workflowConfig.lanes.implement.primary_model, 'claude-sonnet-5', 'unrelated lane left alone');

    assert.ok(writtenContent, 'file must be written — not a silent no-op');
    const written = JSON.parse(writtenContent);
    assert.equal(written.lanes.plan.primary_model, 'claude-opus-5');

    assert.equal(commitMessages.length, 1, 'change must be committed, not just written to disk');
    assert.match(commitMessages[0], /plan/);
    assert.match(commitMessages[0], /claude-opus-4-5/);
    assert.match(commitMessages[0], /claude-opus-5/);
  });
});

describe('maybeAutoUpdateWorkflowModels — real git commit, temp repo (live verification)', () => {
  it('actually produces a git commit recording the change, not a silent rewrite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-track-1111-phase6-'));
    try {
      execSync('git init -q', { cwd: dir });
      execSync('git config user.email test@test.com', { cwd: dir });
      execSync('git config user.name Test', { cwd: dir });
      const wfPath = join(dir, 'workflow.json');
      const workflowConfig = { global: { auto_update_stale_models: true }, lanes: { plan: { primary_model: 'claude-opus-4-5' } } };
      writeFileSync(wfPath, JSON.stringify(workflowConfig, null, 2) + '\n');
      execSync('git add workflow.json && git commit -q -m "initial"', { cwd: dir });

      const stale = findStaleLaneModels({ workflowConfig, proj: { primary: { cli: 'claude' } }, cachedModels: AVAILABLE });
      maybeAutoUpdateWorkflowModels({
        workflowConfig, staleEntries: stale,
        writeFile: (content) => writeFileSync(wfPath, content),
        commit: (message) => {
          execSync('git add workflow.json', { cwd: dir });
          execSync(`git commit -q -m ${JSON.stringify(message)}`, { cwd: dir });
        },
      });

      const log = execSync('git log --oneline', { cwd: dir }).toString();
      assert.match(log, /auto-update/, 'the auto-update must appear in git history');
      const onDisk = JSON.parse(readFileSync(wfPath, 'utf8'));
      assert.equal(onDisk.lanes.plan.primary_model, 'claude-opus-5');

      const diff = execSync('git show HEAD', { cwd: dir }).toString();
      assert.match(diff, /claude-opus-4-5/);
      assert.match(diff, /claude-opus-5/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
