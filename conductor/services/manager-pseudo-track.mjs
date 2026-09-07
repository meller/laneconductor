// conductor/services/manager-pseudo-track.mjs
// Track 10069 Phase 4 (D7/D8, REQ-25..REQ-31): the single source of truth
// for the reserved-name constant every reserved-name branch in this track
// checks against — the worker's resolveTrackFolder/autoLaunchLocalFs/
// syncConversation, the Collector API's comments routes, and the UI's
// resolveWorkerChatTarget all need to agree on exactly one string, never a
// second hand-copied literal.
//
// The pseudo-track is addressed as track number 'manager' and lives at
// conductor/tracks/manager/ (10067 REQ-14). It deliberately contains no
// digit anywhere (10067 REQ-21) — every folder-consumer in this codebase
// treats "contains a digit" as "is a real track"
// (laneconductor.sync.mjs's isTrackDirName is `/\d+/.test(name)`), so a
// digit-free name is what keeps it invisible to claiming, to tracks.md,
// and to the board with no exclusion list anywhere (REQ-30).
//
// Pure module, no I/O — mirrors workspace-mode.mjs / lane-regression-guard.mjs's style.

export const MANAGER_PSEUDO_TRACK = 'manager';

export function isManagerPseudoTrack(trackNumber) {
  return trackNumber === MANAGER_PSEUDO_TRACK;
}

// Track 10069 D8: the pseudo-track has no DB row, so the ONLY carrier for
// "a human replied, please answer" is this file marker, read straight off
// disk exactly like every other **Waiting for reply** check in this
// codebase (autoLaunchLocalFs's own parseWaitingForReply does the same
// case-insensitive match). Kept here, not re-derived from that function,
// so this module stays dependency-free and independently testable.
export function shouldAdmitManagerPseudoTrack(indexContent) {
  return /\*\*Waiting for reply\*\*:\s*yes/i.test(indexContent || '');
}
