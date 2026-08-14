// Track 1114 (found live): "if they don't have a worktree they shouldn't
// appear on Worktrees" — the panel's whole purpose is worktree
// visibility, and a plain `open` row with no live worktree is just an
// abandoned unmerged branch, not something happening right now. The one
// deliberate exception is `stranded`: by definition always worktree-less
// (done:success, no worktree — the exact orphaned-but-ready-to-merge case
// this panel was originally built to surface, Track 1112). Filtering
// those out too would silently defeat the panel's own reason for existing.
export function belongsInWorktreesPanel(row) {
  if (row.hasWorktree) return true;
  return row.classification === 'stranded';
}
