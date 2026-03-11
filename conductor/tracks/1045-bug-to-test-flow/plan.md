# Track 1045: Bug-to-Test Flow

## Phase 1: Backend — `/open-bug` endpoint

**Problem**: The "Open Bug" action is split across two frontend fetch calls with no test.md update. We need a single atomic backend endpoint that handles all side-effects.

**Solution**: Add `POST /api/projects/:id/tracks/:num/open-bug` to `ui/server/index.mjs`.

- [x] Task 1.1: Add `open-bug` route to `ui/server/index.mjs`
    - [x] Look up `repo_path` from `projects` table
    - [x] Find track folder (`conductor/tracks/NNN-*/`)
    - [x] Read existing `test.md` content (or empty string if absent)
    - [x] Count existing `TC-BUG-` occurrences → compute next `N`
    - [x] Append regression block (see spec) to test content string
    - [x] Write updated `test.md` to disk
    - [x] Update `test_content` in DB via `collectorWrite PATCH /track/:num`
    - [x] Post comment `🐛 Bug reported: <description>` via `collectorWrite POST /track/:num/comment`
    - [x] PATCH lane to `plan` via `collectorWrite PATCH /track/:num`
    - [x] Also append comment to local `conversation.md` (same pattern as existing comments endpoint)
    - [x] Queue file sync for `test.md` via `queueFileSync`
    - [x] Return `201 { ok: true, test_appended: true }`

- [x] Task 1.2: Helper — `appendRegressionTest(testContent, description, trackNum)` → new content string (in `ui/server/utils.mjs`)
    - [x] Pure function, no I/O (easy to unit test)
    - [x] Handles missing `## Test Cases` section (appends it)
    - [x] Generates `### Regression: <description> (<date>)` block
    - [x] Generates `- [ ] TC-BUG-N: …` line

**Impact**: Single endpoint encapsulates the full bug-open lifecycle.

---

## Phase 2: Frontend — wire "Open Bug" to new endpoint

**Problem**: The button calls `sendComment()` + a separate PATCH; test.md update is not triggered.

**Solution**: Replace the two calls with a single fetch to `/open-bug`, then refresh comments + detail.

- [x] Task 2.1: In `TrackDetailPanel.jsx`, add `openBug()` async function
    - [x] Capture `draft` text as description (trim; use placeholder if empty)
    - [x] `POST /api/projects/:id/tracks/:num/open-bug` with `{ description }`
    - [x] On success: clear draft, refresh comments, refresh detail (`fetchDetail()`)
    - [x] Guard: disable button while sending (reuse `sending` state)
- [x] Task 2.2: Wire "Open Bug" button `onClick` to `openBug()`
- [x] Task 2.3: Update button tooltip to hint that draft text is used as description

**Impact**: Button sends one request; test.md is updated atomically on the server.

---

## Phase 3: Tests

**Problem**: No automated tests exist for this flow.

**Solution**: `ui/server/tests/bug-to-test.test.mjs` — 10/10 passing.

- [x] Task 3.1: Unit tests for `appendRegressionTest` helper (5 tests)
- [x] Task 3.2: API integration tests for `POST /open-bug` (5 tests)
- [x] Task 3.3: Track's `test.md` updated with all test cases

**Impact**: Regression coverage for the bug-to-test flow itself.

---

## ✅ COMPLETE

All tasks implemented. 10 tests pass. Auth test failure is pre-existing (unrelated to this track).
