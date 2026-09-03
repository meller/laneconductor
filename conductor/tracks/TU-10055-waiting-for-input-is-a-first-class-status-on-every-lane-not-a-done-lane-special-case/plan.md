# Track TU-10055: Waiting-for-input is a first-class status on every lane

Phases are ordered so the contract exists before anything writes to it, and the
UI is built against a status the backend can already store. Each phase is
independently committable and leaves the system working.

---

## Phase 1: The contract — schema, marker, and collectors that accept `waiting`

**Problem**: `waiting` is a legal enum value the collectors refuse. `POST /track`
returns 400 for it (`ui/server/index.mjs:2628`), and the cloud collector
downgrades it to `queue` (`cloud/functions/index.js:953`). There is nowhere to
record *why* a track is parked. Nothing else in this track can work until this
is fixed — and D4 is a live bug affecting `done:waiting` today.

**Solution**: Widen the accepted status set on every write path, add the
`waiting_reason` column and its `**Waiting Reason**` marker, and align the two
collectors' stuck-reset semantics.

- [x] Task 1.1: Remove the `waiting` rejection in `ui/server/index.mjs:2628-2631`
      — accept `['queue','waiting','running','success','failure']`, sourced from
      `LaneActionStatus` in `conductor/constants.mjs` rather than a fresh
      hand-written list.
    - [x] Sub-task: audit `ui/server/index.mjs` for any other hand-listed status
          array and point it at the same constant.
- [x] Task 1.2: Remove the `insertActionStatus === 'waiting' → 'queue'` downgrade
      at `cloud/functions/index.js:953`.
- [x] Task 1.3: Change `cloud/functions/index.js:1282`'s `reset-stuck-actions` to
      write `lane_action_status = 'queue'` (matching `ui/server/index.mjs:3317`),
      keeping `lane_action_result = 'stuck_timeout'`. (REQ-5)
- [x] Task 1.4: Migration `ALTER TABLE tracks ADD COLUMN IF NOT EXISTS
      waiting_reason TEXT;` via the project's Atlas workflow, plus the matching
      field in `prisma/schema.prisma`.
- [x] Task 1.5: `parseWaitingReason()` in `conductor/laneconductor.sync.mjs`
      (alongside `parseMergeMode`/`parseWorkspaceMarker`), wired into
      `syncTrack`'s payload; `waiting_reason` accepted by `POST /track` and
      `PATCH /track/:num/action` and returned by the track read endpoints, on
      both collectors.
- [x] Task 1.6: Add `**Waiting Reason**` to `mergeIndexMarkers`' marker list in
      `conductor/services/worktree-artifact-merge.mjs` with `alwaysInject: true`
      — same reasoning as `**Waiting for reply**` (a track can go its whole life
      without the marker until the first time it pauses, so "absent from
      primary" is the normal first-occurrence case, not a reshaping signal).

**Impact**: A paused track's `index.md` edits sync cleanly again (D4 fixed for
`done:waiting` immediately). The DB can express *why* a track is parked. No
behaviour change yet for non-done lanes.

---

## Phase 2: The worker — any lane can park at `waiting`

**Problem**: The exit handler only looks for an agent-written `waiting` when
`laneStatus === 'done'` (`laneconductor.sync.mjs:5314`), and hardcodes
`targetLane = 'done'` when it finds one (`:5519`). A blocked turn lands at
`<lane>:success` (D3) — the single worst symptom in this track, since ✅ Success
is exactly the state nothing polls and nobody investigates.

**Solution**: Ungate the detection, park in the lane the action actually ran in,
and route the blocked-turn path through the same park.

- [ ] Task 2.1: Drop the `laneStatus === 'done'` condition from
      `agentReportedWaiting`'s detection block (`:5313-5322`). Keep it gated on
      `isSuccess` — a failed run's leftover marker is not a deliberate park.
- [ ] Task 2.2: Replace the hardcoded `targetLane = 'done'` at `:5518-5521` with
      `targetLane = laneStatus` (park in place). `done` keeps working because
      `laneStatus` *is* `done` for a merge run.
- [ ] Task 2.3: `isBlockedTurn` (`:5386`, `:5656-5665`) now also sets
      `nextActionStatus = 'waiting'` alongside the existing
      `waiting_for_reply: yes`, so the board and the claim loop agree with the
      Inbox. (REQ-2)
- [ ] Task 2.4: Write `**Waiting Reason**` into `index.md` and `patchData`
      whenever a run parks. Source, in order: the agent's own
      `**Waiting Reason**` marker; the extracted blocked question's first line;
      a generic fallback plus a `logger.warn` naming the track. (REQ-3)
- [ ] Task 2.5: Verify a same-lane, status-only park is not blocked by
      `applyGuardedLaneWrite`/`lane-regression-guard.mjs` (`:5573-5600`) — the
      guard's `requireProducedForAnyChange` path compares on-disk lane vs the
      run's lane, which matches for a park; add a test pinning that.
- [ ] Task 2.6: Confirm ordering against `endedMidWork` — an abandoned run
      (marker still `running`) must not be read as a park. Preserve the existing
      `!endedMidWork &&` precedence and cover both orderings by test.
- [ ] Task 2.7: Clear `**Waiting Reason**` and `waiting_reason` on any
      subsequent non-waiting outcome for the track.

**Impact**: A lane action on any lane can stop and say "I need a human", and the
system records it truthfully instead of advancing the track.

---

## Phase 3: Parking is honoured, and resume works

**Problem**: Nothing claims a `waiting` track (correct), but there is also no
supported way to un-park one outside the done-lane PR reconciler — so a
first-class pause on `implement` would be a dead end.

**Solution**: Pin the claim-gating behaviour with tests, and add the resume
paths (explicit and conversation-driven).

- [ ] Task 3.1: Tests pinning that neither `autoLaunchLocalFs`
      (`laneconductor.sync.mjs:6358`) nor the API claim query
      (`ui/server/index.mjs`'s `/tracks/claim-queue`) ever claims a `waiting`
      track, on any lane. (REQ-6)
- [ ] Task 3.2: `POST /api/projects/:id/tracks/:num/resume` on both collectors:
      `waiting → queue`, clear `waiting_reason`, set `last_updated_by='human'`,
      409 when the track is not `waiting`. Register it in
      `conductor/services/collector-route-parity.mjs`.
- [ ] Task 3.3: The resume must reach the filesystem too — `syncTrackToFile`
      writes `**Lane Status**: queue` and drops `**Waiting Reason**`, so local-fs
      and worktree copies agree with the DB.
- [ ] Task 3.4: Conversation-reply resume: a reply on a `<lane>:waiting` track
      with `waiting_for_reply: yes` flips the status back to `queue`/`running`
      through the existing answer path — verify the `local-fs-answer` write scope
      (`conversation-run-write-scope.mjs`) permits exactly this un-park and
      nothing more. (REQ-8)
- [ ] Task 3.5: Confirm `done:waiting` is untouched by all of the above — the
      reconciler (`laneconductor.sync.mjs:4413-4445`) remains the only thing that
      moves a PR-parked track.

**Impact**: A parked track is genuinely parked, and there are exactly two ways
out of it — both deliberate, both human-initiated.

---

## Phase 4: The board tells the truth

**Problem**: `waiting` is bucketed with "no status at all" under a grey ⌛
heading (`KanbanBoard.jsx:84`, `LaneFocusView.jsx:37,43`), and a paused
non-done track has no control on its card at all (`TrackCard.jsx:586`) — no
run button, no indicator, no link.

**Solution**: Separate the two buckets, give `waiting` a distinct treatment on
every lane, surface the reason, and add the Resume control.

- [ ] Task 4.1: Split `KanbanBoard.jsx`'s grouping — `waiting` matches only
      `lane_action_status === 'waiting'`; tracks with a missing/unknown status
      get their own bucket (`unknown`, `show: false` by default so they render
      ungrouped rather than mislabelled). Same in `LaneFocusView.jsx`'s
      `statusCounts`/`filteredTracks` (`|| 'waiting'` → explicit handling).
- [ ] Task 4.2: Promote `waiting` in `LANE_STATUS_CONFIG` to a distinct,
      attention-carrying treatment (⏸️, amber) per
      `conductor/design-language.md`'s tokens. `DONE_LANE_STATUS_CONFIG`'s
      🔵 "PR open" override stays as the done-lane specialization.
- [ ] Task 4.3: `TrackCard.jsx` — a `waiting` state indicator on every lane
      (mirroring the existing `running`/`queue` indicator blocks at `:488` and
      `:506`), showing a short label with the full `waiting_reason` in the
      `title` tooltip; keep it a compact one-line badge (the track-10040 wrapping
      lesson at `:499-506`).
- [ ] Task 4.4: `TrackCard.jsx:586` — add `'waiting'` to the ▶-eligible statuses
      for plan/implement/review/quality-gate, labelled **Resume**, wired to the
      Phase 3 resume endpoint. Deliberately NOT added for `done:waiting`, where
      `DonePrLink` remains the affordance. (REQ-7)
- [ ] Task 4.5: `TrackDetailPanel.jsx` — render the waiting reason in full, with
      a Resume control alongside it.

**Impact**: A paused track is the most visible thing on the board, and one click
un-pauses it.

---

## Phase 5: Inbox and auto-complete

**Problem**: The Inbox's `needs_input` bucket can't see a status-only pause
(`ui/server/index.mjs:1045-1079`), and `classifyAutoCompleteOutcome` describes a
non-done pause as a failure to progress (`auto-complete.mjs:31-48`).

**Solution**:

- [ ] Task 5.1: Extend `/api/inbox`'s bucket CASE and its `WHERE` clause so
      `lane_action_status = 'waiting'` alone qualifies a track for
      `needs_input`, with `waiting_reason` as the displayed line. Preserve the
      dismissal semantics the existing tests pin (`track-10012-inbox-buckets`'s
      "dismissed track stops reappearing" cases). (REQ-10)
- [ ] Task 5.2: `InboxPanel.jsx:168`'s client-side classification mirrors the
      same rule.
- [ ] Task 5.3: `classifyAutoCompleteOutcome` — hoist the `waiting` check above
      the `afterLane === 'done'` block and return
      `{ action: 'pause', reason: <waiting reason> }` for any lane. Update the
      caller in `laneconductor.sync.mjs` to halt the sequence and surface the
      reason rather than reporting a stall. Keep `done:waiting`'s existing
      "PR opened" wording as the done-lane case. (REQ-11)

**Impact**: Every pause reaches the human through the channel built for it.

---

## Phase 6: Documentation and contract cleanup

- [ ] Task 6.1: `.claude/skills/laneconductor/SKILL.md` — a "Pausing for human
      input" protocol section: any lane action may end by writing
      `**Lane Status**: waiting` + a mandatory `**Waiting Reason**`, plus a
      `⏸️`/`⚠️` conversation comment per the Completion Comment Convention; add
      `**Waiting Reason**` to the marker table; generalize the `waiting` row
      wording so it no longer reads as done-lane-only.
- [ ] Task 6.2: `conductor/workflow.md` — document `waiting` in the lane-status
      model and the two resume paths.
- [ ] Task 6.3: `conductor/services/resting-state.mjs:20-24` — generalize the
      `ALWAYS_VALID_STATUSES` comment; `waiting` is valid on every lane because
      it is a human-owned park, not because it is done-lane pr-mode's.
- [ ] Task 6.4: `conductor/constants.mjs:22-32` — rewrite `WAITING`'s comment to
      state the general contract, keeping the track-10035 history note.
- [ ] Task 6.5: `conductor/product.md` — note `waiting` in the feature/status
      material where lane statuses are described.

**Impact**: The next agent to touch this reads the general rule, not the
done-lane story.

---

## Phase 7: Age-based escalation of long-parked tracks (FFU — NOT in this track)

- [ ] Deferred: notify/escalate when a track has been `<lane>:waiting` beyond a
      configurable age. Requires a policy decision (who is notified, through
      what channel, and whether escalation changes the status) that this track
      does not make. **This phase is intentionally unchecked; this track cannot
      be marked done at 100% while it is open.**
