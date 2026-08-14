// ui/src/lib/worktreeStats.js
// Track 1114: stats + recommendations header for the Worktrees panel.
// Pure function over the same row shape the panel already fetches — no
// dependency on React so the thresholds/wording are directly testable.

export const OPEN_WORKTREE_WARNING_THRESHOLD = 10;

const CLASSES = ['stranded', 'conflicted', 'mergeable', 'open', 'detached'];

export function computeWorktreeStats(rows) {
  const counts = Object.fromEntries(CLASSES.map(c => [c, 0]));
  let totalDirty = 0;
  for (const row of rows) {
    if (row.class in counts) counts[row.class] += 1;
    if (row.dirty) totalDirty += row.dirty;
  }

  const recommendations = [];

  // Requested directly: "more than 10 worktrees are not recommended" —
  // open worktrees are the ones actually consuming disk + representing
  // unreviewed in-flight work; mergeable/stranded/conflicted/detached are
  // each already called out below on their own terms.
  if (counts.open > OPEN_WORKTREE_WARNING_THRESHOLD) {
    recommendations.push({
      level: 'warning',
      text: `${counts.open} worktrees are open at once — more than ${OPEN_WORKTREE_WARNING_THRESHOLD} is not recommended. Review and quality-gate some tracks before opening more.`,
    });
  }

  if (counts.stranded > 0) {
    const plural = counts.stranded !== 1;
    recommendations.push({
      level: 'action',
      text: `${counts.stranded} branch${plural ? 'es' : ''} ${plural ? 'are' : 'is'} done and ready to merge, but orphaned (stranded) — merge ${plural ? 'them' : 'it'} now.`,
    });
  }

  if (counts.conflicted > 0) {
    const plural = counts.conflicted !== 1;
    recommendations.push({
      level: 'action',
      text: `${counts.conflicted} branch${plural ? 'es' : ''} conflict${plural ? '' : 's'} with main — needs manual resolution.`,
    });
  }

  if (counts.detached > 0) {
    const plural = counts.detached !== 1;
    recommendations.push({
      level: 'info',
      text: `${counts.detached} orphaned scratch worktree${plural ? 's' : ''} with no track — safe to remove if not actively in use.`,
    });
  }

  return { total: rows.length, counts, totalDirty, recommendations };
}
