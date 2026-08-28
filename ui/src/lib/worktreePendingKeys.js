// ui/src/lib/worktreePendingKeys.js
// Track 1114 Phase 7: identity keys for the row-level actions (Remove
// Worktree, Run merge action, Complete & Merge, Discard), plus the "which
// pending keys are stale given the current rows" check that fetchRows runs
// on every poll. Extracted so the staleness computation is testable on its
// own — this is the exact logic that sat behind bug #8 (a stale
// `fetchRows` closure kept calling this comparison against an empty
// `pendingKeys` snapshot forever, so it could never find anything to
// clear; the fix was a ref keeping the interval on the current closure,
// not a bug in this computation itself, but the computation is what the
// fix depends on behaving correctly).
//
// Track 10035 Phase 4: force/create-pr/merge-pr/ai-resolve keys removed —
// those bespoke dispatch actions no longer have UI buttons (merging is a
// standard lane action now; see WorktreesPanel.jsx's single "Run merge
// action" button, keyed by `mergeKey` same as before).
export const removeKey = (row) => `remove:${row.worktree_path || row.branch}`;
export const mergeKey = (row) => `merge:${row.track}`;
export const completeKey = (row) => `complete:${row.track}`;
export const discardKey = (row) => `discard:${row.track}`;

export function computeStillPresentKeys(rows) {
  const stillPresent = new Set();
  for (const row of rows) {
    stillPresent.add(removeKey(row));
    if (row.track) {
      stillPresent.add(mergeKey(row));
      stillPresent.add(completeKey(row));
      stillPresent.add(discardKey(row));
    }
  }
  return stillPresent;
}

// Given the pending keys currently tracked and the freshly-fetched rows,
// returns the keys that no longer correspond to anything in `rows` — a
// pending action's row either vanished (removed, or merged and dropped
// out of the unmerged list) or is present but under a different key.
// Either way, the pending state for it should be cleared rather than
// waiting out the full safety timeout.
export function computeStaleKeys(pendingKeys, rows) {
  const stillPresent = computeStillPresentKeys(rows);
  return Object.keys(pendingKeys).filter((key) => !stillPresent.has(key));
}
