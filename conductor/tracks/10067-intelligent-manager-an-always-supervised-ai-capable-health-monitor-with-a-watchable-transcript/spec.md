# Spec: Intelligent Manager — an always-supervised, AI-capable health monitor with a watchable transcript

## Problem Statement

The 2026-09-04 session was a human plus one AI agent manually performing the job of a
supervisor that does not exist. Every one of the following was found by hand, none by the
system:

- a worker died and stayed dead for 1h45m with no signal
- stale global main-mode lock and stale per-track git locks, both held by dead PIDs
- a dispatch claimed with no run marker, orphaned past any reasonable grace period
- the board lying about state (`queue` while genuinely running; `done:success` while not
  actually merged)
- Auto Run writes landing in the wrong duplicate track folder and flapping back
- leaked duplicate worker processes burning CPU for hours
- a Claude capacity probe that was actually an auth/billing failure, misclassified

Each failure class already has detection logic somewhere in the tree. What is missing is a
**standing loop that runs those checks when nobody is looking**, and a way for a human to
**watch and talk to** whatever is doing that watching.

### What actually exists today (verified, 2026-09-04)

The problem statement says the manager "has no periodic health-sweep loop of its own at all."
That is very nearly true but not exactly, and the exception matters because it is the
template for this work:

| Fact | Evidence |
|---|---|
| `--manager` is a real worker type, machine-level, `project_id: null` | `laneconductor.sync.mjs:139` (`isManager`), `:1161`, `:1259` |
| The manager already runs **one** periodic sweep | `reapOrphanedWorkerProcesses()` (`:7457`), on its own `setInterval` at `:8817`, 5 min default, `isManager`-gated at `:7458` |
| Dead-PID cleanup for the global main-mode lock exists, but **only inside the claim path** | `checkAndClaimGlobalMainModeLock()` `:4153` — `process.kill(pid, 0)` liveness check runs only when some worker tries to claim |
| Same for per-track git locks | `checkAndClaimGitLock()`, same file |
| Phantom-`running` detection exists as a pure module, unused by any manager loop | `conductor/services/stuck-track-sweep.mjs` |
| Hidden resting-state detection exists as a pure module | `conductor/services/resting-state.mjs` |
| No-run-marker orphan reconciliation exists, scoped per project worker | `conductor/services/orphaned-dispatch.mjs`, `run-marker.mjs`, track 10065 |
| A worker systemd unit exists and was verified live via SIGKILL-and-recover | `conductor/systemd/laneconductor-worker@.service` |
| Nothing installs that unit from the CLI | `bin/systemd-user.mjs` handles `laneconductor-api.service` only; `grep systemd bin/lc.mjs` shows API call sites only |
| **No manager systemd unit exists at all** | `ls conductor/systemd/` returns one file |
| **Manager chat/transcript is explicitly disabled in the UI** | `ui/src/lib/workerTaskInfo.js:34` — `if (!worker \|\| worker.type === 'manager') return null;`; `WorkerChatPanel.jsx:85` disables the composer when `isManager` |

So the shape of the work is: **the detection primitives mostly exist and are unwired; the
supervision of the supervisor and the human-facing surface do not exist at all.**

## Solution

Two layers plus the two things that make them trustworthy.

- **Layer 1 — deterministic sweep.** A cheap, no-LLM sweep running on a short interval in
  the manager process, checking the exact failure classes above. Findings are structured
  data. A small, explicitly-enumerated subset is auto-remedied; everything else is reported.
- **Layer 2 — AI escalation.** For findings that are not safe to resolve by fixed rule, the
  manager dispatches a scoped session using the same `spawnCli()` path every lane action
  already uses, so its reasoning lands in a transcript and in `conversation.md` by
  construction, not by a bolted-on mechanism.
- **Req 1 — supervise the supervisor.** Extend the verified `Restart=always` systemd pattern
  to cover the manager itself, and make both units installable from `lc`.
- **Req 3 — watch and talk to it.** Give the manager a supervision pseudo-track so the
  existing transcript + conversation + chat stack works on it unchanged.

## Decisions (the three the track explicitly deferred to planning)

### D1 — Layer 2 autonomy level: **bounded autonomy** (middle option)

Layer 2 sessions may **diagnose freely and act only from a fixed allowlist**. Anything that
touches `main`, a merge, a push, a PR, a deploy, or a production write is **proposed as a
comment**, never executed, and sets `**Waiting for reply**: yes`.

Allowlisted (safe by construction — each is already something an existing code path does):
1. remove a lock file whose recorded PID is confirmed dead on this host
2. restart a process that is under systemd supervision (`systemctl --user restart`)
3. reset a phantom `**Lane Status**: running` marker back to `queue`
4. correct a DB display value that disagrees with the authoritative `index.md`
5. `SIGTERM`, then `SIGKILL` after a grace period, a leaked worker process

Rejected — **full autonomy**: the manager is unattended by definition, so a misdiagnosis
would merge or push code with nobody watching. Rejected — **diagnose-only**: it would not
have fixed a single thing the human fixed by hand on 2026-09-04, which is the entire point
of the track.

This mirrors the precedent already in the tree: `config?.manager?.auto_heal === true`
(`laneconductor.sync.mjs:4937`) gates an existing auto-remedy behind explicit opt-in, and
only fires when *every* disqualifying item has a known remedy. Same shape, extended.

**Kill switch:** `manager.supervision.mode` = `off` | `report` | `remediate` (default
`report`). Auto-remedies and layer-2 dispatch require `remediate`. A fresh install
therefore watches and reports before it ever touches anything.

### D2 — Interval, and whether it is configurable: **30s, configurable, layer 2 is not on a timer**

- Layer 1: 30s default. Cheap by design (filesystem stats, `process.kill(pid, 0)`, one `ps`,
  one already-cached collector read). Configurable via `manager.supervision.sweep_interval_ms`
  in `.laneconductor.json`, with `LC_MANAGER_SWEEP_MS` as the test-only override — the same
  convention every other interval in this file already uses (`LC_HEARTBEAT_INTERVAL_MS`,
  `LC_ORPHAN_REAP_POLL_MS`, `LC_RECONCILE_INTERVAL_MS`).
- Layer 2 has **no interval at all**. It is triggered only by a layer-1 finding that layer 1
  cannot resolve. This is what makes D4's budget tractable: a bad sweep interval cannot
  itself cause spend, because sweeping is free.

### D3 — Where layer 1 runs: **manager only, via a shared pure module**

Check logic goes in a new pure module, `conductor/services/manager-sweep.mjs` (I/O injected,
matching `stuck-track-sweep.mjs` and `orphan-worker-detection.mjs`). The loop that calls it
is `isManager`-gated, exactly like `reapOrphanedWorkerProcesses()`.

Regular workers do **not** run it. Two supervisors sweeping the same locks would race each
other on remedy 1 above, and a worker cannot supervise its own death — which is the headline
failure of 2026-09-04. The track's own counter-argument ("a manager may not be running for
every project, but a regular worker already is") is answered by req 1 rather than by
duplicating the sweep: making the manager systemd-supervised is what makes it reliably
present.

### D4 — Layer 2 budget

Enforced in the manager process, all configurable under `manager.supervision`:

| Control | Default | Purpose |
|---|---|---|
| `max_concurrent_escalations` | 1 | one AI session at a time, ever |
| `escalation_cooldown_ms` | 15 min | per finding **fingerprint**, not per sweep |
| `max_escalations_per_hour` | 4 | absolute ceiling regardless of fingerprints |
| `mode: report` | default | no escalation at all until explicitly enabled |

A finding fingerprint is `check_id + subject` (e.g. `stale-git-lock:10044`). Deduping on the
fingerprint is what stops a persistent finding from re-dispatching every 30 seconds — the
single most likely runaway-spend path.

### D5 — The supervision pseudo-track (how req 3 is satisfied by construction)

The entire live-transcript and conversation stack is keyed on `(projectId, trackNumber)`:
`GET /api/projects/:id/tracks/:num/transcript` reads
`<repo_path>/conductor/logs/*-<trackNumber>-*.log` (`ui/server/index.mjs:1492`), WS
`session:event` filters on `trackNumber` (`ui/src/lib/useTrackTranscript.js`), and
`WorkerChatPanel` posts into that track's `conversation.md`.

Rather than build a second, parallel manager-transcript stack, the manager gets a reserved
per-project pseudo-track: **`conductor/tracks/manager/`**, addressed as track number
`manager`. Layer-2 sessions about a specific track spawn against **that track's** real number
(so the reasoning lands where a human would look for it); machine-level findings with no
track spawn against `manager`.

This is safe because every track-folder consumer requires a numeric prefix, verified:

- `conductor/services/track-folder.mjs:48` — `^(?:[A-Za-z]+-)?${trackNumber}-`
- `conductor/init-tracks-summary.mjs:39` — `/^(\d+)-(.+)$/`
- `laneconductor.sync.mjs`'s `remainingScopedWork()` — `/^(\d+)/`

`manager` matches none of them, so the pseudo-track is invisible to claiming, to
`tracks.md`, and to the auto-launch loop without needing a single exclusion list.

⚠️ **Fundamentals conflict — flagged, non-blocking.** `conductor/product.md`'s "File Roles —
Separation of Concerns" table documents `conductor/tracks/NNN-slug/index.md` as *per-track
state* and `conductor/tracks/tracks.md` as a summary of all tracks. A folder under
`conductor/tracks/` that is not a track bends that model. Proceeding as specified because the
alternative (a parallel transcript stack keyed on worker id) is materially worse and
duplicates four working components. `product.md` is **not** modified by this track — a human
should decide whether the file-roles table gains a row for the pseudo-track or whether it
should live outside `conductor/tracks/` entirely.

## Requirements

**Supervision of the manager (req 1)**
- REQ-1: A `laneconductor-manager.service` systemd --user unit exists, a machine-level
  singleton (not templated on a project path, unlike the worker unit — the manager is not
  scoped to a project, per `laneconductor.sync.mjs:134`).
- REQ-2: Its `Restart` / `RestartSec` / `StartLimit*` values are justified against the
  manager's own lock-stale window the same way the worker unit's are against
  `worker-lock.mjs`'s `DEFAULT_STALE_MS` (60s), including the `[Unit]`-not-`[Service]`
  placement note that unit already documents.
- REQ-3: `lc worker install-service [--manager]` writes, enables and starts the appropriate
  unit, reusing `bin/systemd-user.mjs`'s `hasSystemdUser()` / `writeUnit` / `startService`
  helpers rather than a second systemd integration. Non-systemd hosts get a clear message
  and a non-zero exit, not a silent no-op.
- REQ-4: `lc worker status --manager` reports supervision state (supervised / unsupervised /
  not installed), so "is anything actually restarting this?" is answerable without
  `systemctl`.

**Layer 1 — deterministic sweep (req 2)**
- REQ-5: `conductor/services/manager-sweep.mjs` is a pure module: every liveness fact (PIDs,
  lock file contents, heartbeats, run markers, DB rows, `ps` output) is injected.
- REQ-6: It implements these checks, each emitting a structured finding with a stable
  `check_id`, a `subject`, a `severity`, and a `remedy` (allowlisted id, or `null` meaning
  escalate):
  1. `stale-main-mode-lock` — `_main-mode-global.lock` held past the stale window or by a
     PID that is dead on this host
  2. `stale-git-lock` — same, per-track, for `.conductor/locks/<track>.lock`
  3. `worker-heartbeat-silent` — a registered worker past the staleness threshold
  4. `dispatch-no-run-marker` — a `claimed` dispatch past a conservative grace with no live
     run marker (the standing-sweep counterpart to track 10065's per-reconcile fallback)
  5. `duplicate-worker-identity` — two live processes for the same worker identity
  6. `board-fs-mismatch` — DB lane/status disagreeing with the worktree's own `index.md`
     (track 10063's bug class)
- REQ-7: A sweep loop in `laneconductor.sync.mjs`, `isManager`-gated, on its own
  `setInterval` (not folded into an existing poll — same reasoning `reapOrphanedWorkerProcesses`
  already documents at `:8811`: an existing poll that early-returns when its queue is empty
  barely runs at all when the manager is otherwise idle).
- REQ-8: Auto-remedy fires only for the five allowlisted actions in D1, only when
  `mode: remediate`. Every remedy attempt is logged with what it saw and what it did.
- REQ-9: The sweep never throws out of its interval callback, and a single failing check
  never prevents the other checks in the same tick from running.

**Layer 2 — AI escalation (req 2, req 3)**
- REQ-10: A non-allowlisted finding dispatches a scoped session via the existing
  `spawnCli()` path, so it inherits transcript streaming, log-file naming, session
  continuity and the run marker with no new machinery.
- REQ-11: The session prompt states the finding, the evidence behind it, the allowlist it
  may act within, and the explicit instruction to propose rather than execute anything
  outside it.
- REQ-12: D4's budget is enforced *before* dispatch: concurrency, per-fingerprint cooldown,
  and hourly ceiling.
- REQ-13: Every escalation writes its conclusion to the relevant `conversation.md` as a
  `> **system**:` comment following the **Completion Comment Convention** (`✅` / `⚠️` /
  `❌` as the leading character), so it lands in the Inbox like every other outcome.

**Visibility and interactivity (req 3)**
- REQ-14: The supervision pseudo-track exists per project as `conductor/tracks/manager/`
  with an `index.md` and a `conversation.md`.
- REQ-15: `resolveWorkerChatTarget()` returns a usable target for `type === 'manager'`
  instead of `null`.
- REQ-16: `WorkerChatPanel`'s composer is enabled for a manager worker and posts into the
  supervision track's conversation via the same comments endpoint it already uses.
- REQ-17: A layer-2 session's transcript is visible live through the existing "Show live
  session transcript" path, with no new renderer.
- REQ-18: A human reply in that conversation is picked up the same way a reply on any other
  track is.

**Configuration**
- REQ-19: All of D1–D4's knobs live under `manager.supervision` in `.laneconductor.json`,
  are optional, and default to `mode: report` — an existing install gains reporting and
  nothing else until a human opts in.

## Acceptance Criteria

Each is stated as something an operator could observe.

- [ ] AC-1: `systemctl --user kill -s SIGKILL laneconductor-manager.service` is followed by a
      manager process running again within the configured `RestartSec`, verified live the
      same way the worker unit was.
- [ ] AC-2: `lc worker install-service --manager` on a systemd host leaves an enabled,
      active unit; on a non-systemd host it prints why and exits non-zero.
- [ ] AC-3: `lc worker status --manager` states whether the manager is supervised.
- [ ] AC-4: With a lock file planted naming a PID that does not exist, the manager reports
      the finding within one sweep interval in `report` mode, and removes the lock within one
      sweep interval in `remediate` mode. A lock held by a **live** PID is left alone in both.
- [ ] AC-5: A track left at `**Lane Status**: running` with no live process and no DB claim
      is surfaced as a `board-fs-mismatch` or phantom finding rather than sitting silently.
- [ ] AC-6: A worker killed with SIGKILL is reported as `worker-heartbeat-silent` within the
      staleness threshold, and — when it is systemd-supervised — the manager observes it come
      back rather than restarting it a second time.
- [ ] AC-7: Opening the manager's chat panel in the UI shows its supervisory transcript and
      accepts a typed message. Today this is impossible: the composer is hard-disabled for
      managers.
- [ ] AC-8: A layer-2 escalation's reasoning is readable live in the transcript view while
      it runs, and its conclusion is present in `conversation.md` afterwards with a leading
      `✅` / `⚠️` / `❌`.
- [ ] AC-9: A finding that persists across many sweeps produces **one** escalation, not one
      per sweep — demonstrated by holding a finding true for longer than the cooldown and
      counting dispatches.
- [ ] AC-10: With `mode: report` (the default), no lock is removed, no process is killed and
      no AI session is dispatched, however many findings are raised.
- [ ] AC-11: Layer 2 offered a remedy outside the allowlist proposes it in `conversation.md`
      and sets `**Waiting for reply**: yes`, rather than executing it.
- [ ] AC-12: Adding `conductor/tracks/manager/` leaves `conductor/tracks.md` and the
      auto-launch loop unchanged — the pseudo-track is never listed and never claimed.

## Out of Scope (FFU — deliberately deferred, and therefore not acceptance criteria)

- Full autonomous operation including unattended merges and production writes (D1's rejected
  third option). Revisit only after bounded autonomy has run for a meaningful period.
- Cross-machine supervision — a manager supervising workers on *other* hosts. Every check
  here is host-local, consistent with `reapOrphanedWorkerProcesses`'s existing
  `w.hostname === hostname` filter.
- launchd equivalents for macOS. `hasSystemdUser()` already returns false there and the
  fallback path is unchanged.
- Correcting the misclassified capacity-probe-vs-auth/billing diagnosis itself. The sweep
  can surface the symptom, but `provider-probe-classify.mjs` is where that fix belongs and
  it is a separate track.

## Data Model Changes

None. No migration. Findings are in-process state; conversations and transcripts reuse the
existing `track_comments` / log-file mechanisms via the pseudo-track key.
