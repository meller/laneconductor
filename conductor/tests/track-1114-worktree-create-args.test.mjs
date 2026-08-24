// Track 1114: reproduces the real data-loss bug found live —
// createWorktree() always used `-B <branch> <path> HEAD`, which resets an
// EXISTING branch to HEAD even when it already has real commits (e.g. a
// track whose worktree was removed via the new Remove Worktree feature,
// then resumed via Complete & Merge). The fix's whole safety property is
// captured here: never emit `-B` for a branch that already exists.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorktreeAddArgs } from '../services/worktree-create-args.mjs';

describe('resolveWorktreeAddArgs', () => {
  it('creates fresh with -B when the branch does not exist yet (nothing to lose)', () => {
    const args = resolveWorktreeAddArgs({ branchExists: false, branchName: 'track-1114', worktreePath: '/repo/.worktrees/1114', startPoint: 'HEAD' });
    assert.deepEqual(args, ['worktree', 'add', '-B', 'track-1114', '/repo/.worktrees/1114', 'HEAD']);
  });

  it('checks out the existing branch as-is when it already exists — no -B, no reset', () => {
    const args = resolveWorktreeAddArgs({ branchExists: true, branchName: 'track-10000', worktreePath: '/repo/.worktrees/10000', startPoint: 'HEAD' });
    assert.deepEqual(args, ['worktree', 'add', '/repo/.worktrees/10000', 'track-10000']);
    assert.ok(!args.includes('-B'), 'must never force-reset an existing branch');
  });
});
