// ui/src/lib/armedConfirm.js
// Track 1114 Phase 7: the two-step in-DOM confirm used by Remove Worktree,
// Complete & Merge, and Force Merge (see useArmedConfirm in
// WorktreesPanel.jsx — native window.confirm() never surfaced in this
// app's runtime, found live: a real click produced zero dispatch, zero
// error, zero visible feedback). The key/timer state has to live in a
// React hook, but the actual decision — does this click arm the button or
// fire the action — doesn't need React at all. Extracted here so that
// decision is testable without mounting anything.

// Given the currently armed key (or null) and the key just clicked,
// decides what happens next:
// - clicking the SAME key that's already armed fires the action and
//   disarms
// - clicking any other key (including when nothing is armed) arms that
//   key instead, without firing
export function nextArmedState(currentArmedKey, requestedKey) {
  if (currentArmedKey === requestedKey) {
    return { armedKey: null, shouldFire: true };
  }
  return { armedKey: requestedKey, shouldFire: false };
}
