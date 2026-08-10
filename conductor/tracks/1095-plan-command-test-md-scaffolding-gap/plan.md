# Plan: /laneconductor plan doesn't reliably populate test.md (Track 1095)

## Phase 1: Update Instructions in SKILL.md

**Problem**: The planning agent has weak instructions on creating/populating `test.md`, and the implementation agent proceeds with TDD even when `test.md` is a stub.
**Solution**: Enhance instructions in `SKILL.md`.

- [x] Task 1: Update `/laneconductor plan` instructions in `SKILL.md` to explicitly command the agent to fully populate `test.md` using the templates.
- [x] Task 2: Update `/laneconductor implement` instructions in `SKILL.md` to add a self-healing check at start: if `test.md` is missing, empty, or a stub, draft the test cases first before writing any application code.

## Phase 2: Update sync worker scaffolding in laneconductor.sync.mjs

**Problem**: Tracks created via file sync queue lack `test.md` initially, and the sync worker creates a bare stub.
**Solution**: Initialize structured `test.md` files at creation.

- [x] Task 1: Update `handleTrackCreate` in `laneconductor.sync.mjs` to write a structured `test.md` file (using the standard template) when creating track folders.
- [x] Task 2: Update the fallback `ensureTrackFileExists` for `test.md` in `pullTracksMetadataFromDB` to create a structured template rather than a bare stub.

## Phase 3: Verification

**Problem**: Need to verify the new scaffolding and self-healing logic works correctly.
**Solution**: Write tests and manually verify.

- [x] Task 1: Create a test track via the file sync queue and verify a structured `test.md` is immediately created.
- [x] Task 2: Verify a plan run on a new track correctly fills out `test.md`.
- [x] Task 3: Verify an implement run on a track with a stub `test.md` correctly self-heals by populating it first.
- [x] Task 4: Run existing test suite to ensure no regressions.

## ✅ COMPLETE

## ✅ REVIEWED

## ✅ QUALITY PASSED
