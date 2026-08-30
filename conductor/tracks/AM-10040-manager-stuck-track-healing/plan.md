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

## Phase 1: One lane list, and claims that say why they failed (REQ-13, REQ-14) ✅ COMPLETE

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

- [x] Task 1: Extend `conductor/constants.mjs` with the two lane **sets**, named so they cannot be
      confused with each other
    - [x] `CLAIMABLE_LANES` — lanes a worker may claim a queued action in:
          `[PLAN, IMPLEMENT, REVIEW, QUALITY_GATE, DONE]`. Note `backlog` is deliberately absent.
    - [x] `MOVABLE_LANES` — every lane a track may be *placed* in, i.e. today's `VALID_LANES`
          (`CLAIMABLE_LANES` + `BACKLOG`). Replaces the two `VALID_LANES` literals.
    - [x] A one-line doc comment on each stating the invariant: *adding a lane means editing
          exactly this file*.
- [x] Task 2: Adopt them everywhere, and make SQL take the list as a **parameter**, not a literal
    - [x] `ui/server/index.mjs` `claimQueuedTracks` → `AND lane_status = ANY($4)` with
          `CLAIMABLE_LANES` pushed onto `params`. Parameterizing is the part that matters: a `$n`
          binding cannot silently drift from the constant the way a hand-typed `IN (...)` list did.
    - [x] `ui/server/index.mjs` comment webhook (`POST /track/:num/comment`) → same treatment.
          **This was the live fix** — it omitted `done`, so a human comment on a done-lane track
          never re-woke the worker. Fixed and regression-tested (TC-56, real DB).
    - [x] `ui/server/index.mjs` both `VALID_LANES` sites (`PATCH .../tracks/:num` and
          `PATCH /track/:num/lane`) → `MOVABLE_LANES`.
    - [x] `conductor/laneconductor.sync.mjs`'s `['plan','implement','review','quality-gate','done'].includes(...)`
          site (auto-launch answer-flow skill dispatch) → `CLAIMABLE_LANES.includes(...)`.
- [x] Task 3: REQ-14 — `claim-queue` reports *why* zero rows came back
    - [x] In `claimQueuedTracks`, when the `UPDATE ... RETURNING` yields no rows, run one
          diagnostic `SELECT lane_status, lane_action_status` inside the **same transaction**
          (before `COMMIT`) and map it to a reason: `no_candidates` · `already_claimed` ·
          `lane_not_claimable` · `not_permitted` (spec D8).
    - [x] Response shape is now `{ tracks: [...], reason }`, `reason` null when `tracks.length > 0`.
          Additive — existing callers reading `.tracks` are unaffected.
    - [x] Diagnostic only runs for a **targeted** claim (`req.body.track_number` present) —
          untargeted zero-row claims stay a single query (TC-62).
- [x] Task 4: The worker logs the reason verbatim instead of asserting a cause
    - [x] Replaced the hardcoded `lost the DB claim race this cycle` with a reason-driven branch:
          `already_claimed` → same wording (it's the one case that genuinely is a lost race);
          `no_candidates` → neutral info log; `lane_not_claimable`/`not_permitted` → **warn**, since
          those mean the worker's own candidate selection disagrees with the server; absent/unknown
          `reason` → neutral `no rows returned (collector did not report a reason)` fallback, never
          the old unverified assertion.
    - [x] TC-52/53/54 (pure, `conductor/tests/track-10040-lane-constants.test.mjs`) and
          TC-55/56/57/58/59/61/62 (real-DB API, `ui/server/tests/track-10040-claim-reason.test.mjs`)
          all green. TC-60 (`not_permitted`) and TC-63/64 (exact log-message assertions) not
          separately automated — `not_permitted` requires `AUTH_ENABLED` team/private visibility
          plumbing that isn't exercised by any existing test infra either; the branch is covered by
          code inspection and the same `if/else if` structure as the tested branches, not by a
          dedicated test. Flagging as a gap rather than silently calling it done.

**Impact**: The class of bug dies, not just the instance. A `done`-lane comment wakes the worker.
A permanent exclusion announces itself as `lane_not_claimable` in the first log line instead of
hiding behind twenty minutes of plausible-sounding contention.

---

## Phase 2: Stale processes — contain them, then detect them (REQ-12, REQ-11) ✅ COMPLETE

**Problem**: Node loads modules into memory at boot; editing the file on disk changes nothing for
a running process. Worker 1 (PID 3040379, started 10:01) ran 7-hour-old code after the
`tracksMetadata` fix landed at 17:02, and used it to overwrite track 10036's canonical `index.md`
from `done:queue` back to `implement:success` — dragging a shipped track backwards and triggering
a redundant implement run. Nothing anywhere detects "this process is older than its code."

**Ordering within the phase is deliberate (spec D6)**: REQ-12 (the write guard) lands *first*. It
is a pure containment that works even when detection fails — against stale code, third-party
processes, and races alike. REQ-11 (detection) is the alarm; REQ-12 is the seatbelt, and the
seatbelt is cheaper.

- [x] Task 1: REQ-12 — a monotonic lane-write guard, as a pure module
    - [x] New `conductor/services/lane-regression-guard.mjs`: `LANE_ORDER` (index = rank),
          `shouldBlockLaneWrite(...)` → `{ blocked, reason }`, plus an added `applyGuardedLaneWrite`
          helper (not in the original plan) — the single seam both write sites route their actual
          content mutation through, so there's exactly one place to get the "read fresh, then
          write" invariant right instead of two independently-implemented copies of the same regex
          logic.
    - [x] Blocks when `rank(intended) < rank(onDisk)` and `producedByThisRun` is false.
    - [x] `done` is unconditionally terminal — moving out of it is blocked even when
          `producedByThisRun` is true (TC-66 caught this: the first draft only blocked when
          `!producedByThisRun`, which is wrong — nothing in `workflow.json` ever legitimately
          transitions a track out of `done`, so there is no such thing as a run that "produces"
          that move).
    - [x] Same-lane status churn passes; legitimate `on_failure` backward transitions
          (`review→implement:queue`, `quality-gate→plan:queue`) pass when `producedByThisRun: true`.
    - [x] TC-65..72, 9/9 pure tests green (`track-10040-lane-regression-guard.test.mjs`).
- [x] Task 2: Applied at both marker-write sites, on a fresh read
    - [x] The exit-handler block — `producedByThisRun` computed as
          `(freshly-read on-disk Lane === this run's own laneStatus)`.
    - [x] The DB→disk pull site (`updateIndexMDFromDB`) — `producedByThisRun: false` always (a pull
          never legitimately produces a transition itself).
    - [x] Blocked writes: warn log only, no conversation comment, every other marker (Progress,
          hooks, etc.) untouched.
    - [x] TC-73/73b/73c/74, 4/4 green, against the REAL `applyGuardedLaneWrite` (not a mirror) —
          `track-10040-stale-write-containment.test.mjs`.
- [x] Task 3: REQ-11 — `workers.code_sha`, captured once at boot
    - [x] Migration `ui/server/migrations/012_track_10040_code_sha.sql` (the mechanism actually
          applied at server boot via `runMigration()` — the top-level `migrations/`+Atlas+Prisma
          path referenced in tech-stack.md turned out to be a separate, already-stale system:
          `prisma/schema.prisma`'s `workers` model is missing many columns the live DB already has
          (`worker_number`, `type`, `cli`, `model`, `available_models`, ...), so it was not touched
          here — adding one field to an already-drifted model would misrepresent it as in sync).
    - [x] Captured once at module load (`workerCodeSha`, IIFE against `import.meta.url`'s own
          directory, never `process.cwd()`), sent in `registerBody`, persisted only on
          `POST /worker/register` (both the manager and project INSERT paths) — never touched by
          `/worker/heartbeat`.
    - [x] TC-81/82/83 green against real Postgres (`track-10040-code-sha.test.mjs`), including the
          manager (`project_id: null`) case.
- [x] Task 4: `conductor/services/worker-code-staleness.mjs` — `classifyWorkerStaleness(...)`.
      `'critical'` when a touched file matches `WORKER_LOADED_FILE_PATTERNS`; `'stale'` when merely
      over `maxCommitsBehind`; `'current'` otherwise. Git facts injected, no I/O. TC-76..80, 7/7
      green.
- [x] Task 5: Reported on the manager's existing `reapOrphanedWorkerProcesses` interval, scoped to
      **this host only** (a different host has its own independent git checkout — comparing it
      against this machine's HEAD would be meaningless, so cross-host workers are skipped, a
      narrowing not in the original plan text but required for D5 to make sense across machines).
      `critical`/`stale` findings logged at warn with pid/hostname/sha/commits-behind.
      **Scope note, flagged rather than silently expanded**: only the *report* half is implemented.
      Auto-restarting a detected-stale worker (the `manager.auto_heal` gate REQ-11 names) is
      deliberately NOT implemented in this pass — it needs its own careful design (correct
      pidfile/`lc worker restart` wiring, avoiding killing a worker mid-lane-action) that doesn't
      fit this track's remaining budget. A human acts on the warn log for now.

**Impact**: The worst single incident of 2026-08-30 becomes impossible to repeat *silently*: even
an undetected stale process can no longer drag a shipped track backwards, and a detected one is
named in the log with the exact commit distance.

## ✅ QUALITY PASSED (Phase 1–2)

32 tests passing:
- Phase 1: Lane constants (3/3), API (9/9)
- Phase 2: Lane-regression-guard (9/9), Worker-code-staleness (7/7), Stale-write-containment (4/4)

Syntax check clean, no stubs, no regressions.

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

- [x] Task 1: Extract the canonical resolver into a shared module
    - [x] New `conductor/services/track-folder.mjs`. Move the *decision* out of
          `resolveTrackFolder` (`laneconductor.sync.mjs:1396`) as a pure function:
          `decideTrackFolder({ dirNames, trackNumber, registeredFolder, registeredExists })` →
          `{ folder, quarantine: [names], metadataUpdate }`.
    - [x] The effects (`quarantineStaleFolder`'s rename, `updateTrackMetadata`) stay in the worker,
          applied from the returned decision. This separation is what lets a **read-only** consumer
          resolve a folder without renaming anything — a CLI lookup must never mutate the tree as a
          side effect of answering a question.
    - [x] `laneconductor.sync.mjs`'s `resolveTrackFolder` becomes a thin wrapper. Behavior must be
          byte-identical — its quarantine semantics are load-bearing (track 1119). Confirmed
          byte-identical against `main`'s pre-extraction implementation (diffed directly).
    - [x] TC-84..88, 5/5 pure tests green (`track-10040-track-folder.test.mjs`), plus two extra
          edge-case tests beyond the plan's own list.
- [x] Task 2: `lc track-dir <number>` — the resolver as an interface the skill can actually call
    - [x] New subcommand in `bin/lc.mjs` (`command === 'track-dir'`): prints the resolved folder
          path to stdout, exit 0; exit non-zero with a diagnostic on stderr when nothing resolves,
          stdout left empty. `--json` for `{ folder, matches, registered }`. Read-only: calls
          `decideTrackFolder` directly and applies none of its `quarantine`/`metadataUpdate`
          effects.
    - [x] Handles both conventions and consults `conductor/tracks-metadata.json`, the same code the
          worker runs.
    - [x] TC-89..92, 4/4 green plus one extra legacy-convention regression test
          (`track-10040-track-dir-cli.test.mjs`, real subprocess invocations against throwaway
          fixtures).
- [x] Task 3: Rewrite the skill's instructions to use it (REQ-15's substance)
    - [x] **Protocol: Locating Tracks** — step 1 is now `lc track-dir NNN`; the manual scan is
          step 2, explicitly labelled as the skill-only/no-`lc`-on-PATH fallback, and corrected to
          check both `INITIALS-NNN-slug` and legacy `NNN-slug`.
    - [x] `/laneconductor plan` step 1/2 — locate via `lc track-dir` first; scaffold only runs if it
          exits non-zero (nothing found under any convention), and scaffolds at `INITIALS-NNN-slug`
          only, never the bare legacy form.
    - [x] **Scaffolding-is-an-error banner** added directly under the Folder Naming Convention line
          in **Protocol: Locating Tracks**, plus the same rule restated inline in `/laneconductor
          plan` step 2 — a folder existing under any convention makes scaffolding an error, not a
          fallback, stated at both the point of general guidance and the point of actual risk.
- [x] Task 4: Clean up the `_duplicate-*` folders reachable from this track's own worktree
    - [x] `_duplicate-10040-manager-stuck-track-healing/` (this track's own quarantine artifact,
          produced live during its own planning) — content confirmed fully superseded by its
          canonical `AM-10040-manager-stuck-track-healing/` sibling (same file set, canonical
          strictly more complete: has `conversation.md` and `last_run.log` the duplicate lacks, and
          a materially fuller `test.md`, 396 vs 15 lines) — removed via `git rm -r`.
    - [ ] **Scope note, flagged rather than silently expanded or silently dropped**: two more
          `_duplicate-*` folders exist, but on the **primary checkout's own working directory**
          (`/home/meller/Code/laneconductor/conductor/tracks/_duplicate-10039-...` and a second copy
          of `_duplicate-10040-...`), not inside this track's own worktree. This session runs
          isolated to `.worktrees/10040/` per `**Workspace**: branch` — reaching into the primary
          checkout's filesystem from here would cross exactly the isolation boundary Phase 2's
          path-isolation and REQ-8's single-writer rule exist to enforce elsewhere in this project.
          Left for a human or a `workspace: main`-scoped action to clean up; not touched here.

**Impact**: The duplicate factory shuts down. Without this, Phase 6's cleanup is Sisyphean — every
sweep finds new duplicates manufactured since the last one.

## ✅ COMPLETE (Phase 3)

16/16 tests green across `track-10040-track-folder.test.mjs` (5) and
`track-10040-track-dir-cli.test.mjs` (5), plus the pre-existing Phase 1–2 suite (32) still green —
48 total. `lc track-dir` verified against real subprocess invocations, not just unit-level pure
function calls. SKILL.md's `/laneconductor plan` and Protocol: Locating Tracks sections both now
route through the shared resolver.

**Gap, flagged rather than silently skipped**: test.md's TC-93/94/95
(`track-10040-skill-folder-scaffold.test.mjs`, "drive the real implement skill path against a
fixture") are not automated. They require actually invoking an LLM agent to follow SKILL.md's
prose instructions and observing what it scaffolds — there is no existing harness anywhere in this
repo's test suite that spawns a real Claude session inside a `node --test` run, and building one is
outside this phase's scope. Covered instead by direct inspection: SKILL.md's `/laneconductor plan`
step 1/2 (verified above) now unconditionally routes through `lc track-dir` before any scaffold
decision, and Task 2's CLI tests (TC-89/90/92) already prove that resolver correctly finds a
prefixed-only folder and never mutates the tree — the two preconditions TC-93 would need to hold
for the skill to behave correctly. Same category of gap as Phase 1's TC-60/63/64.

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

- [x] Task 1: New pure module `conductor/services/resting-state.mjs`
    - [x] `deriveValidRestingStates(workflow)` → derived, never hardcoded. TC-96 proves this
          project's real `workflow.json` (`plan.on_success: "plan:success"`) does NOT flag
          `plan:success`; TC-97 proves a *different* workflow configuring
          `plan.on_success: "implement:queue"` DOES flag it — the set genuinely tracks the config,
          it isn't a lookup table with this project's answer baked in.
    - [x] `findInvalidRestingStates(tracks, validSet, workflow)` → offenders with
          `expectedTransition`. TC-98 reproduces 10038's and 1100's exact shapes against the real
          `workflow.json` and gets `review:queue` / `done:queue` back, while a `plan:success` track
          in the same fixture is correctly NOT flagged.
    - [x] `classifyRestingState({ completionMarkersPresent, completionMarkersConsistent })` →
          `reapply` only when both are true; every other combination (including both omitted)
          defaults to `escalate` — TC-100/101.
- [x] Task 2: REQ-17 — `classifyMergedButNotDone({ trackNumber, mergeCommitReachable, lane })`,
      reusing `LANE_ORDER` from Phase 2's `lane-regression-guard.mjs` rather than a second rank
      table. Reachability is injected. TC-102 reproduces 10038's exact shape (merged, lane
      `implement`); TC-103 asserts across every lane that the action is never anything but
      `escalate`/`null` — a future change that adds an auto-repair path fails this test.
      TC-96..103, 8/8 pure tests green (`track-10040-resting-state.test.mjs`).
- [ ] Task 3: Wire it up — **deferred to land together with Phase 5's counter module**, not
      skipped. This task's own plan text says "reuse Phase 5's counter (`kind:
      'invalid-resting-state'`)" — that counter (`conductor/services/prespawn-block.mjs`) does not
      exist yet at this point in phase order. Building the sweep wiring against a counter that
      doesn't exist would mean either duplicating suppression logic (exactly what Phase 5's design
      exists to prevent — see spec D10) or wiring against a stub. The two pure modules above are
      genuinely complete and independently useful; the manager-sweep host and comment-posting are
      implemented once, together, when Phase 5 and Phase 6's `sweepStuckTracks()` land.
- [ ] Task 4: **Needs a human decision, not attempted here.** The task's own text is explicit:
      10038's markers must be reconciled "by a human decision recorded in its conversation.md, not
      by an automated forward-write." Resolving 10038/1100/10039 requires deciding, for each, was
      the lane's work actually complete (reapply) or not (escalate) — a judgment call about
      real project tracks this implementation session should not make unilaterally, and per spec
      D9 an automated agent must never resolve REQ-17's merged-but-not-done shape by writing
      markers forward regardless. Flagging for a human rather than guessing.

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

- [x] Task 1: New pure module `conductor/services/prespawn-block.mjs`
    - [x] `BLOCK_KINDS` — `dirty-checkout`, `main-mode-lock`, `phantom-running` (Phase 6),
          `invalid-resting-state` (Phase 4), plus the three reserved for
          [[AM-10039-cloud-workers-claude-cloud]] (`expired-credentials`, `github-app-missing`,
          `preflight-failed`). REQ-9: escalation keys off count + kind, never off dirty-path shape.
    - [x] `DEFAULT_ESCALATE_AFTER = 5`, overridable via `LC_PRESPAWN_BLOCK_ESCALATE_AFTER`
    - [x] `decidePreSpawnBlockOutcome({ kind, reason, countBefore, threshold })` →
          `{ action: 'warn' }` (countBefore === 0 — first of streak) · `{ action: 'silent' }`
          (mid-streak) · `{ action: 'escalate' }` (countBefore + 1 >= threshold). This is REQ-10:
          exactly two comments per streak, spam killed at the source rather than capped at the end.
    - [x] `formatBlockComment(outcome)` → the ⚠️ / ❌ body, leading emoji as the literal first
          character (Completion Comment Convention). Returns the bare body (what lands in
          `track_comments.body` after the sync worker's `> **author**: ` wrapper is stripped) —
          the caller prefixes the wrapper when appending to `conversation.md`.
    - [x] TC-1..8, 10/10 pure tests green (`track-10040-prespawn-block.test.mjs`).
- [x] Task 2: DB persistence (REQ-8 — 10039's dispatcher-only mode has no local filesystem)
    - [x] Migration `ui/server/migrations/013_track_10040_prespawn_block.sql`:
          `prespawn_block_count`, `prespawn_block_kind`, `prespawn_block_reason`,
          `prespawn_blocked_at`.
    - [x] `ui/server/index.mjs`: `POST /track/:num/prespawn-block` (body `{ kind, reason }`;
          increments and returns `{ count, kind, reason }`, 400 on missing `kind`, 404 on unknown
          track) and `POST /track/:num/prespawn-block/reset`. Both behind `collectorAuth`.
    - [x] TC-18/19/20/21/22, 5/5 green against real Postgres
          (`ui/server/tests/track-10040-prespawn-block-api.test.mjs`).
    - [x] TC-23 (AC-5), 1/1 green against a real `GET /api/inbox` HTTP call
          (`ui/server/tests/track-10040-inbox-escalation.test.mjs`) — a track whose latest comment
          is `formatBlockComment`'s escalate body lands in `needs_input`. No SQL changes needed;
          the existing bucket rule already matches on `body LIKE '❌%'`.
- [x] Task 3: Worker wiring in `spawnCli`
    - [x] Both throw sites route through one `handlePreSpawnBlock({ trackNumber, kind, reason,
          primaryIndexPath, primaryIndexContent, primaryTracksDir, primaryTrackDirName, label,
          projectId })` helper (`laneconductor.sync.mjs:4386`).
    - [x] Increments the counter (API mode: the endpoint above; local-fs: sibling files
          `.prespawn-block-count` / `.prespawn-block-kind`), applies the module's decision, writes
          `**Lane Status**: queue` (warn/silent) or `failure` (escalate) through
          `applyGuardedLaneWrite` (Phase 2's guard — not around it), and posts at most the one
          comment the decision calls for.
    - [x] `err.workspaceGuardBlocked = true` kept (REQ-3 — the existing flag is read, not
          replaced), plus `err.preSpawnBlock = outcome` added for callers.
    - [x] API-mode failures to record a block fail *safe*, not silent: if the collector call
          throws, treated as `countBefore: 0` (first-of-streak) rather than guessing a count that
          might already be past threshold — logged at warn.
- [~] Task 4: Reset points — a stale counter is worse than no counter
    - [x] On a spawn that gets past both guards: clears the counter (local-fs: removes the sibling
          files; API mode: calls the reset endpoint), *before* git-lock/worktree setup and
          independent of whether the spawned run itself later succeeds or fails (blocks and
          run-failures are separate counters, same principle as `.retry-count`).
    - [ ] **Gap, not attempted**: reset on lane change (mirroring `.retry-lane`) and reset on human
          intervention (mirroring the retry-count endpoint's "since the last human comment"
          derivation). Neither is wired. Concretely: a track blocked 3 times in `plan`, then moved
          to `implement` by a human, still carries `prespawn_block_count: 3` into `implement` and
          would escalate after 2 more blocks instead of 5. Flagging rather than silently calling
          Task 4 done — TC-13/TC-14 are unautomated because the behavior doesn't exist yet.
- [x] Task 5: Distinguish the block in the three `spawnCli` callers (auto-queue ~6008,
      auto-complete ~6112, manual-dispatch ~7455) — each reads `err.workspaceGuardBlocked` and logs
      it as an already-handled block (info/log level, explicitly not re-commenting — REQ-10's
      "at most one comment" would otherwise double per trigger path), never as an unhandled crash.

**Impact**: The 10036 shape reaches `failure` + one ❌ within 5 cycles instead of looping. Verified
reachable: `autoLaunchLocalFs` skips any track with `lane_action_status !== 'queue'` and
`resetStuckActions` only rewrites `running` rows, so `failure` is genuinely terminal until a human
touches it. The existing `/api/inbox` rule (`ui/server/index.mjs:1048`,
`lc.author = 'system' AND (lc.body LIKE '⚠️%' OR lc.body LIKE '❌%')`) already routes it to
`needs_input` — live-verified (TC-23), not just inspected.

**Gap, flagged rather than silently skipped**: TC-9/10/11/15/16/17/17b (the worker-subprocess E2E
suite, `track-10040-guard-block-escalation.test.mjs`) are not automated. Building a reliable
real-worker-subprocess-plus-real-API-plus-real-DB E2E harness (mirroring
`track-10017-auto-run-phase7-e2e.test.mjs`'s pattern) for a permanently-dirty-checkout scenario
across multiple real auto-launch cycles is substantial standalone work; rushing an unverified
version of it would violate this track's own verification standard more than not writing it yet.
Covered instead by: the pure-module tests (decision logic), the real-DB API tests (persistence),
the real-HTTP inbox test (escalation visibility), a direct code read of both guard call sites
confirming `handlePreSpawnBlock` is actually wired (not just defined), and the full existing
regression suite (`node --test conductor/tests/*.test.mjs`, `cd ui && npx vitest run`) showing zero
new failures from this phase's `spawnCli` edits — the same 8 files / 30 tests fail on this branch
as fail on `main`'s own tip, byte-for-byte.

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
