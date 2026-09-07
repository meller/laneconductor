# Track AM-10079: Live turn cancellation and abort control in Chat surface

Six phases. Phases 1–3 are the mechanism, 4 is the affordance, 5 is verification,
6 is the explicitly deferred remote case. **Phase 3 carries the design risk** —
it is the one that decides what an abort *means* to the workflow engine, and
getting it wrong re-launches the run the user just stopped (spec.md, "The
failure-semantics trap").

---

## Phase 1: The abort primitive

**Problem**: There is no safe way to signal a run's process group. `process.kill(-pgid, sig)`
by itself will happily kill an unrelated process whose pid was recycled.
**Solution**: A pure, injectable module beside `run-marker.mjs`, gated on the pid-reuse
check `run-marker.mjs` already implements.

- [ ] Task 1.1: Create `conductor/services/run-abort.mjs` (REQ-1) — no process-global
      state, OS probes injected, mirroring `run-marker.mjs`'s style.
    - [ ] `writeAbortIntent(marker, { requestedBy, now })` → new marker preserving every
          existing field, plus `abort_requested`/`abort_requested_at`/`abort_requested_by` (REQ-2)
    - [ ] `readAbortIntent(marker)` → intent or null; absent field ⇒ null (REQ-3)
    - [ ] `signalRunGroup(marker, { stage, isPidAlive, readProcessCommand, kill })` —
          refuses unless `isRunMarkerLive` says live; refuses `pgid` that is not an
          integer `> 1`; signals `-pgid` only (REQ-4)
    - [ ] `nextAbortStage(currentStage)` → `SIGINT` → `SIGTERM` → `SIGKILL` (REQ-5)
    - [ ] `getAbortGraceConfig()` reading `LC_ABORT_SIGINT_GRACE_MS` /
          `LC_ABORT_SIGTERM_GRACE_MS`, env-override-first, defaults 5000/5000 (REQ-5)
- [ ] Task 1.2: An `abortRun({ primaryRoot, trackNumber, requestedBy, ...probes })`
      orchestrator that reads the marker from disk, writes the intent, sends the first
      signal, and schedules escalation only while the group stays live. This is the one
      entry point both the API route (Phase 2) and the CLI (Phase 2) call, so the two
      cannot drift.
- [ ] Task 1.3: Verify by running the Phase 1 tests, including the pid-reuse refusal
      case against a real spawned-then-exited pid.

**Impact**: New file only. Nothing imports it yet, so nothing changes behaviourally.

---

## Phase 2: The request surfaces — API endpoint and CLI

**Problem**: Nothing can ask for a cancellation.
**Solution**: One HTTP route and one CLI command, both delegating to Task 1.2.

- [ ] Task 2.1: `POST /api/projects/:id/tracks/:num/abort` in `ui/server/index.mjs`,
      placed with the other track-scoped POSTs (near `.../resume`, `:5414`) so it inherits
      the `app.use('/api', requireAuth)` mount.
    - [ ] Resolve `repo_path` from `projects`; 404 if absent (REQ-6, REQ-8)
    - [ ] `isManagerPseudoTrack(req.params.num)` branch: marker at
          `conductor/.runs/manager.json`, no `getTrackId`, no lane reconciliation (REQ-7)
    - [ ] Write intent **before** the first signal (REQ-6)
    - [ ] 202 / 202-already_requested / 409 / 404 / 501 exactly as REQ-8 and REQ-9 specify —
          in particular, the 501 for a pid that is not a local process, never a fake success
    - [ ] `broadcast('track:updated', …)` so the board reflects the change without a poll
- [ ] Task 2.2: `lc abort <track>` in `bin/lc.mjs` (REQ-10), alongside `track-dir`/`worktrees`.
      Resolves the primary root itself and calls Task 1.2 directly — no HTTP — so it is the
      only cancellation path that works in `local-fs` mode.
- [ ] Task 2.3: Extend `lc --help` and SKILL.md's Core Commands table with `lc abort`.
- [ ] Task 2.4: Verify for real — start a worker, dispatch a lane action, `curl` the
      endpoint, and confirm with `ps` that the process group is gone. Restart the API
      server first; it does not hot-reload.

**Impact**: A live run can now be stopped. Its *aftermath* is still wrong — that is Phase 3.
Do not mark this phase complete on the strength of "the process died"; it dies into a
failure transition until Phase 3 lands.

---

## Phase 3: Abort is a park, not a failure

**Problem**: A signalled child exits `code: null, signal: 'SIGTERM'`, which the exit
handler reads as a crash: it consumes a retry, fires `on_failure`, posts "Automation
failed", and returns an `**Auto Run**: yes` track to `queue` — where it is immediately
re-claimed and the cancelled run restarts.
**Solution**: One new outcome flag in the exit handler, routed into track 10055's
existing park path rather than a parallel mechanism.

- [ ] Task 3.1: `proc.on('exit', (code, signal) => …)` — capture the signal, which the
      handler currently discards (REQ-11). Thread it into the existing
      `lane_action_result` string so a signalled exit stops reading as `error (code null)`.
- [ ] Task 3.2: Derive `abortedByUser` from the marker the handler **already reads** for
      `markRunFinalizing`, before that rewrite. Require both an `abort_requested` intent
      and a signal-caused exit, so a run that finished cleanly inside the race window is
      still reported as the success it was (REQ-12).
- [ ] Task 3.3: Suppress the failure machinery when `abortedByUser`:
    - [ ] no retry increment (`failCountBefore` untouched) (REQ-13)
    - [ ] `transitionValue = null` — neither `on_success` nor `on_failure` (REQ-13)
    - [ ] `targetLane = laneStatus`, i.e. `**Lane**` is not written (REQ-13)
    - [ ] skip the `if (!isSuccess)` "Automation failed" comment (REQ-15)
    - [ ] skip `checkExhaustion` — a killed run's log is not evidence of a quota problem
- [ ] Task 3.4: Route into the park path: `isParked = true`, `nextActionStatus = 'waiting'`,
      `waitingReason = 'Cancelled by user'`, `lane_action_result = 'aborted'` (REQ-14).
      Order this **after** the `endedMidWork` branch and beside the
      `agentReportedWaiting || isBlockedTurn` branch, so the existing precedence comments
      there stay true.
- [ ] Task 3.5: Post the cancellation comment (REQ-15) — one `system` turn, leading `⚠️`,
      naming the action and stating that the worktree and session are preserved.
- [ ] Task 3.6: Confirm the conversation-run path (REQ-16): `getConversationRunWriteScope`
      already blocks lane writes, and block 3b already clears `**Waiting for reply**` on any
      exit. Assert both hold under an abort; do not add a second clearing path.
- [ ] Task 3.7: Confirm cleanup holds on the abort path (REQ-17) — `releaseTrackClaim`,
      `releaseGitLock`, `releaseGlobalMainModeLock`, marker removal in the `finally`, and
      `per-cycle` worktree preservation. Existing code; this task is to prove it, and to
      fix it only if a signalled exit turns out to skip a branch.
- [ ] Task 3.8: Verify by running a real abort end to end and reading the resulting
      `index.md`, `conversation.md` and DB row — not by reasoning about the diff.

**Impact**: This is the phase that makes cancellation mean something. Changes are confined
to `spawnCli`'s exit handler.

---

## Phase 4: The Stop affordance

**Problem**: The capability is unreachable from the Chat surface.
**Solution**: A Stop control in `TurnStatusBar`, driven by the liveness `ChatView` already
computes.

- [ ] Task 4.1: `TurnStatusBar` takes `canAbort`, `onAbort`, `aborting`, `abortError` (REQ-18).
      Its `if (!turn) return null` early return must not hide the bar when a run is live but
      no stream-json event has arrived yet — a non-claude CLI produces none at all.
- [ ] Task 4.2: Render the three states (REQ-20): idle "■ Stop", in-flight "Stopping…"
      (disabled), and the endpoint's own message on error. A 409 reads as "nothing running",
      not as a failure.
- [ ] Task 4.3: `ChatView` wires `resolveTargetRunLiveness`'s existing result and an
      `apiFetch` POST to the endpoint (REQ-19). No second liveness computation.
- [ ] Task 4.4: Confirm the manager target reaches the same control (REQ-21) — it needs no
      branch, since `resolveWorkerChatTarget` already returns `trackNumber: 'manager'` and
      Phase 2 accepts it.
- [ ] Task 4.5: Style per `conductor/design-language.md`, matching the existing
      `TurnStatusBar` chrome (`text-xs`, muted palette). Destructive-but-recoverable, so
      not alarm-red.
- [ ] Task 4.6: Verify in the running app, not only in jsdom — start the UI, run a real
      lane action, click Stop, watch the turn end. Screenshot the before/after.

**Impact**: `TurnStatusBar.jsx`, `ChatView.jsx`, and their existing test files.

---

## Phase 5: Verification

**Problem**: Every claim above is about a process dying and state being correct afterwards —
the class of claim that unit tests are worst at.
**Solution**: Real spawned processes for the mechanism, jsdom only for the rendering.

- [ ] Task 5.1: `conductor/tests/track-10079-run-abort.test.mjs` — `node:test`, Phase 1's
      pure module, including the pid-reuse refusal and the `pgid <= 1` refusal.
- [ ] Task 5.2: `conductor/tests/track-10079-abort-lifecycle.test.mjs` — `node:test` against
      a **real spawned worker and a real mock-cli child**, following
      `track-10020-run-marker-lifecycle.test.mjs`'s sandbox pattern. Covers AC-1 through
      AC-8, AC-10 and AC-12. Uses `env -u NODE_TEST_CONTEXT` per the track-1096 gotcha.
- [ ] Task 5.3: `ui/src/components/TurnStatusBar.test.jsx` additions — the three button
      states, and the live-run-without-turn-data case (AC-9's UI half, AC-11).
- [ ] Task 5.4: Run the full existing suites and confirm no regression, particularly
      `track-10020-*`, `track-10065-*`, `track-1102-f21-*` and `track-10055-*`, all of which
      assert on exit-handler outcomes this track modifies.
- [ ] Task 5.5: Check every AC against observed output, and record the observation.

**Impact**: Two new `node:test` files, additions to one existing vitest file.

---

## Phase 6: Remote (non-co-located) abort — DEFERRED, NOT IMPLEMENTED

**Problem**: In `remote-api` mode the collector is in the cloud and the run's process group
is on the user's machine. The pid in the marker is not a process the API server can signal,
so Phases 1–5 cannot reach it.
**Solution (not built in this track)**: a `worker_dispatch` row with `action: 'abort-run'`,
consumed by `checkDispatchInbox` out-of-band so it is not queued behind the very run it is
meant to stop, with its own claim/reap semantics and a ~10s poll latency that the UI would
have to represent honestly.

- [ ] Task 6.1: Dispatch-routed abort action — **not implemented in track 10079.**

This phase is deliberately left unchecked, and stays unchecked when the track completes.
Remote abort is a stated **Non-Goal** in `spec.md`, not a deferred piece of this track's
Solution — the Solution is scoped to co-located abort throughout, and no acceptance
criterion depends on this phase. What must not happen is the gap being hidden: REQ-9's
`501` is what reports it to the user, instead of a Stop button that appears to work and
silently does nothing. If a later track picks this up, it starts here.
