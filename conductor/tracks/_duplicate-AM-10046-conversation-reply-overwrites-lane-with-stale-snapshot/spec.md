# Spec: local-fs-answer Overwrites Lane With a Stale Snapshot Under Concurrent Dispatch

## Problem Statement

A conversation-reply run (`label = 'local-fs-answer'`) carries the track's `**Lane**` value as it
was **at that run's dispatch time** and force-writes it back on completion. When a separate,
concurrent dispatch legitimately transitions the lane in between, the reply run silently
overwrites that transition with its stale snapshot. Observed live 2026-08-31 on track AM-10045:
`**Lane**` flapped `implement → plan → implement → implement → plan → implement` over ~90
seconds, with no signal anywhere that anything was wrong.

This is a race on the value of `**Lane**` itself — a genuinely wrong value reaches disk. It is a
different defect from [[AM-10044-running-state-stuck-in-queue-display]], which is about
`lane_action_status` display staleness between disk and DB.

### Confirmed mechanism — three separate writers of the same stale snapshot

The snapshot is `lane_status`, read from `index.md` at the top of `autoLaunchLocalFs`'s scan
(`laneconductor.sync.mjs:5942`) and threaded to `spawnCli(..., laneStatus, ...)` as the 8th
argument, where it becomes the exit handler's `laneStatus`. Three code paths write it back:

**W1 — the reply prompt tells the agent to write it** (`laneconductor.sync.mjs:6145-6148`):
```js
customPrompt = `The user has sent a message in the track conversation. ...
You MUST use /laneconductor pulse ${track_number} ${lane_status} ${parseProgress(content)} "Answered user question" when done.`;
```
`${lane_status}` is interpolated from the dispatch-time snapshot. The agent is *instructed* to
pulse a lane that may be minutes stale by the time it runs.

**W2 — `cmd_type` makes the agent claim the stale lane** (`laneconductor.sync.mjs:6125-6132`):
```js
label = 'local-fs-answer';
if (CLAIMABLE_LANES.includes(lane_status)) { cmd_type = lane_status; } else { cmd_type = 'implement'; }
```
`cmd_type` becomes the skill command (`/laneconductor plan|implement|review|quality-gate|merge`).
**Step 0 of every one of those commands** instructs the agent to "claim the track immediately —
write `**Lane**: <that lane>` and `**Lane Status**: running`". So a conversation reply
unconditionally re-claims the dispatch-time lane as its very first act.

**W3 — the exit handler writes it back** (`laneconductor.sync.mjs:5261-5366`):
```js
const isConversationRun = label === 'local-fs-answer';
const transitionValue = (isConversationRun || ...) ? null : ...;
let { lane: targetLane, status: nextActionStatus } = resolveTransition(transitionValue, laneStatus, ...);
```
`resolveTransition(null, laneStatus, ...)` returns `{ lane: laneStatus, status: 'success' }` — the
stale snapshot, verbatim. That flows into `effectiveLane` and `applyGuardedLaneWrite`.

### Why the existing lane-regression guard does not cover this

`applyGuardedLaneWrite` (track 10040 REQ-12) re-reads the on-disk lane and blocks a write only
when **both** `intendedRank < onDiskRank` **and** `!producedByThisRun`. It therefore covers
exactly one of the four ways this race lands:

| Snapshot | On disk at completion | Guard outcome | Result |
|----------|----------------------|---------------|--------|
| `plan` | `implement` | **blocked** (rank 1 < 2, not produced by this run) | correct, already fixed |
| `implement` | `plan` (e.g. quality-gate's `on_failure`) | **not blocked** (rank 2 > 1) | ❌ stale `implement` clobbers a real `plan` |
| `plan` | `plan` (concurrent run mid-flight, status `running`) | **not blocked** (same lane short-circuit, line 61) | ❌ `Lane Status` forced `running → success` under a live run |
| any | any | W1/W2 write **before** the exit handler | ❌ guard never consulted — the agent writes the marker directly |

The guard is a backwards-only containment primitive. It was never intended to make a
conversation reply a safe lane writer, and it does not.

### Finding 2 — `waiting_for_reply` is conflated with "this lane action needs a retry"

`**Waiting for reply**: yes` is documented (SKILL.md marker table) as "a human comment needs an
answer". W2 above also makes it mean "re-run this track's actual lane action". For a track in a
claimable lane (now including `done`), `cmd_type = lane_status` → `/laneconductor merge` runs
under the `local-fs-answer` label with no human involved.

Confirmed live on track AM-10040: a stray `**Waiting for reply**: yes` (leaked from an unrelated
test-fixture dispatch — tracks 10044/10045's root cause) survived long after the track shipped
(`done:success`, PR merged). Every poll cycle re-triggered a merge retry, which collided with the
main-mode lock, got blocked, and reverted `**Lane Status**` to `queue` as a side effect. The
board read as "the track keeps becoming unmerged."

The damage path is concrete: `spawnCli`'s 8th arg `laneStatus` feeds `resolveWorkspaceMode()`
(`laneconductor.sync.mjs:4554`), so a reply run dispatched with `laneStatus = 'done'` resolves to
`workspace: main` and takes the **global main-mode git lock** — the same lock real lane actions
contend for. A conversation reply, which only ever appends to `conversation.md`, has no business
holding it.

`handlePreSpawnBlock` (track 10040 Phase 1) *does* fire correctly here and logs it — but under
the `local-fs-answer` label, so its own diagnostics read as a failed conversation reply rather
than a blocked merge retry.

**Partial fix already landed** (commit `ab25d5f`, `fix(track-10046): verify a genuine unanswered
human comment...`): `hasGenuineUnansweredHumanComment()` (`laneconductor.sync.mjs:1634`) now
clears a stale flag before the answer branch is entered (`:6118-6123`). That closes the *stray
flag* half of Finding 2 only. The structural conflation — `cmd_type = lane_status`, a real lane
action running under a conversation label — is untouched and is in scope here.

## Requirements

- **REQ-1** — A conversation-reply run MUST NOT write `**Lane**` under any circumstance. It is
  not a lane transition and has no legitimate opinion about which lane the track is in.
- **REQ-2** — A conversation-reply run MUST NOT write `**Lane Status**` either, in any of its
  three writers (pre-spawn `running` write at `:6225-6226`, the agent's own step-0 claim, and the
  exit handler). `**Lane Status**` belongs to the lane-action state machine; a reply borrowing it
  as a liveness marker is what makes two independent dispatches contend for one field.
- **REQ-3** — A conversation-reply run's own liveness/in-flight state MUST be tracked by a
  mechanism that is not the lane state machine. The per-track run marker
  (`conductor/.runs/<track>.json`, track 10020 — `runMarkerPath`/`isRunMarkerLive`, already
  written at `:5023` and removed at `:5055`) is the intended mechanism.
- **REQ-4** — A conversation-reply run MUST NOT be dispatched for a track that already has a live
  run marker. Two agent sessions on one track is the precondition for every symptom in this
  spec; serializing on the existing marker removes it at the source.
- **REQ-5** — The exit handler MUST NOT derive any written value from `laneStatus` (the
  dispatch-time snapshot) for a conversation run. Where the completion patch needs a lane or
  status, it must come from a fresh read of `index.md` at completion time, or be omitted from the
  patch entirely.
- **REQ-6** — `cmd_type` MUST NOT be set to the current `lane_status` inside the `waitingForReply`
  branch. A conversation reply dispatches a non-lane command; a genuine lane-action retry goes
  through the normal claim/dispatch path, which already labels itself correctly
  (`local-fs-implement`, `local-fs-done`, …).
- **REQ-7** — A conversation-reply run MUST resolve to a workspace mode that reflects what it
  actually does (append to `conversation.md` in the primary checkout) and MUST NOT contend for
  the global main-mode git lock as a side effect of a lane it merely observed.
- **REQ-8** — A track waiting to retry a blocked lane action MUST be distinguishable, in
  `conversation.md` / the Inbox / the Kanban card, from a track waiting on a human's reply. The
  documented meanings are "💬 needs your reply" vs. something like "⏳ waiting to retry <lane> —
  blocked by <reason>".
- **REQ-9** — The lane-regression guard's forward direction MUST be closed for any writer that
  does not hold a fresh read: a write of lane X over on-disk lane Y where `X !== Y` and this run
  did not itself execute in Y is not legitimate regardless of rank direction.
- **REQ-10** — Every other dispatch path that captures a lane/status snapshot at claim time and
  writes it back at completion must be audited and either shown safe (re-reads fresh) or fixed.
  `startNextAutoCompleteStage`/`checkAutoCompleteProgress` already re-read fresh (`afterLane` at
  `:6381`) — that is the shape the rest must match.

## Acceptance Criteria

- [ ] AC-1: With a reply run in flight holding a `plan` snapshot, a concurrent lane action moving
      the track to `implement` survives the reply run's completion — `**Lane**` reads `implement`
      afterwards, and the reply's own comment is still posted.
- [ ] AC-2: The reverse direction survives too: a reply run holding an `implement` snapshot does
      not clobber an on-disk `plan` written by a quality-gate failure while it was in flight.
- [ ] AC-3: A reply run completing while a concurrent lane action holds `**Lane Status**:
      running` in the *same* lane leaves that `running` intact — it is not flipped to `success`.
- [ ] AC-4: A `**Waiting for reply**: yes` track sitting in `done` never spawns
      `/laneconductor merge` under the `local-fs-answer` label; a human reading
      `conversation.md` and the worker log can tell a merge retry from a conversation reply.
- [ ] AC-5: A conversation reply never acquires the global main-mode git lock, and is therefore
      never reported as blocked by main-mode lock contention.
- [ ] AC-6: A conversation reply is not dispatched while that track already has a live run
      marker; the worker logs why it deferred, and it is dispatched on a later cycle once the
      marker clears.
- [ ] AC-7: A track blocked waiting to retry a lane action surfaces a distinct, human-readable
      signal that does not read as "needs your reply".
- [ ] AC-8: `**Waiting for reply**` still transitions `yes → no` exactly once per answered reply,
      so the worker does not re-fire the same reply on the next poll cycle.

## Out of Scope

- `lane_action_status` disk↔DB display staleness — that is [[AM-10044-running-state-stuck-in-queue-display]].
- Rewriting the brainstorm dispatch protocol (`cmd_type = 'brainstorm'` already avoids the lane
  commands and is therefore not a W2 writer); it inherits REQ-1..REQ-5 unchanged.
- The `conductor/.runs/` run-marker design itself — this track consumes it, does not redesign it.

## API Contracts / Data Models

No schema changes. Filesystem contract changes only:

| Marker / file | Before | After |
|---|---|---|
| `**Lane**` | written by reply runs (W1, W2, W3) | never written by a reply run |
| `**Lane Status**` | written `running` pre-spawn, `success` at exit, by reply runs | never written by a reply run |
| `**Waiting for reply**` | written by reply runs | unchanged — still the reply run's one owned marker |
| `conductor/.runs/<track>.json` | liveness for lane actions only | also the reply run's in-flight guard (REQ-3, REQ-4) |
