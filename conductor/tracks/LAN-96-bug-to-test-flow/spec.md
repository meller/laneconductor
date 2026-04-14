# Spec: Bug-to-Test Flow

## Problem Statement

The "Open Bug" button in the Conversation tab sends a comment and moves the track to the `plan` lane, but does nothing to record a regression test. Without a test, the same bug can silently resurface. The full bug lifecycle should end with a failing test that prevents recurrence.

## Requirements

- **REQ-1**: When a user clicks "Open Bug", a regression test case is automatically appended to the track's `test.md`.
- **REQ-2**: The bug description used for the test case should come from the user's current draft (if non-empty) or the body of the "Open Bug" comment.
- **REQ-3**: The test entry must follow the existing `test.md` format (a new `### Regression: …` section with a `- [ ] TC-BUG-N:` checkbox).
- **REQ-4**: If no `test.md` exists yet, one must be created with the standard header + the regression section.
- **REQ-5**: The updated `test_content` must be persisted in the DB (`tracks.test_content`) so the Tests tab in the UI reflects the new test immediately.
- **REQ-6**: The file on disk (`test.md`) must also be updated so the sync worker and AI agents pick it up.
- **REQ-7**: The existing comment-posting and lane-change behaviour ("Open Bug" → `plan` lane) must be preserved.
- **REQ-8**: No regressions in the existing "Open Feature" or "Brainstorm" quick-action buttons.

## Acceptance Criteria

- [ ] Clicking "Open Bug" with draft text → regression test case containing that text is appended to `test.md` (disk + DB)
- [ ] Clicking "Open Bug" with empty draft → regression test case with generic placeholder is appended
- [ ] If `test.md` does not exist, it is created from scratch with correct header + regression section
- [ ] The comment `🐛 Bug reported: …` is posted to the conversation as before
- [ ] The track moves to the `plan` lane
- [ ] Tests tab in UI renders the new regression test immediately (test_content updated)
- [ ] "Open Feature" and "Brainstorm" buttons are unaffected

## API Contracts / Data Models

### New endpoint

```
POST /api/projects/:id/tracks/:num/open-bug
Content-Type: application/json

Body: { "description": "optional user description of the bug" }

Response 201: { "ok": true, "comment": { ...comment row... }, "test_appended": true }
```

### test.md regression block format

```markdown
### Regression: <description> (<ISO date>)
- [ ] TC-BUG-N: Verify "<description>" does not recur — expected: [correct behavior]
```

Where `N` is derived from the count of existing `TC-BUG-` lines + 1.
