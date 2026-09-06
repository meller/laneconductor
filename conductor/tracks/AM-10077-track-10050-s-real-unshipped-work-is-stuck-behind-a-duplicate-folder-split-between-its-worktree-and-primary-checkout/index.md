# Track AM-10077: Track 10050's real unshipped work is stuck behind a duplicate-folder split between its worktree and primary checkout

**Lane**: plan
**Lane Status**: queue
**Progress**: 0%
**Phase**: New
**Type**: dev
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Summary**: Track 10050 has real unshipped Phase 1-5 work but is misclassified pr-open and entangled in a known duplicate-folder split (TU-10050 vs 10050) — needs manual reconciliation, not an automatic fallback.

## Problem

Track 10050 ("Worktree Base Freshness — Start Track Branches From origin/main")
contains real, unshipped work — a full Phase 1-5 implementation adding
`resolveWorktreeStartPoint()` — confirmed absent from current `main` (`grep
-rn "resolveWorktreeStartPoint" conductor/*.mjs` returns nothing). Its live
worktree (`.worktrees/10050`) still exists on disk, so this isn't a
stale-cache case like tracks 1102/10012/10013/1053/008/10011 (all
investigated and resolved 2026-09-06).

Instead, its own track branch never committed a `**Merge Mode**` marker, so
`worktree-audit.mjs`'s `readTrackStateFromBranch()` defaults it to `'pr'`
(the documented default for a missing marker) — misclassifying it as
`pr-open` in the Worktrees panel and offering "Run Merge Action" (the
GitHub-PR flow) for what is actually intended to be a direct-merge track.

Digging into WHY the marker was never committed surfaced a second, deeper
problem: this track's metadata is split across two different directories
that both claim to be its home:
- **Worktree's own copy**: `.worktrees/10050/conductor/tracks/TU-10050-worktree-base-freshness-start-track-branches-from-origin-main/index.md` — no `Merge Mode` marker at all.
- **Primary checkout's copy**: `conductor/tracks/10050-worktree-base-freshness-start-track-branches-from-origin-main/index.md` (no `TU-` prefix) — HAS `**Merge Mode**: direct`, but `**Progress**: 0%` despite `**Lane Status**: success`.

The worktree also contains several `_quarantine-10050-*` and
`_duplicate-10050-*` directories, and git history has an existing
`chore(tracks): quarantine recurring duplicate folders for 10050-10052`
commit — this exact track (and its 10049/10051/10052 siblings) already has a
documented history of this same TU-prefix/no-prefix duplicate-folder
confusion. It's unclear which of the two `index.md` copies is the
authoritative source of truth for Lane Status/Progress/Merge Mode right now,
or whether the primary checkout's copy is itself a leftover of the same bug
rather than genuinely fresher data.

## Why this needs a dedicated look, not a quick patch

This isn't a "small source of truth" fix like the pr_status fallback added
to `worktree-audit.mjs` on 2026-09-06 (commits `5862de5d`, `e84a27eb`) — that
fix trusts a single unambiguous external signal (GitHub's own PR status).
Here there is no external oracle: the two candidate index.md files
disagree with each other, and resolving which one is right (and whether the
underlying implementation work is still wanted / safe to merge as-is, given
it's now sitting on a branch that's ~1579 commits behind main) requires
actually reading both files and the branch's real diff, not just picking a
fallback order.

## Scope

1. Determine which of the two `index.md` copies (worktree vs. primary,
   `TU-10050-...` vs `10050-...`) is authoritative, and why the split
   happened — likely the same root cause already partially addressed by
   the `chore(tracks): quarantine recurring duplicate folders for
   10050-10052` commit for its sibling tracks.
2. Decide whether the real Phase 1-5 `resolveWorktreeStartPoint()` work is
   still wanted, given main has moved ~1579 commits since the branch was
   last based. If yes, rebase/reconcile and merge for real (direct mode,
   per its actual intent). If no, discard via the Worktrees panel with a
   reason, same as tracks 9997/10011 (both resolved 2026-09-06).
3. Consider whether `worktree-audit.mjs` should also fall back to the
   primary checkout's `Merge Mode` marker when a worktree's own copy is
   missing one — mirroring the pr-fields fallback added in `e84a27eb` — but
   only once (1) determines the primary copy is actually trustworthy here,
   since right now it's unclear whether that copy's `direct` marker predates
   or postdates the duplicate-folder confusion.
**Merge Mode**: direct
