# Track 1115: Workspace Mode — main-direct vs branch-per-track

**Lane**: done
**Lane Status**: success
**Progress**: 85%
**Last Run**: claude/claude-sonnet-5 (primary)
**Phase**: ⚠️ Lane/Progress inconsistent with real state — see conversation.md. Phases 1-4/6 done; Phase 5 (dedicated E2E suite) not written — see plan.md's Phase 5 status note.
**Type**: dev
**Waiting for reply**: no
**Summary**: LaneConductor implicitly assumes ALL work is branch-per-track worktree work; an entire live pairing session (tracks 1112-1114's bug fixes) happened directly on main because fixing self-hosted…

## Problem

Surfaced during the 2026-08-13/14 dogfooding sessions. Every lane action
today runs through `checkAndClaimGitLock` → `createWorktree` → work on
`track-NNN` branch → merge at done:success. There is no other recognized
way to do work. But a whole class of real work can't use it:

1. **Self-hosted infrastructure fixes.** The sync worker, API server, and
   Vite UI all run from the primary checkout on main. A fix to the worker
   made on a branch doesn't take effect until merged and restarted from
   main — which breaks the fix → restart → verify-live loop that caught
   most of this session's bugs (the TDZ restart crash, the heartbeat
   null-clobber, F13's token corruption). You cannot dogfood a fix to the
   runner from a branch the runner isn't running.

2. **Live human+assistant pairing.** Sessions like this one commit
   straight to main (`20e0374`, `73485b3`, `ec332ef`) with no track
   machinery involved. The system has no record connecting those commits
   to the tracks they implemented. Concretely bit us: track 1113's
   planning agent correctly verified "Send & Run does not exist" against
   every branch — while the implementation sat uncommitted on main under
   its feet.

3. **Quick bug fixes** where worktree overhead (lock, worktree add,
   branch, merge) exceeds the change itself.

## Design (from live discussion — to be refined in planning)

Two workspace modes, selectable, with branch-per-track as the default:

- **`branch` (default, current behavior)** — unchanged. Lock → worktree →
  track branch → merge at done. The safe mode for autonomous/unattended
  agent runs: a run that goes sideways stays quarantined on its branch.
- **`main` (opt-in)** — lane actions run directly in the primary checkout,
  no worktree, no track branch. Constraints that make it safe rather than
  a free-for-all:
  - Still takes the git lock — main mode inherently serializes to ONE
    lane action at a time per project (two agents editing the same
    checkout would trample each other; the lock machinery exists for
    exactly this).
  - Commits made during the action must reference the track (enforced or
    at minimum injected into the agent's instructions), so main history
    stays attributable — closing the "commits with no track record" gap.
  - The exit handler's file/DB updates work as today (they already write
    to `process.cwd()` when there's no worktreePath — partial support
    exists incidentally; this track makes it deliberate and tested).

**Default rationale (recommendation, open to override in planning):**
- The default must be safe when nobody is watching; main-direct is only
  appropriate with a human in the loop, and that's precisely when
  flipping an explicit switch is cheap.
- Asymmetric failure cost: wrong default to `branch` costs a merge step;
  wrong default to `main` costs a polluted main.

**Selection surface (to decide in planning):**
- **Type-based default (proposed in the same discussion): feature/dev
  tracks → `branch`, bug tracks → `main`.** The New Track modal already
  has the exact hook — its existing `type` selector (feature vs `⚠ Bug`,
  with the board's Bug button pre-selecting bug) — so track creation needs
  no new UI surface at all; the type the user already picks drives the
  workspace default. Fits how the two kinds of work actually behave:
  features are larger and benefit from isolation, bugs are small fixes
  where worktree overhead dominates and fast on-main iteration is the
  point.
- Per-project default: `.laneconductor.json` → `workspace.mode` (or under
  the existing `worktree` config block, e.g. `worktree.lifecycle: none`).
- Per-track override: `**Workspace**: main` marker in index.md — type
  sets the default, never a hard rule (a big risky bug refactor may still
  want a branch; a one-line feature tweak may want main). An infra track
  declares itself main-direct regardless of project default.
- UI: show the mode on the track card / detail panel; the Worktrees panel
  naturally shows nothing for main-mode tracks (no worktree — consistent
  with 1114's "no worktree → not in the panel" scoping).

**Honest tension to resolve in planning:** the safety rationale above says
main-direct is for when a human is in the loop — but type-based
defaulting sends *autonomous* bug-fix runs to main too, and those are
often unattended. Options to weigh: (a) accept it — bugs are small and
the git lock + track-referencing commits bound the blast radius; (b) bug
type defaults to main only for *manually dispatched* runs, while
auto-claimed queue runs always use branch; (c) main mode requires the
track to be explicitly human-approved once before an agent may use it.
Don't resolve this silently — it's the crux of the default question.

**Plan-classifies when type is missing + plan lane runs main-direct
(added to the design in the same discussion):**
- Not every creation path provides the type (`lc new "Title" "Desc"` has
  no type flag today; UI tracks might skip it). When missing, the plan
  skill's FIRST job is to classify bug-vs-feature from the description +
  codebase, write it into `index.md`, and record its reasoning in
  conversation.md — so a wrong guess is visible and overridable, not
  silent.
- **The plan lane itself always runs main-direct, for every track.**
  Three reasons, one of them empirical:
  1. Plan only writes the track's own docs (spec/plan/test/index.md) —
     nothing needing git isolation.
  2. Direct evidence from this repo's own 2026-08-13 audit: most of the
     44 unmerged branches cleaned up in track 1114 were `plan:success,
     ahead 1-2` doc-only branches (1054, 1055, 1070, 1072, 1081, 1094,
     1096, ...) — plan-in-a-worktree IS the primary branch-clutter
     generator. Plan-on-main would have prevented nearly all of it.
  3. It resolves the sequencing problem inherent in "plan decides the
     mode": today `spawnCli` creates the worktree at the START of every
     lane action, plan included — the classification must exist before
     any worktree does. Plan-on-main gives exactly that: **the worktree
     is created lazily at first implement** (features/branch mode only),
     not at track creation or plan time.
- Skill change: `/laneconductor plan` gains the classification step;
  `lc new` gains a `--type bug|feature` flag for callers who already
  know.

## Interaction with track 10018 (per-track merge mode) — added 2026-08-18

Track [10018](../10018-per-track-merge-mode/index.md) adds a per-track
`**Merge Mode**: pr|direct` (default `pr`) governing how a track *branch*
integrates: auto-merge vs GitHub PR with human approval. Together the two
tracks form one three-way strategy per track: `main-direct` |
`branch + direct merge` | `branch + PR`. Consequences for this track's
planning phase:

1. **New option (d) for the unattended-bug tension above:** bug tracks
   stay **branch-mode with `merge_mode: direct`** — fast integration, no
   PR ceremony, but still quarantined on a branch — and main-direct is
   reserved for the cases that genuinely need it: self-hosted infra
   dogfooding (#1) and live human pairing (#2). Motivation #3 (worktree
   overhead on tiny fixes) is mostly answered by branch+direct.
2. **10018's dev-server preview (its Phase 5) overlaps motivation #1:**
   it runs the dev server *from a branch's worktree*. If preview is
   extended to also swap the sync worker (recorded as an open item in
   10018's spec), the infra-dogfood case shrinks and this track's
   irreducible core becomes live-pairing/attribution (#2).
3. **Shared conventions:** ship sibling markers (`**Workspace**:
   main|branch`, `**Merge Mode**: direct|pr`) resolved by one shared
   resolution service; main-mode tracks are excluded from 10018's PR
   machinery entirely (no branch → no PR, no preview row, `merge_mode`
   N/A — consistent with 1114's "no worktree → not in the panel").
4. **Sequencing:** 10018 lands first (planned, applies to today's
   all-branch world); this track's Phase 1 design finalization then
   resolves the default-mode question with option (d) on the table.

## Open questions for planning — RESOLVED 2026-08-19

All three resolved in `spec.md`; kept here with their answers for
context.

- ~~Does `merge-worktree`/`auto-complete-track` (1114) need a main-mode
  variant?~~ → **D8**: no merge step at all. "Already on main" *is* the
  merged state. `finishAutoCompleteWithMerge()` skips
  `mergeWorktreeBranch()` and reports success instead of surfacing
  `{ merged: false, reason: 'no-branch' }` as a failure.
- ~~Should main mode refuse to start on a dirty checkout?~~ → **D10**:
  yes. Any dirty path outside the track's own
  `conductor/tracks/{NNN}-*/` folder blocks the spawn, leaves the track
  at `queue`, and **does not consume a retry**. The track's own folder is
  excluded because the worker itself dirties it (writing `**Lane
  Status**: running`) immediately before spawning.
- ~~Reconciler interaction: main-mode tracks must be excluded from
  worktree reconciliation.~~ → **D9**: already true by construction, and
  verified against `worktree-audit.mjs:180-215` rather than assumed —
  rows are enumerated from `listTrackBranches()` + `git worktree list`,
  and a main-mode track creates neither, so it is never enumerated. No
  code change needed; REQ-9 locks it with a test.

**Also resolved — the "honest tension" above** (options a/b/c): **D1**
takes option (b), with one refinement — the *type-derived* default
(bug→main) does not survive an unattended auto-claim, but an *explicit*
`**Workspace**: main` marker does, because forcing a branch on a track
explicitly marked main produces a wrong run rather than a safe one (an
infra track can't dogfood a fix from a branch the runner isn't running).
Option (d) from track 10018 was considered and deferred — see D1; it
would be simpler and should be reopened if 10018 lands before Phase 2.

## Phases
- [x] Phase 1: Design finalization — resolve the unattended-bug-run tension (options a/b/c above), decide config surface and the dirty-checkout guard; write spec.md with REQs
- [x] Phase 2: Worker — plan lane always main-direct; worktree created lazily at first implement, honoring the track's resolved mode (skip worktree/branch for main mode, keep the git lock, keep exit-handler file/DB writes pointed at cwd); inject track-reference commit convention into agent instructions
- [x] Phase 3: Skill + CLI — `/laneconductor plan` classifies bug-vs-feature when type is missing (writes it to index.md, reasoning to conversation.md); `lc new --workspace main|branch` flag
- [x] Phase 4: UI — mode visible on track card/detail; type already selectable at creation (existing feature/Bug selector drives the default); project default in Config
- [ ] Phase 5: Tests — **partially done, see plan.md's status note**: pure-resolver unit tests done (13 cases) and 7 pre-existing E2E tests fixed after D6 broke their plan-creates-a-worktree assumption; the dedicated Tasks 2-8 E2E suite (real spawned-worker process tests on real git state for main mode, lazy worktree, auto-queue override, merge skip, dirty-checkout guard, lock serialization, Worktrees-panel exclusion) is NOT written
- [x] Phase 6: Docs — SKILL.md + workflow.md guidance on when each mode is appropriate

## Related tracks
- [10018](../10018-per-track-merge-mode/index.md) — per-track merge mode (pr vs direct); the integration end of the same axis, see interaction section above
- [1112](../1112-git-sync-and-worktree-visibility/index.md) / [1114](../1114-worktrees-panel-deep-link-autopilot-cleanup/index.md) — the worktree machinery this adds an alternative to; 1114's panel scoping already behaves correctly for main-mode tracks (nothing to show)
- [1113](../1113-conversation-worker-interaction-consolidation/index.md) — its planning agent's "Send & Run doesn't exist" false-negative is this track's problem statement in miniature
- [1110](../1110-worker-separation-and-claim-race-safety/index.md) — the lock/claim machinery main mode leans on for serialization
**Merge Mode**: pr
**PR Number**: 6
**PR URL**: https://github.com/meller/laneconductor/pull/6
**PR Status**: conflicted
