# Track 1112: Out-of-band git sync + worktree visibility/merge UI

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New — grounded by live inspection 2026-08-13, not yet planned
**Type**: dev
**Summary**: Two related gaps confirmed live: nothing pulls changes made by a user pushing directly to git (bypassing LaneConductor), and per-track worktrees have zero visibility anywhere — this machine alone…

## Problem

Raised as two questions; both checked against real code and real state
rather than assumed.

### 1. Out-of-band git sync

Scenario: two users work the same repo from different machines through a
shared remote LaneConductor API; a third user pushes commits directly to
git, never touching LaneConductor at all. Does anything notice?

Checked: the only git-network operation anywhere in the worker is
`git fetch origin <main> --quiet`
(`conductor/laneconductor.sync.mjs:3108`), called once, only as part of
`checkAndClaimGitLock` — i.e. only when THIS worker is about to claim a
track and set up its own worktree. `fetch` alone only updates
remote-tracking refs; nothing `pull`s or merges those changes into the
actual tracked files, and nothing re-syncs FS→DB from a change that
originated in git rather than in a local file edit or a DB write.

So: a third user's direct `git push` is **invisible** to every
LaneConductor worker until something on that machine happens to run
`git pull` for an unrelated reason (e.g. as a side effect of claiming
some other track). No proactive detection, no notification, no
conflict surfacing if that push touched a file a worker is about to
overwrite.

### 2. Worktree visibility

Confirmed live on this machine: **49 worktrees** (`git worktree list`),
**45 with commits not yet merged into `main`** (`git branch --no-merged
main`) — including this very session's own track 1104, which has 3
unmerged commits sitting in `.worktrees/1104` right now. Zero references
to "worktree" anywhere in `ui/src/` or `ui/server/index.mjs` — no UI
panel, no API endpoint, nothing. The only way to see any of this is raw
`git` commands in a terminal.

`getWorktreeLifecycle()` (`conductor/laneconductor.sync.mjs:192`)
defaults to `'per-cycle'`, which is supposed to merge-and-remove the
worktree on `done:success`
(`mergeAndRemoveWorktree`, called from the exit-handler cleanup path).
Given 45 branches are sitting unmerged, that step is either not
consistently reached (tracks not yet at `done`), or failing silently
somewhere — worth establishing which, at planning time, before assuming
a UI is the only fix needed.

## Solution (to be designed at planning — this file states the confirmed problem)

- Sync direction: decide whether LaneConductor should proactively `git
  pull` on some cadence (heartbeat-adjacent?) to catch out-of-band
  pushes, and what happens when a pulled change conflicts with a
  worker's own in-progress worktree — needs real conflict-handling
  design, not just "pull more often."
- Visibility: at minimum, a way to list worktrees + their merge status
  (ahead/behind main, uncommitted changes) somewhere in the UI or via
  `lc`. Given 45 branches are already unmerged on just one developer's
  machine, this is not a hypothetical need.
- Merge path: once visible, what's the actual action — a UI "merge to
  main" button, an `lc` command, or is fixing why `mergeAndRemoveWorktree`
  isn't reliably firing the actual fix (making the UI unnecessary for the
  common case, still useful for the exceptional one)?
- Investigate why 45 branches are unmerged before designing the fix —
  likely a mix of (a) tracks legitimately not yet at `done`, (b) the
  `per-cycle` merge step failing/skipping silently, (c) tracks whose
  worktree lifecycle is configured `per-lane` or otherwise never
  triggers a merge at all. Different causes need different fixes.

## Phases
- [ ] Phase 1: Audit — for a sample of this machine's 45 unmerged worktrees, determine which of the three causes above applies to each; establishes whether this is mostly a lifecycle bug or mostly a visibility gap
- [ ] Phase 2: Worktree visibility — list worktrees + merge/dirty status (UI panel and/or `lc` command, decide which at planning)
- [ ] Phase 3: Merge action — surfaced from Phase 2's listing, scoped based on Phase 1's findings (fix the automatic path, add a manual one, or both)
- [ ] Phase 4: Out-of-band git sync — design the pull cadence + conflict handling; this is the riskier half (wrong conflict handling could silently lose work) and may deserve its own sub-design review before implementation
- [ ] Phase 5: Tests + a real live check on this machine's actual 45 unmerged branches (not just synthetic ones) — this track has an unusually large, real dataset to validate against already

## Depends on
None directly, but touches the same worktree lifecycle code
[1110](../1110-worker-separation-and-claim-race-safety/index.md) just
finished hardening (`spawnCli`'s exit-handler cleanup path) — worth
reading that context before changing the merge/cleanup logic further.

## Notes

Opened directly from a user question ("do we need a track for this?") —
answered yes, given the confirmed live evidence (49 worktrees, 45
unmerged, zero UI visibility) rather than opening speculatively.
