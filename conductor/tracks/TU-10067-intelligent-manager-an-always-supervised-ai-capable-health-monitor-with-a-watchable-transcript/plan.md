# Track TU-10067: Intelligent Manager — always-supervised, AI-capable health monitor

Seven phases. Phases 1–3 deliver a working deterministic supervisor that would have caught
most of the 2026-09-04 incident on its own. Phases 4–6 add the human-facing surface and the
AI escalation. Phase 7 verifies against the real product, not just unit tests.

Order matters: the sweep is useless if the process running it can die (Phase 1 first), and
layer 2 is unsafe to build before layer 1's findings are structured and trustworthy.

---

## Phase 1: Supervise the manager (REQ-1..REQ-4)

**Problem**: Nothing restarts the manager. The worker unit exists and was verified live with
a real SIGKILL, but there is no manager equivalent, and neither unit is installable from the
CLI — `bin/systemd-user.mjs` only knows about the API service.
**Solution**: A machine-level singleton unit for the manager plus a `lc` subcommand that
installs either unit through the existing systemd helper.

- [x] Task 1.1: Write `conductor/systemd/laneconductor-manager.service` — a singleton, not
      templated (the manager has no project path; `laneconductor.sync.mjs:134`).
    - [x] `Restart=always`, and `RestartSec`/`StartLimit*` justified in comments against the
          manager's lock-stale window, mirroring the worker unit's reasoning
    - [x] Carry over the worker unit's `[Unit]`-not-`[Service]` `StartLimit*` placement note
          — that was a real, silently-disabling bug
    - [x] `WorkingDirectory` from the manager's resolved serving root; `ExecStart` includes
          `--manager`
- [x] Task 1.2: Extend `bin/systemd-user.mjs` from one hardcoded service to a small registry
      (`api`, `worker@`, `manager`), keeping `hasSystemdUser()` / `startService()` /
      `isServiceActive()` / `getServicePid()` as the single systemd integration point.
- [x] Task 1.3: Add `lc worker install-service [--manager]` — writes, `daemon-reload`s,
      enables and starts. On a non-systemd host, explain and exit non-zero.
- [x] Task 1.4: Add supervision state to `lc worker status [--manager]`.
- [ ] Task 1.5: Call `enableLinger()` on install so supervision survives logout. Wired
      into `install-service` (both branches); not yet exercised against a real install
      (see conversation.md — deferred to Phase 7's live check rather than run against this
      machine's real, already-running manager identity).

**Impact**: The manager becomes a permanently-present process. This is the precondition for
D3's decision that layer 1 lives only in the manager.

---

## Phase 2: Layer-1 check module (REQ-5, REQ-6)

**Problem**: Detection logic for these failure classes is scattered — some inside claim
paths that only run when a worker is alive, some in pure modules nothing calls periodically.
**Solution**: One pure, injected-I/O module producing structured findings, unit-testable
without a live process, matching `stuck-track-sweep.mjs`'s established style.

- [x] Task 2.1: Create `conductor/services/manager-sweep.mjs` with the finding shape
      `{ check_id, subject, severity, evidence, remedy }` and a stable fingerprint helper
      (`check_id + subject` — the dedupe key D4 depends on).
- [x] Task 2.2: `stale-main-mode-lock` — reuse `checkAndClaimGlobalMainModeLock`'s existing
      staleness and `process.kill(pid, 0)` semantics rather than inventing a second rule.
- [x] Task 2.3: `stale-git-lock`, per track, same semantics.
- [x] Task 2.4: `worker-heartbeat-silent`, threshold aligned with the existing
      `ORPHAN_WORKER_STALE_HEARTBEAT_MS`.
- [x] Task 2.5: `dispatch-no-run-marker` — compose `run-marker.mjs`'s `isRunMarkerLive` with
      claimed-dispatch rows; do not fork track 10065's logic.
- [x] Task 2.6: `duplicate-worker-identity`, built on `parsePsWorkerRows`.
- [x] Task 2.7: `board-fs-mismatch` — DB lane/status vs the worktree's `index.md`, reusing
      `resolveTrackFolder` so it cannot repeat track 10063's wrong-duplicate-folder bug.
- [x] Task 2.8: Project resolution per spec.md D6 — every finding carries a `project_id`
      or is explicitly marked host-scoped. Track-scoped checks already know it;
      process-scoped checks derive it from the process cwd (the same `/proc/<pid>/cwd` read
      `reapOrphanedWorkerProcesses` already does) or from the worker row.
- [x] Task 2.9: Unit tests per check: fires when it should, and specifically **does not**
      fire for the live-PID / in-flight-race / within-grace cases.
- [x] Task 2.10: Unit tests for D6's resolution order, including the host-scoped residue.

**Impact**: Every failure class from the incident becomes a named, testable predicate.

---

## Phase 3: Wire the sweep loop into the manager (REQ-7..REQ-9, REQ-19)

**Problem**: A pure module nothing calls changes nothing.
**Solution**: An `isManager`-gated interval, plus the config surface and the remedy
allowlist, defaulting to report-only.

- [x] Task 3.1: Read `manager.supervision` config with defaults (`mode: report`,
      `sweep_interval_ms: 30000`) and the `LC_MANAGER_SWEEP_MS` test override.
      `getManagerSupervisionConfig()` reads `~/.laneconductor/manager-config.json`'s
      `supervision` block, not `.laneconductor.json` as spec.md REQ-19 literally says — the
      manager has no single project checkout to read that file from. Documented deviation,
      not silent (see conversation.md).
- [x] Task 3.2: Add the sweep `setInterval` alongside the existing dispatch/reconcile
      intervals, `isManager`-gated, documenting why it is separate (same reasoning already
      written above `reapOrphanedWorkerProcesses`'s own interval).
- [x] Task 3.3: Gather the injected facts each tick — lock files, `ps`, registered workers,
      claimed dispatches, run markers are all wired to real collaborators in
      `runManagerHealthSweep()`. `track index.md state` (for board-fs-mismatch) is the one
      fact source NOT wired this pass — see Task 3.5's note and manager-sweep-runner.mjs's
      own scope-note comment for the specific reason (a same-lane, status-only mismatch can
      be wrongly forgiven by `matchForwardTransition` for a self-referential lane like
      `done`; needs a real fix there, not a guessed DB-status mapping).
- [x] Task 3.4: Per-check error isolation so one failing check cannot abort the tick (REQ-9).
      `safeRun()` wraps every check category in `manager-sweep-runner.mjs`.
- [~] Task 3.5: Implement the five allowlisted remedies, each gated on `mode: remediate`.
      Two of five are wired for real: `remove-dead-lock` (fires and is tested) and
      `correct-board-display` (coded and tested at the runner level, but currently
      unreachable in production since `board-fs-mismatch` itself isn't wired to real DB/fs
      data — see Task 3.3). The other three are correctly NOT new code here:
      restart-via-systemd is passive (systemd's own `Restart=always`, Phase 1); SIGTERM/
      SIGKILL of a leaked process is `reapOrphanedWorkerProcesses`, already existing and
      unchanged; resetting a phantom `running` marker has no wired finding yet (no check
      in this pass produces that specific finding). Left unchecked rather than marked done,
      since "the five" isn't accurate yet.
- [x] Task 3.6: Two layers, not one. Orchestration-level tests
      (`manager-sweep-runner.test.mjs`, 18 cases, including the new
      dispatch-no-run-marker wiring above) verify report vs. remediate, error isolation,
      and D6 project resolution against fully injected fakes. On top of that,
      `conductor/tests/track-10067-manager-sweep-e2e.test.mjs` spawns a REAL `--manager`
      process against a REAL planted dead-PID lock file and a mock collector — no injected
      collaborators at all — and confirms report mode reports without touching the file
      (asserting on the actual "stale-main-mode-lock" log line, not merely the file's
      survival, which would trivially "pass" if the sweep silently never ran), remediate
      mode removes it within one interval, and a live-PID lock survives remediate mode too.
      **Found and fixed while writing that E2E test, worth flagging on its own**: the shared
      `startIsolatedWorker()` test helper deliberately redirects a worktree checkout to the
      PRIMARY repo's copy of `laneconductor.sync.mjs` (that's the whole point of track
      10045 — deterministic script resolution, not incidental). Run unmodified from inside
      *this* track's own worktree, every assertion in that E2E file silently exercised the
      unmodified primary checkout instead of this track's Phase 3 code — a false pass/fail
      unrelated to the code actually under test. Fixed locally in that one test file via the
      documented `LC_TEST_REPO_ROOT` override (set on the test runner's own `process.env`,
      not the spawned child's — a subtlety that cost a second round of debugging), not by
      changing the shared helper's default (which exists for a good, separate reason and
      other tracks' suites depend on it). Any FUTURE track writing a new
      `startIsolatedWorker()`-based e2e test for in-progress worktree code should expect the
      same trap and apply the same fix.

**Impact**: Ships a working deterministic supervisor for 5 of 6 layer-1 checks
(stale-main-mode-lock, stale-git-lock, worker-heartbeat-silent, duplicate-worker-identity,
dispatch-no-run-marker). `board-fs-mismatch` is the one still unwired (Task 3.3/3.5). Everything
below this line is the human-facing half.

---

## Phase 4: Supervision pseudo-track (REQ-14, REQ-21, REQ-23, D5, D7)

**Problem**: The transcript and conversation stack is keyed on `(projectId, trackNumber)`;
the manager has neither.
**Solution**: A reserved per-project `conductor/tracks/manager/` pseudo-track, invisible to
every folder scan. (The filesystem-backed comments-API adapter that used to be Task 4.5 here
moved to Track 10069 — reading/writing comments over HTTP is interactivity, 10069's scope
now; the manager's own findings still get written directly to `conversation.md` by Task 4.3
below, which needs no API and stays here.)

- [x] Task 4.1: Create the pseudo-track on first sweep if absent, **only in projects the
      manager supervises** — never in the manager's own serving root, which is not a project
      checkout (D6). `index.md` marks it clearly as not a workflow track, plus
      `conversation.md`.
- [x] Task 4.2: Route host-scoped findings (D6 step 3) to the manager's log and worker row
      only — no pseudo-track, no comment.
- [x] Task 4.3: Route project-scoped findings into its `conversation.md` as `> **system**:` comments in the
      required parser format, deduped by fingerprint so a persistent finding is not re-posted
      every 30 seconds.
- [x] Task 4.4: Skip the reserved pseudo-track in the worker's `syncConversation`
      (REQ-23). **Do this before Task 4.3 ships**, not after — without it, every finding
      written by 4.3 becomes a failed `/track/manager/comment` POST once per sweep. Put the
      check in `syncConversation`; do **not** touch `extractTrackNumber`'s no-digit fallback,
      which every other caller shares.
- [x] Task 4.6: Confirm live that the transcript route already works unchanged for a
      non-numeric segment — its pattern is `-${trackNum}-\d+\.log$` over `conductor/logs/`
      with no DB lookup, so `-manager-<ts>.log` matches. Verified by reading during planning;
      re-confirm against a real log file rather than trusting the note.
- [x] Task 4.7: Regression test — after the pseudo-track exists, `tracks.md` is unchanged,
      `lc track-dir manager` does not resolve it as a track, and auto-launch never claims it.
      Include the REQ-21 assertion that the reserved name contains no digit in any position,
      since that (not a numeric *prefix*) is what `isTrackDirName` actually tests.

**Impact**: The manager gains an addressable identity inside machinery that already works —
and the one part that did not work is adapted rather than assumed.

---

## Phase 5: (removed — moved to Track 10069)

This phase used to cover manager chat interactivity: `resolveWorkerChatTarget()` returning a
usable target for managers, enabling the `WorkerChatPanel` composer, rendering findings
distinctly from AI turns, and the comments-API adapter Phase 4's Task 4.5 used to build for
it. Revised split (see this track's index.md cross-reference note): 10069 has to build
resolver/composer-enabling logic for every worker type it supports anyway, not just the
manager, so a manager-specific slice of that here risked two different answers to "how does
chat find its target." This track ships watchable (Phase 4 + REQ-17's existing transcript
path); chattable is entirely 10069's build, on top of REQ-14/21/23 here.

**Impact of the removal**: req 3 (visibility AND interactivity) is only half-satisfied by
this track alone until Track 10069 ships — an explicit, accepted gap, not an oversight.

---

## Phase 6: Layer-2 AI escalation (REQ-10..REQ-13, REQ-24..REQ-26, D1, D4, D8)

**Problem**: "Is this merge stuck or slow?" cannot be answered by a fixed rule.
**Solution**: Dispatch a scoped session through the existing `spawnCli()` path, bounded by
the allowlist and the budget.

- [x] Task 6.1: Budget gate before dispatch — concurrency, per-fingerprint cooldown, hourly
      ceiling (REQ-12). `conductor/services/manager-escalation.mjs`'s `canEscalate()`, written
      and tested (11 cases) before anything dispatches through it.
- [x] Task 6.2: Prompt builder stating finding, evidence, allowlist, and the
      propose-don't-execute rule for everything else (REQ-11). `buildEscalationPrompt()`,
      same file.
- [x] Task 6.3: Add the supervision bypass to `spawnCli()` (D8, REQ-24..26) — a reserved
      action (`MANAGER_ESCALATION_ACTION`) that skips `resolveWorkspaceMode`,
      `createWorktree`, `checkAndClaimGitLock` and `checkAndClaimGlobalMainModeLock`, running
      in the primary checkout. Modeled on `isConversationRun`, extended in three places, not
      one — verified by reading, not assumed:
      1. `workspaceMode = (isConversationRun || isSupervisionRun) ? null : ...` (the bypass itself)
      2. `checkAndClaimGitLock` — runs **unconditionally** today, including for
         `isConversationRun`; that variable's own bypass comment only ever promised no
         worktree and no main-mode lock, never the per-track lock. A supervision run needed
         its own additional `!isSupervisionRun` guard here — this would have been a silent
         AC-20 failure if I'd only mirrored the workspace-mode bypass.
      3. The exit handler's OWN separate `isConversationRun` (label-based, not action-based) —
         kept deliberately un-merged with the supervision flag, because that variable also
         drives an unconditional "clear **Waiting for reply**" on completion (3b), which is
         the opposite of AC-11. A parallel `isSupervisionRun` flag shares the *lane*-write
         restriction (`getConversationRunWriteScope`) without inheriting that clear.
      Also found and fixed the same class of gap in the manual-dispatch pre-check
      (`wouldBeWorkspaceMode`, ~line 8890): it calls `resolveWorkspaceMode` directly with no
      bypass awareness at all, so it could reject an escalation as "needs main-mode, busy"
      for a run that never actually needs main-mode. Skipped entirely for
      `MANAGER_ESCALATION_ACTION`.
    - [x] Assert no branch and no worktree are created (AC-19) —
          `track-10067-manager-escalation-workspace-bypass.test.mjs`, real spawned worker,
          real git repo.
    - [x] Assert a track-scoped escalation does not take that track's git lock (AC-20) — same
          test: a REAL per-track lock (this test process's own, genuinely-alive pid) is
          planted before the dispatch and asserted byte-identical afterward.
- [ ] Task 6.4: Dispatch via `spawnCli()` against the affected track's number, or the
      project's `manager` pseudo-track for a project-scoped finding with no track.
      **Not wired — three structural blockers found, none safe to patch under this pass's
      remaining scope, all documented rather than guessed at:**
      1. **Cross-project cwd.** `spawnCli()` resolves ~24 paths off `process.cwd()`, assuming
         the caller's cwd already IS the target project's checkout. The manager's own serving
         root is a DIFFERENT directory (D6) — dispatching against project N's track requires
         either a global `process.chdir()` (unsafe: the sweep's own 30s interval, or any
         other concurrent async tick in this one process, could resolve paths against the
         wrong project mid-flight) or threading an explicit root parameter through spawnCli's
         ~24 call sites — a real refactor, not a fix-in-place.
      2. **The manual-dispatch pre-check bug** — found and fixed as part of Task 6.3 above,
         since it also affects any real dispatch, but noted here because it was discovered
         while investigating this wiring.
      3. **Dispatch-row finalization.** `reconcileActiveDispatch()` decides a manual dispatch
         is complete by reading the target's **Lane Status** from disk and checking it's no
         longer `running` — but a supervision run is REQUIRED to leave that marker untouched
         (`writeScope.canWriteLaneStatus: false`, Task 6.3). For a track that's genuinely
         mid-run (the exact case an escalation exists to investigate), that file permanently
         reads "running" and the dispatch row is never finalized — confirmed live in this
         phase's own e2e test (see its comment for the full trace). The session's own outcome
         still lands correctly on the track via `lane_action_result` (unaffected); only the
         `worker_dispatch` row's bookkeeping is stuck. Needs its own resolution (e.g.
         finalize a supervision dispatch purely off `runningTrackMap`/process-exit, never
         file state) before any manager can safely self-dispatch escalations.
      Given these, Tasks 6.5–6.7 (comment convention, waiting-for-reply, budget-in-practice)
      are also deferred — each assumes a working dispatch to observe.
- [ ] Task 6.5: Conclusion written to `conversation.md` per the Completion Comment
      Convention, so it reaches the Inbox (REQ-13). Blocked on Task 6.4.
- [ ] Task 6.6: Non-allowlisted remedy path sets `**Waiting for reply**: yes` instead of
      acting (AC-11). Blocked on Task 6.4 — but the mechanism itself needs no new code: the
      session writes `**Waiting for reply**: yes` directly (same as any dispatched agent
      writing its own markers, and NOT auto-cleared, since the exit handler's 3b block
      deliberately excludes `isSupervisionRun` — see Task 6.3).
- [ ] Task 6.7: Test that a finding held true across many sweeps produces exactly one
      dispatch (AC-9), and that `mode: report` produces zero (AC-10). The budget gate itself
      is tested in isolation (Task 6.1); this task is the sweep-loop integration of it, which
      needs Task 6.4's actual call site to exist first.

**Impact**: The dispatch mechanism's safety properties (workspace isolation, no lock
contention, budget) are built and independently verified. The manager cannot yet actually
place a call to them — that requires solving the cross-project cwd problem first, which is
real scope, not an oversight.

---

## Phase 7: Real-product verification and documentation

**Problem**: Every failure class here is a process-liveness problem. Unit tests cannot prove
a supervisor supervises.
**Solution**: Drive the real mechanisms, then document the feature where operators look.

- [ ] Task 7.1: Live SIGKILL-and-recover on the manager unit, recording observed output
      (AC-1). This is the same verification the worker unit already passed.
- [ ] Task 7.2: Live stale-lock test — plant a dead-PID lock, watch the sweep report it, flip
      to `remediate`, watch it clear (AC-4).
- [ ] Task 7.3: Live worker-death test — SIGKILL a supervised worker, confirm the finding and
      confirm the manager does not double-restart it (AC-6).
- [ ] Task 7.4: Live UI check — manager chat panel shows a transcript and accepts a message
      (AC-7, AC-8). Restart the API and worker first; neither hot-reloads.
- [ ] Task 7.5: Document `manager.supervision` config and `lc worker install-service` in
      `conductor/product.md`'s feature table and the skill's command reference.
- [ ] Task 7.6: Leave `product.md`'s File Roles table **unmodified** and carry the
      fundamentals-conflict note forward for human decision — see spec.md's D5.

**Impact**: The track can be judged on observed behaviour rather than on plausible diffs.

---

## Notes for the implementer

- **Do not rewrite the existing detection logic.** Most of Phase 2 is composition. Forking
  `checkAndClaimGlobalMainModeLock`'s staleness rule into a second, subtly different one is
  the most likely way to make this track a net negative.
- **`mode: report` is the default on purpose.** Anything that makes remediation the default
  contradicts D1 and AC-10.
- **The budget gate (Task 6.1) is written before the dispatch path (Task 6.4)**, not after,
  and the workspace bypass (Task 6.3) before it — a single escalation dispatched without the
  bypass creates a `track-manager` branch and reads a worktree snapshot in which none of the
  conditions it was sent to diagnose exist (D8).
- **One ordering inside Phase 4 is load-bearing.** Task 4.4 (the `syncConversation` skip)
  lands before Task 4.3 starts writing findings, or every finding becomes a failed collector
  POST. (The comments-adapter-before-composer ordering that used to live here moved to Track
  10069 along with both halves of that sequence.)
- **`manager` is a reserved name with a hard constraint, not a label.** Any rename must keep
  it digit-free (REQ-21) — `isTrackDirName` tests `/\d+/` unanchored, so `manager-2` would
  become claimable by the auto-launch loop.
