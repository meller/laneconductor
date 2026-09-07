# Track AM-10078: Track folder resolution picks a stale duplicate over the canonical INITIALS-prefixed folder, recurring across 10050/10066/10067

**Lane**: implement
**Merge Mode**: direct
**Lane Status**: running
**Progress**: 0%
**Phase**: Planned — 6 phases
**Type**: dev
**Author**: AM
**Created By**: 2565050+meller@users.noreply.github.com
**Summary**: Five compounding root causes found: two creation writers disagree on the INITIALS convention, quarantine output is committed to git so duplicates resurrect on every checkout,…

## Problem

Found three separate times in one session (2026-09-06/07), always the same shape: a track directory that should be named `INITIALS-<n>-slug` (e.g. `TU-10067-...`) also has a bare `<n>-slug` copy and/or a `_duplicate-<n>-slug` copy sitting next to it in `conductor/tracks/`, each with older/stale content (wrong Lane, wrong Lane Status, a stale Problem/Summary predating real work). All three were manually quarantined this session by renaming to `_quarantine-<n>-nonprefixed-<ts>` / `_quarantine-<n>-dup-<ts>` (commits `016f9e9d` for 10050/10051/10052, `ee037a65` for 10066, `2b4acea6` for 10067) — the same remediation, applied ad hoc each time, never at the root cause.

**Concretely dangerous, not just untidy.** `readTrackStateFromBranch()` in `conductor/services/worktree-audit.mjs` resolves a track number to a folder via `git ls-tree --name-only <ref> conductor/tracks/`, then `.find()`s the first entry matching `^(?:[a-zA-Z0-9]+-)?<n>-`. Git's listing is alphabetical, and a bare `10067-...` sorts before `TU-10067-...` (digit `1` < uppercase `T` in ASCII) — so `.find()` silently picks the stale bare folder every time both exist. This isn't cosmetic: it directly caused a real, confusing bug found live 2026-09-07 — `mainHasReopenedTrackIndependently()`'s read of main's own state for track 10067 resolved to the stale bare folder (`Lane: plan`) instead of the canonical `TU-10067-...` one (`Lane: done`, matching the DB's real done:success state), which masked an unrelated, legitimate fix (see track history, commit `58fd3b10`) until the duplicate was quarantined. `resolveTrackFolder()` in `conductor/laneconductor.sync.mjs` (used by the live filesystem-based dispatch/sync path, not just the read-only audit) almost certainly has the same ordering exposure — not yet confirmed live, but likely, since duplicates were found in the PRIMARY checkout's own working tree, not just old git history.

**Not yet understood: how the duplicates get created in the first place.** All three instances found so far predate this investigation — none were created live in front of us. Prior art exists (`016f9e9d`'s commit message: "quarantine recurring duplicate folders for 10050-10052" — same problem, already recurring before this session even started) but no root-cause fix ever landed, only repeated manual quarantines.

## Scope

1. **Find the actual creation path(s).** Likely candidates worth checking first: whatever creates a track's folder on `lc new`/track creation (does it always use the INITIALS-prefixed name, or does some path fall back to bare?); `copyWorktreeArtifactsToPrimary` / the worktree↔primary doc-sync machinery (track 10073, investigated this session, already found this exact sync path silently overwriting content — a duplicate-creation bug living in the same neighborhood would not be surprising); and any code that creates a `_duplicate-*` folder explicitly as a conflict-safety mechanism (the naming suggests intentional design somewhere, not pure accident).
2. **Fix folder resolution to never silently prefer a stale duplicate.** At minimum, `readTrackStateFromBranch()` and `resolveTrackFolder()` should either (a) prefer an INITIALS-prefixed match over a bare one when both exist, or (b) treat multiple matches as an error/warning condition surfaced somewhere visible, rather than silently picking git's alphabetical first. Given how much of the audit/reconcile/dispatch machinery depends on correctly resolving a track number to its one true folder, a wrong silent pick is worse than a loud failure.
3. **One-time sweep of the existing repo** for any other tracks already carrying this same duplicate shape, beyond the 3+3 (10050/10051/10052 from `016f9e9d`, plus 10066/10067 from this session) already found and quarantined — quarantine them the same way once the root cause (item 1) is understood, so a fresh occurrence doesn't slip back in immediately after.
4. **Regression coverage**: a test that creates a bare + INITIALS-prefixed duplicate pair and asserts folder-resolution picks the INITIALS-prefixed (or otherwise correct/canonical) one — mirroring the shape of the live bugs found, not just testing the creation-path fix in isolation.
**Auto Run**: yes
