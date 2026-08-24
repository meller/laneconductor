// Track 1114 (found live): createWorktree() unconditionally used
// `git worktree add -B <branch> <path> HEAD` whenever it needed to
// (re)create a worktree — `-B` force-creates OR force-resets the branch
// to the given start point even if it already exists with real commits.
// That's correct for a genuinely new track (nothing to lose), but for a
// track whose worktree was removed and is now being resumed, it silently
// discards every commit already on that branch and starts fresh from
// main's current HEAD. Pre-existing bug, independent of anything else
// built this session — Remove Worktree just made the trigger state (no
// worktree, but a real branch with history) far more likely to occur.
//
// Pure decision extracted for testability: laneconductor.sync.mjs has no
// exports, so the actual git-existence check and gitExec call stay there;
// this only owns "given whether the branch already exists, which args are
// safe to use."
export function resolveWorktreeAddArgs({ branchExists, branchName, worktreePath, startPoint }) {
  if (branchExists) {
    // Check the EXISTING branch out as-is — must never reset it.
    return ['worktree', 'add', worktreePath, branchName];
  }
  // Nothing to lose — safe to create fresh from startPoint.
  return ['worktree', 'add', '-B', branchName, worktreePath, startPoint];
}
