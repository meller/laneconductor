# Tests: Track 1103 — End-to-end onboarding experience

## Test Commands
```bash
# Server-side affordances (REQ-1, REQ-3, REQ-4)
cd ui && npx vitest run server/tests/track-1103-*.test.mjs

# Regression: 1102 F7's git-init behavior must be unchanged
node --test conductor/tests/track-1091-create-project-worker.test.mjs

# UI (once Phase 4 lands)
npx playwright test --project=fast -g "1103"
```

## Test Cases

### Phase 1/2 (documentation — verified by cross-reference, not automated)
- [ ] TC-1: Every state in Phase 1's UI happy path matches an actual
      observed screen from 1104's session-log.md (spot-check, not 1:1
      required — 1104 is the primary source of truth)
- [ ] TC-2: Phase 2's CLI happy path matches `lc setup`'s actual prompt
      sequence in `bin/lc.mjs` (re-verify if that file changes)

### Phase 4: UI affordances
- [ ] TC-3: A project with a registered `projects` row and zero rows in
      `workers` shows the "no worker" indicator (REQ-1/2)
- [ ] TC-4: A project with two workers on different `hostname`s shows
      both in the WORKERS bar, correctly attributed (REQ-2)
- [ ] TC-5: `create-project` against a directory containing files other
      than the scaffold refuses with the existing 1102 F7 error message
      — regression, must still pass unmodified (REQ-3)
- [ ] TC-6: Worker mode badge reads "Manual" for a `sync-only` worker and
      "Automatic" for `sync+poll`, while `GET /api/workers` still returns
      the raw `sync-only`/`sync+poll` string (REQ-4 — label only, no
      contract change)
- [ ] TC-7: A track whose dispatch fails during worktree setup (1102
      F8's reproduction) shows a distinct failed state with the actual
      error text, not an indefinitely-climbing stale counter (REQ-5)
- [ ] TC-8: A track whose dispatch succeeds in its worktree but doesn't
      merge back (1102 F9/F12's reproduction — the exact scenario hit
      live in track 1104) shows a distinct "succeeded, unmerged" state
      (REQ-5)

### Phase 5: Wiki guides
- [ ] TC-9: UI guide reviewed against 1104's session-log.md — every step
      in the guide traces to a step in the log
- [ ] TC-10: Skill/CLI guide reviewed against 1105/1106's session logs
      once those tracks produce one

## Acceptance Criteria
- [ ] All test cases above pass or are explicitly deferred with a reason
      (e.g. TC-10 blocked until 1105/1106 run)
- [ ] No regression in `track-1091-create-project-worker.test.mjs`
      (git-init behavior, REQ-3)
- [ ] Every REQ in spec.md maps to at least one test case or a recorded
      manual verification in this track's `conversation.md`
