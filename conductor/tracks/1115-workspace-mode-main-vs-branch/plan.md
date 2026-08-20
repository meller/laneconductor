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

## Phase 2: Worker — mode resolution + spawnCli wiring

**Problem**: `spawnCli()` (`laneconductor.sync.mjs:3531`) always
lock+worktrees except in local-fs mode; there is no per-track,
per-trigger decision point.
**Solution**: REQ-1/REQ-2/REQ-3/REQ-4.

- [ ] Task 1: Create `conductor/services/workspace-mode.mjs` exporting
      `resolveWorkspaceMode({ laneStatus, workspaceMarker, trigger,
      projectWorkspaceMode })` implementing spec.md D5's table exactly
      (pure function, no I/O — mirrors `path-isolation.mjs`'s style).
    - [ ] Sub-task: `laneStatus === 'plan'` → `'main'` unconditionally
          (D6), checked first.
    - [ ] Sub-task: explicit `workspaceMarker` (`'main'`/`'branch'`)
          wins over everything except the plan-lane rule above.
    - [ ] Sub-task: `trigger === 'auto-queue'` forces `'branch'` (D1)
          even when `workspaceMarker === 'main'` — this is the one case
          where the marker does NOT win; encode the precedence exactly
          as D5 orders it (plan-lane check, then marker, then
          auto-queue-forces-branch, then project default, then
          branch-default) — do not let marker short-circuit before the
          auto-queue check.
    - [ ] Sub-task: `projectWorkspaceMode` fallback, then `'branch'`
          default.
- [ ] Task 2: Add a `parseWorkspaceMarker(content)` helper next to the
      existing `parseTrackType()` (`laneconductor.sync.mjs:1322`),
      reading `**Workspace**:` the same way, returning `null` when
      absent/invalid (not a default — resolveWorkspaceMode needs to know
      "unset" is distinct from "branch chosen").
- [ ] Task 3: In `spawnCli()`, before the existing
      `if (!getIsLocalFs() && !process.env.LC_SKIP_GIT_LOCK)` block
      (`laneconductor.sync.mjs:3541`): read the track's `index.md`,
      resolve workspace mode, and change the block to:
      - Always attempt `checkAndClaimGitLock()` (still required in
        `main` mode per D1/REQ-2 — this does not move).
      - Only call `createWorktree()` when the resolved mode is
        `'branch'`. When `'main'`, `worktreePath` stays `null`.
      - Confirm (do not re-derive) that every existing
        `worktreePath || process.cwd()` site downstream — spawn `cwd`
        (`laneconductor.sync.mjs:3640`), the exit-handler's
        `workDir`/`targetIndexPath` (`:3894-3898`), and the
        artifact-copy block's `if (worktreePath && existsSync(...))`
        guard (`:3976`) — already does the right thing with
        `worktreePath === null`; these were flagged in spec.md as
        pre-existing incidental support, verify with a real run rather
        than re-reading the code a second time.
- [ ] Task 4: Add `trigger` as a new parameter to `spawnCli()` and thread
      it from all three call sites (REQ-3):
      `autoLaunchLocalFs()`'s normal claim path → `'auto-queue'`;
      `autoLaunchLocalFs()`'s `waitingForReply` branch → `'manual-dispatch'`;
      `checkDispatchInbox()` (`:5401`) → `'manual-dispatch'`.
- [ ] Task 5 (REQ-4): In `spawnCli()`'s `contextPrompt` construction
      (`:3553-3606`), append one instruction line — only when resolved
      mode is `'main'` — telling the agent to commit with
      `feat(track-NNN): ...` / reference the track number, per
      `conductor/workflow.md`'s existing convention.
- [ ] Task 6 (REQ-5/D8): In `finishAutoCompleteWithMerge()`
      (`:4652`), resolve the track's workspace mode before calling
      `mergeWorktreeBranch()`. On `'main'`, skip the merge call and
      report success (`resultText` = `"Completed [...] — already on
      main, no merge needed."`) instead of treating `{ merged: false,
      reason: 'no-branch' }` as failure.
- [ ] Task 7 (D10/REQ-10): Add a dirty-checkout guard function (reusing
      `git status --porcelain`, matching
      `conductor/services/git-divergence.mjs:91`'s pattern) called only
      when resolved mode is `'main'`, right before spawning. On a
      disqualifying dirty path (anything outside
      `conductor/tracks/{NNN}/`): do not spawn, leave
      `lane_action_status: queue`, append a `conversation.md` comment
      naming the path(s), return without consuming a retry.

**Impact**: `spawnCli()` becomes mode-aware; `main`-mode tracks never
create a worktree/branch; `plan` never creates one for anyone.

## Phase 3: Skill + CLI

**Problem**: no way to set or classify `**Workspace**` outside the
worker's own resolution logic.
**Solution**: REQ-7/REQ-8.

- [ ] Task 1 (REQ-7): `bin/lc.mjs`'s `new` command
      (`:2078-2189`) gains `--workspace main|branch`, validated against
      `['main', 'branch']`; when present, writes `**Workspace**: <value>`
      into the generated `index.md` alongside the existing
      `**Type**:`/`**Lane**:` lines. Update the usage string at `:2121`.
- [ ] Task 2 (REQ-8): `.claude/skills/laneconductor/SKILL.md`'s
      `/laneconductor plan` section gains a step, ordered before the
      existing "Scaffold (if missing)"/"Refine (if exists)" logic: if
      `index.md` has no `**Workspace**` marker, classify bug-vs-feature
      from the track's title/description/`conversation.md` + a quick
      codebase scan, write `**Workspace**: main` or `**Workspace**:
      branch`, and append the reasoning as a `> **system**:` comment to
      `conversation.md` (using the skill's required comment-format
      protocol — plain prose here would silently fail to sync).

**Impact**: Every track-creation path (UI, `lc new`, worker-side
scaffold-on-missing in `spawnCli`) either sets `**Workspace**` up front
or gets it classified by the first `plan` run.

## Phase 4: UI

**Problem**: no visibility into a track's resolved workspace mode.
**Solution**: REQ-6/REQ-11/REQ-12.

- [ ] Task 1 (REQ-6): `ui/server/utils.mjs`'s `trackTemplates()`
      (`:32-45`) emits `**Workspace**: main` in the `bug` branch's
      `index` template and `**Workspace**: branch` in the `feature`
      branch's — one line each, matching the existing `typeLine`
      pattern already in that function.
- [ ] Task 2 (REQ-11): Sync the `**Workspace**` marker to the DB the same
      way `**Type**` already reaches `tracks.track_type` (find that
      sync path — likely the same `syncTrack()` marker-parsing routine
      that handles `**Progress**`/`**Phase**`/etc. — and add
      `workspace_mode` alongside it, including a migration for the new
      `tracks.workspace_mode` column).
- [ ] Task 3 (REQ-11): `TrackCard.jsx`/`TrackDetailPanel.jsx` render the
      mode next to the existing `TrackTypeBadge`
      (`TrackCard.jsx:151`) — e.g. a small "main" / "branch" tag, styled
      distinctly (this repo's convention: red/blue/green/amber badges
      per type, per `TrackCard.jsx:264` and `NewTrackModal.jsx:271-277`).
- [ ] Task 4 (REQ-12): Wherever `worktree_lifecycle` is currently
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

- [ ] Task 1: Unit tests for `resolveWorkspaceMode()` — every row of
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
- [ ] Task 8: Worktrees-panel regression — `main`-mode track produces no
      panel row at any lane (exercises `belongsInWorktreesPanel`
      end-to-end, not just re-asserting D9's static analysis).

**Impact**: Confidence that a bug-classified track genuinely runs
main-direct without touching worktree machinery, and that a
feature-classified (or auto-queue-forced) track is byte-for-byte
identical to today's `branch` behavior.

## Phase 6: Docs

**Problem**: nothing documents when to use which mode, or what the
`**Workspace**` marker means.
**Solution**:

- [ ] Task 1: `.claude/skills/laneconductor/SKILL.md` — document the
      `**Workspace**` marker in the "Filesystem-as-API Interface" table
      (alongside `**Status**`/`**Progress**`/etc.), and add a short
      "Workspace Modes" subsection near `/laneconductor plan`'s
      description covering the classification step and D1's
      auto-queue-forces-branch rule.
- [ ] Task 2: `conductor/workflow.md` — add a short section on when
      `main` vs `branch` is appropriate (mirrors this spec's Non-Goals:
      branch stays the default; main is for attended bug fixes and infra
      self-fixes).

**Impact**: Future track creators and reviewers understand the marker
without re-deriving this track's reasoning from git blame.
