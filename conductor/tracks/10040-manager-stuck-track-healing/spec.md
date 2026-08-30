# Spec: Manager Stuck-Track Healing

## Problem Statement

Stuck-track *detection* exists and works; stuck-track *repair* does not. Tracks wedge in states
no automated component can escape, and nothing escalates them to a human either — they just spin
invisibly. Three distinct failure modes were confirmed live on 2026-08-30 (tracks 10036 and
10040 themselves), all documented below.

The manager worker (track 1091) is the natural owner: it's the machine-level singleton with
cross-project scope. Today its *entire* self-healing repertoire is one function —
`reapOrphanedWorkerProcesses` (`laneconductor.sync.mjs`, track 1091 Phase 7), which kills
**unregistered** `laneconductor.sync.mjs` processes older than 30 minutes. Nothing about stuck
tracks, phantom markers, duplicate folders, or dirty checkouts exists in its code.

## Finding 1 — Permanent workspace-guard blocks never escalate

`workspace: main` lane actions check the primary checkout is clean before spawning. On a
*permanently* dirty checkout the guard blocks every cycle forever:

1. `resetStuckActions` (every worker, every 2 min → `POST /tracks/reset-stuck-actions`) resets a
   stale `running` row to `queue` + `lane_action_result: stuck_timeout`. Detection works.
2. `Auto Run: yes` → worker re-claims → `running` → guard blocks before spawn
   (`laneconductor.sync.mjs` ~4380) → reverts to `queue` → appends a ⚠️ comment.
3. Repeat forever. **Track 10036 accumulated 191 such comments** over a `ui/node_modules`
   symlink that was committed to git before being ignored, so `git status` reported
   `D ui/node_modules` permanently. No human-visible failure state was ever reached.

Why it can't self-escalate:
- Retry counting lives in the spawned process's **exit handler** (~line 4879). The guard throws
  **before** any spawn, so no failure is counted and `max_retries_reached` can never fire.
- The guard tags its error `err.workspaceGuardBlocked = true` — **that flag is never read
  anywhere in the codebase**. Dead code.

## Finding 2 — Quarantined duplicate folders embalm phantom `running` markers

`quarantineStaleFolder` (`laneconductor.sync.mjs:1366`) renames an ambiguous duplicate track
folder to `_duplicate-<name>` so folder *resolution* can never match it again. It does **not**
delete the folder or clear its status markers.

But the lane concurrency counter (`laneconductor.sync.mjs:5541-5560`) scans **every** directory
under `conductor/tracks/` — `_duplicate-*` included — and counts any `**Lane Status**: running`
it finds toward that lane's `parallel_limit`. Quarantining a folder mid-"run" therefore
**permanently** burns a parallel-limit slot.

Confirmed live: `_duplicate-10039-cloud-workers-claude-cloud/` (`implement: running`) and
`_duplicate-10038-...` (`review: running`) held phantom slots while the DB had **zero** implement
tracks running and the worker had no agent child processes. Result:
`[local-fs] Lane "implement" at limit 2 (Running: 3, Claimed: 0). Skipping 10036-...` — track
10036's implement could never be claimed.

Note the counter reads `Math.max(fromFiles, internalRunning)`, so a filesystem phantom always
wins over correct in-process state.

## Finding 3 — Long-lived workers manufacture the duplicates (root cause chain)

The duplicates in Finding 2 come from track 10036's own bug: `tracksMetadata` is cached once per
worker process and never invalidated, so a worker older than a track can't resolve its folder,
and the implement skill scaffolds a duplicate legacy `NNN-slug` folder beside the real
`INITIALS-NNN-slug` one. The manager process (alive since 2026-08-27) and worker-2 (2026-08-28)
both predate every 100xx track from that week and were actively producing duplicates.

Those untracked duplicate folders then dirty the primary checkout, which re-triggers Finding 1
for *other* tracks — 10040's own plan run was blocked by
`conductor/tracks/10036-.../, conductor/tracks/10039-.../`. The three findings compound.

Also worth noting: `reapOrphanedWorkerProcesses` did **not** catch a real zombie worker found the
same day (PID 1736711, ~17% CPU for 2 days against a deleted cwd) because that process had
registered itself in the workers table at startup. Registered-but-useless is invisible to the
sweep's orphan definition.

## Finding 4 — A fix on disk is not a fix in production (stale in-memory code)

Confirmed live 2026-08-30, and the single most damaging pattern of the day. Worker 1
(PID 3040379) started at 10:01. The `tracksMetadata` fix (`fa85a9c`) was committed at 17:02 —
**7 hours later**. Node had long since loaded the old module into memory, and editing the file on
disk does nothing for a running process. So for 7 hours a worker kept manufacturing duplicate
folders using code that had already been fixed, and every "did we fix it?" check against the
source said yes.

The damage was not limited to new tracks. In its final cycles before being killed, worker 1
overwrote track 10036's **own canonical `index.md`** from `done:queue` back to
`implement:success`, regenerated two duplicate folders for it, and caused a correctly-coded
worker to spawn a redundant `/laneconductor implement 10036` on an already-merged feature. A
track that had genuinely shipped was dragged backwards through the pipeline by a stale process.

There is no mechanism anywhere that detects "this running process is older than the code it
claims to run." Every recovery today was a human noticing and restarting by hand.

## Finding 5 — `done` became an active lane without updating every consumer

Track 10035 made `done` a real, claimable lane action (the merge step). The worker's poll loop was
updated. Two SQL consumers were not:

- `POST /tracks/claim-queue` (`ui/server/index.mjs:2918`) filtered
  `lane_status IN ('plan','implement','review','quality-gate')` — no `'done'`. **Every** claim
  attempt on a `done:queue` track returned zero rows, forever, for every worker. Callers logged
  it as `lost the DB claim race` (`laneconductor.sync.mjs:5820`), which read as transient
  contention but was a permanent silent exclusion. Tracks 10036, 10020 and 10026 all sat
  unclaimable at `done:queue`; 10036 was stuck ~20 minutes with two idle workers polling it.
  Fixed 2026-08-30 in `bede5ab` — but the *class* of bug is what matters here.
- The comment webhook (`ui/server/index.mjs:3219`) has the identical omission: a human comment on
  a `done`-lane track does not re-wake the worker. **Still unfixed.**

The lesson generalizes past these two call sites: lane-name lists are duplicated across the
worker and the API with no shared definition, so adding a lane silently half-lands.

## Finding 6 — Folder-duplication is not solely the worker's stale cache

After worker 1 was killed and only correctly-coded workers remained, a fresh
`/laneconductor implement 10036` session **still** scaffolded duplicate legacy `NNN-slug`
folders. The short-lived `claude -p` skill session performs its own folder resolution,
independent of the long-lived worker's `tracksMetadata` cache that 10036 fixed. 10036 closed one
instance of "cannot resolve the real folder"; the skill-side path is a separate, still-open
instance of the same class. Any duplicate-cleanup work here will keep finding new duplicates
until that path is fixed too.

## Finding 7 — `<non-terminal-lane>:success` is an unreachable resting state

Workers only ever claim `lane_action_status = 'queue'`. So the moment a track lands in a
non-terminal lane with status `success`, nothing polls it, nothing escalates it, and it sits
there indefinitely with no error and no Inbox entry — indistinguishable at a glance from healthy
completed work, because `success` reads as good news.

Per `workflow.json`, the only legitimate `*:success` resting states are `done:success` (shipped)
and `plan:success` (this project deliberately sets `plan.on_success: "plan:success"`, meaning
"planned, awaiting a human to start implement"). Every other combination is unreachable-by-design:
`implement.on_success` is `review:queue`, `review.on_success` is `quality-gate:queue`,
`quality-gate.on_success` is `done:queue`.

Found live 2026-08-30 by querying for the shape:

- **10038** at `implement:success` — had already *merged to main* (`a897323`) hours earlier and
  been dragged backwards by Finding 6's duplicate folders. It would have sat there forever.
- **1100** at `quality-gate:success` (90%) — stranded, age unknown.
- **10039** at `implement:success` (15%) — stranded (this one is not Auto Run, so a human was
  expected to move it, but the resting state is still not one the workflow can produce).

This is the detection rule that would have caught Findings 4 and 6 automatically instead of
requiring a human to notice a card sitting in the wrong column: the invalid resting state is
trivially queryable, and it is a *derived* check — it needs no new bookkeeping, just a comparison
against `workflow.json`'s own transition table.

## Requirements

- REQ-1: Count consecutive workspace-guard blocks per track (persisted; e.g. a
  `.guard-block-count` sibling to the existing `.retry-count`), reset on any successful spawn or
  human intervention. The blocking guard increments it.
- REQ-2: After N consecutive blocks (default ~5), set `lane_action_status: failure` and post a
  single `❌` comment naming the persistent root cause (the disqualifying dirty paths), so it
  reaches the Inbox's "Needs your input". Stop appending per-cycle ⚠️ spam once escalated.
- REQ-3: Read the `workspaceGuardBlocked` flag that already exists, rather than adding a parallel
  signal.
- REQ-4: Exclude `_duplicate-*` folders from the lane concurrency counter — and/or clear their
  status markers at quarantine time, so a quarantined folder can never hold a parallel-limit
  slot. Quarantine must not be able to embalm a `running` marker.
- REQ-5: Manager sweep detects phantom `running` markers generally: a track marked `running` in
  the filesystem with no corresponding agent process and no live DB claim is reconciled (reset to
  `queue`) or escalated, not left to wedge a lane.
- REQ-6: Widen orphan-worker detection beyond "unregistered": a registered worker whose cwd no
  longer exists, or whose heartbeat is long dead, should also be reaped.
- REQ-7: Where a dirty path is provably junk (e.g. a tracked-but-deleted ignorable build output),
  the manager may propose or apply the fix. Exact safety boundary decided in planning — anything
  ambiguous escalates only, never auto-fixes.
- REQ-8 (added in planning, from [[AM-10039-cloud-workers-claude-cloud]]'s cross-track note): the
  block counter and escalation state are persisted in the **database** (`tracks` columns), not
  only as filesystem sibling files. 10039's dispatcher-only mode has no local `conductor/tracks/`
  to hold a `.guard-block-count`, so a file-only design would force it to rebuild the mechanism.
  Local-fs mode still writes sibling files — it has no DB — but the DB is the canonical store
  wherever one exists.
- REQ-9 (added in planning): the counter is **cause-generic**, not dirty-checkout-specific. Every
  record carries a `kind` discriminator (`dirty-checkout`, `main-mode-lock`, and, reserved for
  10039, `expired-credentials` / `github-app-missing` / `preflight-failed`). Escalation logic
  keys off count + kind, never off the dirty-path shape, so 10039 reuses it by passing a new
  `kind`.
- REQ-10 (added in planning): the ⚠️ spam is fixed at the source, not merely capped at escalation.
  A ⚠️ comment is posted only on the **first** block of a streak; blocks 2..N−1 are logged only;
  block N posts the single ❌. A permanent block therefore produces exactly two comments total
  (one ⚠️, one ❌) rather than 191.
- REQ-11 (Finding 4): every worker records the git commit SHA of the code it loaded at startup
  (`workers.code_sha`, captured once at boot). The manager sweep compares each registered
  worker's `code_sha` against ~~the repo's current `HEAD` for its project~~ **the LaneConductor
  install directory's current `HEAD`** and flags — or, behind the same `manager.auto_heal` gate
  as REQ-7, restarts — any worker running code older than N commits or older than a fix that
  touched files it depends on. A stale worker is a *correctness* hazard, not just a staleness
  annoyance: worker 1 rewrote a shipped track's canonical `index.md` backwards.

  > **Corrected in planning, accepted 2026-08-30 — do not re-derive this.** The struck-through
  > original ("the repo's current `HEAD` for its project") was wrong, and wrong in a way that
  > made the requirement *unimplementable for the very worker type that owns this feature*.
  > Staleness is a property of the **installed worker code**, not of any managed project's repo:
  > a worker's code lives at the LaneConductor install path (`~/.laneconductorrc`) while the
  > projects it manages are separate repos with no necessary relationship to it, and the manager
  > worker registers with `project_id: null` and has **no project repo at all**. A worker whose
  > managed project has advanced but whose install dir has not is **not** stale, and must not be
  > flagged. See D5 for the capture-once-at-boot rule that goes with this.
- REQ-12 (Finding 4): a worker must never write a track's `**Lane**`/`**Lane Status**` backwards
  past a terminal state it did not itself produce. Concretely: a process may not move a track out
  of `done` (or from a later lane to an earlier one) based solely on its own in-memory view — it
  must re-read the current marker first and no-op if the on-disk state is ahead of what it
  expects. This is a last line of defence that would have contained Finding 4's damage even with
  stale code running.
- REQ-13 (Finding 5): the set of claimable/active lanes is defined **once**, in one shared module
  imported by both the worker and the API, replacing every duplicated
  `lane_status IN ('plan','implement','review','quality-gate'[,'done'])` literal. Adding a lane
  must be a one-line change that cannot half-land. Includes fixing the still-broken comment
  webhook (`ui/server/index.mjs:3219`).

  > **Clarified in planning, accepted 2026-08-30.** The shared module already exists:
  > `conductor/constants.mjs` exports `Lanes`/`LaneActionStatus`, is already imported by the
  > worker (`laneconductor.sync.mjs:15`), and `ui/server/index.mjs` already imports from
  > `../../conductor/*.mjs` (lines 19–22). **This does not make the requirement smaller.** The
  > requirement is *"the list cannot drift"*, not *"create a module"* — so the substance is
  > parameterizing the SQL (`= ANY($n)` bound to the constant) instead of hand-typing an
  > `IN (...)` literal that can silently fall out of sync, which is exactly how `done` went
  > missing. AC-13's repo-wide grep stays: it is what proves no hardcoded literal survived.
- REQ-14 (Finding 5): a claim attempt that returns zero rows must be distinguishable from a lost
  race. `claim-queue` returns *why* nothing was claimed (`already_claimed` vs
  `lane_not_claimable` vs `no_candidates`), and the worker logs that reason verbatim. The current
  message asserts a cause it never verified, which is what disguised a permanent bug as transient
  contention for hours.
- REQ-15 (Finding 6): the implement skill's own folder resolution uses the same canonical
  resolver as the worker (single implementation, not a parallel one), so a skill session cannot
  scaffold a duplicate folder for a track that already exists under the `INITIALS-NNN-slug`
  convention. Scaffolding a new track folder when a folder for that track number already exists
  in any naming convention is an error, not a fallback.
- REQ-16 (Finding 7): the manager sweep detects tracks resting in a state `workflow.json` cannot
  produce — `lane_action_status = 'success'` in a lane whose `on_success` moves elsewhere — and
  either re-applies the configured transition (when the lane's work is genuinely complete) or
  escalates. The valid-resting-state set is *derived from `workflow.json`*, never hardcoded, so a
  project that configures `plan.on_success: "plan:success"` does not get its planned tracks
  falsely flagged.
- REQ-17 (Finding 7): the same rule catches the inverse corruption — a track whose lane markers
  were moved *backwards* past a merge that already happened. If a track's merge commit is
  reachable from `main` but its lane is earlier than `done`, that is an invalid state and must be
  reported, not silently re-run. (10038 was re-implemented after it had already shipped.)

## Design Decisions (resolved in planning)

- **D1 — Who escalates.** Both, splitting by what each can see. The *blocking worker* escalates
  inline at block time (Phase 1): it is the only component that knows the cause, it works in
  local-fs where no manager exists, and it has no sweep latency. The *manager sweep* (Phase 2)
  handles what the guard structurally cannot see — phantom `running` markers left by a process
  that died, quarantined folders holding lane slots, and dead-cwd workers. The shared
  classification/threshold logic lives in one pure module used by both, so the two paths can
  never disagree.
- **D2 — Escalation terminal state.** `**Lane Status**: failure` on the track's own lane (not a
  lane change). Verified this genuinely stops the loop: `autoLaunchLocalFs` skips any track whose
  `lane_action_status !== 'queue'` (`laneconductor.sync.mjs:5703`), and `resetStuckActions` only
  rewrites `running` rows, so nothing re-queues it. Any human intervention (comment, drag) clears
  it via the existing retry-reset path.
- **D3 — Phase 3 auto-heal safety boundary.** A dirty path is healable **only** when all three
  hold: (a) `git status --porcelain` reports it deleted-from-worktree (`D`), (b) `git check-ignore`
  confirms it is currently git-ignored, and (c) its basename is on a closed allowlist of build
  output (`node_modules`, `dist`, `build`, `out`, `.next`, `coverage`, `.venv`, `__pycache__`,
  `.turbo`). The only permitted remedy is `git rm -r --cached <path>` — index-only. Never a
  filesystem delete, never a content edit, never a path failing any of (a)–(c).
- **D4 — Propose before apply.** Default behavior is **propose**: the ❌ escalation comment
  includes the exact remedy command for a human to run. Applying it automatically requires an
  explicit `manager.auto_heal: true` opt-in in `.laneconductor.json`; when enabled the manager
  takes the global main-mode lock before touching the index and commits the change. A tool that
  wedges tracks should not earn unattended write access to `main` on the same release that fixes
  the wedging.
- **D5 — `code_sha` is the *install dir's* HEAD, not the managed project's.** REQ-11 says "the
  repo's current `HEAD` for its project"; that is wrong for the common case. A worker's **code**
  lives at the LaneConductor install path (`~/.laneconductorrc`), while the projects it manages
  are separate repos that may have no relationship to it at all — the manager worker registers
  with `project_id: null` and has no project repo whatsoever. Staleness is therefore always
  measured against the install dir's `HEAD`. Captured **once** at module load into a
  module-level const and sent only on `/worker/register`, never refreshed on the heartbeat: a
  value that updates itself defeats the entire purpose, which is to record what this process
  actually loaded into memory.
- **D6 — Containment before detection (Phase 2 internal ordering).** REQ-12's write guard lands
  before REQ-11's staleness detection. The guard is a pure invariant that holds against stale
  code, third-party processes, and races alike, including every case detection misses; detection
  only raises an alarm a human still has to act on. Cheaper, stronger, and it would have
  contained the live incident on its own.
- **D7 — Cause-removal before safety-net (Phase 3 before Phase 4).** Finding 6's duplicate
  factory is generating duplicates *now* (one for this very track), and those untracked folders
  are themselves a leading cause of the dirty checkouts Finding 1 escalates on. Fixing the
  factory shrinks the problem Phase 4 nets. The two phases are technically independent and may
  be swapped without cost.
- **D8 — `claim-queue`'s reason set gained a fourth value.** REQ-14 names three
  (`already_claimed`, `lane_not_claimable`, `no_candidates`); planning added `not_permitted` for
  a row that exists and is queued in a claimable lane but was excluded by the visibility /
  `worker_permissions` filter. Without it that case reports `no_candidates`, which is exactly
  the "asserting a cause it never verified" failure REQ-14 exists to end. The diagnostic query
  runs only for **targeted** claims (`track_number` present) — an untargeted claim returning
  zero rows is normal idle polling, and a second query on every idle beat of every worker is
  real cost for no signal.
- **D9 — Finding 7's inverse case (REQ-17) escalates only; it is never auto-repaired.** A track
  whose merge commit is reachable from `main` while its markers read an earlier lane is
  *corrupt*, and both available repairs are wrong to automate: re-running it repeats exactly the
  damage (10038 was re-implemented after it had already shipped), and writing its markers
  forward to `done` asserts a merge nobody verified. REQ-16's forward case may `reapply` the
  configured transition when the lane's completion markers are present and consistent; REQ-17's
  case always stops at a ⚠️ for a human.
- **D10 — Every detector must be idempotent from its first commit, not as a follow-up.** Finding
  7's check, the phantom-marker check, and the resting-state check all run on an interval against
  states that persist *by definition* — an unconditional comment from any of them reproduces the
  191-comment incident this track exists to end, in a new place. All of them route through
  REQ-1's counter (with their own `kind`) rather than inventing per-detector suppression.

## Acceptance Criteria

- [ ] AC-1: A permanently-dirty checkout drives a track to `lane_action_status: failure` with one
      ❌ comment within N cycles — reproduced against the 10036 shape — instead of looping.
- [ ] AC-2: A `_duplicate-*` folder containing `**Lane Status**: running` does not consume a
      parallel-limit slot; a track queued in that lane is still claimed.
- [ ] AC-3: A phantom filesystem `running` marker with no agent process and no DB claim is
      reconciled by the manager sweep within one sweep interval.
- [ ] AC-4: A registered worker process whose cwd is deleted is reaped (Finding 3's zombie case).
- [ ] AC-5: Escalated tracks appear in the Inbox's "Needs your input" bucket, verified against a
      real `/api/inbox` response, not just a unit assertion.
- [ ] AC-6: A permanently-blocked track produces exactly **two** system comments across the whole
      streak (one ⚠️ at the first block, one ❌ at escalation) — counted from a real
      `conversation.md` after N+2 auto-launch cycles, not asserted from the formatting function.
- [ ] AC-7: The block counter survives a worker process restart and is readable without the
      filesystem — after escalation, `GET /track/:num` (or the tracks row) reports the recorded
      count, kind, and reason, so 10039's dispatcher-only mode can consume it.
- [ ] AC-8: A transient block does **not** escalate: a checkout that is dirty for the first block
      and clean by the next cycle spawns normally, and the recorded count is back to 0 afterwards.
- [ ] AC-9: With `manager.auto_heal` unset, a healable `D ui/node_modules` path is only *proposed*
      — the ❌ comment names `git rm -r --cached ui/node_modules` and the git index is verifiably
      unchanged. With it enabled, the same scenario ends with the path untracked, the checkout
      clean, and the previously-stuck track spawning on the next cycle.
- [ ] AC-10 (Finding 4): a worker started before a commit that touches its own source is detected
      as stale — `workers.code_sha` differs from `HEAD` — and surfaced by the manager sweep.
      Verified against a real worker process, not a fabricated row.
- [ ] AC-11 (Finding 4): a stale process cannot drag a shipped track backwards. Reproduce the live
      incident: with a track at `done:queue`, have a process holding an older in-memory view
      attempt to write `implement:success` to its `index.md`; the write must no-op and log, and
      the track must remain at `done:queue`.
- [ ] AC-12 (Finding 5): a `done:queue` track is claimable — `POST /tracks/claim-queue` returns it
      and the merge action actually spawns. Regression guard for `bede5ab`; must fail against the
      pre-fix filter.
- [ ] AC-13 (Finding 5): every lane list is sourced from the single shared definition — grep the
      repo for a hardcoded `'plan', 'implement', 'review', 'quality-gate'` literal in a SQL or
      claim path and find none. A human comment on a `done`-lane track re-wakes the worker.
- [ ] AC-14 (Finding 5): a zero-row claim reports a specific reason (`already_claimed` /
      `lane_not_claimable` / `no_candidates`), and the worker logs that reason rather than
      asserting "lost the claim race".
- [ ] AC-15 (Finding 6): an implement skill session for a track that already has an
      `INITIALS-NNN-slug` folder does not create an `NNN-slug` duplicate. Run the real skill path
      against a fixture with an existing prefixed folder and assert exactly one folder exists
      afterwards.

## Out of Scope

- Fixing the stale `tracksMetadata` cache itself — that is track 10036's job (shipped as
  `fa85a9c`). This track handles the *consequences* (duplicates, phantom markers, wedged lanes)
  and the escalation path. Note Finding 6 is **not** covered by 10036 and is in scope here.

- [ ] AC-16 (Finding 7): a query for tracks in an invalid resting state (`lane_action_status
      = 'success'` in a lane whose `on_success` targets a different lane) returns 10038's and
      1100's shapes against a seeded fixture, and returns **zero** false positives for
      `plan:success` under this project's own `workflow.json`.
- [ ] AC-17 (Finding 7): a track whose merge commit is reachable from `main` but whose lane is
      earlier than `done` is reported as invalid — reproduced with 10038's exact shape (merged at
      `a897323`, markers reading `implement:success`).

## Live Incident Log (2026-08-30)

The session that produced Findings 4–6, for whoever implements this. Every item was diagnosed
from live state, not theory:

| Symptom | Real cause | Status |
|---|---|---|
| 10036 wedged 2 days, 191 ⚠️ comments | `ui/node_modules` committed as a symlink → permanently dirty checkout → guard blocked every spawn, never escalated | root cause fixed; escalation is REQ-1/2 |
| implement lane "at limit 2" with 0 running | `_duplicate-*` folders' embalmed `running` markers ate parallel slots | REQ-4 |
| 24 workers, ~47% CPU | leaked test-harness workers; 2 ignored SIGTERM and needed SIGKILL | REQ-6 (+ reaper must escalate to SIGKILL) |
| 10036 `done:queue` unclaimable for 20 min with 2 idle workers | `claim-queue` SQL omitted `'done'` | fixed `bede5ab`; REQ-13/14 |
| shipped track 10036 dragged back to `implement` | worker 1 running 7-hour-old in-memory code | REQ-11/12 |
| duplicates regenerated *after* the cache fix | skill-side folder resolution is a separate code path | REQ-15 |
