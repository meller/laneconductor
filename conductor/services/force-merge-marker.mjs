// Track 1114 Phase 7: the merge-worktree dispatch handler's "force on a
// track that hasn't reached done:success" branch (laneconductor.sync.mjs)
// writes a done:success marker onto the worktree's own index.md before
// merging, so the board and git history don't diverge (see index.md
// finding #4 — previously force only bypassed the merge's own done-check
// and never touched lane state, leaving the board showing "review" while
// the code was already in main). Extracted here so the decision and the
// text mutation are each testable without a real worktree, git process, or
// dispatch queue.

// Should this force-merge write a done:success marker onto the branch
// before merging? Only when force is set AND the track genuinely hasn't
// reached done:success on its own AND a worktree actually exists to write
// into (a `stranded` row with no live worktree falls back to the
// pre-existing git-only force-merge behavior — lane state is left as-is,
// there's no file to write it into).
export function shouldWriteForceDoneMarker({ isDoneSuccess, force, hasWorktree, worktreePath }) {
  return Boolean(force) && !isDoneSuccess && Boolean(hasWorktree) && Boolean(worktreePath);
}

// Sets **Lane**: done and **Lane Status**: success on an index.md's raw
// content, replacing each marker in place if present or appending it if
// missing. Mirrors mergeIndexMarkers' header-replace regex
// (worktree-artifact-merge.mjs) — same `**Header**: value` shape, applied
// here to exactly the two fields a forced done:success needs.
export function applyDoneSuccessMarkers(content) {
  const setHeader = (c, header, value) => {
    const re = new RegExp(`\\*\\*${header}\\*\\*:\\s*[^\\n]+`, 'i');
    return re.test(c) ? c.replace(re, `**${header}**: ${value}`) : c.trim() + `\n**${header}**: ${value}\n`;
  };
  let updated = setHeader(content, 'Lane', 'done');
  updated = setHeader(updated, 'Lane Status', 'success');
  return updated;
}
