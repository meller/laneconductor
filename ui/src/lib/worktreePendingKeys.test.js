// ui/src/lib/worktreePendingKeys.test.js
// Track 1114 Phase 7: previously untested pending-state staleness check —
// the computation the stale-closure bug (#8) depended on being correct.
// The bug itself was that fetchRows' interval kept calling this with a
// frozen, empty pendingKeys snapshot; these tests pin down that the
// computation itself correctly identifies stale keys when given real,
// current inputs (i.e. what should happen once the closure is fixed).
import { describe, it, expect } from 'vitest';
import { computeStillPresentKeys, computeStaleKeys, removeKey, mergeKey, completeKey, forceKey, discardKey, createPrKey, mergePrKey, aiResolveKey } from './worktreePendingKeys.js';

describe('computeStillPresentKeys', () => {
  it('includes the remove key for every row, track-scoped keys only when a track exists', () => {
    const rows = [
      { worktree_path: '/repo/.worktrees/1065', track: '1065' },
      { branch: 'track-999', track: null }, // detached, no track
    ];
    const present = computeStillPresentKeys(rows);
    expect(present.has(removeKey(rows[0]))).toBe(true);
    expect(present.has(mergeKey(rows[0]))).toBe(true);
    expect(present.has(completeKey(rows[0]))).toBe(true);
    expect(present.has(forceKey(rows[0]))).toBe(true);
    expect(present.has(discardKey(rows[0]))).toBe(true);
    expect(present.has(createPrKey(rows[0]))).toBe(true);
    expect(present.has(mergePrKey(rows[0]))).toBe(true);
    expect(present.has(aiResolveKey(rows[0]))).toBe(true);
    expect(present.has(removeKey(rows[1]))).toBe(true);
    expect(present.has(mergeKey(rows[1]))).toBe(false);
    expect(present.has(discardKey(rows[1]))).toBe(false);
    expect(present.has(createPrKey(rows[1]))).toBe(false);
    expect(present.has(mergePrKey(rows[1]))).toBe(false);
    expect(present.has(aiResolveKey(rows[1]))).toBe(false);
  });
});

describe('computeStaleKeys', () => {
  it('marks a pending key stale once its row disappears (removed, or merged out of the unmerged list)', () => {
    const pendingKeys = { 'remove:/repo/.worktrees/1065': 1, 'merge:1067': 2 };
    const rows = [{ worktree_path: '/repo/.worktrees/1067', track: '1067' }]; // 1065's row is gone
    const stale = computeStaleKeys(pendingKeys, rows);
    expect(stale).toEqual(['remove:/repo/.worktrees/1065']);
  });

  it('does not mark a pending key stale while its row is still present under the same identity', () => {
    const row = { worktree_path: '/repo/.worktrees/1065', track: '1065' };
    const pendingKeys = { [removeKey(row)]: 1, [completeKey(row)]: 2 };
    const stale = computeStaleKeys(pendingKeys, [row]);
    expect(stale).toEqual([]);
  });

  it('clears a completed auto-complete/force-merge pending key once the row merges and drops out of the list', () => {
    const row = { worktree_path: '/repo/.worktrees/1065', track: '1065' };
    const pendingKeys = { [completeKey(row)]: 1 };
    // merged rows are simply absent from the next fetch — no longer unmerged relative to main
    const stale = computeStaleKeys(pendingKeys, []);
    expect(stale).toEqual([completeKey(row)]);
  });

  it('clears a discard pending key once the row disappears (discarded rows drop out of the list)', () => {
    const row = { worktree_path: '/repo/.worktrees/1065', track: '1065' };
    const pendingKeys = { [discardKey(row)]: 1 };
    const stale = computeStaleKeys(pendingKeys, []);
    expect(stale).toEqual([discardKey(row)]);
  });

  it('clears a merge-pr pending key once the PR merges and the row drops out of the list', () => {
    const row = { worktree_path: '/repo/.worktrees/10018', track: '10018' };
    const pendingKeys = { [mergePrKey(row)]: 1 };
    const stale = computeStaleKeys(pendingKeys, []);
    expect(stale).toEqual([mergePrKey(row)]);
  });

  it('clears an ai-resolve pending key once the row resolves (mergeable/merged rows change key or drop out)', () => {
    const row = { worktree_path: '/repo/.worktrees/1065', track: '1065' };
    const pendingKeys = { [aiResolveKey(row)]: 1 };
    const stale = computeStaleKeys(pendingKeys, []);
    expect(stale).toEqual([aiResolveKey(row)]);
  });

  it('leaves unrelated pending keys alone when only some rows disappear', () => {
    const rowA = { worktree_path: '/repo/.worktrees/1065', track: '1065' };
    const rowB = { worktree_path: '/repo/.worktrees/1067', track: '1067' };
    const pendingKeys = { [removeKey(rowA)]: 1, [removeKey(rowB)]: 2 };
    const stale = computeStaleKeys(pendingKeys, [rowB]);
    expect(stale).toEqual([removeKey(rowA)]);
  });
});
