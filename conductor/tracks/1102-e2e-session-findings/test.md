# Tests: Track 1102 — E2E session findings

Every open phase is TDD'd: write the test, watch it fail **for the right
reason**, then fix. This track exists because things with green unit tests
were broken in the real UI — so phases touching a user-visible flow are not
done until they have also been driven for real (see "Live verification").

## Test Commands

```bash
# Worker / conductor suite (node:test — real processes, real filesystem)
node --test conductor/tests/

# A single conductor test
node --test conductor/tests/track-1102-f21-mid-run-doc-sync-clobber.test.mjs

# UI + server suite (Vitest)
cd ui && npm test

# A single server test
cd ui && npx vitest run server/tests/track-1102-f15-lane-reset-dispatch.test.mjs

# Browser E2E
cd ui && npx playwright test
```

**Baseline first.** This suite has a known set of pre-existing flaky
failures (7 at last count). Record the failing set *before* changing
anything and compare after — a stash-compare, not eyeballing. "No new
failures" is the bar; "all green" is not achievable and claiming it is a
false pass.

## Test Cases

### Phase 3 — F3: one status marker (REQ-1 / AC-1)
File: `ui/server/tests/track-1102-f3-single-status-marker.test.mjs`
- [ ] TC-3.1: `trackTemplates()` output contains `**Lane**:` — expected: present
- [ ] TC-3.2: `trackTemplates()` output contains no `**Status**:` line — expected: 0 matches
- [ ] TC-3.3: bug-type and default-type templates both satisfy TC-3.1/3.2 — expected: both pass
- [ ] TC-3.4 (regression, unmodified): `conductor/tests/track-10012-parse-status-precedence.test.mjs` still passes — expected: `**Lane**` keeps winning for legacy files that have both
- [ ] TC-3.5 (live): create a track in the UI, `grep -c '\*\*Status\*\*' index.md` — expected: 0; then drag its card to another lane and wait 2s — expected: it stays put

### Phase 7 — F21 original variant (REQ-3 / AC-3)
File: `conductor/tests/track-1102-f21-exit-zero-mid-work.test.mjs`
- [ ] TC-7.1: mock CLI exits 0 leaving `index.md` at `Lane Status: running` with a dirty worktree — expected: outcome is the new mid-work state, **not** a bare `queue`
- [ ] TC-7.2: same run appends a `> **system**: ⚠️ …` comment naming the mid-work end and the re-run remedy — expected: comment present and parseable by the sync worker's comment parser
- [ ] TC-7.3: the dispatch row records the distinguishable result — expected: not the generic "lane status: queue"
- [ ] TC-7.4 (negative): a normal run that exits 0 *after* setting `success` is unaffected — expected: existing transition behavior byte-for-byte
- [ ] TC-7.5 (negative): a real failure (non-zero exit) still reports failure — expected: unchanged
- [ ] TC-7.6 (live): re-run the interrupted track and confirm the work continues from the worktree — expected: prior uncommitted work still present, session resumed

### Phase 8 — F9b: `workDir` TDZ (REQ-2 / AC-2)
File: `conductor/tests/track-1102-f9b-log-staging.test.mjs`
- [ ] TC-8.1: after a run producing log output, `last_run.log` is staged in the worktree — expected: `git status --porcelain` shows it staged, not untracked (fails today: the `git add` never executes)
- [ ] TC-8.2: no `ReferenceError` is thrown during the exit handler — expected: none, asserted from worker stdout
- [ ] TC-8.3: the catch logs a warning if the `git add` genuinely fails — expected: a visible warn line, not silence

### Phase 9 — F20: transcript overlay (REQ-4 / AC-4)
File: `ui/tests/e2e/track-1102-f20-transcript-overlay.spec.js`
- [ ] TC-9.1: with a transcript open, `elementFromPoint` at the card's action button returns that button — expected: the button, not the transcript div (fails today)
- [ ] TC-9.2: clicking the action button issues the expected POST — expected: request observed
- [ ] TC-9.3: a finished/killed run's transcript is not presented as live — expected: distinct, correct state
- [ ] TC-9.4 (live): drive the real UI, click through, confirm the action happens

### Phase 10 — F6: MANUAL / AUTOMATIC in the CLI (REQ-5 / AC-5)
File: `conductor/tests/track-1102-f6-cli-mode-vocabulary.test.mjs`
- [ ] TC-10.1: `lc worker start --help` mentions MANUAL and AUTOMATIC — expected: both present
- [ ] TC-10.2: `lc worker status` labels a `sync-only` worker MANUAL — expected: MANUAL
- [ ] TC-10.3: `worker.mode: 'sync+poll'` and `--sync-and-work` behave exactly as before — expected: unchanged wire behavior
- [ ] TC-10.4: mode wording is never confused with `workers.type` (`project` | `manager`) — expected: distinct labels

### Phase 11 — F19: backlog → plan (REQ-6 / AC-6)
File: `ui/src/components/TrackCard.test.jsx` (extend)
- [ ] TC-11.1: a `backlog` track's next-lane arrow targets `plan` — expected: `plan`
- [ ] TC-11.2: the arrow's label/tooltip names the plan lane — expected: no "Start"/implement wording for a backlog card
- [ ] TC-11.3 (mutation check): flipping `NEXT_LANE.backlog` back to `implement` makes TC-11.1 fail — expected: fails

### Phase 12 — F18 follow-up: claim-timeout (REQ-7 / AC-7)
File: `ui/server/tests/track-1102-f18b-dispatch-claim-timeout.test.mjs`
- [ ] TC-12.1: a dispatch `pending` past the window with another live worker available is reassigned — expected: `worker_id` changes to the live worker
- [ ] TC-12.2: with no other live worker, it is marked failed with a reason — expected: `status: 'failed'`, non-empty message
- [ ] TC-12.3 (negative): a dispatch inside the window is left alone — expected: untouched
- [ ] TC-12.4 (negative): a *claimed* dispatch on a long-running action is never reassigned — expected: untouched regardless of age
- [ ] TC-12.5: the outcome is visible via the API the UI reads — expected: present in the response

### Phase 13 — F10c: FK SET NULL (REQ-8 / AC-8)
File: `ui/server/tests/track-1102-f10c-dispatch-fk-set-null.test.mjs`
- [ ] TC-13.1: deleting a `workers` row leaves its `worker_dispatch` rows present — expected: rows survive with `worker_id IS NULL` (fails today: CASCADE deletes them)
- [ ] TC-13.2: `worker_adhoc_chat` history survives the same deletion — expected: readable afterwards
- [ ] TC-13.3: every read path tolerates a null `worker_id` — expected: no crash, sensible rendering
- [ ] TC-13.4: migration applies cleanly to a DB with existing rows — expected: applies, no data loss

### Phase 4 — walkthrough (no fixed test file)
Observation-driven, not assertion-driven. Each task records a screenshot or
a real API/DB response. Anything broken becomes F22+ in `index.md` with the
same evidence standard as F1–F21.
- [ ] TC-4.1: Activity panel states/chat/stop — observed and recorded
- [ ] TC-4.2: Inbox classification of ✅ / ⚠️ / ❌ — observed and recorded
- [ ] TC-4.3: deploy wizard walked, stopping before an actual deploy — recorded

### Phase 15 — F15 live verification (REQ-9 / AC-9)
- [ ] TC-15.1: real sync-only project, drag a card to a new lane — expected: a `worker_dispatch` row appears and is claimed
- [ ] TC-15.2: same via the `/reset` path — expected: same
- [ ] TC-15.3: observation recorded in F15's body

## Live verification (required, not optional)

Phases 3, 7, 9, 15 and 4 touch user-facing flows. Unit tests cannot detect a
feature that was never wired up — that is the founding observation of this
track. Before marking any of them complete:

- [ ] Restarted the worker and API server first (neither hot-reloads;
      verifying against a stale process is a false pass, and has produced
      false verdicts in this repo before)
- [ ] Drove the flow in the real UI and recorded the user-visible result

## Acceptance Criteria

- [ ] Every open phase has its test written first and observed failing for
      the right reason before the fix
- [ ] Full conductor suite re-run: no failures beyond the recorded
      pre-existing baseline (compared, not eyeballed)
- [ ] `cd ui && npm test` shows no new failures against its own baseline
- [ ] Every AC-1 … AC-10 in `spec.md` is checked, or moved to another track
      with a link
- [ ] No stub or "not yet implemented" path remains in any code path this
      plan marks `[x]`
