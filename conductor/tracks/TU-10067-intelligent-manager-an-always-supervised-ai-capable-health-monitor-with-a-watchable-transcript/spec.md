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

This is safe because every track-folder consumer skips a folder with no track number in
it. Re-verified 2026-09-06, and the governing guard is **not** the numeric *prefix* the
first planning pass assumed:

- `laneconductor.sync.mjs:1536` — `isTrackDirName(name)` = `/\d+/.test(name) && !name.startsWith('_duplicate-')`.
  This is the filter on **three** of the four folder scans: the concurrency scan (`:3050`),
  the artifact scan (`:6311`), and — the one that matters most — the **auto-launch scan**
  (`:6342`).
- `laneconductor.sync.mjs`'s `remainingScopedWork()` (`:8833`) — `/^(\d+)/`
- The Jira outbound scan (`:3267`) — `^LAN-\d+` or `^\d+`
- `conductor/init-tracks-summary.mjs:39` — `/^(\d+)-(.+)$/` (this is what keeps it out of
  `tracks.md`)
- `conductor/services/track-folder.mjs:48` — `^(?:[A-Za-z]+-)?${trackNumber}-`

`manager` matches none of them, so the pseudo-track is invisible to claiming, to
`tracks.md`, and to the auto-launch loop without needing a single exclusion list.

**The reserved name must therefore contain no digit anywhere** — not merely lack a numeric
prefix. `isTrackDirName` tests `/\d+/` unanchored, so a folder named `manager-2` or
`supervision-1` *would* be scanned and could be claimed by the auto-launch loop. The same
scan then sorts on `parseInt(a.match(/\d+/)[0])`, which throws outright on a digitless name
that somehow reached it. Both facts point the same way and are pinned as REQ-21 so a later
rename cannot silently un-hide the pseudo-track.

**Which project's supervision track a manager's chat resolves to.** A manager's worker row
has `project_id: null` by construction (`laneconductor.sync.mjs:1259`), and the workers API
deliberately returns the manager in *every* project's worker list —
`WHERE (w.project_id = $1 OR w.type = 'manager')` (`ui/server/index.mjs:367`). Its
`last_track_project_id` is aliased straight from that null `w.project_id` (`:360`), so it is
null too. The chat target therefore resolves to the **project whose board the user is
currently viewing** (`resolveWorkerChatTarget`'s existing `fallbackProjectId` argument). That
is coherent rather than arbitrary: the manager already appears on every board, so "the
manager's supervision thread for the project I am looking at" is exactly what a user asking
"what is it doing?" from that board means.


### D6 — Where a finding lands when it has no project

D5 leaves one case unresolved, and it has to be settled before implementation rather than
discovered during it: the transcript and conversation stack is addressed as
`/api/projects/:id/tracks/:num/...`, so **a finding with no resolvable `project_id` has no
addressable transcript at all**. Two of layer 1's six checks can produce exactly that —
`duplicate-worker-identity` and `worker-heartbeat-silent` are about processes, not tracks.

Every finding therefore carries a `project_id`, resolved in this order:

1. **Track-scoped findings** (`stale-main-mode-lock`, `stale-git-lock`,
   `dispatch-no-run-marker`, `board-fs-mismatch`) — the project is already known, since the
   lock/dispatch/track was read from that project's checkout.
2. **Process-scoped findings** (`duplicate-worker-identity`, `worker-heartbeat-silent`) —
   derive the project from the process's working directory. This needs no new mechanism:
   `reapOrphanedWorkerProcesses` already reads `/proc/<pid>/cwd` for precisely this kind of
   question (`laneconductor.sync.mjs`'s `cwdExists`). A registered worker also carries its
   `project_id` on its own worker row.
3. **Host-scoped residue** — a process whose cwd is unreadable, deleted, or outside every
   known project. These are **report-only in this track**: logged by the manager and visible
   on its worker row, with no pseudo-track and no layer-2 escalation.

Host-scoped findings get no pseudo-track deliberately. The manager's own serving root is
explicitly *not* a project checkout — it prints
`Manager worker starting from <root> — not scoped to any project checkout`
(`laneconductor.sync.mjs:191`) — so there is no `conductor/tracks/` there to write into and
no project id to address a transcript with. Inventing a synthetic "host" project to hold
them would add a DB-visible fake project to every board to serve a residue case, which is a
worse trade than logging them. The residue is also small by construction: step 2 resolves
the common cases, and the 2026-09-04 incident's leaked processes all had resolvable cwds.

**Consequence for layer 2**: escalation requires a resolvable `project_id`, because
`spawnCli()` needs one to write a transcript anywhere a human can read it. A host-scoped
finding is reported and never escalated. This is a real limit and is listed in Out of Scope
rather than hidden.

⚠️ **Fundamentals conflict — flagged, non-blocking.** `conductor/product.md`'s "File Roles —
Separation of Concerns" table documents `conductor/tracks/NNN-slug/index.md` as *per-track
state* and `conductor/tracks/tracks.md` as a summary of all tracks. A folder under
`conductor/tracks/` that is not a track bends that model. Proceeding as specified because the
alternative (a parallel transcript stack keyed on worker id) is materially worse and
duplicates four working components. `product.md` is **not** modified by this track — a human
should decide whether the file-roles table gains a row for the pseudo-track or whether it
should live outside `conductor/tracks/` entirely.

### D7 — The pseudo-track's transcript works unchanged; its **conversation** does not

D5 claims the existing "transcript + conversation + chat stack works on it unchanged." Half
of that is true, and the other half would have failed during Phase 5 as an unbuildable
requirement — the same class of gap D6 closed. Verified by reading the routes, 2026-09-06:

| Path | Backed by | Works for `manager`? |
|---|---|---|
| `GET /api/projects/:id/tracks/:num/transcript` (`ui/server/index.mjs:1492`) | pure filesystem — `new RegExp(\`-${trackNum}-\\d+\\.log$\`)` over `conductor/logs/` | **yes, unchanged** |
| `GET /api/projects/:id/tracks/:num/comments` (`:1733`) | `getTrackId()` (`:1580`) → `SELECT id FROM tracks WHERE track_number = $2` | **no — 404.** The pseudo-track has no DB row, by design |
| `POST /api/projects/:id/tracks/:num/comments` (`:1747`) | `collectorWrite('POST', '/track/manager/comment')`, then appends to the folder found by `readdirSync(tracksDir).find(d => d.startsWith(\`${num}-\`))` | **no.** The collector write needs a track row, and the folder probe looks for `manager-`, while the folder is literally `manager` |
| Worker `syncConversation` (`:2687`) | `extractTrackNumber` (`:1896`) | **worse than not running.** Its no-digit fallback is `?.[1] ?? trackDir`, so it returns the string `'manager'` rather than null. `syncConversation` does not early-return; it POSTs every finding to `/track/manager/comment`, which fails and logs a warning — one failed POST per finding, per sweep |

So Phase 4's "route findings into `conversation.md`" would have written comments the UI
returns 404 for, and Phase 5's "enable the composer" would have posted into nothing. The
`useTrackComments` hook (`ui/src/lib/useTrackComments.js`) reads that 404ing endpoint on a
2s poll, so the panel would have rendered permanently empty.

**Decision: a filesystem-backed conversation adapter, keyed on the reserved name — not a DB
row.** When `:num === 'manager'`, both comments routes bypass `getTrackId` and the collector
entirely and read/append `<repo_path>/conductor/tracks/manager/conversation.md` directly.

Rejected — **give the pseudo-track a real `tracks` row** (`track_number` is `TEXT`, so it
would fit). It would make every route work with no new code, but it puts a card on every
project's Kanban board, which then needs a new exclusion in the tracks-list query. That is
exactly the exclusion-list cost D5 chose this design to avoid, traded for one branch in two
routes.

The adapter is cheap because the parser already exists as a pure, exported function:
`parseConversationComments()` in `conductor/sync-conversation-utils.mjs:13`. Nothing needs
extracting — the route imports it and maps turns to the same `{ author, body, created_at }`
shape `useTrackComments` already renders.

Two consequences that are requirements, not notes:

- The manager must **skip its own pseudo-track in `syncConversation`** — otherwise every
  sweep that writes a finding produces a failed collector POST. The skip is explicit
  (a reserved-name check in `syncConversation`), *not* a change to `extractTrackNumber`'s
  fallback: that fallback is shared by every other caller and changing it has blast radius
  well outside this track.
- REQ-18's "a human reply is picked up the same way" resolves to the **manager reading the
  file it owns**, not to the DB `waiting_for_reply` path, since no DB row exists to carry
  that flag. This is simpler, not a workaround: the manager is the only writer and the only
  reader of that thread.

**Shared contract — track 10069 must know about this.** `index.md`'s cross-reference asks
that any change to the pseudo-track mechanism be stated rather than silently reshaped. D7 is
such a change, and it moves in 10069's favour: the supervision thread is **filesystem-backed
and has no `tracks` row**, so a persistent, target-switchable manager chat built on top of it
reads and writes `conductor/tracks/manager/conversation.md` through the comments routes'
reserved-name branch — it must not assume a DB-backed track behind that endpoint. REQ-15's
resolver shape and the transcript event format are **unchanged**; only the conversation
backing store is now specified where it previously was assumed.

### D8 — A supervision session is a third workspace case: no worktree, no lock

D5 and D7 established that a layer-2 escalation reuses `spawnCli()` "with no new
machinery." Verified against the real spawn path on 2026-09-06, that is not safe as written,
and it fails in the same way for **every** escalation — not just pseudo-track ones.

`spawnCli()` resolves a workspace mode before it does anything else
(`laneconductor.sync.mjs:4806`). A supervision dispatch carries no `**Workspace**` marker and
no `**Track Kind**`, and a manager sweep is unattended by definition, so
`resolveWorkspaceMode` returns `'branch'` twice over — once at the unattended-trigger rule
(`workspace-mode.mjs`, "an unattended trigger forces 'branch'") and again at the row-6
default. Three things then happen, all wrong:

| What `spawnCli` does | Why it is wrong for a supervisor |
|---|---|
| `createWorktree(trackNumber)` → `.worktrees/manager`, branch `track-manager` (`:4047`) | A diagnostic session has no code to isolate and nothing to merge. It also leaves a branch and a worktree row in the Worktrees panel for something that is not a track. |
| `checkAndClaimGitLock(trackNumber)` (`:5043`) | For a **track-scoped** escalation this takes the lock of the very track being diagnosed — colliding with the real run whose health is in question. |
| The session runs **inside the worktree** | This is the serious one. A worktree is a checkout of `HEAD`, not the live primary checkout. Every condition layer 1 detects — a stale lock file, a phantom `running` marker, a board/filesystem mismatch — exists in the primary checkout's working tree. A supervisor that reads a clean snapshot of `HEAD` cannot see any of them. It would reliably report that the problem it was dispatched to investigate does not exist. |

There is also a circularity worth stating plainly: if the finding is `stale-main-mode-lock`
and the escalation itself claims locks, the diagnosis perturbs the condition it was sent to
diagnose — and `checkAndClaimGlobalMainModeLock` *removes* a dead-PID lock as a side effect
of claiming, so the evidence would be gone before the session looked at it.

**Decision: supervision runs directly in `process.cwd()` — neither `'main'` nor `'branch'`.**

This is not a new concept; it is the existing third case. `spawnCli` already carves out
exactly this for conversation replies (`isConversationRun`, `:4806`), whose own comment
describes it as "a genuinely distinct third case, not 'main' and not 'branch'" that operates
"directly in `process.cwd()` ... with neither a worktree nor the main-mode lock." A
supervision run has the same three properties: it observes rather than edits code, it must
see live state, and it must not serialize against real work. It takes the same bypass.

Concretely: supervision dispatches set a reserved action, and `spawnCli` treats that action
the way it already treats `CONVERSATION_REPLY_ACTION` — skip `resolveWorkspaceMode`, skip
`createWorktree`, skip both locks, run in the primary checkout.

Rejected — **mark the pseudo-track `**Workspace**: main`**. It skips the worktree, but
`'main'` still takes the global main-mode lock, which both serializes supervision against
every real main-mode lane action and re-introduces the circularity above. Rejected —
**let it take a worktree and diagnose from the DB only**: it gives up the filesystem evidence
(lock files, `index.md` markers, run markers) that four of the six layer-1 checks are built
on.

**Consequence for D1's allowlist.** Remedies now execute in the primary checkout, which is
what makes them work at all — removing a dead lock file or resetting a phantom marker in a
worktree copy would fix nothing observable. It also means the propose-don't-execute boundary
is the *only* thing standing between a supervision session and the live checkout, which
raises its importance rather than changing it.

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
- REQ-10: A non-allowlisted finding **with a resolvable `project_id`** (D6) dispatches a
  scoped session via the existing `spawnCli()` path, so it inherits transcript streaming,
  log-file naming, session continuity and the run marker with no new machinery. A
  host-scoped finding is reported and never dispatched — there is nowhere addressable to
  write its transcript.
- REQ-11: The session prompt states the finding, the evidence behind it, the allowlist it
  may act within, and the explicit instruction to propose rather than execute anything
  outside it.
- REQ-12: D4's budget is enforced *before* dispatch: concurrency, per-fingerprint cooldown,
  and hourly ceiling.
- REQ-13: Every escalation writes its conclusion to the relevant `conversation.md` as a
  `> **system**:` comment following the **Completion Comment Convention** (`✅` / `⚠️` /
  `❌` as the leading character), so it lands in the Inbox like every other outcome.

**Visibility (req 3, half) — interactivity moved to Track 10069**
- REQ-14: The supervision pseudo-track exists per project as `conductor/tracks/manager/`
  with an `index.md` and a `conversation.md`. It is created only in projects the manager
  actually supervises — never in the manager's own serving root, which is not a project
  checkout (D6).
- REQ-17: A layer-2 session's transcript is visible live through the existing "Show live
  session transcript" path, with no new renderer.
- **Moved to Track 10069** (revised split — this track ships watchable, not chattable;
  10069 needs to build resolver/composer logic for every worker type it supports anyway,
  so a manager-specific slice of it here risked two different answers to "how does chat
  find its target"): former REQ-15 (`resolveWorkerChatTarget()` returning a usable target
  for `type === 'manager'`), former REQ-16 (`WorkerChatPanel`'s composer enabled for
  managers), former REQ-18 (a human reply in the pseudo-track's `conversation.md` being
  picked up). 10069 depends on REQ-14 and REQ-21/23 below (the pseudo-track existing and
  being safely reserved) — it does not rebuild those.

**Configuration**
- REQ-19: All of D1–D4's knobs live under `manager.supervision` in `.laneconductor.json`,
  are optional, and default to `mode: report` — an existing install gains reporting and
  nothing else until a human opts in.
- REQ-20: Every finding carries a `project_id` resolved per D6's three-step order, or is
  explicitly marked host-scoped. No finding is silently dropped for lacking one.

**Pseudo-track plumbing (D7)**
- REQ-21: The reserved pseudo-track folder name contains **no digit in any position**, and a
  test asserts this. `isTrackDirName` (`laneconductor.sync.mjs:1536`) tests `/\d+/`
  unanchored, so a digit anywhere would make the folder scannable and claimable by the
  auto-launch loop; the same scan then sorts on `parseInt(name.match(/\d+/)[0])`, which
  throws on a digitless name that reaches it. `manager` satisfies both.
- **Moved to Track 10069**: former REQ-22, the `GET`/`POST /api/projects/:id/tracks/:num/comments`
  filesystem-backed adapter for the reserved name. Reading and writing comments is
  interactivity, not visibility — the manager's own findings still land in
  `conversation.md` directly via Task 4.3 below (the manager writes to its own filesystem,
  no API involved), but the HTTP route a browser uses to read/post into that same file is
  10069's to build, for the same reason as REQ-15/16/18 above.
- REQ-23: The worker's `syncConversation` explicitly skips the reserved pseudo-track. Without
  this, `extractTrackNumber`'s no-digit fallback returns the literal string `'manager'`, so
  every finding written becomes a failed `/track/manager/comment` POST — once per finding,
  per sweep. The skip is a reserved-name check in `syncConversation`, **not** a change to
  `extractTrackNumber`, whose fallback every other caller shares.
- REQ-24: A layer-2 supervision dispatch runs in the primary checkout: `spawnCli()` skips
  workspace-mode resolution, worktree creation, the per-track git lock and the global
  main-mode lock for it, via the same reserved-action bypass `CONVERSATION_REPLY_ACTION`
  already uses (D8).
- REQ-25: This applies to **every** supervision dispatch, including track-scoped ones. An
  escalation about track N must never claim track N's git lock or run in track N's worktree.
- REQ-26: No supervision dispatch ever creates a git branch or a worktree. `track-manager`
  and `.worktrees/manager` must never come into existence.

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
- [ ] AC-7 (revised — composer half moved to Track 10069): Opening the manager's live
      session transcript (the existing "Show live session transcript" path, REQ-17) shows
      its supervisory reasoning as a layer-2 escalation runs. Accepting a typed reply is
      10069's AC, not this track's — see that track's spec.
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
- [ ] AC-13: A leaked worker process belonging to a known project produces a finding
      attributed to that project, readable in that project's supervision thread — not
      dropped for being "machine-level".
- [ ] AC-14: A leaked process whose working directory is deleted or outside every known
      project is still reported in the manager's log and on its worker row, and is not
      escalated to an AI session.
- **Moved to Track 10069**: former AC-15 (opening the manager's chat from two different
  project boards shows each project's own supervision thread), former AC-16 (the manager's
  chat panel lists findings already written to the thread — proof of the comments adapter),
  former AC-17 (a message typed into the manager's composer lands in
  `conversation.md` as `> **human**: ...`, no `tracks` row created). All three are
  interactivity ACs against the comments API/composer, which is 10069's build now.
- [ ] AC-18: Running a sweep that writes findings to the supervision thread produces **no**
      `[conv-sync] post comment failed` warnings in the worker log — the reserved-name skip
      (REQ-23) is observable as the absence of that noise, which is present without it.

- [ ] AC-19: After a layer-2 escalation runs, `git branch --list 'track-manager'` and
      `ls .worktrees/manager` are both empty, and `git worktree list` is unchanged (REQ-26).
- [ ] AC-20: An escalation dispatched about a track that is genuinely running does not block
      or disturb that run — the track's own git lock is still held by the real run
      throughout, and the real run completes normally (REQ-25).
- [ ] AC-21: An escalation about a planted dead-PID stale lock can still see that lock file
      when it starts. This is the observable proof it is reading the primary checkout rather
      than a worktree snapshot: in a worktree the file is simply absent, so the session would
      report no problem found.

## Out of Scope (FFU — deliberately deferred, and therefore not acceptance criteria)

- Full autonomous operation including unattended merges and production writes (D1's rejected
  third option). Revisit only after bounded autonomy has run for a meaningful period.
- Cross-machine supervision — a manager supervising workers on *other* hosts. Every check
  here is host-local, consistent with `reapOrphanedWorkerProcesses`'s existing
  `w.hostname === hostname` filter.
- launchd equivalents for macOS. `hasSystemdUser()` already returns false there and the
  fallback path is unchanged.
- Layer-2 escalation for host-scoped findings (D6 step 3). It needs a transcript identity
  that is not tied to a project, which is a design question of its own; reporting them is
  enough to have caught the 2026-09-04 leaked processes.
- Correcting the misclassified capacity-probe-vs-auth/billing diagnosis itself. The sweep
  can surface the symptom, but `provider-probe-classify.mjs` is where that fix belongs and
  it is a separate track.

## Data Model Changes

None. No migration. Findings are in-process state; conversations and transcripts reuse the
existing `track_comments` / log-file mechanisms via the pseudo-track key.
