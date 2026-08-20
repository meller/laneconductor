# Spec: Track 1102 — E2E session findings (new project → track → plan flow)

## Problem Statement

Walking the real new-user path in the UI (create project → create track →
plan → activity/inbox → deploy wizard) surfaced 21 findings (F1–F21) in
flows that all had passing unit tests and were already marked done. The
full evidence for each finding lives in `index.md` — this spec does **not**
restate it. This spec covers only **what is still open**, so the remaining
work is unambiguous and the track can eventually be closed honestly.

## Finding status at plan time (2026-08-20)

Re-verified against the code in this worktree, not taken from the write-ups:

| # | State | Evidence checked now |
|---|-------|----------------------|
| F1 | Closed — not a bug | `sync-only` is the deliberate default; decision encoded in a test |
| F2 | Fixed | `nextBtnDisabledReason` in `TrackCard.jsx` + 5 tests |
| **F3** | **OPEN** | `ui/server/utils.mjs:35,41` still bakes `**Status**:` into every new `index.md`; `conductor/services/parse-status.mjs` exists purely to work around the resulting drift |
| F4 | Out of scope | Filed as track 1101 |
| F5 | Fixed | `dispatchIfSyncOnly()` bridge, proven live |
| **F6** | **PARTIAL** | UI already shows `MANUAL`/`AUTOMATIC` (`WorkersList.jsx:375,597`); `bin/lc.mjs:640` help still says "default is sync-only" |
| F7 | Fixed | `runCreateProject()` git-inits + commits |
| F8 | Fixed | try/catch + failure PATCH in the lane-action dispatch branch. Its "no busy heartbeat" follow-up is **also closed** — `spawnCli()` does call `updateWorkerHeartbeat('busy', …)` (`laneconductor.sync.mjs:3984`) |
| F9 | Fixed (guard + producer) | Exit handler reads/writes the same location. **Sub-bug still OPEN** — see F9b below |
| F10 | Fixed (soft de-register) | Leftovers (b) duplicate identity and (c) FK CASCADE still open; (b) largely absorbed by F16 + track 1110 |
| F11 | Fixed | Log-growth keepalive replaces the fixed kill timer |
| F12 | Fixed | `reconcileActiveDispatch()` re-pushes and only clears on success |
| F13 | Symptom fixed | Deeper cause (manager has no credential storage of its own) explicitly deferred to its own track |
| F14 | Fixed (UX) | Logs-tab empty state explains the Transcript tab |
| F15 | Fixed, unit-tested | Live E2E verification still open |
| **F16** | Fixed | Lock path resolves the primary checkout |
| F17 | Fixed, live-verified | `workerRoot = resolvePrimaryRepoRoot(...)` in every `lc worker` command |
| F18 | Fixed | Phantom-fixture exclusion at 3 call sites. Claim-timeout direction still open |
| **F19** | Code fixed, **undocumented + untested** | `NEXT_LANE.backlog === 'plan'` confirmed at `TrackCard.jsx:21`, but the finding body carries no fix note and no regression test asserts it |
| **F20** | **OPEN** | Not fixed; transcript drawer at `TrackDetailPanel.jsx:640-660` |
| **F21** | **PARTIAL** | Escalated (mid-run clobber) variant fixed; original turn-end variant open |

## Requirements

- **REQ-1 (F3)** — A newly scaffolded track carries exactly **one**
  lane-state marker. `ui/server/utils.mjs`'s templates must stop emitting
  the legacy `**Status**:` line. `parseStatus()`'s legacy `**Status**`
  fallback stays (old tracks on disk still have it) but must never be
  reachable for a newly created track.
- **REQ-2 (F9b)** — `laneconductor.sync.mjs:4269` calls
  `execSync(…, { cwd: workDir })` inside the `if (lastRunLog)` block, but
  `const workDir` is declared at 4274 in the *sibling* `if (updated)`
  block. Every run with log output throws a TDZ `ReferenceError`, swallowed
  by that call's own empty `catch (e) {}`, so `last_run.log` is never
  staged. Must be fixed, and the empty catch must not silently hide a
  programming error again.
- **REQ-3 (F21, original variant)** — A lane action that exits 0 while its
  `index.md` still reads `Lane Status: running` (agent backgrounded a
  command and let its turn end) must produce a **distinguishable** outcome
  — not the generic reset to `queue` with no signal. The user must be able
  to tell "ended mid-work, re-run to resume" from "queued, never started".
  Work is already recoverable (worktree persists, `--resume` continues the
  session); only the signal is missing.
- **REQ-4 (F20)** — A run's transcript must never sit on top of, and
  swallow clicks meant for, a track card's action buttons. A finished or
  killed run's transcript must not render as if it were live.
- **REQ-5 (F6)** — The CLI's user-facing vocabulary must match the UI's:
  `MANUAL` / `AUTOMATIC`, not `sync-only` / `sync+poll`. On-the-wire values
  (`worker.mode`, `--sync-and-work`) stay unchanged — this is a naming and
  help-text change only, so no config migration is needed.
- **REQ-6 (F19)** — The `backlog → plan` next-lane fix must be locked in by
  a regression test, and the finding write-up in `index.md` must record the
  fix (today its heading claims "FIXED" while its body reads as open).
- **REQ-7 (F18 follow-up)** — A dispatch left `pending` past a bounded
  window must be reassigned to another live worker or marked failed, rather
  than starving silently. This covers the case signature-exclusion cannot:
  a *real* worker that dies after being assigned.
- **REQ-8 (F10c)** — `worker_dispatch.worker_id`'s `ON DELETE CASCADE`
  (`migrations/20260809090728_add_worker_dispatch.sql:12`) must become
  `SET NULL`, so a manual row deletion can never again erase dispatch and
  chat history.
- **REQ-9 (F15)** — The drag-to-lane / reset dispatch bridge must be
  verified **live** on a real sync-only project, the way F5 was, not only
  by unit test.
- **REQ-10 (F13 deeper cause)** — Not fixed here. Must be filed as its own
  track (a manager needs its own `~/.laneconductor/manager-config.json`
  credential storage instead of borrowing a co-located project's
  `machine_token`) and referenced from this track's Depends-on.

## Non-goals

- F4 (cloud project selector) — owned by track 1101.
- F13's deeper cause — filed, not fixed (REQ-10).
- F10(a) — the pre-fix chat history is unrecoverable; nothing to build.
- F10(b) beyond what F16 and track 1110 already deliver.
- Re-litigating any finding marked Fixed above. Regressions get their own
  finding, not a reopened one.

## Acceptance Criteria

Each criterion states an outcome a user or an operator could observe.

- [ ] **AC-1 (REQ-1)** Creating a track through the UI produces an
      `index.md` whose only lane marker is `**Lane**` — `grep -c '\*\*Status\*\*'`
      on the new file returns 0. Dragging that card between lanes does not
      revert (the track-10012 symptom stays fixed).
- [ ] **AC-2 (REQ-2)** After any lane action that produced log output, the
      run's `last_run.log` is actually staged in git — `git status` in the
      worktree shows it tracked, not untracked. No `ReferenceError` occurs.
- [ ] **AC-3 (REQ-3)** A run whose agent exits 0 with `index.md` still at
      `running` and a dirty worktree ends with an explicit, human-readable
      outcome saying the run ended mid-work and can be re-run to resume —
      visible in `conversation.md` and in the dispatch result — instead of
      a silent `queue`.
- [ ] **AC-4 (REQ-4)** With a run's transcript open, clicking a track
      card's action button performs the action. A killed/finished run's
      transcript is not presented as live.
- [ ] **AC-5 (REQ-5)** `lc worker start --help` (and `lc worker status`)
      describe the two modes as MANUAL and AUTOMATIC, with the flag/value
      names shown as the mechanism, not the concept. Existing configs and
      flags keep working unchanged.
- [ ] **AC-6 (REQ-6)** A test fails if `NEXT_LANE.backlog` stops being
      `plan`. `index.md`'s F19 body states the fix.
- [ ] **AC-7 (REQ-7)** A dispatch assigned to a worker that never claims it
      does not stay `pending` indefinitely — it is reassigned to another
      live worker or marked failed with a reason, and that is observable in
      the UI.
- [ ] **AC-8 (REQ-8)** Deleting a `workers` row leaves its
      `worker_dispatch` rows intact with `worker_id IS NULL`; the Activity
      panel's history survives.
- [ ] **AC-9 (REQ-9)** A recorded live run exists: on a real sync-only
      project, dragging a card to a new lane produces a `worker_dispatch`
      row that is claimed and executed — observed, not inferred.
- [ ] **AC-10 (REQ-10)** A new track exists for the manager credential
      storage problem, linked from this track.

## Completion rule

This track may only reach `done` when every criterion above is checked or
explicitly moved to another track with a link. Findings whose fix is
"documented as deferred" do **not** count as satisfied (see the skill's
done-gate).
