// conductor/tests/track-10021-scoped-worker.test.mjs
// Track 10021 Phase 2 Task 8: unit tests for the pure parts of
// conductor/tests/playwright/helpers/scoped-worker.mjs — the parts that
// don't need a live UI/API/worker to exercise.
//
// The orchestration functions (createTrackViaUI, enableAutoRun,
// spawnScopedWorker, waitForLaneAction, cleanup) are exercised for real by
// the specs that use them (new-track-plan.spec.js, brainstorm-concurrency.spec.js)
// in the slow Playwright tier — that IS their integration test.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveWorkerNumber,
  classifyDirtyPaths,
  isMainModeBlocked,
  resolveTrackDir,
} from '../tests/playwright/helpers/scoped-worker.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Track 10021: deriveWorkerNumber (F3 regression guard)', () => {
  it('TC-4: never returns 1 across 1000 simulated PIDs', () => {
    for (let pid = 1; pid <= 1000; pid++) {
      assert.notEqual(deriveWorkerNumber(pid), 1);
    }
  });

  it('TC-4: always returns a value in the reserved throwaway range (9000-9999)', () => {
    for (let pid = 1; pid <= 1000; pid++) {
      const n = deriveWorkerNumber(pid);
      assert.ok(n >= 9000 && n <= 9999, `worker number ${n} for pid ${pid} out of reserved range`);
    }
  });

  it('different PIDs derive different worker numbers (collision avoidance across concurrent runs)', () => {
    assert.notEqual(deriveWorkerNumber(12345), deriveWorkerNumber(54321));
  });
});

describe('Track 10021: classifyDirtyPaths (mirrors laneconductor.sync.mjs:4206 main-mode guard)', () => {
  it('TC-5: a change inside the scoped track\'s own folder is NOT disqualifying', () => {
    const dirty = ['conductor/tracks/10050-my-track/index.md', 'conductor/tracks/10050-my-track/plan.md'];
    assert.deepEqual(classifyDirtyPaths(dirty, ['10050-my-track']), []);
  });

  it('TC-5: a change outside the scoped track folder(s) IS disqualifying', () => {
    const dirty = ['conductor/tracks/999-other-track/index.md', 'src/app.js'];
    assert.deepEqual(classifyDirtyPaths(dirty, ['10050-my-track']), dirty);
  });

  it('TC-5: worker bookkeeping files are not disqualifying', () => {
    const dirty = ['conductor/.sync.pid', 'conductor/.sync-9042.lock-target', 'conductor/tracks-metadata.json'];
    assert.deepEqual(classifyDirtyPaths(dirty, ['10050-my-track']), []);
  });

  it('TC-5: a path outside conductor/ entirely is disqualifying (not accidentally matched as bookkeeping)', () => {
    const dirty = ['README.md'];
    assert.deepEqual(classifyDirtyPaths(dirty, ['10050-my-track']), dirty);
  });

  it('a change inside ANY of multiple scoped track folders is not disqualifying (Phase 4: one worker, two tracks)', () => {
    const dirty = ['conductor/tracks/10050-a/index.md', 'conductor/tracks/10051-b/plan.md'];
    assert.deepEqual(classifyDirtyPaths(dirty, ['10050-a', '10051-b']), []);
  });
});

describe('Track 10021: isMainModeBlocked (F4 abort-on-blocked detector)', () => {
  it('TC-6: fires on the literal message text the worker writes', () => {
    const content = `> **system**: ⚠️ Main-mode run blocked — the primary checkout has unrelated uncommitted changes outside this track's folder: src/foo.js. Not spawning; will retry next cycle once the checkout is clean.`;
    assert.equal(isMainModeBlocked(content), true);
  });

  it('TC-6: does not fire on an ordinary system comment', () => {
    const content = `> **system**: ✅ Plan complete — moved to implement.`;
    assert.equal(isMainModeBlocked(content), false);
  });

  it('does not fire on empty/undefined content', () => {
    assert.equal(isMainModeBlocked(''), false);
    assert.equal(isMainModeBlocked(undefined), false);
  });
});

describe('Track 10021: resolveTrackDir (REQ-1 — tolerates both folder layouts)', () => {
  let root;
  it('setup', () => {
    root = mkdtempSync(join(tmpdir(), 'track-10021-resolve-'));
    mkdirSync(join(root, 'conductor/tracks/10050-my-feature'), { recursive: true });
    mkdirSync(join(root, 'conductor/tracks/AM-10051-another-one'), { recursive: true });
    mkdirSync(join(root, 'conductor/tracks/008-legacy-padded'), { recursive: true });
  });

  it('resolves a legacy NNN-slug folder', () => {
    assert.equal(resolveTrackDir(root, '10050'), '10050-my-feature');
  });

  it('resolves an INITIALS-NNN-slug folder', () => {
    assert.equal(resolveTrackDir(root, '10051'), 'AM-10051-another-one');
  });

  it('normalises zero-padding differences', () => {
    assert.equal(resolveTrackDir(root, '8'), '008-legacy-padded');
    assert.equal(resolveTrackDir(root, '008'), '008-legacy-padded');
  });

  it('returns null when no folder matches', () => {
    assert.equal(resolveTrackDir(root, '99999'), null);
  });

  it('teardown', () => {
    rmSync(root, { recursive: true, force: true });
  });
});
