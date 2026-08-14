// Track 1114 (found live): the Worktrees panel showed rows like #991,
// #992, #1044 — unmerged branches with real history but NO live worktree
// (already cleaned up some other way, or never had one recreated). "If
// they don't have a worktree they shouldn't appear in Worktrees" —
// correct, EXCEPT `stranded` rows, which are BY DEFINITION always
// worktree-less (done:success, no worktree) — that's the exact orphaned-
// but-ready-to-merge case this whole panel exists to surface. Filtering
// those out too would silently defeat the panel's original purpose.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { belongsInWorktreesPanel } from '../services/worktree-panel-scope.mjs';

describe('belongsInWorktreesPanel', () => {
  it('excludes an open row with no live worktree — abandoned, nothing to show', () => {
    assert.equal(belongsInWorktreesPanel({ classification: 'open', hasWorktree: false }), false);
  });

  it('includes an open row that has a live worktree — real active work', () => {
    assert.equal(belongsInWorktreesPanel({ classification: 'open', hasWorktree: true }), true);
  });

  it('includes a stranded row even with no worktree — that IS the definition of stranded', () => {
    assert.equal(belongsInWorktreesPanel({ classification: 'stranded', hasWorktree: false }), true);
  });

  it('includes mergeable/conflicted rows (always have a worktree by their own classification rules)', () => {
    assert.equal(belongsInWorktreesPanel({ classification: 'mergeable', hasWorktree: true }), true);
    assert.equal(belongsInWorktreesPanel({ classification: 'conflicted', hasWorktree: true }), true);
  });

  it('includes detached rows — always have a worktree by definition (that is how they are found)', () => {
    assert.equal(belongsInWorktreesPanel({ classification: 'detached', hasWorktree: true }), true);
  });
});
