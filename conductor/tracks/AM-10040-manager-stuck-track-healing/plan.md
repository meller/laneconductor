# Track AM-10040: Manager Stuck-Track Healing

Seven phases, ordered by *live damage rate* rather than by the order the findings were written.
The original three phases (now 5–7) predate Findings 4–7; the four new phases (1–4) go first
because each is currently causing damage on every worker cycle, and because each removes a
*cause* that the later phases would otherwise only be cleaning up after.

Line numbers are from the working tree as of 2026-08-30 — **re-locate by symbol, not by number**.
`conductor/laneconductor.sync.mjs` is ~7500 lines and moves constantly.

**Requirement coverage** — every REQ maps to exactly one phase:

| Phase | Requirements | Finding |
|---|---|---|
| P1 — One lane list, honest claim failures | REQ-13, REQ-14 | 5 |
| P2 — Stale-process containment + detection | REQ-12, REQ-11 | 4 |
| P3 — One folder resolver, skill included | REQ-15 | 6 |
| P4 — Invalid resting states | REQ-16, REQ-17 | 7 |
| P5 — Pre-spawn block counting + escalation | REQ-1, 2, 3, 8, 9, 10 | 1 |
| P6 — Manager sweep: phantoms, slots, zombies | REQ-4, REQ-5, REQ-6 | 2, 3 |
| P7 — Known-safe auto-heal | REQ-7 | 1 |

---

## Phase 1: One lane list, and claims that say why they failed (REQ-13, REQ-14)

**Problem**: Lane-name lists are duplicated as inline SQL/JS literals across the worker and the
API. Adding `done` as a claimable lane (track 10035) updated some and missed others, and the miss
was *silent* — `claim-queue` returned zero rows forever and the worker reported it as
`lost the DB claim race`, a cause it never verified. Confirmed sites:

| Site | Literal | State |
|---|---|---|
| `ui/server/index.mjs:2918` (`claimQueuedTracks`) | `lane_status IN ('plan','implement','review','quality-gate','done')` | fixed in `bede5ab`, still an inline literal |
| `ui/server/index.mjs:3219` (comment webhook wake) | `lane_status IN('plan','implement','review','quality-gate')` | **still broken** — a human comment on a `done`-lane track never re-wakes the worker |
| `conductor/laneconductor.sync.mjs:5772` | `['plan','implement','review','quality-gate','done'].includes(...)` | correct today, duplicated |
| `ui/server/index.mjs:819`, `:3320` (`VALID_LANES`) | includes `backlog` — a *different* set (movable lanes) | correct, but must be named to stay distinguishable |

**Good news that shrinks this phase**: the shared module already exists and is already imported
across the boundary. `conductor/constants.mjs` exports `Lanes`/`LaneActionStatus` and is imported
by the worker (`laneconductor.sync.mjs:15`); `ui/server/index.mjs` already imports from
`../../conductor/*.mjs` in four places (lines 19–22). This is an *extend and adopt*, not a new
module.

- [ ] Task 1: Extend `conductor/constants.mjs` with the two lane **sets**, named so they cannot be
      confused with each other
    - [ ] `CLAIMABLE_LANES` — lanes a worker may claim a queued action in:
          `[PLAN, IMPLEMENT, REVIEW, QUALITY_GATE, DONE]`. Note `backlog` is deliberately absent.
    - [ ] `MOVABLE_LANES` — every lane a track may be *placed* in, i.e. today's `VALID_LANES`
          (`CLAIMABLE_LANES` + `BACKLOG`). Replaces the two `VALID_LANES` literals.
    - [ ] A one-line doc comment on each stating the invariant: *adding a lane means editing
          exactly this file*.
- [ ] Task 2: Adopt them everywhere, and make SQL take the list as a **parameter**, not a literal
    - [ ] `ui/server/index.mjs:2918` → `AND lane_status = ANY($n)` with `CLAIMABLE_LANES` pushed
          onto `params`. Parameterizing is the part that matters: a `$n` binding cannot silently
          drift from the constant the way a hand-typed `IN (...)` list did.
    - [ ] `ui/server/index.mjs:3219` (comment webhook) → same treatment. **This is the live fix**
          in this task — it currently omits `done`.
    - [ ] `ui/server/index.mjs:819`, `:3320` → `MOVABLE_LANES`.
    - [ ] `conductor/laneconductor.sync.mjs:5772` → `CLAIMABLE_LANES.includes(...)`.
- [ ] Task 3: REQ-14 — `claim-queue` reports *why* zero rows came back
    - [ ] In `claimQueuedTracks` (`ui/server/index.mjs:2890`), when the `UPDATE ... RETURNING`
          yields no rows, run one diagnostic `SELECT lane_status, lane_action_status` inside the
          **same transaction** (before `COMMIT`, so the answer is consistent with the attempt) and
          map it to a reason: `no_candidates` (no matching row at all) · `already_claimed`
          (`lane_action_status <> 'queue'`) · `lane_not_claimable` (`lane_status` not in
          `CLAIMABLE_LANES`) · `not_permitted` (row exists and is queued in a claimable lane, but
          the visibility/permission filter excluded it — see spec D8).
    - [ ] Response shape becomes `{ tracks: [...], reason }`, `reason` null when
          `tracks.length > 0`. Additive — existing callers reading `.tracks` are unaffected.
    - [ ] Only run the diagnostic for a **targeted** claim (`req.body.track_number` present). An
          untargeted "give me up to N" claim returning zero is normal idle polling; a second query
          on every idle beat of every worker is real cost for no signal.
- [ ] Task 4: The worker logs the reason verbatim instead of asserting a cause
    - [ ] `conductor/laneconductor.sync.mjs:5820` — replace the hardcoded `lost the DB claim race
          this cycle (another worker already has it)` with the server's `reason`. Only
          `already_claimed` may be described as a lost race; `lane_not_claimable` must be logged
          at **warn**, since it is by definition a bug (the worker chose a candidate the server
          refuses to claim — the two disagree about what is claimable).
    - [ ] Keep the message readable when `reason` is absent (older collector) — fall back to a
          neutral `no rows returned (collector did not report a reason)`, never to the old
          unverified assertion.

**Impact**: The class of bug dies, not just the instance. A `done`-lane comment wakes the worker.
A permanent exclusion announces itself as `lane_not_claimable` in the first log line instead of
hiding behind twenty minutes of plausible-sounding contention.

---

## Phase 2: Stale processes — contain them, then detect them (REQ-12, REQ-11)

**Problem**: Node loads modules into memory at boot; editing the file on disk changes nothing for
a running process. Worker 1 (PID 3040379, started 10:01) ran 7-hour-old code after the
`tracksMetadata` fix landed at 17:02, and used it to overwrite track 10036's canonical `index.md`
from `done:queue` back to `implement:success` — dragging a shipped track backwards and triggering
a redundant implement run. Nothing anywhere detects "this process is older than its code."

**Ordering within the phase is deliberate (spec D6)**: REQ-12 (the write guard) lands *first*. It
is a pure containment that works even when detection fails — against stale code, third-party
processes, and races alike. REQ-11 (detection) is the alarm; REQ-12 is the seatbelt, and the
seatbelt is cheaper.

- [ ] Task 1: REQ-12 — a monotonic lane-write guard, as a pure module
    - [ ] New `conductor/services/lane-regression-guard.mjs`:
          `LANE_ORDER = ['backlog','plan','implement','review','quality-gate','done']` (index =
          rank) and
          `shouldBlockLaneWrite({ onDiskLane, onDiskStatus, intendedLane, intendedStatus, producedByThisRun })`
          → `{ blocked, reason }`.
    - [ ] Block when `rank(intendedLane) < rank(onDiskLane)` and `producedByThisRun` is false.
          Also block any write that moves a track **out of** `done` regardless of rank arithmetic —
          `done` is terminal and is the exact case that caused the incident.
    - [ ] Do **not** block same-lane status transitions (`running` → `success`, `queue` →
          `running`); this guards lane regression, not status churn. A worker legitimately writes
          `implement:failure` on the lane it is running in.
    - [ ] `on_failure` transitions that legitimately move backwards (`review` → `implement:queue`,
          `quality-gate` → `plan:queue`, both from `workflow.json`) must pass. These set
          `producedByThisRun: true` — the run that just failed *is* the author of the regression,
          which is precisely the distinction the flag encodes.
- [ ] Task 2: Apply the guard at every marker-write site, on a **fresh** read
    - [ ] The exit-handler block (`laneconductor.sync.mjs` ~5015–5045) — the site that produced the
          incident. It already re-reads `index.md` from the write location (a track-1102 fix); feed
          that freshly-read content's current `**Lane**` into the guard rather than the in-memory
          `laneStatus` the run started with. That difference is the whole fix.
    - [ ] The DB→disk sync path (~2779, ~2918–2934) — a stale DB row is the same hazard as stale
          code.
    - [ ] On block: no-op the lane/status write, leave every other marker alone, and log at warn
          with both states (`refused to write <intended> over <onDisk>`). Do **not** post a
          conversation comment — a stale process spamming `conversation.md` is the failure mode
          this track exists to end.
- [ ] Task 3: REQ-11 — `workers.code_sha`, captured once at boot
    - [ ] Migration `migrations/<ts>_add_worker_code_sha.sql`:
          `ALTER TABLE workers ADD COLUMN code_sha TEXT, ADD COLUMN code_sha_captured_at TIMESTAMPTZ`.
          Mirror in `prisma/schema.prisma` (`model workers`, ~199) and `prisma/schema.sql` (~175).
    - [ ] Capture at module load in `laneconductor.sync.mjs` — **once**, into a module-level const,
          never re-read. Against the **install dir's** HEAD, not the managed project's (spec D5).
    - [ ] Send it in `upsertWorker`'s `registerBody` (~1038) and persist it in
          `POST /worker/register`. It must **not** be updated by the heartbeat path — only by
          registration — for the same reason.
- [ ] Task 4: The staleness comparison, as a pure module
    - [ ] New `conductor/services/worker-code-staleness.mjs`:
          `classifyWorkerStaleness({ workerSha, headSha, commitsBehind, touchedFiles, maxCommitsBehind })`
          → `{ stale, severity, reason }`. `severity: 'critical'` when any commit since `workerSha`
          touched a file the worker loads (`laneconductor.sync.mjs`, anything under
          `conductor/services/`, `conductor/constants.mjs`); `'stale'` when merely
          `commitsBehind > maxCommitsBehind`; `'current'` otherwise.
    - [ ] Git facts are **injected**, never shelled out from inside the module — same style as
          `orphan-worker-detection.mjs`, so it unit-tests without a repo.
- [ ] Task 5: Report it. Run on the manager's existing `reapOrphanedWorkerProcesses` interval now;
      move into Phase 6's `sweepStuckTracks()` when that lands.
    - [ ] Log `critical` findings at warn with pid, hostname, sha, and commits-behind count.
    - [ ] Restarting a stale worker is gated behind `manager.auto_heal: true`, the same opt-in as
          Phase 7 (REQ-11 says so explicitly). Absent/false → report only.

**Impact**: The worst single incident of 2026-08-30 becomes impossible to repeat *silently*: even
an undetected stale process can no longer drag a shipped track backwards, and a detected one is
named in the log with the exact commit distance.

---

## Phase 3: One folder resolver, including the skill's own (REQ-15)

**Problem**: Track 10036 fixed the *worker's* stale `tracksMetadata` cache. It did not touch the
skill's folder resolution, which is a separate code path in a separate short-lived process. A
fresh `claude -p` implement session still scaffolds a duplicate legacy `NNN-slug` folder beside
the real `INITIALS-NNN-slug` one.

The skill-side defect is findable in `SKILL.md` and is a *documentation* bug with code
consequences:
- **Protocol: Locating Tracks**, step 2 tells the agent to look for "a directory starting with the
  track number (e.g. `conductor/tracks/017-firebase-static/`)" — the legacy pattern only. A
  prefixed `AM-10040-...` folder does not start with the track number and is invisible to it.
- `/laneconductor plan` step 2 ("Scaffold if missing") says *create* `conductor/tracks/NNN-slug/` —
  the legacy convention, with no check for an existing folder under any other convention. That
  instruction **is** the duplicate factory.

**Live confirmation, from this very track**:
`conductor/tracks/_duplicate-10040-manager-stuck-track-healing/` exists right now — a duplicate of
AM-10040 itself, quarantined during its own planning. Four `_duplicate-*` folders are present in
total (10036, 10038, 10039, 10040).

- [ ] Task 1: Extract the canonical resolver into a shared module
    - [ ] New `conductor/services/track-folder.mjs`. Move the *decision* out of
          `resolveTrackFolder` (`laneconductor.sync.mjs:1396`) as a pure function:
          `decideTrackFolder({ dirNames, trackNumber, registeredFolder, registeredExists })` →
          `{ folder, quarantine: [names], metadataUpdate }`.
    - [ ] The effects (`quarantineStaleFolder`'s rename, `updateTrackMetadata`) stay in the worker,
          applied from the returned decision. This separation is what lets a **read-only** consumer
          resolve a folder without renaming anything — a CLI lookup must never mutate the tree as a
          side effect of answering a question.
    - [ ] `laneconductor.sync.mjs`'s `resolveTrackFolder` becomes a thin wrapper. Behavior must be
          byte-identical — its quarantine semantics are load-bearing (track 1119).
- [ ] Task 2: `lc track-dir <number>` — the resolver as an interface the skill can actually call
    - [ ] New subcommand in `bin/lc.mjs`: prints the resolved folder path to stdout, exit 0; exit
          non-zero with a diagnostic when nothing resolves. `--json` for
          `{ folder, matches, registered }`. Read-only: never quarantines, never writes metadata.
    - [ ] Handles both conventions and consults `conductor/tracks-metadata.json`, because it is the
          same code the worker runs.
- [ ] Task 3: Rewrite the skill's instructions to use it (REQ-15's substance)
    - [ ] **Protocol: Locating Tracks** — replace the hand-rolled scan with `lc track-dir NNN` as
          step 1, keeping the manual scan as an explicitly-labelled fallback for skill-only
          environments with no `lc` on PATH, corrected to match `INITIALS-NNN-slug` as well.
    - [ ] `/laneconductor plan` step 2 — scaffold only after `lc track-dir` reports nothing, and
          scaffold at `INITIALS-NNN-slug` (the documented convention), never `NNN-slug`.
    - [ ] **Scaffolding over an existing track number is an error, not a fallback.** If any folder
          resolves for that number under any convention, the session must use it and say so — the
          skill must never create a second folder for a number that already has one.
- [ ] Task 4: Clean up the four `_duplicate-*` folders currently on disk, after confirming each
      one's content is fully represented in its canonical sibling. (Phase 6 Task 1 fixes the
      *mechanism* that lets them hold lane slots; this is the one-time cleanup of today's set.)

**Impact**: The duplicate factory shuts down. Without this, Phase 6's cleanup is Sisyphean — every
sweep finds new duplicates manufactured since the last one.

---

## Phase 4: Invalid resting states (REQ-16, REQ-17)

**Problem**: Workers only ever claim `lane_action_status = 'queue'`. A track resting at
`<non-terminal-lane>:success` is therefore polled by nothing, escalated by nothing, and — because
`success` reads as good news — looks healthy at a glance. Three tracks are sitting in exactly this
state right now: **10038** at `implement:success` (already merged to `main` at `a897323`, dragged
backwards by Finding 6's duplicates), **1100** at `quality-gate:success`, **10039** at
`implement:success`.

This is the cheapest high-value check in the whole track: it needs **no new bookkeeping**. The
valid resting states are derivable from `workflow.json`'s own transition table, and the invalid
ones are a single query. It is also the *generic* detector that would have caught Findings 4 and 6
automatically rather than requiring a human to notice a card in the wrong column — which is why it
sits ahead of the escalation counter rather than in the sweep phase.

- [ ] Task 1: New pure module `conductor/services/resting-state.mjs`
    - [ ] `deriveValidRestingStates(workflow)` → the set of `lane:status` pairs the configured
          workflow can actually produce and leave alone. Derived, **never hardcoded** (REQ-16): for
          this project it yields `plan:success` (because `plan.on_success` is literally
          `"plan:success"`), `done:success`, `done:waiting`, and every `*:failure` /
          `*:queue` / `*:running`. A project configuring `plan.on_success: "implement:queue"`
          must get `plan:success` flagged, and this project must not.
    - [ ] `findInvalidRestingStates(tracks, validSet)` → the offenders, each with the transition
          `workflow.json` says *should* have been applied.
    - [ ] `classifyRestingState(track)` → `reapply` (the lane's work is genuinely complete — apply
          the configured `on_success` transition) vs `escalate` (ambiguous — post a ⚠️ and leave
          it). Default to `escalate`; `reapply` only when the lane's completion markers are
          present and consistent.
- [ ] Task 2: REQ-17 — the inverse corruption (merged, but the lane says otherwise)
    - [ ] `classifyMergedButNotDone({ trackNumber, mergeCommitReachable, lane })` → invalid when a
          track's merge commit is reachable from `main` but its lane ranks earlier than `done`.
          This is 10038's exact shape.
    - [ ] Reachability is **injected** (a `isReachableFromMain(sha)` probe), keeping the module
          pure and testable without a repo.
    - [ ] This state is **always** `escalate`, never auto-repaired. Re-running a merged track is
          precisely the damage (10038 was re-implemented after shipping); moving its markers
          forward to `done` without a human confirming the merge is the mirror-image mistake.
- [ ] Task 3: Wire it up — same host pattern as Phase 2 Task 5 (manager's existing interval now,
      Phase 6's `sweepStuckTracks()` once that exists)
    - [ ] Escalations post one ⚠️ comment naming the invalid state and the transition that should
          have applied, and go through Phase 2's lane-regression guard like every other write.
    - [ ] Post **at most one** comment per track per invalid state — this detector runs on every
          sweep against a state that persists by definition, so it is a 191-comment machine unless
          it is idempotent from the start. Reuse Phase 5's counter (`kind: 'invalid-resting-state'`)
          rather than inventing a second suppression mechanism.
- [ ] Task 4: Resolve the three live instances (10038, 1100, 10039) as part of this phase, each
      with a recorded decision — 10038 in particular needs its markers reconciled with the fact
      that it already merged, **by a human decision recorded in its conversation.md**, not by an
      automated forward-write.

**Impact**: The failure mode that hides best — a track that looks finished and is simply
abandoned — becomes a queryable, self-reporting condition, using configuration the project already
has.

---

## Phase 5: Count pre-spawn blocks and escalate to failure (REQ-1, 2, 3, 8, 9, 10)

*(Previously Phase 1. Unchanged in substance — the analysis was re-verified against the code and
still holds.)*

**Problem**: The two `err.workspaceGuardBlocked = true` throw sites (~4420 dirty-checkout, ~4451
main-mode-lock) fire *before* any spawn, so the exit handler's retry counter (~4920) never runs and
`max_retries_reached` structurally cannot fire. Every block reverts the track to `queue`
(`...replace(/\*\*Lane Status\*\*:\s*[^\n]+/i, '**Lane Status**: queue')`, both sites) and appends
a ⚠️ comment, forever. The flag itself is read nowhere.

**Solution**: A cause-generic, DB-persisted "pre-spawn block" counter incremented at those same two
throw sites, escalating to `**Lane Status**: failure` at a threshold. Escalation is inline in the
blocking worker — it is the only component that knows the cause, and it works in local-fs where no
manager exists (spec D1).

- [ ] Task 1: New pure module `conductor/services/prespawn-block.mjs`
    - [ ] `BLOCK_KINDS` — `dirty-checkout`, `main-mode-lock`, `phantom-running` (Phase 6),
          `invalid-resting-state` (Phase 4), plus the three reserved for
          [[AM-10039-cloud-workers-claude-cloud]] (`expired-credentials`, `github-app-missing`,
          `preflight-failed`). REQ-9: escalation keys off count + kind, never off dirty-path shape.
    - [ ] `DEFAULT_ESCALATE_AFTER = 5`, overridable via `LC_PRESPAWN_BLOCK_ESCALATE_AFTER`
    - [ ] `decidePreSpawnBlockOutcome({ kind, reason, countBefore, threshold })` →
          `{ action: 'warn' }` (countBefore === 0 — first of streak) · `{ action: 'silent' }`
          (mid-streak) · `{ action: 'escalate' }` (countBefore + 1 >= threshold). This is REQ-10:
          exactly two comments per streak, spam killed at the source rather than capped at the end.
    - [ ] `formatBlockComment(outcome)` → the ⚠️ / ❌ body, leading emoji as the literal first
          character (Completion Comment Convention).
- [ ] Task 2: DB persistence (REQ-8 — 10039's dispatcher-only mode has no local filesystem)
    - [ ] Migration `migrations/<ts>_add_track_prespawn_block.sql`:
          `ALTER TABLE tracks ADD COLUMN prespawn_block_count INTEGER NOT NULL DEFAULT 0,
          ADD COLUMN prespawn_block_kind TEXT, ADD COLUMN prespawn_block_reason TEXT,
          ADD COLUMN prespawn_blocked_at TIMESTAMPTZ`
    - [ ] Mirror the columns in `prisma/schema.prisma` and `prisma/schema.sql`
    - [ ] `ui/server/index.mjs`: `POST /track/:num/prespawn-block` (body `{ kind, reason }`;
          increments and returns `{ count, kind, reason }`) and
          `POST /track/:num/prespawn-block/reset`. Both behind `collectorAuth`, same shape as the
          existing `GET /track/:num/retry-count` (~3030).
- [ ] Task 3: Worker wiring in `spawnCli`
    - [ ] Extract the two near-identical block bodies (~4415–4435 and ~4445–4465) into one
          `handlePreSpawnBlock({ trackNumber, kind, reason, primaryIndexPath, primaryIndexContent,
          primaryTracksDir, primaryTrackDirName, label })` helper.
    - [ ] It increments the counter (API mode: the endpoint above; local-fs: sibling files
          `.prespawn-block-count` / `.prespawn-block-kind` / `.prespawn-block-lane`, exactly the
          `.retry-count` / `.retry-lane` pattern at ~4920), then applies the module's decision:
          revert to `**Lane Status**: queue` on warn/silent, or write `**Lane Status**: failure` on
          escalate, and post at most the one comment the decision calls for.
    - [ ] Keep throwing the same error with `err.workspaceGuardBlocked = true` (REQ-3 — read the
          existing flag, do not add a parallel signal) and add `err.preSpawnBlock = outcome`.
    - [ ] The escalating write goes through Phase 2's lane-regression guard like every other marker
          write. `failure` is a status change on the same lane, so it passes — but it must go
          *through* the guard, not around it.
- [ ] Task 4: Reset points — a stale counter is worse than no counter
    - [ ] On a spawn that gets past both guards: clear the counter (this is the "consecutive" in
          "consecutive blocks").
    - [ ] In the exit handler's `isSuccess` branch, alongside the existing `.retry-count` removal.
    - [ ] On lane change, via the same `.retry-lane`-style guard.
    - [ ] On human intervention — reuse the "since the last human comment" semantics the
          retry-count endpoint already implements, so a human comment or drag clears it.
- [ ] Task 5: Distinguish the block in the three `spawnCli` callers (~5860 auto-queue, ~5950
      auto-complete, ~7230 manual-dispatch) — log `workspaceGuardBlocked` as a block, not a crash.

**Impact**: The 10036 shape reaches `failure` + one ❌ within 5 cycles instead of looping. Verified
reachable: `autoLaunchLocalFs` skips any track with `lane_action_status !== 'queue'` and
`resetStuckActions` only rewrites `running` rows, so `failure` is genuinely terminal until a human
touches it. The existing `/api/inbox` rule (`ui/server/index.mjs:1048`,
`lc.author = 'system' AND (lc.body LIKE '⚠️%' OR lc.body LIKE '❌%')`) already routes it to
`needs_input` — nothing new needed there, only verification (AC-5).

---

## Phase 6: Manager sweep — phantom markers, wedged lanes, dead-cwd workers (REQ-4, 5, 6)

*(Previously Phase 2. One correction from re-checking live state — see Task 1.)*

**Problem**: Three leaks, all invisible to the pre-spawn guard.
1. `quarantineStaleFolder` (`laneconductor.sync.mjs:1383`) renames a duplicate to `_duplicate-*`
   but leaves its status markers intact, while `autoLaunchLocalFs`'s `dirs` filter
   (`readdirSync(tracksDir).filter(d => /\d+/.test(d))`, ~5574) still matches it — `_duplicate-`
   names contain the track number's digits, so the filter passes them. A quarantined folder frozen
   at `running` therefore burns a lane slot permanently, and
   `alreadyRunning = Math.max(fromFiles, internalRunning)` (~5739) means the filesystem phantom
   always beats correct in-process state. The same unfiltered scan appears at ~2774 and ~5543.
2. Nothing reconciles a filesystem `running` marker left by a process that died.
3. `reapOrphanedWorkerProcesses` (~6340) defines "orphan" as *unregistered*, so the real zombie
   (PID 1736711, ~17% CPU for 2 days against a deleted cwd) was invisible — it had registered. It
   also only ever sends `SIGTERM` (~6366); two of the 24 leaked workers ignored it.

- [ ] Task 1: Quarantined folders can never hold a lane slot (REQ-4 — both belts)
    - [ ] Exclude `_duplicate-*` from the `dirs` filter at ~5574 **and** the
          `currentlyRunningPerLane` pre-pass at ~5578–5597, plus the sibling scans at ~2774 and
          ~5543. (Note `isWorkerBookkeepingPath` already exempts `_duplicate-*` from the
          *dirty-checkout* guard — the concurrency counter is a different scan that was missed.)
    - [ ] In `quarantineStaleFolder`, rewrite the renamed folder's `**Lane Status**: running` →
          `quarantined` so no future scan can resurrect the phantom either.
    - [ ] **Correction to the previous plan**: the four `_duplicate-*` folders on disk right now
          read `implement:queue` / `plan:success` — *not* `running`. The specific live wedge that
          plan cited has since cleared. The defect is unchanged and unfixed; do not go looking for
          an active `Lane "implement" at limit 2 (Running: 3)` to reproduce against. Build the
          fixture (TC-24) rather than waiting for the symptom to recur.
- [ ] Task 2: New pure module `conductor/services/stuck-track-sweep.mjs`
    - [ ] `findPhantomRunningTracks({ fsRunning, livePids, runMarkers, dbClaims, graceMs })` →
          tracks marked `running` on disk with no live agent pid, no live run marker
          (`conductor/services/run-marker.mjs`'s `isRunMarkerLive`), no live DB claim, and older
          than the grace window.
    - [ ] `classifyPhantom(track)` → `reconcile` (first sighting → reset to `queue`) vs `escalate`
          (repeat offender → `failure`, via Phase 5's counter with `kind: 'phantom-running'`).
    - [ ] Reconciliation writes go through Phase 2's lane-regression guard — a sweep resetting
          `running` → `queue` on the same lane passes it, and must not be allowed to bypass it.
- [ ] Task 3: `sweepStuckTracks()` in `laneconductor.sync.mjs`, gated on `isManager`, on its own
      interval (default 5 min, `LC_STUCK_SWEEP_INTERVAL_MS`), with an in-flight guard matching
      `orphanReconcileInFlight`. Cross-project: enumerate projects from the collector, read each
      one's `repo_path`/`conductor/tracks/`. This is also the permanent host for Phase 2 Task 5's
      staleness report and Phase 4 Task 3's resting-state check — move both in here.
- [ ] Task 4: Widen orphan-worker detection (REQ-6) in
      `conductor/services/orphan-worker-detection.mjs`
    - [ ] `findOrphanedWorkerProcesses(rows, { registeredPids, selfPid, graceMs })` becomes
          `(rows, { registeredWorkers, selfPid, graceMs, staleHeartbeatMs, cwdExists })` — taking
          registered workers as `{ pid, last_heartbeat }` plus an injected `cwdExists(pid)` probe
          (`readlink /proc/<pid>/cwd` → the ` (deleted)` suffix) rather than a bare pid Set.
    - [ ] Reap when: unregistered (today's rule, unchanged), **or** registered with a deleted cwd,
          **or** registered with a heartbeat older than `staleHeartbeatMs`. Keep the `graceMs`
          young-process guard and the never-reap-self rule on **every** branch.
    - [ ] Escalate `SIGTERM` → `SIGKILL` after a grace period at the kill site (~6366): two of the
          live zombies ignored `SIGTERM` outright. Log each escalation.
    - [ ] Keep the module pure — the `/proc` probe is injected, so it stays unit-testable.
- [ ] Task 5: Verify the escalation actually reaches a human — drive a real `/api/inbox` response
      and confirm the escalated track lands in `needs_input` (AC-5; do not settle for a unit
      assertion on the SQL `CASE`).

**Impact**: A lane can no longer be wedged by a folder nobody is working in, a dead run no longer
holds a slot forever, and a registered-but-useless worker gets reaped — with a `SIGKILL` for the
ones that ignore the polite request.

---

## Phase 7: Known-safe auto-heal, propose-by-default (REQ-7)

*(Previously Phase 3, unchanged.)*

**Problem**: The 10036 root cause — `ui/node_modules` committed as a symlink, then ignored, so
`git status` reports `D ui/node_modules` permanently — is trivially fixable and provably junk, but
currently needs a human to notice a ❌ comment first.

- [ ] Task 1: New pure module `conductor/services/dirty-path-heal.mjs`
    - [ ] `classifyHealableDirtyPath({ path, porcelainStatus, isGitIgnored })` →
          `{ healable, remedy, reason }`. Healable **only** when all three hold: status is
          deleted-from-worktree (`D`), the path is currently git-ignored, and its basename is on the
          closed allowlist (`node_modules`, `dist`, `build`, `out`, `.next`, `coverage`, `.venv`,
          `__pycache__`, `.turbo`). Anything else → `healable: false`, escalate only.
    - [ ] The only remedy ever emitted is `git rm -r --cached <path>` — index-only. Never a
          filesystem delete, never a content edit.
- [ ] Task 2: Propose path (default). Phase 5's ❌ escalation comment includes the exact remedy
      command when a healable path is found; the git index is left untouched.
- [ ] Task 3: Apply path (opt-in). `manager.auto_heal: true` in `.laneconductor.json` lets the
      manager run the remedy: take the global main-mode lock first
      (`checkAndClaimGlobalMainModeLock`, `laneconductor.sync.mjs:3841`), run it, commit
      `fix(manager): untrack ignored build output <path>`, release (`releaseGlobalMainModeLock`,
      :3881), and post a ✅ comment naming what it did. Absent/false → propose only. The same flag
      gates Phase 2 Task 5's worker restart.
- [ ] Task 4: Full regression suite across all seven phases — see `test.md`.

**Impact**: The single most common permanent cause self-heals once a human opts in, and every other
cause still escalates to a person rather than spinning.

---

## Notes / Risks

- **Phase 2's guard is a dependency of Phases 4, 5 and 6**, not merely adjacent: all three write
  status markers, and all three must route through it rather than around it. Land Phase 2 Tasks
  1–2 before any of them.
- **Phases 3, 4 and 5 are otherwise order-independent.** Phase 3 removes the most common *cause* of
  a dirty checkout; Phase 4 is the cheapest detector; Phase 5 is the safety net for whatever causes
  remain. Cause-removal and cheap-detection are placed ahead of the net (spec D7), but swapping
  costs nothing.
- **Phase 4 and Phase 6 share a host.** Both want `sweepStuckTracks()`. Phase 4 ships first and
  runs on the manager's existing reap interval; Phase 6 Task 3 builds the real sweep and adopts it.
  If the phases land close together, build the sweep once in Phase 4 and let Phase 6 extend it.
- **Idempotence is a first-class requirement for every detector here, not a polish item.** Phase 4
  and Phase 6 both run repeatedly against states that persist by definition. Any of them will
  reproduce the 191-comment incident if it posts unconditionally. Route every one through Phase 5's
  counter.
- **`_duplicate-*` folders will keep reappearing until Phase 3 lands** — including for this track.
  Do not treat a fresh one as evidence that Phase 3 regressed; check whether the session that
  created it predates the fix.
- **This track is itself blocked by the bugs it fixes.** Its own plan runs were blocked by dirty
  paths from 10036 and 10039, and it has already grown its own `_duplicate-` folder. Expect
  implement to hit the same guards; that is a live test, not an obstacle to route around.
- **Reserved-kind coupling with [[AM-10039-cloud-workers-claude-cloud]]**: 10039 consumes Phase 5's
  counter rather than rebuilding it. The DB columns and the `kind` discriminator (REQ-8/REQ-9) are
  the contract — do not make the schema or the escalation logic dirty-checkout-specific.
- **Ordering with [[10036-fix-stale-tracks-metadata-cache-in-resolvetrackfolder]]**: 10036 fixed
  the *worker-side* stale cache (`fa85a9c`). Finding 6 / Phase 3 is the *skill-side* instance of the
  same class and is explicitly in scope here.
- **Threshold choice (Phase 5).** 5 blocks at a ~2-minute auto-launch cadence is roughly 10 minutes
  of transient dirtiness tolerated before escalation. The 30s in-guard settle window
  (`DIRTY_RETRY_MAX_MS`) already absorbs sub-minute flapping, so 5 is deliberately generous.
- **Migration count.** Two migrations land in this track (`workers.code_sha` in Phase 2,
  `tracks.prespawn_block_*` in Phase 5). Keep them separate — they are independently revertable and
  belong to different phases.
