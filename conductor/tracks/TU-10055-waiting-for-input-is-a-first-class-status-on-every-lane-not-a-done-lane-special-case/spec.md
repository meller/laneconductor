# Spec: Waiting-for-input is a first-class status on every lane

## Problem Statement

A lane action can pause and genuinely need a human before it can continue.
This happens on `plan` ("should this track also change the pricing model?"),
`implement` ("should I apply this destructive DB migration?"), `review`
("this contradicts the design language — which one wins?") and `quality-gate`
("the E2E suite needs prod credentials I don't have") — not only on `done`.

Today `waiting` exists as a real value (`LaneActionStatus.WAITING` in
`conductor/constants.mjs:32`, the Postgres enum value added by
`migrations/20260304181909_enable_rls.sql:2`), but essentially every code path
that reads or writes it is hardcoded to the **done lane's pr-mode merge**.
Everywhere else the state is either impossible to reach, silently discarded, or
rendered indistinguishable from "nothing has happened yet".

### Confirmed defects

| # | Where | What actually happens |
|---|-------|----------------------|
| D1 | `conductor/laneconductor.sync.mjs:5314` | `agentReportedWaiting` detection is gated on `isSuccess && laneStatus === 'done'`. An agent on any other lane that writes `**Lane Status**: waiting` as its last action has that write **ignored** by the exit handler, which then applies the normal success transition — the pause is erased and the track advances as if the work were finished. |
| D2 | `conductor/laneconductor.sync.mjs:5518-5521` | Even when detected, the override hardcodes `targetLane = 'done'`. There is no way to express "paused, still in `implement`". |
| D3 | `conductor/laneconductor.sync.mjs:1829-1835` + `:5493-5497` + `:5656-5665` | A turn that ends on a genuine blocking question (`isBlockedTurn`) sets `transitionValue = null`, so `resolveTransition` returns `status: isSuccess ? 'success' : …`. A blocking question is a clean `end_turn` (exit 0), so **a blocked turn lands at `<lane>:success`** — the card reads ✅ Success, nothing polls it, and `resting-state.mjs` is the only thing in the codebase that would even call it stranded. `waiting_for_reply: yes` is set, which is the only reason a human ever finds out. |
| D4 | `ui/server/index.mjs:2628-2631` | `POST /track` (the generic chokidar file-sync path, the one `syncTrack` uses at `laneconductor.sync.mjs:2465-2466`) **rejects `lane_action_status: 'waiting'` with a 400**. Every file-triggered re-sync of a `done:waiting` track therefore fails outright — not just the status field; title, progress, summary and `index_content` are all discarded. The failure is swallowed as a `logger.warn` at `laneconductor.sync.mjs:2513`. This breaks the one lane where waiting is supposed to work today. |
| D5 | `cloud/functions/index.js:953` | `if (insertActionStatus === 'waiting') insertActionStatus = 'queue';` — the cloud collector silently downgrades every waiting write to `queue`, which is precisely the "a worker will pick this up automatically" state the pause exists to avoid. |
| D6 | `cloud/functions/index.js:1282` | `reset-stuck-actions` writes `lane_action_status = 'waiting', lane_action_result = 'stuck_timeout'`, while the local collector writes `'queue'` for the same operation (`ui/server/index.mjs:3317`). Under a first-class model, a timed-out phantom run and a deliberate human pause become the same state on cloud. |
| D7 | `ui/src/components/KanbanBoard.jsx:84` | `waiting: visibleTracks.filter(t => !t.lane_action_status \|\| t.lane_action_status === 'waiting')` — a genuinely paused track is bucketed with tracks that have *no status at all*, under a grey ⌛ "Waiting" header. `DONE_LANE_STATUS_CONFIG`'s distinct labelling (`:243-246`) applies only when `lane.id === 'done'`. Same conflation in `LaneFocusView.jsx:37,43` (`t.lane_action_status \|\| 'waiting'`). |
| D8 | `ui/src/components/TrackCard.jsx:586` | The ▶ run control renders for `['success','queue','failure','failed']` on plan/implement/review/quality-gate. `waiting` is absent, and `DonePrLink` (`:232`) is gated on `lane_status === 'done'`. A track parked at `implement:waiting` has **no run button, no indicator, and no link** — the card is inert with no way to resume it from the UI. |
| D9 | `conductor/services/auto-complete.mjs:31-44` | `afterStatus === 'waiting'` is only classified inside `if (afterLane === 'done')`. On any other lane it falls to the same-lane guard and is reported as `"<lane> did not advance (status: waiting) — stopping rather than retrying automatically"` — a paused-for-you state described to the user as a failure to progress. |
| D10 | `ui/server/index.mjs:1045-1079` | The Inbox's `needs_input` bucket is driven by `t.waiting_for_reply` and comment authorship. `lane_action_status = 'waiting'` contributes nothing, so a lane action that parked without posting a question never appears in the Inbox at all. |
| D11 | `conductor/services/resting-state.mjs:24` | `waiting` sits in `ALWAYS_VALID_STATUSES` justified as "done-lane pr-mode's own legitimate … park". The behaviour generalizes correctly, but the stated contract does not, and there is no reason recorded anywhere for *why* a given track is parked. |

Net effect: the only two ways a lane action can currently signal "I need you"
are (a) `waiting_for_reply`, which requires it to have posted a conversation
comment, and (b) landing at `<lane>:success` and hoping someone notices. Neither
is legible on the board.

## Solution

Make `<lane>:waiting` mean exactly one thing, on every lane:

> **This lane action stopped on purpose and cannot continue until a human does
> something. No worker will claim it until a human resumes it.**

with a mandatory human-readable reason attached, a uniform visual treatment, an
explicit resume affordance, and Inbox surfacing.

### Status semantics after this track

| Status | Meaning | Who moves it next |
|--------|---------|-------------------|
| `queue` | Ready; a worker may claim it | worker (auto) |
| `running` | A lane action is executing right now | the running action's exit handler |
| `waiting` | **Paused — needs a human.** Nothing will claim it. | a human (Resume / reply / external event) |
| `success` | The lane action finished and the workflow transition applied | n/a (terminal for that lane) |
| `failure` | The lane action failed | retry machinery, or a human |

`done:waiting` (pr-mode merge, PR open on GitHub) becomes one *instance* of the
general rule — "the human action needed is approving the PR" — not a separate
mechanism. Its existing reconciler (`reconcilePrTracks`,
`laneconductor.sync.mjs:4413-4445`) stays exactly as-is: it is the external
event that resumes that particular flavour of pause.

### Relationship to `waiting_for_reply`

The two signals stay distinct and are set together where both apply:

- `waiting_for_reply` (boolean) — *the conversation channel is open*: a question
  is on the thread and a human reply will be routed back into the agent via the
  existing `local-fs-answer` resume path (`laneconductor.sync.mjs:6358`'s
  `!waitingForReply` bypass).
- `lane_action_status = 'waiting'` — *the lane action itself is parked*: this is
  the board-level state and the claim-gating fact.

A blocked turn (D3) sets **both**: `<lane>:waiting` so the board and the claim
loop are honest, and `waiting_for_reply: yes` so replying is enough to resume.
A pause with no answerable question (e.g. "PR open, go approve it"; "run the
prod migration and then resume me") sets only the former.

## Requirements

- **REQ-1** — `<lane>:waiting` is reachable on `plan`, `implement`, `review`,
  `quality-gate` and `done`. The exit handler honours an agent-written
  `**Lane Status**: waiting` on any lane and parks the track **in the lane the
  action ran in**, never forcing `done`. (D1, D2)
- **REQ-2** — A turn that ends on a genuine blocking question parks at
  `<lane>:waiting` with `waiting_for_reply: yes`, never at `<lane>:success`. (D3)
- **REQ-3** — A new `**Waiting Reason**: <one line>` marker in `index.md`,
  parsed by the sync worker, persisted to a `tracks.waiting_reason` column and
  returned by the track APIs. When a lane action parks without writing one, the
  worker synthesizes it from the run's own blocked question or last system
  comment and logs a warning — a park is never reasonless in the UI.
- **REQ-4** — Both collectors accept and store `lane_action_status: 'waiting'`
  on every write path, for every lane. The `POST /track` 400 (D4) and the cloud
  `waiting → queue` downgrade (D5) are removed.
- **REQ-5** — `reset-stuck-actions` writes `queue` on cloud, matching local
  (D6). A stuck/phantom run is not a deliberate pause and must not land in the
  state that means "a human chose this".
- **REQ-6** — Nothing auto-claims a `waiting` track. This already holds
  (`laneconductor.sync.mjs:6358`, the `queue`-only claim SQL) and must be
  covered by a test so it cannot regress.
- **REQ-7** — A human can resume a parked track from the UI in one click, on
  every lane: the resume flips `<lane>:waiting → <lane>:queue`, clears
  `**Waiting Reason**`, and the normal claim loop takes it from there.
  `done:waiting` with an open PR keeps the PR link as its affordance and is the
  one case where resume is not offered (the reconciler owns that transition).
- **REQ-8** — Replying on the conversation thread of a `<lane>:waiting` track
  that also has `waiting_for_reply: yes` resumes it through the existing answer
  path, without a separate manual resume.
- **REQ-9** — The board distinguishes *paused* from *no status yet*. Tracks with
  a missing/unknown `lane_action_status` no longer render inside the "Waiting"
  group. `waiting` gets a distinct, non-grey treatment on every lane, with the
  waiting reason in the card's tooltip and shown in full in the track detail
  panel. (D7, D8)
- **REQ-10** — A `<lane>:waiting` track appears in the Inbox's "Needs your
  input" bucket on the strength of its status alone, with no comment and no
  `waiting_for_reply` required. (D10)
- **REQ-11** — `classifyAutoCompleteOutcome` reports a `<lane>:waiting` outcome
  on any lane as a deliberate pause with its reason, distinct from the
  "did not advance — stopping rather than retrying" failure wording. (D9)
- **REQ-12** — `SKILL.md` documents the general protocol (how any lane action
  declares a pause, and that a reason is mandatory), and
  `conductor/workflow.md` documents `waiting` in the lane-status model.
  `resting-state.mjs`'s contract comment is generalized. (D11)
  > ⚠️ **Open item for human review (fundamentals-conflict guardrail).** REQ-12
  > requires editing `conductor/workflow.md` (the documented lane-status model)
  > and `conductor/product.md`. Those are project fundamentals, so the change is
  > called out here rather than made quietly inside an implementation phase —
  > confirm the lane-status model is meant to grow a first-class `waiting`
  > before Phase 6 lands. Non-blocking; the rest of the track does not depend
  > on the answer.

- **REQ-13** — Backwards compatible: existing `done:waiting` tracks keep
  working unchanged, including `reconcilePrTracks`' merged/conflicted
  transitions and `DonePrLink`. Tracks with no `**Waiting Reason**` marker are
  valid input everywhere.

### Explicitly out of scope (FFU — must not be claimed as delivered)

- **Age-based escalation of a long-parked track** (e.g. "waiting > 7 days →
  escalate to failure / notify"). Deliberately deferred: it needs a policy
  decision about who gets notified and how, which this track does not make.
  Phase 7 in `plan.md` carries it unchecked.
- **Adding `blocked` to the Postgres `LaneActionStatus` enum.**
  `constants.mjs:21` defines `BLOCKED: 'blocked'` but
  `prisma/schema.prisma:12-18` has no such value — a real inconsistency, but a
  separate one, untouched here.

## Acceptance Criteria

- [ ] An `implement` lane action that stops to ask a human a question leaves the
      track visibly paused on the Implement column — not marked ✅ Success, and
      not silently advanced to Review.
- [ ] The same is true for `plan`, `review` and `quality-gate`.
- [ ] The board shows *why* a paused track is paused: hovering the card surfaces
      the waiting reason, and the track detail panel shows it in full.
- [ ] A paused track on any lane has a working ▶ Resume control; clicking it
      puts the track back in the queue and a worker picks it up on the next
      cycle.
- [ ] Replying to the question on a paused track's conversation thread resumes
      it without touching the Resume button.
- [ ] A paused track appears under "Needs your input" in the Inbox, even when
      the pause posted no comment.
- [ ] A track with no `lane_action_status` at all no longer appears under the
      board's "Waiting" heading.
- [ ] A `done:waiting` track with an open PR behaves exactly as it does today:
      🔵 PR open group, working PR link, reconciler still flips it to
      `done:success` when the PR merges and back to `done:queue` when it
      conflicts.
- [ ] Editing a paused track's `index.md` no longer causes its collector sync to
      fail — title, progress and summary changes reach the DB while the track is
      parked (D4's 400 is gone).

## Data Model Changes

```sql
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS waiting_reason TEXT;
```

Nullable, no default, no backfill. `LaneActionStatus` already contains
`waiting` (`migrations/20260304181909_enable_rls.sql:2`) — no enum change.
Mirrored in `prisma/schema.prisma`'s `tracks` model and in the Atlas migration
directory per the project's normal migration workflow.

## API Contracts

- `POST /track` — accepts `lane_action_status: 'waiting'` for any
  `lane_status`; accepts and stores `waiting_reason`.
- `PATCH /track/:num/action` — same.
- `GET /api/projects/:id/tracks`, `GET /track/:num` — return `waiting_reason`.
- `POST /api/projects/:id/tracks/:num/resume` — sets
  `lane_action_status = 'queue'`, clears `waiting_reason`, marks
  `last_updated_by = 'human'`. 409 if the track is not currently `waiting`.
  Mirrored in `cloud/functions/index.js` (route parity is enforced by
  `conductor/services/collector-route-parity.mjs`).

## Marker Contract

```markdown
**Lane Status**: waiting
**Waiting Reason**: Needs approval to run the destructive 0042 migration on prod
```

Written by the lane action as its own last action, the same way
`**Lane Status**: waiting` is written by the pr-mode merge action today.
`**Waiting Reason**` follows the sparse-emission convention: present only while
the track is parked, cleared on resume.
