# Track 1081: `**Summary**` marker gets silently overwritten with wrong content

## Phase 1: Confirm Mechanism 1 is already fixed (no code change)

**Problem**: Track's own index.md claims mechanism 1's root cause is a hardcoded
`"Answered user question"` summary in the `waitingForReply` auto-answer prompt.
**Solution**: Verify against current source; document instead of re-fixing if already resolved.

- [x] `git log -S "Answered user question" -- conductor/laneconductor.sync.mjs` → found
      track AM-10046 Phase 2 (commit `68752c17`) already replaced the mandating prompt template.
- [x] Confirmed current source has no mandated `pulse ... "Answered user question"` call anywhere.
- [x] Documented finding in spec.md — no implementation needed for Mechanism 1.

**Impact**: No code change. Track's Phase field / conversation updated to reflect verification.

## Phase 2: Root-cause Mechanism 2 (stale/truncated Summary round trip)

**Problem**: `**Summary**` markers over 200 chars get permanently truncated after a push+pull
round trip through the DB, even with no concurrent editing.
**Solution**: Traced to `parseSummaryMarker`/`parseSummary` truncating via `truncateSummary()`
before push, combined with `updateIndexMDFromDB` writing the DB's (truncated) `content_summary`
back to the file once `isConcurrentEdit`'s 10s grace period lapses (pull runs every 5s, so this
expires deterministically within ~10-15s of any push, no race required). Confirmed against a
prior partial fix (track 10056-10058, `conductor/tests/track-10035-new-track-flags.test.mjs`)
that avoided the trigger for `lc new` specifically, without fixing the general mechanism.

- [x] Traced push side: `conductor/laneconductor.sync.mjs` `parseSummaryMarker`/`parseSummary`
      call `truncateSummary(text, 200)`; `syncTrack`'s payload sends this truncated value as
      `content_summary`.
- [x] Traced pull side: `updateIndexMDFromDB` writes `dbTrack.content_summary` straight into the
      file's `**Summary**` marker whenever `pullTracksMetadataFromDB` decides to pull.
- [x] Traced why pull fires even without concurrent edits: DB's `content_updated_at` trigger
      bumps on any `content_summary` change (the truncation itself counts), and
      `isConcurrentEdit`'s 10s grace period expires on its own within a couple of 5s pull cycles.
- [x] Confirmed truncation was never load-bearing: `content_summary` is Postgres `TEXT`
      (unbounded); `ui/src/components/TrackCard.jsx` already `line-clamp-3`s it for display.
- [x] Live self-evidence: this track's own `**Summary**` marker is already truncated to exactly
      200 chars, mid-word, ending in "…" — produced by this exact bug.

## Phase 3: Fix — stop truncating Summary at push time

**Problem**: Truncation happens in `conductor/laneconductor.sync.mjs`, which cannot be imported
directly for unit testing (chokidar watchers + `setInterval`s run as import-time side effects).
**Solution**: Extract the pure summary-parsing helpers into a new sibling module
(`conductor/summary-utils.mjs`, mirroring the existing `conductor/sync-timestamp-utils.mjs`
precedent), remove the truncation call from the Summary-parsing paths only, and have
`laneconductor.sync.mjs` import from the new module instead of defining these functions inline.
`parseCurrentPhaseMarker`'s own use of `truncateSummary` (for `**Phase**`, track 1114's
intentional bound) is preserved unchanged by importing `truncateSummary` from the new module
too — no behavior change there.

- [x] Write failing test `conductor/tests/track-1081-summary-truncation.test.mjs` importing
      `parseSummaryMarker`/`parseSummary` from the not-yet-existing `conductor/summary-utils.mjs`.
      Confirmed failing (`ERR_MODULE_NOT_FOUND`) before implementation.
- [x] Create `conductor/summary-utils.mjs`: moved `truncateSummary`, `parseSummaryMarker`,
      `parseSummary` there; removed the `truncateSummary()` call from both Summary-returning
      paths (marker value and Problem-derived fallback).
- [x] Updated `conductor/laneconductor.sync.mjs` to import these three functions from
      `./summary-utils.mjs` instead of defining them locally; `parseCurrentPhaseMarker` still
      calls the imported `truncateSummary` unchanged (verified via TC-8/TC-8b regression tests).
- [x] Ran the new test — 8/8 pass.
- [x] Ran existing regression suites:
      `conductor/tests/sync-concurrent-edit-grace-period.test.mjs` — 4/4 pass, no regression.
      `conductor/tests/track-10035-new-track-flags.test.mjs` — 6/7 pass; the 1 failure
      ("omits both markers when neither flag is passed") is **pre-existing**, confirmed via
      `git stash` to fail identically before this track's changes — it's stale against a later,
      already-documented default-flags behavior change (SKILL.md 2026-09-08: `lc new` now
      writes `**Merge Mode**: direct` / `**Auto Run**: yes` by default). Out of scope for this
      track; not fixed here.
- [x] `node --check` passes on both modified/created files.

## Phase 4: Update track documentation

- [x] `conversation.md`: comment documenting Mechanism 1 verified-already-fixed and Mechanism 2
      root-caused + fixed, with commit references.
- [x] `index.md`: `**Phase**`, `**Progress**`, `**Summary**` updated to reflect completion.

## ✅ COMPLETE
