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

- [ ] Task 1.1: Write `conductor/systemd/laneconductor-manager.service` — a singleton, not
      templated (the manager has no project path; `laneconductor.sync.mjs:134`).
    - [ ] `Restart=always`, and `RestartSec`/`StartLimit*` justified in comments against the
          manager's lock-stale window, mirroring the worker unit's reasoning
    - [ ] Carry over the worker unit's `[Unit]`-not-`[Service]` `StartLimit*` placement note
          — that was a real, silently-disabling bug
    - [ ] `WorkingDirectory` from the manager's resolved serving root; `ExecStart` includes
          `--manager`
- [ ] Task 1.2: Extend `bin/systemd-user.mjs` from one hardcoded service to a small registry
      (`api`, `worker@`, `manager`), keeping `hasSystemdUser()` / `startService()` /
      `isServiceActive()` / `getServicePid()` as the single systemd integration point.
- [ ] Task 1.3: Add `lc worker install-service [--manager]` — writes, `daemon-reload`s,
      enables and starts. On a non-systemd host, explain and exit non-zero.
- [ ] Task 1.4: Add supervision state to `lc worker status [--manager]`.
- [ ] Task 1.5: Call `enableLinger()` on install so supervision survives logout.

**Impact**: The manager becomes a permanently-present process. This is the precondition for
D3's decision that layer 1 lives only in the manager.

---

## Phase 2: Layer-1 check module (REQ-5, REQ-6)

**Problem**: Detection logic for these failure classes is scattered — some inside claim
paths that only run when a worker is alive, some in pure modules nothing calls periodically.
**Solution**: One pure, injected-I/O module producing structured findings, unit-testable
without a live process, matching `stuck-track-sweep.mjs`'s established style.

- [ ] Task 2.1: Create `conductor/services/manager-sweep.mjs` with the finding shape
      `{ check_id, subject, severity, evidence, remedy }` and a stable fingerprint helper
      (`check_id + subject` — the dedupe key D4 depends on).
- [ ] Task 2.2: `stale-main-mode-lock` — reuse `checkAndClaimGlobalMainModeLock`'s existing
      staleness and `process.kill(pid, 0)` semantics rather than inventing a second rule.
- [ ] Task 2.3: `stale-git-lock`, per track, same semantics.
- [ ] Task 2.4: `worker-heartbeat-silent`, threshold aligned with the existing
      `ORPHAN_WORKER_STALE_HEARTBEAT_MS`.
- [ ] Task 2.5: `dispatch-no-run-marker` — compose `run-marker.mjs`'s `isRunMarkerLive` with
      claimed-dispatch rows; do not fork track 10065's logic.
- [ ] Task 2.6: `duplicate-worker-identity`, built on `parsePsWorkerRows`.
- [ ] Task 2.7: `board-fs-mismatch` — DB lane/status vs the worktree's `index.md`, reusing
      `resolveTrackFolder` so it cannot repeat track 10063's wrong-duplicate-folder bug.
- [ ] Task 2.8: Project resolution per spec.md D6 — every finding carries a `project_id`
      or is explicitly marked host-scoped. Track-scoped checks already know it;
      process-scoped checks derive it from the process cwd (the same `/proc/<pid>/cwd` read
      `reapOrphanedWorkerProcesses` already does) or from the worker row.
- [ ] Task 2.9: Unit tests per check: fires when it should, and specifically **does not**
      fire for the live-PID / in-flight-race / within-grace cases.
- [ ] Task 2.10: Unit tests for D6's resolution order, including the host-scoped residue.

**Impact**: Every failure class from the incident becomes a named, testable predicate.

---

## Phase 3: Wire the sweep loop into the manager (REQ-7..REQ-9, REQ-19)

**Problem**: A pure module nothing calls changes nothing.
**Solution**: An `isManager`-gated interval, plus the config surface and the remedy
allowlist, defaulting to report-only.

- [ ] Task 3.1: Read `manager.supervision` config with defaults (`mode: report`,
      `sweep_interval_ms: 30000`) and the `LC_MANAGER_SWEEP_MS` test override.
- [ ] Task 3.2: Add the sweep `setInterval` alongside the existing dispatch/reconcile
      intervals, `isManager`-gated, documenting why it is separate (same reasoning already
      written above `reapOrphanedWorkerProcesses`'s own interval).
- [ ] Task 3.3: Gather the injected facts each tick — lock files, `ps`, registered workers,
      claimed dispatches, run markers, track `index.md` state.
- [ ] Task 3.4: Per-check error isolation so one failing check cannot abort the tick (REQ-9).
- [ ] Task 3.5: Implement the five allowlisted remedies, each gated on `mode: remediate`,
      each logging observation and action.
- [ ] Task 3.6: Test the loop end to end against a mock collector: planted dead-PID lock is
      reported in `report` mode, removed in `remediate` mode, and a live-PID lock is left
      alone in both.

**Impact**: Ships a working deterministic supervisor. Everything below this line is the
human-facing half.

---

## Phase 4: Supervision pseudo-track (REQ-14, REQ-21..REQ-23, D5, D7)

**Problem**: The transcript and conversation stack is keyed on `(projectId, trackNumber)`;
the manager has neither. And only half that stack works for a track with no DB row — the
transcript route is pure filesystem, but comments go through `getTrackId()` and the
collector (D7).
**Solution**: A reserved per-project `conductor/tracks/manager/` pseudo-track, invisible to
every folder scan, plus a filesystem-backed conversation adapter for the two comments routes.

- [ ] Task 4.1: Create the pseudo-track on first sweep if absent, **only in projects the
      manager supervises** — never in the manager's own serving root, which is not a project
      checkout (D6). `index.md` marks it clearly as not a workflow track, plus
      `conversation.md`.
- [ ] Task 4.2: Route host-scoped findings (D6 step 3) to the manager's log and worker row
      only — no pseudo-track, no comment.
- [ ] Task 4.3: Route project-scoped findings into its `conversation.md` as `> **system**:` comments in the
      required parser format, deduped by fingerprint so a persistent finding is not re-posted
      every 30 seconds.
- [ ] Task 4.4: Skip the reserved pseudo-track in the worker's `syncConversation`
      (REQ-23). **Do this before Task 4.3 ships**, not after — without it, every finding
      written by 4.3 becomes a failed `/track/manager/comment` POST once per sweep. Put the
      check in `syncConversation`; do **not** touch `extractTrackNumber`'s no-digit fallback,
      which every other caller shares.
- [ ] Task 4.5: Filesystem-backed comments adapter (REQ-22) — in `ui/server/index.mjs`,
      handle the reserved name in both `GET` and `POST /api/projects/:id/tracks/:num/comments`
      before they reach `getTrackId()` / `collectorWrite()`:
    - [ ] GET reads `<repo_path>/conductor/tracks/manager/conversation.md` and maps it with
          the already-exported pure `parseConversationComments()`
          (`conductor/sync-conversation-utils.mjs:13` — nothing to extract) into the same
          shape `useTrackComments` renders.
    - [ ] POST appends `> **human**: <body>` in the required parser format. Note the existing
          folder probe (`d.startsWith(\`${num}-\`)`) does not match a folder named exactly
          `manager` — the adapter addresses the folder directly rather than reusing it.
    - [ ] Assert no `tracks` row is created for the reserved name (AC-17).
- [ ] Task 4.6: Confirm live that the transcript route already works unchanged for a
      non-numeric segment — its pattern is `-${trackNum}-\d+\.log$` over `conductor/logs/`
      with no DB lookup, so `-manager-<ts>.log` matches. Verified by reading during planning;
      re-confirm against a real log file rather than trusting the note.
- [ ] Task 4.7: Regression test — after the pseudo-track exists, `tracks.md` is unchanged,
      `lc track-dir manager` does not resolve it as a track, and auto-launch never claims it.
      Include the REQ-21 assertion that the reserved name contains no digit in any position,
      since that (not a numeric *prefix*) is what `isTrackDirName` actually tests.

**Impact**: The manager gains an addressable identity inside machinery that already works —
and the one part that did not work is adapted rather than assumed.

---

## Phase 5: Manager chat and transcript in the UI (REQ-15..REQ-18)

**Problem**: `resolveWorkerChatTarget()` returns `null` for managers and the composer is
hard-disabled — the manager is structurally unwatchable today.
**Solution**: Point manager chat at the supervision track. No new renderer.

**Depends on Phase 4's Task 4.5.** `useTrackComments` polls the comments endpoint every 2s;
without the adapter that endpoint 404s for the reserved name, so enabling the composer here
first yields a panel that renders permanently empty and posts into nothing.

- [ ] Task 5.1: `resolveWorkerChatTarget()` returns the supervision target for
      `type === 'manager'`, scoped to the currently-viewed project via the existing
      `fallbackProjectId` argument (a manager's own `project_id` and `last_track_project_id`
      are both null by construction — see D5), preferring a currently-escalated real track
      when one exists.
- [ ] Task 5.2: Enable the `WorkerChatPanel` composer for managers; replace the
      manager-specific empty state with the transcript.
- [ ] Task 5.3: Render findings distinctly from AI turns so "what it noticed" reads apart
      from "what it decided".
- [ ] Task 5.4: Update the existing `WorkerChatPanel.test.jsx` manager cases, which currently
      assert the disabled behaviour and will correctly fail.
- [ ] Task 5.5: Verify live in the running UI, not only in tests — open the panel against a
      real manager and read a real sweep.

**Impact**: Requirement 3 becomes observable.

---

## Phase 6: Layer-2 AI escalation (REQ-10..REQ-13, D1, D4)

**Problem**: "Is this merge stuck or slow?" cannot be answered by a fixed rule.
**Solution**: Dispatch a scoped session through the existing `spawnCli()` path, bounded by
the allowlist and the budget.

- [ ] Task 6.1: Budget gate before dispatch — concurrency, per-fingerprint cooldown, hourly
      ceiling (REQ-12). Written and tested first: this is the runaway-spend guard.
- [ ] Task 6.2: Prompt builder stating finding, evidence, allowlist, and the
      propose-don't-execute rule for everything else (REQ-11).
- [ ] Task 6.3: Dispatch via `spawnCli()` against the affected track's number, or the
      project's `manager` pseudo-track for a project-scoped finding with no track —
      inheriting transcript, logging, run marker unchanged. A host-scoped finding (D6 step 3)
      is never dispatched; assert this rather than relying on it not happening.
- [ ] Task 6.4: Conclusion written to `conversation.md` per the Completion Comment
      Convention, so it reaches the Inbox (REQ-13).
- [ ] Task 6.5: Non-allowlisted remedy path sets `**Waiting for reply**: yes` instead of
      acting (AC-11).
- [ ] Task 6.6: Test that a finding held true across many sweeps produces exactly one
      dispatch (AC-9), and that `mode: report` produces zero (AC-10).

**Impact**: The judgement calls a human made by hand become watchable, bounded automation.

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
- **The budget gate (Task 6.1) is written before the dispatch path (Task 6.3)**, not after.
- **Two orderings inside Phase 4 are load-bearing**, both for the same reason — writing
  findings before the plumbing that carries them produces noise rather than a partial
  feature. Task 4.4 (the `syncConversation` skip) lands before Task 4.3 starts writing
  findings; Task 4.5 (the comments adapter) lands before Phase 5 enables the composer.
- **`manager` is a reserved name with a hard constraint, not a label.** Any rename must keep
  it digit-free (REQ-21) — `isTrackDirName` tests `/\d+/` unanchored, so `manager-2` would
  become claimable by the auto-launch loop.
