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

- [x] Task 1: Write a failing test — a track scaffolded by
      `trackTemplates()` contains `**Lane**` and no `**Status**`
      (`ui/server/tests/track-1102-f3-single-status-marker.test.mjs`, 5
      tests, watched all 5 fail for the right reason before the fix)
- [x] Task 2: Remove `**Status**` from both templates in `ui/server/utils.mjs`;
      emit `**Lane**: <laneStatus>` + `**Lane Status**: queue` instead,
      matching the sync worker's own `handleTrackCreate()` template
- [x] Task 3: Keep `parseStatus()`'s step-2 legacy `**Status**` branch, and
      annotate it as back-compat-only (unreachable for new tracks)
- [x] Task 4: Re-run `conductor/tests/track-10012-parse-status-precedence.test.mjs`
      unchanged — 4/4 still pass, drift-precedence guarantee survives
- [ ] Task 5: Verify live — create a track in the UI, grep the file, drag
      the card between lanes and confirm it does not revert (deferred to
      Phase 4's walkthrough pass — needs a running local-api stack + browser)

**Status**: code fixed and unit-tested; live verification (Task 5) deferred
to Phase 4.

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

- [x] Task 1: Activity panel — opened live, 3 real workers shown, busy vs
      idle correctly distinguished, clicked into the busy one (this
      session's own dispatch) and got a real streaming tool-call
      transcript with a working chat box. Per-worker stop not
      re-exercised this pass (already verified in a prior session, see
      "What worked") — no reason found to re-test it
- [x] Task 2: Inbox — opened live, 36 real items correctly split into
      NEEDS YOUR INPUT / AWAITING AI, varied real content including a
      system ⚠️ (the F9-family stale-docs guard firing correctly on a
      real track, caught incidentally)
- [x] Task 3: Deploy wizard — reached the Release tab for the
      `laneconductor` project, real controls and a real, populated
      Deployment Dispatch History. **Stopped before any actual deploy
      action**, per scope
- [x] Task 4: Recorded via screenshots (Activity, Inbox, deploy wizard) —
      see "What worked" section in index.md for the write-up
- [x] Task 5: No new findings surfaced this pass — everything walked
      rendered correctly against real data; nothing rose to F22+

**Impact**: The remaining two-thirds of the new-user path got the same
live-driven treatment the first third got — and, unlike the original
walkthrough, found nothing broken this time.

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

**Correction while implementing**: empirical reproduction (real worker,
real worktree, mock CLI that never touches `index.md`) showed current
code actually **advances the lane forward** with `Progress: 100%` on
exit 0 — not "reset to queue" as this phase's Problem statement assumed.
Same underlying defect (a run that never finished reported as a clean
pass), different specific symptom; fix targets what was actually found.

- [x] Task 1: Write a failing test — spawn a real worker with a mock CLI
      that exits 0 without moving `index.md` off `running`; assert the
      outcome is the new distinguishable state
      (`conductor/tests/track-1102-f21-exit-zero-mid-work.test.mjs`)
- [x] Task 2: Detect the state in the exit handler (exit 0, index still
      `running`) before the lane-advance/100%-progress writes — gated on
      `cli !== 'mock'` after a real regression
      (`track-1102-f11-progress-keepalive.test.mjs`, 2/2 → 1/2) showed
      every mock-cli-driven test looks like "ended mid-work" without the
      gate, since mock-cli never simulates a real agent's own
      self-transition write
- [x] Task 3: Report it — dispatch result (`ended_mid_work`) plus a
      `> **system**: ⚠️ …` comment in `conversation.md` saying the run
      ended mid-work and re-running resumes it
- [ ] Task 4: Confirm the recovery claim by actually re-running and watching
      the work continue, rather than asserting it (deferred — needs a real
      Claude agent run, not the mock-cli reproduction; live verification,
      not unit-testable)
- [ ] Task 5: Add SKILL guidance — a lane agent must not end its final turn
      on a just-launched background command; the harness kills background
      children when the session process exits (still open — this phase
      only made the aftermath visible/non-destructive, doesn't prevent it)

**Impact**: A mid-work exit becomes visible and actionable — lane no
longer silently advances forward as if the work were verified complete,
and the dispatch/comment record says explicitly what happened and how to
recover. Confirmed no regressions across the shared exit-handler code
path: F8, F9, F9b, F11, F12, F21-escalated, and the 1112
worktree-artifact-merge suite all re-run clean.

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

**Investigated, does not reproduce**: found a genuinely stuck `running`
track live on the real board (#001, "Walkthrough Test Project 1104",
stale 8715+ minutes) and ran the exact `document.elementFromPoint`
reproduction technique this finding used. At the browser's default
narrow viewport (925px, 6 columns squeezed to ~130px each) an overlap
DID appear — but between two *different sibling cards*, not a
transcript strip, and it vanished entirely at a realistic desktop width
(1600px): `arrowIsTarget: true`, click lands correctly. Also checked
`TrackDetailPanel`'s transcript drawer directly — its own collapse
button is correctly clickable too, no overlap.

- [x] Task 1: Reproduced (attempted) in a live browser against a real
      stuck card — see investigation note above; no current reproduction
      found at realistic viewport width
- [ ] Task 2: Fix the stacking/layout (not attempted — no confirmed bug
      to fix; see Task 1)
- [ ] Task 3: Distinguish a live run's transcript from a finished/killed
      one in the UI (not attempted — same reason)
- [x] Task 4: Verified by driving the real UI — clicks land correctly at
      realistic viewport width; not reproduced, so nothing to re-verify
      after a fix

**Impact**: No code change made. Documented what was actually found
(likely fixed as a side effect of F2's button-rendering rework, or the
original report was at an unusually narrow window) so this isn't
re-investigated from scratch if it resurfaces — see F20's "Left open"
note for what to capture if it does.

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

**Correction while implementing**: the regression test already existed —
`ui/src/components/TrackCard.test.jsx`'s `"TrackCard — F19 backlog arrow
must route through plan, not skip to implement"` describe block, added
alongside the code fix. Missed during planning because only `TrackCard.jsx`
was grepped, not its test file. No new test needed; verified it's real by
mutating `NEXT_LANE.backlog` back to `'implement'` and confirming the test
fails, then reverting.

- [x] Task 1: Add a test asserting a backlog card's next lane is `plan`
      (already existed — see correction above)
- [x] Task 2: Confirm it fails if `NEXT_LANE.backlog` is changed back
      (mutated live, confirmed failure, reverted)
- [x] Task 3: Write the fix note into F19's body in `index.md`
- [ ] Task 4: Decide and record whether moving to implement with no
      plan artifacts should additionally warn (deferred — separate UX
      decision, not required for this phase's regression-safety goal)

**Impact**: The fix is enforced by a test rather than by a comment.

---

## Phase 12: F18 follow-up — dispatch claim-timeout

**Problem**: Phantom-fixture exclusion stops a *fake* worker absorbing a
dispatch, but not a **real** worker that dies after being assigned one. Such
a dispatch stays `pending` forever with no error anywhere — the same silent
starvation, from a cause exclusion-by-signature cannot cover.

**Solution**: Bound how long a dispatch may sit unclaimed.

- [x] Task 1: Write a failing test — a dispatch assigned to a worker that
      never claims it is reassigned or failed within the window
      (`ui/server/tests/track-1102-f18b-dispatch-claim-timeout.test.mjs`).
      First draft's mock filtered candidates unconditionally in JS rather
      than inspecting the SQL text — mutation-testing caught it (stayed
      green even after the production query's exclusion clause was
      deliberately removed); rewritten to inspect SQL text like F18's own
      test, re-verified the mutation now fails it correctly
- [x] Task 2: Implement the timeout (`reapStaleDispatches()`,
      `ui/server/index.mjs`) — reassign to another live worker; mark
      failed with a reason when none exists
- [ ] Task 3: Make the outcome visible in the UI, not only in the DB
      (deferred — needs UI work, out of this phase's scope)
- [x] Task 4: Timeout is a distinct window from the poll cadence by
      construction — `LC_DISPATCH_CLAIM_TIMEOUT_MS` (default 5min) vs. a
      worker's own poll interval (seconds); a healthy worker slow to pick
      up a dispatch is not mistaken for a dead one at any realistic cadence

**Impact**: Closes the starvation path that survives F18's fix — a real
worker dying between assignment and claim no longer strands a dispatch
forever with no error anywhere.

---

## Phase 13: F10c — `worker_dispatch` FK should be SET NULL

**Problem**: `migrations/20260809090728_add_worker_dispatch.sql:12` still has
`ON DELETE CASCADE` on `worker_dispatch.worker_id`. F10's soft
de-registration stops the *routine* path from deleting a worker row, but any
manual deletion still erases every dispatch and all `worker_adhoc_chat`
history with it — exactly the loss F10 documented as unrecoverable.

**Solution**: Belt-and-braces — make the history survive a row deletion.

**Reopened during replan (2026-08-20)**: previously reported as "done
except an apply step awaiting confirmation". Verifying that during this
replan showed the migration **cannot be applied as committed at all** —
see F22. Tasks 1–3 are genuinely done; Task 4 is blocked on Phase 16, not
on permission alone, and the phase does not count as complete until the
live DB's FK actually changes.

- [x] Task 1: Write a failing test — deleting a worker row keeps its
      dispatch rows with `worker_id IS NULL`
      (`ui/server/tests/track-1102-f10c-dispatch-fk-set-null.test.mjs`,
      2 tests; watched both fail against the pre-fix CASCADE schema,
      pass after — against the scratch `laneconductor_dev` DB)
- [x] Task 2: Add an Atlas migration changing CASCADE → SET NULL (column
      made nullable first) — hand-written rather than atlas-generated,
      since `atlas migrate diff` bundled in unrelated pre-existing drift
- [x] Task 3: Audit every read of `worker_dispatch.worker_id` for a null
      it did not previously have to handle
- [ ] Task 4: Apply the migration and verify against the **real** DB —
      **blocked on Phase 16** (branch currency + re-timestamp). Verified
      during replan that the live FK is still `ON DELETE CASCADE`, i.e.
      this phase's actual goal is not yet achieved
- [ ] Task 5: Re-run the F10c test suite pointed at the live DB's real
      schema (not the scratch reconstruction) as the honest AC-8 check

**Impact**: Worker history stops being destroyable by a single row
deletion — *once Task 4 lands*. Today the code is written and proven on a
scratch DB while production still cascades.

---

## Phase 14: F13 deeper cause — file as its own track

**Problem**: A manager worker has no credential storage of its own and
authenticates using whatever co-located project's `machine_token` is in the
cwd's `.laneconductor.json`. F13's fix addressed only the most damaging
symptom (pid flapping); the deeper cause is explicitly deferred.

**Solution**: File it properly — do not fix it here.

- [x] Task 1: Create the track ([1118](../1118-manager-worker-credential-storage/index.md)
      — manager persists its own `machine_token` in
      `~/.laneconductor/manager-config.json`, alongside `projectsDir`)
- [x] Task 2: Carry over F13's traced evidence so it is not re-derived
- [x] Task 3: Link it from F13's body and this track's Depends-on (added a
      new "Spawned tracks" section since Depends-on is for the other
      direction)

**Impact**: The remaining risk is owned by a track instead of a paragraph.

---

## Phase 15: F15 — live E2E verification of the dispatch bridge

**Problem**: F15's fix is unit-tested against the same code path F5's tests
trust, but was never proven live the way F5 was. Every finding in this track
that was "confirmed by unit test alone" is exactly the class of thing this
whole track exists to distrust.

**Solution**: Prove it end to end — split during replan into a part that
needs nobody's permission and a much narrower part that does.

**Replan correction**: the previous framing ("blocked, needs a go-ahead
to touch the live board") over-scoped the blocker. What F15's fix
actually claims is that `PATCH /track/:num/lane` and `/track/:num/reset`
insert a `worker_dispatch` row that a sync-only worker then claims and
runs. That whole chain — real Express app, real worker process, real
dispatch claim, real lane action — is exactly what this repo's existing
mock-collector + spawned-worker harness already exercises for F8/F9/F12/
F21, entirely inside a temp dir. It is *not* "one level weaker than F5";
it is a genuine E2E of the mechanism. Only the browser drag **gesture**
needs the real board, and that is a much smaller claim to leave open.

### 15a — E2E through the real dispatch chain (unblocked)
- [ ] Task 1: New test on the established harness pattern: temp project,
      sync-only worker, real `PATCH /track/:num/lane` → assert a
      `worker_dispatch` row is created, claimed, and the lane action runs
- [ ] Task 2: Same for the `/track/:num/reset` path
- [ ] Task 3: Negative case — a project with a sync+poll worker must NOT
      get a dispatch (the bridge's own precondition)
- [ ] Task 4: Watch each fail for the right reason before wiring it up

### 15b — the browser drag gesture (still needs consent)
- [ ] Task 5: Drag a card on the real board and observe the row appear
      — needs either an explicit go-ahead, or a disposable scratch
      project. Deliberately left as its own small item so 15a isn't held
      hostage to it
- [ ] Task 6: Record the observation in F15's body

**Impact**: The mechanism gets real E2E coverage now; only the gesture
remains gated. Splitting also stops "needs permission" from being an
excuse that quietly covers work that never needed permission.

---

## Phase 16: F22 — make the F10c migration actually applicable

**Problem**: See F22. The migration authored in Phase 13 sits at version
`20260820101300`, but this branch is **196 commits behind main**, and the
live DB has already recorded `20260821120000` and `20260823100000` — both
sorting above it, and neither present in this worktree. Atlas assumes
linear history and rejects out-of-order migrations by default;
`atlas.sum` was regenerated against the stale file set and will conflict
on merge. The live FK is still `ON DELETE CASCADE`, so Phase 13's fix
currently does nothing in production.

**Solution**: Bring the branch current, re-timestamp above the
high-water mark, regenerate the checksum on the merged tree, then apply.

- [ ] Task 1: Merge (or rebase onto) `main` — 196 commits; expect real
      conflicts in `migrations/atlas.sum` and possibly the F18b/F21 files,
      since main has moved under all of them
- [ ] Task 2: Re-run this track's full test set after the merge, before
      touching anything else — a 196-commit merge is itself a regression
      risk to everything already landed here
- [ ] Task 3: Re-timestamp the migration above the live high-water mark
      (currently `20260823100000`), delete the old file, regenerate
      `atlas.sum` with `atlas migrate hash`
- [ ] Task 4: Dry-run against the scratch `laneconductor_dev` DB first —
      confirm Atlas accepts the ordering and applies cleanly there
- [ ] Task 5: Only then apply to the live DB (Phase 13 Task 4), with
      explicit confirmation, and verify the FK actually changed
- [ ] Task 6: Decide/record which migration mechanism is canonical
      (`migrations/` + Atlas vs `ui/server/migrations/` + startup
      `runMigration()`) — having both undocumented is what made the first
      read of this land on the wrong answer

**Impact**: Turns a schema fix that silently does nothing into one that
actually ships — and documents the trap for the next track that writes a
migration from a long-lived worktree.

---

## Notes

- **Verified closed while planning**, contradicting an earlier write-up:
  F8's "clear the busy heartbeat" follow-up. `spawnCli()` does call
  `updateWorkerHeartbeat('busy', …)` (`laneconductor.sync.mjs:3984`), so
  lane actions do show as busy. No phase needed.
- New findings from Phase 4 get appended to `index.md` as F22+ and, if they
  need work, their own phase here — they do not expand an existing phase.
