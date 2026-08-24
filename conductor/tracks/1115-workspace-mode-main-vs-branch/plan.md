# Track 1115: Workspace Mode — main-direct vs branch-per-track

See `spec.md` for full reasoning (D1-D10) behind every decision below.
See `conductor/tracks/1115-workspace-mode-main-vs-branch/index.md`'s
"Design" section for the original discussion these decisions resolve.

## Phase 1: Design finalization — COMPLETE (this planning pass)

**Problem**: index.md left three open questions unresolved: which of
options (a)/(b)/(c) handles the unattended-bug-run tension, what the
config surface looks like, and whether a dirty-checkout guard is needed.
**Solution**: Resolved as D1 (option b), D4 (project.workspace_mode),
D10 (git status --porcelain guard) in spec.md, each grounded against the
actual call sites in `conductor/laneconductor.sync.mjs`.

- [x] Resolve unattended-bug-run tension → D1, option (b)
- [x] Decide config surface → D2 (single `**Workspace**` marker) + D4
      (`project.workspace_mode`)
- [x] Decide dirty-checkout guard → D10
- [x] Write spec.md with REQ-1..REQ-12

**Impact**: No code yet. Everything below is new work for `/laneconductor
implement`.

**Task 0's gate, pre-answered (2026-08-24, before this implement pass
started)**: track 10018 (per-track merge mode) HAS landed — merged to
main in commit `96b2418`, `conductor/services/merge-mode.mjs` with
`resolveMergeMode()` is present and live in the current codebase. Per
Task 0's own instructions below: adopt spec.md D1's **option (d)** —
drop the type-derived bug→main default (D3) entirely, update D1/D3/D5
and test.md's TC-4/TC-5/TC-6 accordingly, and co-locate
`resolveWorkspaceMode()` with the existing `resolveMergeMode()` in
`conductor/services/` rather than inventing a second convention. Do
not re-implement assuming 10018 hasn't landed — it has.

## Phase 2: Worker — mode resolution + spawnCli wiring

**Problem**: `spawnCli()` (`laneconductor.sync.mjs:3531`) always
lock+worktrees except in local-fs mode; there is no per-track,
per-trigger decision point.
**Solution**: REQ-1/REQ-2/REQ-3/REQ-4.

- [x] Task 0 (**GATE — do this before Task 1, it can delete Tasks 1's D1/D3
      logic entirely**): Check whether track 10018 has landed:
      `grep -rn "merge_mode" conductor/services/ conductor/laneconductor.sync.mjs`.
      - **As of the 2026-08-19 replan**: 10018 was at `implement`, 98%,
        with no `merge_mode` yet in worker code — i.e. imminent but not
        landed. This track has not started Phase 2, so 10018 will very
        likely land first.
      - **If it has landed**: adopt spec.md D1's **option (d)** — drop the
        type-derived bug→main default (D3) entirely; bug tracks become
        `branch` + `merge_mode: direct`, and `main` is reserved for the
        cases that genuinely need it (infra self-fixes, live pairing).
        This deletes D3, deletes D5 rows 3 and 4, and reduces the resolver
        to: plan-lane → marker → project default → branch. It also removes
        the whole "behavior depends on how the run was launched" surprise.
        Update spec.md's D1/D3/D5 and `test.md`'s TC-4/TC-5/TC-6 to match
        rather than implementing both designs.
      - **If it has not landed**: proceed with D1/D3 as specified below.
      - Either way, coordinate with 10018's `resolveMergeMode(track)`:
        it is the direct sibling of `resolveWorkspaceMode()` (same
        marker-plus-nullable-column pattern, same NULL-vs-explicit
        distinction). Confirmed 2026-08-19 from 10018's spec.md:14-15.
        Prefer co-locating the two resolvers over inventing a second
        convention — index.md's interaction note calls for "one shared
        resolution service."
- [x] Task 1: Create `conductor/services/workspace-mode.mjs` exporting
      `resolveWorkspaceMode({ laneStatus, workspaceMarker, trackType,
      trigger, projectWorkspaceMode })` implementing spec.md D5's table
      exactly (pure function, no I/O — mirrors `path-isolation.mjs`'s
      style).
    - [x] Sub-task: `laneStatus === 'plan'` → `'main'` unconditionally
          (D6), checked first.
    - [x] Sub-task: explicit `workspaceMarker` (`'main'`/`'branch'`)
          wins over everything except the plan-lane rule above —
          **including over the auto-queue override below.** ⚠️ This
          REVERSES what an earlier draft of this task said. See spec.md
          D1's refinement: forcing a branch on a track explicitly marked
          `main` does not produce a safe run, it produces a *wrong* one
          (an infra track is marked main precisely because a branch run
          cannot do its job). The marker is the human's explicit switch.
    - [x] Sub-task: `trigger` of `'auto-queue'` or `'auto-complete'`
          forces `'branch'` — but only over the **type-derived** default
          (D3), not over the marker. Encode the precedence exactly as D5
          orders it: plan-lane, then marker, then auto-trigger, then
          bug-type default, then project default, then branch. Rows 2/3/4
          in that sequence are the entire encoding of D1 — TC-3 and TC-4
          in `test.md` exist to pin them as a conflicting pair.
    - [x] Sub-task: `projectWorkspaceMode` fallback, then `'branch'`
          default.
- [x] Task 2: Add a `parseWorkspaceMarker(content)` helper next to the
      existing `parseTrackType()` (`laneconductor.sync.mjs:1450`),
      reading `**Workspace**:` the same way, returning `null` when
      absent/invalid (not a default — resolveWorkspaceMode needs to know
      "unset" is distinct from "branch chosen").
- [x] Task 3: In `spawnCli()` (`:3728`), before the existing
      `if (!getIsLocalFs() && !process.env.LC_SKIP_GIT_LOCK)` block
      (`laneconductor.sync.mjs:3738`): read the track's `index.md`,
      resolve workspace mode, and change the block to:
      - Always attempt `checkAndClaimGitLock()` (still required in
        `main` mode per D1/REQ-2 — this does not move).
      - Only call `createWorktree()` when the resolved mode is
        `'branch'`. When `'main'`, `worktreePath` stays `null`.
      - Confirm (do not re-derive) that every existing
        `worktreePath || process.cwd()` site downstream — the context
        prompt's workspace line (`:3782`), spawn `cwd` (`:3837`), the
        exit-handler's `tracksDir`/`workDir` (`:4023`, `:4107`), and the
        artifact-copy block's `if (worktreePath && existsSync(...))`
        guard (`:4191`) — already does the right thing with
        `worktreePath === null`. Verified present at these lines during
        this planning pass; confirm with a real run rather than
        re-reading the code a second time.
- [x] Task 4: Add `trigger` as a new parameter to `spawnCli()` and thread
      it from all **four** trigger sources (REQ-3). ⚠️ An earlier draft
      of this task listed three and missed the auto-complete chain:
      - `autoLaunchLocalFs()` normal claim (`:4727`) → `'auto-queue'`
      - the **same** call site with `waitingForReply` true (local at
        `:4521`) → `'manual-dispatch'`. These are one call site, not
        two — compute the trigger inline from that variable.
      - auto-complete stage runner (`:4814`) → `'auto-complete'`, treated
        as unattended per D5 row 3 (human-*started*, but a fire-and-forget
        multi-lane chain — exactly the "nobody is watching" case).
      - `checkDispatchInbox()` (`:6022`) → `'manual-dispatch'`.
- [x] Task 5 (REQ-4): In `spawnCli()`'s `contextPrompt` construction
      (`:3751` onward), append one instruction line — only when resolved
      mode is `'main'` — telling the agent to commit with
      `feat(track-NNN): ...` / reference the track number, per
      `conductor/workflow.md`'s existing convention.
- [x] Task 6 (REQ-5/D8): In `finishAutoCompleteWithMerge()`
      (`:4822`), resolve the track's workspace mode before calling
      `mergeWorktreeBranch()`. On `'main'`, skip the merge call and
      report success (`resultText` = `"Completed [...] — already on
      main, no merge needed."`) instead of treating `{ merged: false,
      reason: 'no-branch' }` as failure.
- [x] Task 7 (D10/REQ-10, **corrected during implementation** — see
      spec.md D10's 2026-08-24 note): Add a dirty-checkout guard function
      (reusing `git status --porcelain`, matching
      `conductor/services/git-divergence.mjs:91`'s pattern) called only
      when resolved mode is `'main'`, right before spawning. On a
      disqualifying dirty path (anything outside
      `conductor/tracks/{NNN}/` **and** outside the worker's own runtime
      bookkeeping — `conductor/.sync*.pid`, `.sync*.lock-target`,
      `.worker*.tokens.json`, `conductor/tracks-metadata.json`, all
      matched via `conductor/\.[^/]+$` or an explicit
      `tracks-metadata.json` check): do not spawn, leave
      `lane_action_status: queue`, append a `conversation.md` comment
      naming the path(s), return without consuming a retry. ⚠️ The
      bookkeeping exemption was NOT in the original spec — without it,
      this guard blocks every `plan`-lane spawn in any real deployment
      (D6 makes `plan` always resolve to `'main'`, and the worker's own
      pid/lock/token files are dirty essentially all the time); confirmed
      live by 7 existing E2E tests failing until this was added.

**Impact**: `spawnCli()` becomes mode-aware; `main`-mode tracks never
create a worktree/branch; `plan` never creates one for anyone.

## Phase 3: Skill + CLI

**Problem**: no way to set or classify `**Workspace**` outside the
worker's own resolution logic.
**Solution**: REQ-7/REQ-8.

- [x] Task 1 (REQ-7): `bin/lc.mjs`'s `new` command
      (`:2078-2189`) gains `--workspace main|branch`, validated against
      `['main', 'branch']`; when present, writes `**Workspace**: <value>`
      into the generated `index.md` alongside the existing
      `**Type**:`/`**Lane**:` lines. Update the usage string at `:2121`.
- [x] Task 2 (REQ-8, **corrected during implementation** — see spec.md
      REQ-8's 2026-08-24 note): `.claude/skills/laneconductor/SKILL.md`'s
      `/laneconductor plan` section gains a step, ordered before the
      existing "Scaffold (if missing)"/"Refine (if exists)" logic: if
      `index.md` has no `**Workspace**` AND no `**Track Kind**` marker,
      classify bug-vs-feature from the track's title/description/
      `conversation.md` + a quick codebase scan, write `**Track Kind**:
      bug` or `**Track Kind**: feature` (NOT `**Workspace**` directly —
      plan runs before every lane action per D6, so writing `**Workspace**`
      here would make the inference indistinguishable from a deliberate
      human override for nearly every track), and append the reasoning as
      a `> **system**:` comment to `conversation.md` (using the skill's
      required comment-format protocol — plain prose here would silently
      fail to sync).

**Impact**: Every track-creation path (UI, `lc new`, worker-side
scaffold-on-missing in `spawnCli`) either sets `**Workspace**` up front
or gets it classified by the first `plan` run.

## Phase 4: UI

**Problem**: no visibility into a track's resolved workspace mode.
**Solution**: REQ-6/REQ-11/REQ-12.

- [x] Task 1 (REQ-6, **corrected during implementation** — see spec.md
      D3's 2026-08-24 correction note): `ui/server/utils.mjs`'s
      `trackTemplates()` emits `**Track Kind**: bug` (a NEW marker, not
      `**Workspace**` — that would make the type-derived default
      indistinguishable from an explicit human override and silently
      defeat D1's auto-queue safety check) in the `bug` branch's `index`
      template only (omitted for `feature`, same sparse-emission
      convention as `typeLine`). `parseTrackKind()` lives in
      `workspace-mode.mjs` alongside `resolveWorkspaceMode()`.
- [x] Task 2 (REQ-11): Sync the `**Workspace**` marker to the DB the same
      way `**Type**` already reaches `tracks.track_type` (find that
      sync path — likely the same `syncTrack()` marker-parsing routine
      that handles `**Progress**`/`**Phase**`/etc. — and add
      `workspace_mode` alongside it, including a migration for the new
      `tracks.workspace_mode` column).
- [x] Task 3 (REQ-11): `TrackCard.jsx`/`TrackDetailPanel.jsx` render the
      mode next to the existing `TrackTypeBadge`
      (`TrackCard.jsx:151`) — e.g. a small "main" / "branch" tag, styled
      distinctly (this repo's convention: red/blue/green/amber badges
      per type, per `TrackCard.jsx:264` and `NewTrackModal.jsx:271-277`).
- [x] Task 4 (REQ-12): Wherever `worktree_lifecycle` is currently
      surfaced in the project Config UI (or, if it isn't, document
      `workspace_mode` as a manual `.laneconductor.json` edit exactly
      like `worktree_lifecycle` is documented today — do not build a
      config UI section that doesn't already exist for its sibling
      field).

**Impact**: A human can see, at a glance, whether a track is running
main-direct or branch-isolated, and why (bug/feature default vs
override).

## Phase 5: Tests

**Problem**: this is entirely new branching logic in the single most
load-bearing function in the worker (`spawnCli`) — needs real process-level
verification, not code-reading.
**Solution**: see `test.md` for the full list; summarized here by what
each covers.

**Status (2026-08-24 implement pass): Task 1 done, Tasks 2-8 NOT done —
deferred, not silently dropped.** Task 1's pure-resolver unit tests exist
and pass (13 cases), and this pass additionally fixed 7 PRE-EXISTING E2E
tests that broke as a direct consequence of D6 shipping (they assumed
`plan` always creates a worktree, which is no longer true — see
`spec.md`'s D10 correction note). But the dedicated Task 2-8 E2E suite —
real spawned-worker-process tests asserting on real git state for `main`
mode, lazy worktree creation, the auto-queue override, the merge skip, the
dirty-checkout guard, lock serialization, and the Worktrees-panel
exclusion — was not written this pass. **This matters**: `test.md`'s own
header says these are "the load-bearing ones... unit tests over a pure
resolver cannot detect a worktree that got created anyway," and that is
still true — the resolver being unit-tested does not verify `spawnCli`'s
wiring actually uses it correctly end to end. Do not treat this track as
verified for real-world main-mode behavior until Tasks 2-8 land.

- [x] Task 1: Unit tests for `resolveWorkspaceMode()` — every row of
      D5's table, as a pure-function test
      (`conductor/tests/track-1115-workspace-mode.test.mjs`, mirroring
      `track-1112-worktree-audit.test.mjs`'s style for pure logic).
- [ ] Task 2: E2E test extending the `local-api-e2e.test.mjs` /
      mock-collector + mock-cli pattern: a real spawned worker process,
      `main`-mode track through `plan` → `implement`, asserting on real
      git state (no `.git/worktrees/{n}`, no `track-{n}` branch, commit
      present on the primary checkout's branch).
- [ ] Task 3: Same harness, `branch`-mode track — confirm lazy worktree
      creation (absent after `plan`, present after `implement` starts).
- [ ] Task 4: Auto-queue-forces-branch override test — a track marked
      `**Workspace**: main` claimed via the auto-launch path still gets a
      real worktree/branch.
- [ ] Task 5: `finishAutoCompleteWithMerge` main-mode success-not-failure
      regression test.
- [ ] Task 6: Dirty-checkout guard test — dirty file outside the track's
      own folder blocks a `main`-mode spawn; track stays at `queue`.
- [ ] Task 7: Serialization test — two `main`-mode dispatches for two
      different tracks in the same project, second one observably
      blocked on the lock until the first releases.
- [ ] Task 8: Worktrees-panel regression (TC-34/TC-35) — `main`-mode track
      produces no panel row at any lane, including after `done:success`.
      Drive it through `auditWorktrees()` against a real repo, **not** by
      unit-testing `belongsInWorktreesPanel` in isolation: per D9 the
      guarantee is that no row is ever *enumerated* (rows come from
      `listTrackBranches()` + `git worktree list`, and a main-mode track
      creates neither), which a filter-level test cannot observe. This
      also confirms the `stranded` classification — the one
      worktree-less case that *does* pass the panel filter — cannot
      catch a main-mode track.

**Impact**: Confidence that a bug-classified track genuinely runs
main-direct without touching worktree machinery, and that a
feature-classified (or auto-queue-forced) track is byte-for-byte
identical to today's `branch` behavior.

## Phase 6: Docs

**Problem**: nothing documents when to use which mode, or what the
`**Workspace**` marker means.
**Solution**:

- [x] Task 1: `.claude/skills/laneconductor/SKILL.md` — document the
      `**Workspace**` marker in the "Filesystem-as-API Interface" table
      (alongside `**Status**`/`**Progress**`/etc.), and add a short
      "Workspace Modes" subsection near `/laneconductor plan`'s
      description covering the classification step and D1's
      auto-queue-forces-branch rule.
- [x] Task 2: `conductor/workflow.md` — add a short section on when
      `main` vs `branch` is appropriate (mirrors this spec's Non-Goals:
      branch stays the default; main is for attended bug fixes and infra
      self-fixes).
- [x] Task 3: `conductor/product.md` — its "Worktree Management" section
      currently states flatly that "All work happens inside the worktree
      (isolated from main branch)" and describes `worktree_lifecycle` as
      having exactly two values (`per-cycle`/`per-lane`). Both become
      inaccurate once main mode exists. Update that section to describe
      the workspace-mode axis as orthogonal to lifecycle, and note that
      lifecycle is simply N/A for main-mode tracks. (Found during
      planning: Phase 6 previously listed only SKILL.md and workflow.md,
      leaving the most-read architecture doc stale.)

**Impact**: Future track creators and reviewers understand the marker
without re-deriving this track's reasoning from git blame.
