# Track AM-10038: Widen Bookkeeping-Conflict Auto-Resolve to Checkbox Mirroring

**Lane**: review
**Lane Status**: queue
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: Re-verifying after rebase (polluted commit removed)
**Waiting for reply**: no
**Type**: dev
**Track Kind**: bug
**Merge Mode**: direct
**Auto Run**: yes
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Summary**: `isSafeToAutoResolveBookkeepingConflict` only recognizes main's divergence as a safe sync-mirror artifact when it's limited to `**Lane**:`-style header lines; it doesn't recognize the same mirroring…

## Problem
Track 10037 hit a "Conflicted" merge state purely because the live sync worker had independently mirrored the same completed work's checkbox ticks into main's copy of `plan.md`, while the track's own worktree branch mirrored the identical ticks via its real commits. `isTrackBookkeepingConflict`/`isSafeToAutoResolveBookkeepingConflict` (`conductor/services/track-metadata-conflict.mjs`) only strips known `**Lane**:`/`**Progress**:`/etc. header lines before comparing main's content to the merge-base; a checkbox-line change is treated as "real" content, so the safety check refuses and the track sits unmergeable until a human/agent manually verifies and resolves it (documented precedent: track 10014 hit the exact same header-only case; track 10037 is the checkbox-line variant).

## Solution
Extend the auto-resolve safety check with a second, narrower rule: for files in the same bookkeeping whitelist, if main's full content (after normal stripping) is otherwise identical to the **branch's** content for that file (not just the base's), it's provably safe to auto-resolve by taking theirs — main and the branch converged on the same real state independently, so there is no actual conflict of intent, only of history. This subsumes the existing header-only case without changing its behavior, and additionally covers checkbox-line and other benign field mirroring (e.g. a future field the header whitelist hasn't been extended to yet) — as long as the *result* on both sides is identical, no whitelist maintenance is required going forward.
**Waiting for reply**: yes
