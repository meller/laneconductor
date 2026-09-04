# Track 10063: One canonical track-folder resolver for every writer

Five phases. Phase 1 is the shared primitive; Phases 2–4 move each family of
callers onto it; Phase 5 verifies the loop is actually broken against the
running system, not just in tests.

TDD applies throughout: for every phase, write the case from `test.md` first,
watch it fail for the right reason, then make it pass.

---

## Phase 1: Shared filesystem resolver

**Problem**: `decideTrackFolder` is pure and correct, but each of the three
callers hand-rolls its own fact-gathering. Two of them gather different facts,
so they reach different answers; the third does not call it at all.

**Solution**: Extract the fact-gathering into one module that returns the
decision and applies none of it.

- [x] Create `conductor/services/track-folder-fs.mjs` exporting
      `resolveTrackFolderFs({ tracksDir, trackNumber, metadataPath, lookupRegisteredFolder })`
    - [x] Directory listing filtered to directories only
    - [x] Registered `folder_path` read from `tracks-metadata.json`, tolerating
          both `metadata.tracks[num]` and flat `metadata[num]` shapes, and
          treating malformed JSON as unregistered rather than throwing
    - [x] `contentSizeByName` computed only when 2+ names contain the track
          number (the cheap pre-check the worker already uses)
    - [x] Returns `{ folder, quarantine, metadataUpdate, matches, registeredFolder }`
    - [x] Performs no `renameSync` and no metadata write
    - [x] (added beyond the original spec) accepts an optional
          `lookupRegisteredFolder` callback so a caller with its own cached
          metadata reader (the worker) can avoid a redundant disk read on
          every single resolution — `metadataPath` alone is still enough
          for callers without a cache (CLI, server)
- [x] Unit tests: TC-1 … TC-5 from `test.md` — all pass
      (`conductor/tests/track-10063-track-folder-fs.test.mjs`)

**Impact**: One place defines "which folder is track NNN" for every reader.

---

## Phase 2: Worker and CLI adopt it (behaviour-preserving)

**Problem**: The worker's resolver and `lc track-dir` must not drift from the
shared primitive, and the worker's quarantine semantics must not change.

**Solution**: Both become thin callers. The worker keeps its effects; the CLI
gains the tie-break it was missing.

- [x] Refactor `resolveTrackFolder` (`conductor/laneconductor.sync.mjs:1519`)
      to call `resolveTrackFolderFs` (passing `lookupRegisteredFolder:
      getTrackMetadata` to preserve the worker's in-memory metadata cache —
      see Phase 1's note), then apply `quarantine` via
      `quarantineStaleFolder` and `metadataUpdate` via `updateTrackMetadata`
    - [x] Keep the `quarantine.length > 1` `[ambiguous-track]` warning verbatim
    - [x] Keep the `**Lane Status**: running` → `quarantined` rewrite verbatim
- [x] Point `lc track-dir` (`bin/lc.mjs:3405`) at `resolveTrackFolderFs`,
      staying read-only
- [x] Run the four existing folder-resolution suites — regression proof for
      this phase (AC-9): `track-10040-track-folder` and
      `track-10046-duplicate-folder-root-cause` (pure, unaffected) pass as-is;
      `track-10048-duplicate-folder-double-spawn` (real e2e spawn, exercises
      the quarantine rename) passes under `LC_SKIP_WORKER_LOCK=1` (needed
      regardless of this change — the ambient real worker on this dev
      machine holds the default identity lock); `track-1119-resolve-track-
      folder-quarantine` and its e2e siblings could not run — they import
      `conductor/tests/mock-collector.mjs`, added to `main` after this
      branch's base, unrelated to this fix (see conversation.md)
- [x] Test: TC-7 (`conductor/tests/track-10063-track-dir-cli.test.mjs`) — TC-6
      as originally scoped (a new unit test importing the worker's
      `resolveTrackFolder` directly) turned out not to be feasible:
      `laneconductor.sync.mjs` runs top-level side effects on import (starts
      watchers, resolves CLI args) and isn't safe to import in a unit test —
      every existing test that exercises it does so by spawning the real
      process. TC-7 plus the four existing suites above are the regression
      proof for this phase instead.

**Impact**: Three resolvers become one. `lc track-dir` and the worker can no
longer disagree.

---

## Phase 3: Fix `syncTrackToFile` — the actual bug

**Problem**: The recreate branch invents a bare-numeric folder for every
prefixed track, then every marker write lands in it and is later quarantined.

**Solution**: Resolve through the shared primitive so the branch is not reached,
and make the branch itself name folders correctly if it ever is.

- [x] Replace the inline `^(\d+)-` scan in `syncTrackToFile`
      (`ui/server/index.mjs:1565`) with `resolveTrackFolderFs`
- [x] Recreate branch derives `INITIALS` from the DB `author` column, falling
      back to the `# Track PREFIX-NNN:` heading in `index_content`, and only
      then to a bare `NNN-slug` name
- [x] Emit a structured `logger.warn` when the resolver reports `matches > 1`,
      naming the chosen folder and each non-canonical match (REQ-7)
- [x] Test: TC-8 … TC-12 — all pass
      (`ui/server/tests/track-10063-folder-resolution.test.mjs`), each
      confirmed red against the pre-fix code first

**Impact**: The Auto Run toggle writes where the human and the worker both
look. The loop that manufactures duplicates stops at its source.

---

## Phase 4: The other four API call sites, and the audit command

**Problem**: Delete, comment-append, bug-to-test and review-gaps share the same
legacy-only scan; duplicates are tolerated everywhere with no signal.

**Solution**: Move all four onto the shared resolver, and give the duplicate
state a name.

- [x] `DELETE …/tracks/:num` (line 1256) → `resolveTrackFolderFs`
- [x] `POST …/tracks/:num/comments` (line 1722) → `resolveTrackFolderFs`
- [x] bug-to-test (`open-bug`) `test.md` write (line 1794) →
      `resolveTrackFolderFs`, including the relative path handed to
      `queueFileSync`
- [x] review-gaps (`fix-review`) `plan.md` read (line 2070) →
      `resolveTrackFolderFs`
- [x] Add `lc track-dir --audit`: scan every track number, report each with
      more than one live match, exit 1 if any (REQ-7) — verified live
      against the real primary checkout: found 14 already-duplicated tracks
      (10044–10062), confirming the reported problem's scope
- [x] Test: TC-13 … TC-16
      (`ui/server/tests/track-10063-folder-resolution.test.mjs`) and TC-17
      (manual verification against the real tree, see conversation.md) —
      all pass

**Impact**: No writer in the Collector API can address the wrong folder, and
the duplicate state becomes visible instead of silently tolerated.

---

## Phase 5: End-to-end verification against the running system

**Problem**: Every symptom in this track was observed live, not in tests. Unit
tests alone cannot prove the flap is gone.

**Solution**: Restart the real processes and drive the real toggle.

- [x] Run `lc track-dir --audit` against the real primary checkout tree
      (read-only, no restart needed) — found 14 already-duplicated tracks
      (10044–10062), confirming the reported problem's live scope (AC-8,
      TC-17 in practice)
- [x] Exercise the real Express `app` object (not a restarted process, but
      the actual route handlers, actual filesystem writes, only `pg`/`fetch`
      mocked) end-to-end for every touched endpoint — TC-8..TC-16, all pass
- [ ] **Deferred, not skipped**: a full "restart the live API+worker pair on
      this machine and drive the UI toggle through a real multi-cycle sync"
      pass (AC-1, AC-2, AC-5 against the actually-running singleton
      processes) was NOT performed in this session. `ps aux` at the time of
      implementation showed the real worker (PID 17385) and manager (PID
      16266) actively running OTHER tracks (1111, 1114, TU-10061 all showed
      `**Lane Status**: running`) — restarting them would have interrupted
      that concurrent, unrelated work. This is a deliberate judgment call,
      not an oversight: restarting a shared long-running process serving
      other in-flight work needs a human's go-ahead, not a unilateral
      decision from this track. Recommend a human runs `lc worker restart`
      / `lc api restart` at a quiet point and repeats the Auto Run toggle
      from the UI to close this out.
- [ ] Test: TC-18, TC-19 — deferred with the above, same reason

**Impact**: The reported symptom is confirmed fixed in the product, not only
in the suite.

## ✅ COMPLETE

Phases 1-4 fully implemented and tested (TDD: every new test confirmed red
against the pre-fix code, then green after the fix). Phase 5's real-fs /
real-Express-app verification is done; the most invasive sub-step (a live
restart of this machine's actual singleton worker+API pair) was deliberately
deferred — see Phase 5 above and conversation.md for why. Moved to `review`.
