// Track 1114 (found live): "if they don't have a worktree they shouldn't
// appear on Worktrees" — the panel's whole purpose is worktree
// visibility, and a plain `open` row with no live worktree is just an
// abandoned unmerged branch, not something happening right now. The one
// deliberate exception is `stranded`: by definition always worktree-less
// (done:success, no worktree — the exact orphaned-but-ready-to-merge case
// this panel was originally built to surface, Track 1112). Filtering
// those out too would silently defeat the panel's own reason for existing.
//
// Track 10018: `pr-open` is a second such exception. A pr-mode track can
// be done:success with its worktree gone (worker restart, a manual `git
// worktree remove`, whatever) while its PR is still open on GitHub — the
// PR itself, not the worktree, is the artifact that matters at that
// point, and it still needs a human decision. Without this, that row
// would classify `pr-open` (not `stranded`, since the merge-mode fork
// happens before the stranded check) and silently vanish from the one
// panel built to surface exactly this kind of pending state.
export function belongsInWorktreesPanel(row) {
  if (row.hasWorktree) return true;
  return row.classification === 'stranded' || row.classification === 'pr-open';
}
