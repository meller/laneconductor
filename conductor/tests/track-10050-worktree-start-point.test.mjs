// Track 10050: createWorktree() based every new track branch on the literal
// string `HEAD` (laneconductor.sync.mjs:3940). Two defects fall out of that:
// the base is whatever local <main> happened to be (arbitrarily stale — see
// the module's own header for why), and `HEAD` isn't even <main> when the
// primary checkout is sitting on some other branch.
//
// The tempting fix — base on origin/<main> unconditionally, which
// conductor/lock.mjs:138 already does — is WRONG and would regress this repo
// badly. TC-3 is the case that proves it: local main here is permanently
// ahead of origin/main (measured 27/0 while planning) because the worker
// commits to main on every lane action and nothing ever pushes. Basing on
// origin/main there silently drops all 27.
//
// One test per row of spec.md's resolution table.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorktreeStartPoint } from '../services/worktree-start-point.mjs';

const base = { mainBranch: 'main', mainRefExists: true, fetchOk: true };

describe('resolveWorktreeStartPoint', () => {
  it('TC-1: behind + fast-forwarded → the local <main> ref, now equal to origin/<main>', () => {
    const out = resolveWorktreeStartPoint({ ...base, ahead: 0, behind: 3, pullOutcome: 'pulled' });
    assert.deepEqual(out, { startPoint: 'main', reason: 'refreshed', staleBy: 0 });
  });

  it('TC-2: behind but the pull was refused → origin/<main> directly (nothing local to lose)', () => {
    const out = resolveWorktreeStartPoint({ ...base, ahead: 0, behind: 3, pullOutcome: 'dirty-overlap' });
    assert.deepEqual(out, { startPoint: 'origin/main', reason: 'remote-ahead-pull-refused', staleBy: 0 });
  });

  it('TC-2b: every other pull refusal reason behaves identically to dirty-overlap', () => {
    for (const pullOutcome of ['auto-pull-disabled', 'merge-failed', 'fetch-failed', null]) {
      const out = resolveWorktreeStartPoint({ ...base, ahead: 0, behind: 3, pullOutcome });
      assert.deepEqual(out, { startPoint: 'origin/main', reason: 'remote-ahead-pull-refused', staleBy: 0 },
        `pullOutcome=${pullOutcome} should still resolve to origin/main`);
    }
  });

  it('TC-3: local ahead → the local <main> ref, NEVER origin/<main> (this repo\'s steady state)', () => {
    const out = resolveWorktreeStartPoint({ ...base, ahead: 27, behind: 0, pullOutcome: null });
    assert.deepEqual(out, { startPoint: 'main', reason: 'local-ahead', staleBy: 0 });
    assert.notEqual(out.startPoint, 'origin/main',
      'basing on origin/main here would drop 27 local-only commits — the exact regression this track exists to avoid');
  });

  it('TC-4: diverged → local <main>, and staleBy reports the commits we are missing', () => {
    const out = resolveWorktreeStartPoint({ ...base, ahead: 4, behind: 2, pullOutcome: null });
    assert.deepEqual(out, { startPoint: 'main', reason: 'diverged', staleBy: 2 });
  });

  it('TC-5: in sync → local <main>, never reported stale', () => {
    const out = resolveWorktreeStartPoint({ ...base, ahead: 0, behind: 0, pullOutcome: null });
    assert.equal(out.startPoint, 'main');
    assert.equal(out.staleBy, 0);
    assert.equal(out.reason, 'in-sync');
  });

  it('TC-6: fetch failed → local <main>, staleBy null (unknown, not zero)', () => {
    const out = resolveWorktreeStartPoint({ ...base, fetchOk: false, ahead: null, behind: null, pullOutcome: null });
    assert.deepEqual(out, { startPoint: 'main', reason: 'offline', staleBy: null });
    assert.notEqual(out.staleBy, 0,
      'the caller must be able to distinguish "known fresh" from "cannot tell" — REQ-7 stays silent on the latter');
  });

  it('TC-7: no local <main> ref → falls back to HEAD, whatever else is true', () => {
    const combos = [
      { fetchOk: true, ahead: 0, behind: 5, pullOutcome: 'pulled' },
      { fetchOk: true, ahead: 9, behind: 0, pullOutcome: null },
      { fetchOk: true, ahead: 1, behind: 1, pullOutcome: null },
      { fetchOk: false, ahead: null, behind: null, pullOutcome: null },
    ];
    for (const combo of combos) {
      const out = resolveWorktreeStartPoint({ ...base, mainRefExists: false, ...combo });
      assert.deepEqual(out, { startPoint: 'HEAD', reason: 'no-main-ref', staleBy: null },
        `combo ${JSON.stringify(combo)} must still fall back to HEAD`);
    }
  });

  it('TC-8: honours a non-"main" default branch — no hardcoded "main" anywhere', () => {
    const master = { mainBranch: 'master', mainRefExists: true, fetchOk: true };
    assert.equal(resolveWorktreeStartPoint({ ...master, ahead: 0, behind: 3, pullOutcome: 'pulled' }).startPoint, 'master');
    assert.equal(resolveWorktreeStartPoint({ ...master, ahead: 0, behind: 3, pullOutcome: 'merge-failed' }).startPoint, 'origin/master');
    assert.equal(resolveWorktreeStartPoint({ ...master, ahead: 2, behind: 0, pullOutcome: null }).startPoint, 'master');
  });

  it('is pure — same input, same output, no observable side effects', () => {
    const input = { ...base, ahead: 4, behind: 2, pullOutcome: null };
    const frozen = Object.freeze({ ...input });
    const a = resolveWorktreeStartPoint(frozen);
    const b = resolveWorktreeStartPoint(frozen);
    assert.deepEqual(a, b);
  });
});
