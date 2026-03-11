# Track 1045: Bug-to-Test Flow

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Phase**: Complete
**Waiting for reply**: no
**Summary**: When "Open Bug" is clicked, automatically append a regression test to test.md (disk + DB) so the bug cannot silently recur.

## Problem
The "Open Bug" button in the Conversation tab posts a comment and changes the lane but leaves `test.md` unchanged. Without a regression test, the same bug can resurface undetected.

## Solution
Added `POST /api/projects/:id/tracks/:num/open-bug` endpoint that atomically posts the comment, appends a `TC-BUG-N` regression test to `test.md` (disk + DB), and moves the track to `plan`. Updated the UI button to call this endpoint using the draft text as the bug description.

## Phases
- [x] Phase 1: Backend — `/open-bug` endpoint + `appendRegressionTest` helper
- [x] Phase 2: Frontend — wire "Open Bug" button to new endpoint
- [x] Phase 3: Tests — 10/10 passing
