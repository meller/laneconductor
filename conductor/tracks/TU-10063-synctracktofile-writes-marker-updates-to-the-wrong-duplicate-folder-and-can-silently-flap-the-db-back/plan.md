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

- [ ] Create `conductor/services/track-folder-fs.mjs` exporting
      `resolveTrackFolderFs({ tracksDir, trackNumber, metadataPath })`
    - [ ] Directory listing filtered to directories only
    - [ ] Registered `folder_path` read from `tracks-metadata.json`, tolerating
          both `metadata.tracks[num]` and flat `metadata[num]` shapes, and
          treating malformed JSON as unregistered rather than throwing
    - [ ] `contentSizeByName` computed only when 2+ names contain the track
          number (the cheap pre-check the worker already uses)
    - [ ] Returns `{ folder, quarantine, metadataUpdate, matches }`
    - [ ] Performs no `renameSync` and no metadata write
- [ ] Unit tests: TC-1 … TC-5 from `test.md`

**Impact**: One place defines "which folder is track NNN" for every reader.

---

## Phase 2: Worker and CLI adopt it (behaviour-preserving)

**Problem**: The worker's resolver and `lc track-dir` must not drift from the
shared primitive, and the worker's quarantine semantics must not change.

**Solution**: Both become thin callers. The worker keeps its effects; the CLI
gains the tie-break it was missing.

- [ ] Refactor `resolveTrackFolder` (`conductor/laneconductor.sync.mjs:1519`)
      to call `resolveTrackFolderFs`, then apply `quarantine` via
      `quarantineStaleFolder` and `metadataUpdate` via `updateTrackMetadata`
    - [ ] Keep the `quarantine.length > 1` `[ambiguous-track]` warning verbatim
    - [ ] Keep the `**Lane Status**: running` → `quarantined` rewrite verbatim
- [ ] Point `lc track-dir` (`bin/lc.mjs:3405`) at `resolveTrackFolderFs`,
      staying read-only
- [ ] Run the four existing folder-resolution suites unchanged — they are the
      regression proof for this phase (AC-9)
- [ ] Test: TC-6, TC-7

**Impact**: Three resolvers become one. `lc track-dir` and the worker can no
longer disagree.

---

## Phase 3: Fix `syncTrackToFile` — the actual bug

**Problem**: The recreate branch invents a bare-numeric folder for every
prefixed track, then every marker write lands in it and is later quarantined.

**Solution**: Resolve through the shared primitive so the branch is not reached,
and make the branch itself name folders correctly if it ever is.

- [ ] Replace the inline `^(\d+)-` scan in `syncTrackToFile`
      (`ui/server/index.mjs:1565`) with `resolveTrackFolderFs`
- [ ] Recreate branch derives `INITIALS` from the DB `author` column, falling
      back to the `# Track PREFIX-NNN:` heading in `index_content`, and only
      then to a bare `NNN-slug` name
- [ ] Emit a structured `logger.warn` when the resolver reports `matches > 1`,
      naming the chosen folder and each non-canonical match (REQ-7)
- [ ] Test: TC-8 … TC-12

**Impact**: The Auto Run toggle writes where the human and the worker both
look. The loop that manufactures duplicates stops at its source.

---

## Phase 4: The other four API call sites, and the audit command

**Problem**: Delete, comment-append, bug-to-test and review-gaps share the same
legacy-only scan; duplicates are tolerated everywhere with no signal.

**Solution**: Move all four onto the shared resolver, and give the duplicate
state a name.

- [ ] `DELETE …/tracks/:num` (line 1256) → `resolveTrackFolderFs`
- [ ] `POST …/tracks/:num/comments` (line 1722) → `resolveTrackFolderFs`
- [ ] bug-to-test `test.md` write (line 1794) → `resolveTrackFolderFs`,
      including the relative path handed to `queueFileSync`
- [ ] review-gaps `plan.md` read (line 2070) → `resolveTrackFolderFs`
- [ ] Add `lc track-dir --audit`: scan every track number, report each with
      more than one live match, exit 1 if any (REQ-7)
- [ ] Test: TC-13 … TC-17

**Impact**: No writer in the Collector API can address the wrong folder, and
the duplicate state becomes visible instead of silently tolerated.

---

## Phase 5: End-to-end verification against the running system

**Problem**: Every symptom in this track was observed live, not in tests. Unit
tests alone cannot prove the flap is gone.

**Solution**: Restart the real processes and drive the real toggle.

- [ ] Restart the API server and the worker — neither hot-reloads, and
      verifying against a stale process is a false pass
- [ ] Toggle Auto Run in the UI on a prefixed track; confirm
      `**Auto Run**: yes` in the `INITIALS-NNN-slug` folder's `index.md` and
      nothing written to any bare-numeric folder (AC-1, AC-3)
- [ ] Wait a full worker sync cycle; confirm `auto_run` is still `true` in the
      database with no human action in between (AC-2)
- [ ] Post a comment through the API; confirm it reaches the canonical
      `conversation.md` and the worker syncs it (AC-5)
- [ ] Run `lc track-dir --audit` before and after a worker pass; record both
      outputs (AC-8)
- [ ] Record each observation in `conversation.md` — screenshot or real
      API/DB response, not "the code looks correct"
- [ ] Test: TC-18, TC-19

**Impact**: The reported symptom is confirmed fixed in the product, not only
in the suite.
