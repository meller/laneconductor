# Track 1112: Out-of-band git sync + worktree visibility/merge UI

**Lane**: review
**Lane Status**: running
**Progress**: 100%
**Last Run**: claude/sonnet (primary)
**Phase**: Planned — audit complete (Phase 1 done), Phases 2–7 specced
**Type**: dev
**Waiting for reply**: no
**Summary**: Planned. Audit of all 44 unmerged branches found 41 legitimately open, 2 stranded by RC-A (merge gated on the worktree dir existing), 1 missed by RC-B (merge only fires from one worker exit path).…

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

> **Planning-time re-measurement (2026-08-13)**: 48 worktrees / 44 unmerged.
> The counts above (49/45) were taken when the track was opened; track 1104's
> branch has since landed (commit `902ee2f`). Both questions above are now
> answered — see Solution below. All figures in `spec.md` use the 48/44
> re-measurement.

## Solution

Designed at planning — see `spec.md` for full requirements and `plan.md`
for phases. Audit results (measured 2026-08-13, all 44 unmerged branches):

| Class | Count | Cause |
|-------|-------|-------|
| Track not yet at `done` | 41 | Working as designed — invisible, but not a bug |
| `done:success`, worktree gone | 2 (1044, 1059) | **RC-A** — permanently stranded |
| `done:success`, worktree present | 1 (1099) | **RC-B** — merge never attempted |

- **RC-A**: `mergeAndRemoveWorktree` returns early on a missing worktree
  directory *before* attempting the merge (`laneconductor.sync.mjs:3334`) —
  but the branch outlives the directory, so it is stranded forever.
- **RC-B**: the merge only fires from `spawnCli`'s exit handler under
  `targetLane === 'done' && isSuccess` (`laneconductor.sync.mjs:3912`). A UI
  drag, `lc move`, or a quality gate on another machine never merges.

Orphaned-source sweep: only `track-1059` carries non-track-file changes, and
that work is already in main via another route — so nothing is *currently*
lost. But commit `902ee2f` (`.worktrees/1104`, 60% recovered) proves the loss
mode is real; invisibility is what made it expensive.

Approach: **CLI before UI** (worktrees are per-machine; the API may be
remote, and `local-fs` has no API at all), **reconcile on lane state rather
than on an exit-handler side effect**, **merge in a scratch worktree** so the
shared checkout with its 100+ dirty files is never touched, and
**detect-and-surface** out-of-band pushes with auto-pull only on a provably
safe fast-forward.

## Phases
- [x] Phase 1: Audit — all 44 branches classified; RC-A and RC-B identified with line numbers (done at planning time)
- [ ] Phase 2: `lc worktrees` — visibility, local-only, works in `local-fs`, surfaces stranded branches `git worktree list` can't see
- [ ] Phase 3: Lifecycle fixes — RC-A (merge on branch existence, not directory), RC-B (`reconcileWorktrees()` on heartbeat), merge in a scratch worktree
- [ ] Phase 4: `lc worktrees merge <track>` — manual path, incl. the stranded case, `--dry-run` / `--force`
- [ ] Phase 5: Out-of-band git sync — periodic fetch + divergence reporting; auto-pull only on clean FF with no dirty overlap; post-pull FS→DB resync
- [ ] Phase 6: Tests + LIVE verification against this machine's real 44-branch state
- [ ] Phase 7: UI worktree panel via heartbeat reporting — **may be deferred**; if it is, this track cannot be marked `done` at 100%

## Depends on
None directly, but touches the same worktree lifecycle code
[1110](../1110-worker-separation-and-claim-race-safety/index.md) just
finished hardening (`spawnCli`'s exit-handler cleanup path) — worth
reading that context before changing the merge/cleanup logic further.

## Notes

Opened directly from a user question ("do we need a track for this?") —
answered yes, given the confirmed live evidence (49 worktrees, 45
unmerged, zero UI visibility) rather than opening speculatively.
