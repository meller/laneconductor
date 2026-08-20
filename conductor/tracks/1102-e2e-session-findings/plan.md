# Track 1102: E2E session findings — new project → track → plan flow

Umbrella bug track. Phases 1–6 already exist in `index.md` and their numbers
are **stable** — done phases are never renumbered, because the finding
write-ups reference them. New work is appended as Phases 7+, ordered by
severity, then by verification/cleanup.

Full evidence per finding lives in `index.md`. This file carries only the
work.

---

## Phase 1: F1 — worker mode for a newly created project ✅

**Problem**: A new project's worker was thought to be misconfigured as
`sync-only`.
**Solution**: Investigated — `sync-only` is the *intended* default ("sync +
manual UI operations"); the real bug was F5. Decision encoded in a test that
asserts `mode === 'sync-only'` deliberately, so changing the default later
is a conscious act.

- [x] Task 1: Trace `runCreateProject`'s worker spawn
- [x] Task 2: Confirm sync-only still serves dispatches (`checkDispatchInbox`)
- [x] Task 3: Lock the decision in with an asserting test
- [x] Task 4: Re-file the real symptom as F5

**Impact**: Closed as not-a-bug, with the misdiagnosis documented so it is
not rediscovered.

---

## Phase 2: F2 — accurate lane-action button state/tooltip ✅

- [x] Task 1: Add `nextBtnDisabledReason` distinguishing queue / running / failure
- [x] Task 2: TDD in `ui/src/components/TrackCard.test.jsx` (5 tests)

**Impact**: The disabled arrow says what is actually true and what to do.

---

## Phase 3: F3 — one status marker, not two

**Problem**: `ui/server/utils.mjs:35,41` bakes a legacy `**Status**: <lane>`
line into every UI-created `index.md`, alongside the authoritative
`**Lane**`. Nothing updates `**Status**` after creation, so the two diverge.
`conductor/services/parse-status.mjs` exists *only* to make `**Lane**` win —
a workaround for a marker that should not be written at all. Confirmed still
present at plan time.

**Solution**: Stop emitting `**Status**` for new tracks; keep the parser's
legacy fallback for tracks already on disk.

- [ ] Task 1: Write a failing test — a track scaffolded by
      `trackTemplates()` contains `**Lane**` and no `**Status**`
- [ ] Task 2: Remove `**Status**` from both templates in `ui/server/utils.mjs`;
      ensure `**Lane**` + `**Lane Status**` are what the template emits
- [ ] Task 3: Keep `parseStatus()`'s step-2 legacy `**Status**` branch, and
      annotate it as back-compat-only (unreachable for new tracks)
- [ ] Task 4: Re-run `conductor/tests/track-10012-parse-status-precedence.test.mjs`
      unchanged — the drift-precedence guarantee must survive
- [ ] Task 5: Verify live — create a track in the UI, grep the file, drag
      the card between lanes and confirm it does not revert

**Impact**: New tracks carry one marker; the 10012 revert bug loses its
underlying cause instead of only its symptom.

---

## Phase 4: Continue the walkthrough — Activity, Inbox, deploy wizard

**Problem**: The original walkthrough stopped after the plan run. Activity,
Inbox and the deploy wizard were never walked as a user, so anything broken
there is still undiscovered.

**Solution**: Walk them, on a real project, recording observations. Fix what
is trivial and local; file anything larger as a new finding (F22+) in
`index.md` rather than expanding this phase.

- [ ] Task 1: Activity panel — worker states, chat round-trip, per-worker stop
- [ ] Task 2: Inbox — classification of ✅ / ⚠️ / ❌ completion comments,
      "needs your input" vs "recent activity" buckets
- [ ] Task 3: Deploy wizard — walk it end to end, **stop before an actual
      deploy**
- [ ] Task 4: Record each observation (screenshot or real API/DB response)
- [ ] Task 5: File new findings as F22+ with the same evidence standard

**Impact**: The remaining two-thirds of the new-user path get the same
treatment the first third got.

---

## Phase 5: F15 — extend the sync-only dispatch bridge ✅

- [x] Task 1: Extract `dispatchIfSyncOnly()` from `/implement`
- [x] Task 2: Call it from `/track/:num/lane` and `/track/:num/reset`
- [x] Task 3: 5 tests in `ui/server/tests/track-1102-f15-lane-reset-dispatch.test.mjs`

**Impact**: Drag-to-lane and reset now reach sync-only projects. Live
verification is Phase 15.

---

## Phase 6: F16 — worker identity lock path ✅

- [x] Task 1: Resolve the lock path via `resolvePrimaryRepoRoot()`
- [x] Task 2: Live-verify — killed 4 real duplicates, confirmed one survivor

**Impact**: One identity, one lock, regardless of the worker's cwd.

---

## Phase 7: F21 (original variant) — a run that ends mid-work says nothing

**Problem**: An agent that backgrounds a long command at turn end exits 0
while its `index.md` still reads `Lane Status: running`. The exit handler
(`laneconductor.sync.mjs`, around `resolveTransition()` at line 4161) can
call it neither success nor failure, so it resets `lane_action_status` to
`queue`. All work sits uncommitted in the worktree and nothing tells anyone
a re-run is needed. The escalated variant of F21 is already fixed; this one
is a different mechanism and is still open.

**Solution**: Make "exit 0 + index still `running`" its own recognised
outcome, and steer agents away from producing it.

- [ ] Task 1: Write a failing test — spawn a real worker with a mock CLI
      that exits 0 without moving `index.md` off `running`; assert the
      outcome is the new distinguishable state, not a bare `queue`
- [ ] Task 2: Detect the state in the exit handler (exit 0, index still
      `running`, worktree dirty) before the generic reset
- [ ] Task 3: Report it — dispatch result plus a `> **system**: ⚠️ …` comment
      in `conversation.md` saying the run ended mid-work and re-running
      resumes it (the worktree and session both persist)
- [ ] Task 4: Confirm the recovery claim by actually re-running and watching
      the work continue, rather than asserting it
- [ ] Task 5: Add SKILL guidance — a lane agent must not end its final turn
      on a just-launched background command; the harness kills background
      children when the session process exits

**Impact**: A mid-work exit becomes visible and actionable instead of a
silent re-queue.

---

## Phase 8: F9b — `workDir` TDZ ReferenceError swallows `last_run.log` staging

**Problem**: `laneconductor.sync.mjs:4269` runs
`execSync('git add …', { cwd: workDir })` inside the `if (lastRunLog)`
block, but `const workDir` is declared at 4274 inside the *sibling*
`if (updated)` block. Every run with log output throws a TDZ
`ReferenceError`, caught by that call's own empty `catch (e) {}`. The log
file is written to disk but never staged. Confirmed still present.

**Solution**: Hoist the declaration; stop the empty catch from hiding a
programming error.

- [ ] Task 1: Write a failing test asserting the log file ends up staged
      after a run that produced output
- [ ] Task 2: Hoist `const workDir = worktreePath || process.cwd()` above
      both blocks and remove the duplicate declaration
- [ ] Task 3: Make the catch log at warn level instead of swallowing
      silently — a `ReferenceError` here must never be invisible again
- [ ] Task 4: Audit the immediate neighbourhood for the same empty-catch
      pattern and report (do not mass-refactor)

**Impact**: `last_run.log` reaches git, and the class of bug that hid this
one for months stops being silent.

---

## Phase 9: F20 — transcript overlays card buttons and swallows clicks

**Problem**: A dead run's transcript stayed rendered and sat on top of a
track card's "Run plan action" button — confirmed live with
`document.elementFromPoint`. Two real clicks hit the transcript div and did
nothing: no POST, no error, no feedback. Collapsing the transcript freed the
button. The transcript drawer is rendered at
`ui/src/components/TrackDetailPanel.jsx:640-660` (and
`WorkerActivityLatch.jsx:257`), docked as a fixed-position drawer.

**Solution**: Fix the layering, and stop presenting a finished run's
transcript as live.

- [ ] Task 1: Reproduce in a browser test — assert the action button is the
      element at its own coordinates while a transcript is open
- [ ] Task 2: Fix the stacking/layout so the drawer never covers card
      controls (z-index and/or layout, not `pointer-events` papering)
- [ ] Task 3: Distinguish a live run's transcript from a finished/killed
      one in the UI
- [ ] Task 4: Verify by driving the real UI and confirming the click
      performs the action

**Impact**: Removes the third distinct cause of "clicking does nothing" seen
in this session.

---

## Phase 10: F6 — MANUAL / AUTOMATIC vocabulary in the CLI

**Problem**: `sync-only` / `sync+poll` name the mechanism, not the choice,
and "sync-only" reads as "does nothing but sync" — the exact wrong inference
that produced F1's misdiagnosis. The UI already renders `MANUAL` /
`AUTOMATIC` (`WorkersList.jsx:375,597`); the CLI does not —
`bin/lc.mjs:640` still reads "default is sync-only".

**Solution**: Align the CLI's user-facing wording with the UI's. Wire values
unchanged, so nothing migrates.

- [ ] Task 1: Update `lc worker start` help text to lead with MANUAL /
      AUTOMATIC, naming the flag as the mechanism
- [ ] Task 2: Update `lc worker status` / `lc status` output to show the
      same two words
- [ ] Task 3: Confirm `worker.mode` values and `--sync-and-work` still work
      exactly as before (no config migration)
- [ ] Task 4: Check `workers.type` (`project` | `manager`) is not conflated
      with mode anywhere in the output

**Impact**: One vocabulary across UI and CLI for a distinction that has
already misled once.

---

## Phase 11: F19 — lock in and document the backlog → plan fix

**Problem**: `NEXT_LANE.backlog` is `'plan'` in `TrackCard.jsx:21` (verified
at plan time, with an explanatory comment), but no test asserts it and the
finding's body in `index.md` still reads as open while its heading claims
FIXED. A future edit could silently restore the one-click
backlog→implement path that dispatched an implement agent against a track
with no plan artifacts.

**Solution**: Add the missing regression test and correct the write-up.

- [ ] Task 1: Add a test asserting a backlog card's next lane is `plan`
- [ ] Task 2: Confirm it fails if `NEXT_LANE.backlog` is changed back
- [ ] Task 3: Write the fix note into F19's body in `index.md`
- [ ] Task 4: Decide and record whether moving to implement with no
      plan artifacts should additionally warn

**Impact**: The fix is enforced by a test rather than by a comment.

---

## Phase 12: F18 follow-up — dispatch claim-timeout

**Problem**: Phantom-fixture exclusion stops a *fake* worker absorbing a
dispatch, but not a **real** worker that dies after being assigned one. Such
a dispatch stays `pending` forever with no error anywhere — the same silent
starvation, from a cause exclusion-by-signature cannot cover.

**Solution**: Bound how long a dispatch may sit unclaimed.

- [ ] Task 1: Write a failing test — a dispatch assigned to a worker that
      never claims it is reassigned or failed within the window
- [ ] Task 2: Implement the timeout (reassign to another live worker;
      mark failed with a reason when none exists)
- [ ] Task 3: Make the outcome visible in the UI, not only in the DB
- [ ] Task 4: Confirm it cannot reassign a dispatch a healthy worker is
      merely slow to pick up — check the window against real poll cadences

**Impact**: Closes the starvation path that survives F18's fix.

---

## Phase 13: F10c — `worker_dispatch` FK should be SET NULL

**Problem**: `migrations/20260809090728_add_worker_dispatch.sql:12` still has
`ON DELETE CASCADE` on `worker_dispatch.worker_id`. F10's soft
de-registration stops the *routine* path from deleting a worker row, but any
manual deletion still erases every dispatch and all `worker_adhoc_chat`
history with it — exactly the loss F10 documented as unrecoverable.

**Solution**: Belt-and-braces — make the history survive a row deletion.

- [ ] Task 1: Write a failing test — deleting a worker row keeps its
      dispatch rows with `worker_id IS NULL`
- [ ] Task 2: Add an Atlas migration changing CASCADE → SET NULL (column
      must be nullable)
- [ ] Task 3: Audit every read of `worker_dispatch.worker_id` for a null it
      did not previously have to handle
- [ ] Task 4: Apply the migration and verify against the real DB

**Impact**: Worker history stops being destroyable by a single row deletion.

---

## Phase 14: F13 deeper cause — file as its own track

**Problem**: A manager worker has no credential storage of its own and
authenticates using whatever co-located project's `machine_token` is in the
cwd's `.laneconductor.json`. F13's fix addressed only the most damaging
symptom (pid flapping); the deeper cause is explicitly deferred.

**Solution**: File it properly — do not fix it here.

- [ ] Task 1: Create the track (manager persists its own `machine_token` in
      `~/.laneconductor/manager-config.json`, alongside `projectsDir`)
- [ ] Task 2: Carry over F13's traced evidence so it is not re-derived
- [ ] Task 3: Link it from F13's body and this track's Depends-on

**Impact**: The remaining risk is owned by a track instead of a paragraph.

---

## Phase 15: F15 — live E2E verification of the dispatch bridge

**Problem**: F15's fix is unit-tested against the same code path F5's tests
trust, but was never proven live the way F5 was. Every finding in this track
that was "confirmed by unit test alone" is exactly the class of thing this
whole track exists to distrust.

**Solution**: Prove it on a real sync-only project.

- [ ] Task 1: Real sync-only project, real card, real drag to a new lane
- [ ] Task 2: Observe the `worker_dispatch` row appear and get claimed
- [ ] Task 3: Repeat for the `/reset` path
- [ ] Task 4: Record the observation in F15's body

**Impact**: The bridge is verified the way F5 was, not one level weaker.

---

## Notes

- **Verified closed while planning**, contradicting an earlier write-up:
  F8's "clear the busy heartbeat" follow-up. `spawnCli()` does call
  `updateWorkerHeartbeat('busy', …)` (`laneconductor.sync.mjs:3984`), so
  lane actions do show as busy. No phase needed.
- New findings from Phase 4 get appended to `index.md` as F22+ and, if they
  need work, their own phase here — they do not expand an existing phase.
