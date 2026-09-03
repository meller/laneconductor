# Tests: Track 10055 — Waiting-for-input is a first-class status on every lane

## Test Commands

```bash
# Worker / collector integration + unit (node:test, zero deps)
node --test conductor/tests/track-10055-waiting-any-lane.test.mjs
node --test conductor/tests/track-10055-waiting-resume.test.mjs

# Regression: the done-lane waiting flow this generalizes must not break
node --test conductor/tests/track-10035-pr-flow-e2e.test.mjs
node --test conductor/tests/track-10035-merge-lane-action.test.mjs
node --test conductor/tests/track-1114-auto-complete.test.mjs

# Server API + UI unit (Vitest)
cd ui && npm test

# Browser E2E
cd ui && npx playwright test
```

New test files:
- `conductor/tests/track-10055-waiting-any-lane.test.mjs` (Phases 1, 2, 5)
- `conductor/tests/track-10055-waiting-resume.test.mjs` (Phase 3)
- `ui/server/tests/track-10055-waiting-api.test.mjs` (Phases 1, 3, 5)
- `ui/src/components/TrackCard.waiting.test.jsx`,
  `ui/src/components/KanbanBoard.waiting.test.jsx` (Phase 4)
- `ui/e2e/track-10055-waiting.spec.js` (Phase 4 real-product check)

## Test Cases

### Phase 1 — Contract: schema, marker, collectors

- [ ] TC-1: `POST /track` with `lane_action_status: 'waiting'` and
      `lane_status: 'implement'` — expected: 200, row stored as `waiting`
      (today: 400, `ui/server/index.mjs:2628`).
- [ ] TC-2: `POST /track` with `lane_action_status: 'waiting'` and
      `lane_status: 'done'` — expected: 200 (D4 regression guard: this path is
      broken today for the one lane waiting is supposed to work on).
- [ ] TC-3: `POST /track` with `lane_action_status: 'nonsense'` — expected: 400,
      i.e. widening the set did not remove validation.
- [ ] TC-4: cloud `POST /track` with `waiting` — expected: stored as `waiting`,
      not silently rewritten to `queue` (`cloud/functions/index.js:953`).
- [ ] TC-5: cloud `POST /tracks/reset-stuck-actions` against a stale `running`
      track — expected: `lane_action_status = 'queue'`,
      `lane_action_result = 'stuck_timeout'` (parity with local).
- [ ] TC-6: `parseWaitingReason()` on an `index.md` containing
      `**Waiting Reason**: Needs prod DB approval` — expected: that exact
      string; on an index.md without the marker — expected: `null`.
- [ ] TC-7: `syncTrack` on a parked track posts `waiting_reason` in the payload
      and the value round-trips through `GET /track/:num`.
- [ ] TC-8: `mergeIndexMarkers` injects `**Waiting Reason**` into a primary
      `index.md` that does not yet contain the marker (`alwaysInject`), and
      updates it in place when it does.

### Phase 2 — Worker parks on any lane

- [ ] TC-9: mock-cli run on lane `implement` writing `**Lane Status**: waiting`,
      exit 0 — expected: track ends at `implement:waiting`, NOT `review:queue`
      (the `implement.on_success` transition) and NOT `done:waiting`. Covers D1
      and D2 together.
- [ ] TC-10: same on `plan`, `review`, `quality-gate` — expected: parked in the
      lane the action ran in, each time.
- [ ] TC-11: mock-cli merge run on `done` writing `waiting` — expected:
      `done:waiting`, unchanged from today (regression guard for track 10035).
- [ ] TC-12: a run whose transcript ends on a blocking question
      (`extractBlockedQuestion` matches), exit 0 — expected:
      `lane_action_status = 'waiting'` **and** `waiting_for_reply = true`, and
      NOT `<lane>:success`. Directly covers D3.
- [ ] TC-13: a run that ends mid-work (`**Lane Status**: running` left on disk)
      — expected: `<lane>:queue` with `lane_action_result = 'ended_mid_work'`,
      never read as a park.
- [ ] TC-14: a *failed* run (exit 1) with a leftover `waiting` marker on disk —
      expected: normal failure handling, not a park.
- [ ] TC-15: a park writes `**Waiting Reason**` to `index.md` and
      `waiting_reason` to the DB patch; when the agent wrote no marker, the
      reason is derived from the blocked question and a warning is logged.
- [ ] TC-16: a same-lane status-only park is not blocked by
      `applyGuardedLaneWrite` — the marker actually lands on disk.
- [ ] TC-17: the next successful (non-waiting) run on the same track clears both
      `**Waiting Reason**` and `waiting_reason`.

### Phase 3 — Parking is honoured; resume works

- [ ] TC-18: `autoLaunchLocalFs` over a fixture containing `implement:waiting`,
      `review:waiting`, `done:waiting` and one `implement:queue` — expected:
      only the queued track is launched.
- [ ] TC-19: `/tracks/claim-queue` with a `waiting` track available — expected:
      not claimed; `claim_reason` reports it as not queued.
- [ ] TC-20: `POST /api/projects/:id/tracks/:num/resume` on an
      `implement:waiting` track — expected: 200, DB shows `implement:queue`,
      `waiting_reason` NULL, `last_updated_by = 'human'`.
- [ ] TC-21: same call on a `implement:running` track — expected: 409, no state
      change.
- [ ] TC-22: after TC-20, the track's `index.md` reads
      `**Lane Status**: queue` with no `**Waiting Reason**` line.
- [ ] TC-23: end-to-end resume — park a track via mock-cli, call resume, run one
      worker cycle — expected: the worker claims and launches it.
- [ ] TC-24: a human reply on a `<lane>:waiting` + `waiting_for_reply: yes`
      track — expected: the answer path fires and the track leaves `waiting`
      without an explicit resume call.
- [ ] TC-25: route parity — `collector-route-parity` reports the resume route
      present on both collectors.

### Phase 4 — UI

- [ ] TC-26 (`KanbanBoard.waiting.test.jsx`): tracks with
      `lane_action_status: undefined` do NOT render inside the
      `lane-group-implement-waiting` group; a track with `'waiting'` does.
- [ ] TC-27: the waiting group header on a non-done lane renders the distinct
      (non-grey) label, and the done lane still renders 🔵 "PR open".
- [ ] TC-28 (`TrackCard.waiting.test.jsx`): an `implement:waiting` card renders
      a waiting indicator whose `title` contains the `waiting_reason`.
- [ ] TC-29: an `implement:waiting` card renders a ▶ Resume button; clicking it
      calls the resume handler with that track.
- [ ] TC-30: a `done:waiting` card with a `pr_url` renders `DonePrLink` and NO
      Resume button (regression guard for track 10035's affordance).
- [ ] TC-31: `LaneFocusView` status counts put a status-less track outside the
      waiting count, and filtering by `waiting` returns only parked tracks.
- [ ] TC-32 (`TrackDetailPanel.test.jsx`): the panel renders the full waiting
      reason and a Resume control for a parked track.

### Phase 5 — Inbox + auto-complete

- [ ] TC-33 (`track-10055-waiting-api.test.mjs`): a track at `implement:waiting`
      with **zero comments** and `waiting_for_reply = false` appears in
      `/api/inbox` under `needs_input`, with `waiting_reason` as its line.
- [ ] TC-34: dismissing that track hides it, and it does not reappear on the
      next poll while nothing has changed (mirrors the track-8002 live incident
      case in `track-10012-inbox-buckets.test.mjs`).
- [ ] TC-35: existing inbox bucket tests in
      `ui/server/tests/track-10012-inbox-buckets.test.mjs` still pass unchanged.
- [ ] TC-36: `classifyAutoCompleteOutcome({ beforeLane:'implement',
      afterLane:'implement', afterStatus:'waiting' })` — expected:
      `action: 'pause'` with the waiting reason, NOT the
      `"did not advance … stopping rather than retrying"` failure wording.
- [ ] TC-37: `classifyAutoCompleteOutcome({ beforeLane:'done',
      afterLane:'done', afterStatus:'waiting' })` — expected: unchanged
      `action: 'complete'`, "PR opened" reason (`track-1114-auto-complete`
      regression).

### Phase 6 — Documentation

- [ ] TC-38: `SKILL.md` contains a `**Waiting Reason**` marker-table row and a
      pausing protocol section that does not describe `waiting` as
      done-lane-only.
- [ ] TC-39: repo-wide grep for the phrase pattern tying `waiting` to the done
      lane in `constants.mjs` / `resting-state.mjs` — expected: comments state
      the general contract.

### Real-product check (required — this track touches UI)

- [ ] TC-40 (`ui/e2e/track-10055-waiting.spec.js`): with a seeded
      `implement:waiting` track, the board shows it in a distinctly-labelled
      waiting group in the Implement column; the card exposes the reason and a
      Resume control; clicking Resume moves it to the queued group. Run against
      a **restarted** API + worker (neither hot-reloads — a stale process is a
      false pass).
- [ ] TC-41: manual observation recorded in `conversation.md` — park a real
      track on `implement` via a lane action, screenshot the board, resume it,
      and confirm a worker picks it up.

## Acceptance Criteria

- [ ] All new tests above pass.
- [ ] `node --test conductor/tests/track-10035-*.test.mjs` and
      `conductor/tests/track-1114-auto-complete.test.mjs` pass unchanged — the
      done-lane flow this generalizes is not regressed.
- [ ] `cd ui && npm test` passes with no new failures.
- [ ] `cd ui && npx playwright test` passes (existing specs, plus TC-40).
- [ ] Stub scan (`grep -rniE "not yet implemented|TODO|FIXME|FFU"` over
      `conductor ui bin cloud`) returns nothing inside code paths this track
      marks `[x]`.
- [ ] Phase 7 (age-based escalation) is still unchecked and is not claimed as
      delivered.
