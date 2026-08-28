# Spec: Widen Bookkeeping-Conflict Auto-Resolve to Checkbox Mirroring

## Problem Statement

`conductor/services/track-metadata-conflict.mjs`'s `isSafeToAutoResolveBookkeepingConflict` decides
whether a merge conflict confined to a track's own bookkeeping files (`index.md`, `plan.md`,
`spec.md`, `test.md`, `conversation.md`) can be auto-resolved by taking the branch's version. It
currently only allows this when main's content, after stripping known `**Lane**:`-style header
lines, is byte-identical to the merge-base's content. Any other divergence on main — even when
main's actual field values are provably the *same real value* the branch independently arrived at
(e.g. plan.md checkbox ticks mirrored in by the live DB→file sync) — is treated as unsafe, and the
merge stops for manual/agent resolution.

Track 10037 hit exactly this: main's `plan.md` had its checkboxes ticked (via the sync worker
mirroring DB state), which the header-line whitelist doesn't recognize, so the merge tool refused
even though main and the branch had reached identical states independently. This was resolved by
hand in-session; this track prevents needing to repeat that.

## Requirements

- REQ-1: Add a second, independent safe-resolve rule in `isSafeToAutoResolveBookkeepingConflict`:
  for each conflicting path already confirmed to be a bookkeeping file (`isTrackBookkeepingConflict`
  must still pass first — unchanged), if main's content is byte-identical to the **branch's**
  content for that path, treat it as safe (no real divergence — main just arrived at the same
  state via a different route). This is checked in addition to, not instead of, the existing
  base-vs-main header-only rule — either rule passing is sufficient.
- REQ-2: The existing header-only rule must remain unchanged in behavior — this is an addition, not
  a replacement. No regression for the track-10014-style case.
- REQ-3: If main's content differs from BOTH the base (beyond header lines) AND the branch, the
  conflict must still block (this is the genuinely unsafe case — main has real, un-mirrored
  changes of its own, e.g. a human hand-edited `plan.md` on main directly).
- REQ-4: The comparison is content-only (exact string equality after existing normalization, if
  any) — no new heuristics, no partial/fuzzy matching. This keeps the check as conservative as the
  existing one, just less blind to one more legitimate case.
- REQ-5: `mergeWorktreeBranch`'s existing behavior when the check passes (`git checkout --theirs`,
  commit, compare-and-swap ref update, resync) needs no changes — the fix is entirely inside the
  safety predicate.

## Acceptance Criteria

- [ ] AC-1: A conflict where main's plan.md content is byte-identical to the branch's plan.md
      content (main and branch both, independently, ended at the same content from a common base)
      is now classified safe and auto-resolved without manual intervention.
- [ ] AC-2: The original track-10014-style case (main only touched known header lines) still
      auto-resolves — no regression.
- [ ] AC-3: A conflict where main has genuinely divergent, non-mirrored content (differs from both
      base's stripped content AND the branch's raw content) still reports as unsafe/blocks.
- [ ] AC-4: `lc worktrees merge <track> --dry-run` reflects the new classification correctly for
      all three cases above (existing dry-run reporting path, no new code needed there beyond the
      predicate change propagating through).

## API Contracts / Data Models

No schema or API changes — this is a pure function change in
`conductor/services/track-metadata-conflict.mjs`.
