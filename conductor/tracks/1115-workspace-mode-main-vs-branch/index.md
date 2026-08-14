# Track 1115: Workspace Mode — main-direct vs branch-per-track

**Lane**: plan
**Lane Status**: running
**Progress**: 0%
**Phase**: Not started — design captured from live discussion 2026-08-14
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

## Open questions for planning
- Does `merge-worktree`/`auto-complete-track` (1114) need a main-mode
  variant, or is "already on main" trivially the merged state? (Likely
  the latter — done:success in main mode needs no merge step at all.)
- Should main mode refuse to start if the primary checkout is dirty
  beyond some threshold, to avoid entangling an agent run with unrelated
  human WIP? (This session's checkout routinely had 50+ ambient dirty
  files — an agent committing on main must not sweep those up.)
- Reconciler interaction: main-mode tracks must be excluded from
  worktree reconciliation entirely.

## Phases
- [ ] Phase 1: Design finalization — resolve the unattended-bug-run tension (options a/b/c above), decide config surface and the dirty-checkout guard; write spec.md with REQs
- [ ] Phase 2: Worker — plan lane always main-direct; worktree created lazily at first implement, honoring the track's resolved mode (skip worktree/branch for main mode, keep the git lock, keep exit-handler file/DB writes pointed at cwd); inject track-reference commit convention into agent instructions
- [ ] Phase 3: Skill + CLI — `/laneconductor plan` classifies bug-vs-feature when type is missing (writes it to index.md, reasoning to conversation.md); `lc new --type bug|feature` flag
- [ ] Phase 4: UI — mode visible on track card/detail; type already selectable at creation (existing feature/Bug selector drives the default); project default in Config
- [ ] Phase 5: Tests — both modes through a full lane action on a real scratch repo; plan-on-main leaves no branch behind; lazy worktree appears only at first implement; main-mode serialization (second dispatch queues, doesn't interleave); dirty-checkout guard
- [ ] Phase 6: Docs — SKILL.md + workflow.md guidance on when each mode is appropriate

## Related tracks
- [1112](../1112-git-sync-and-worktree-visibility/index.md) / [1114](../1114-worktrees-panel-deep-link-autopilot-cleanup/index.md) — the worktree machinery this adds an alternative to; 1114's panel scoping already behaves correctly for main-mode tracks (nothing to show)
- [1113](../1113-conversation-worker-interaction-consolidation/index.md) — its planning agent's "Send & Run doesn't exist" false-negative is this track's problem statement in miniature
- [1110](../1110-worker-separation-and-claim-race-safety/index.md) — the lock/claim machinery main mode leans on for serialization
