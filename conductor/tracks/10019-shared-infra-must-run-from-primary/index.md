# Track 10019: Shared state must live in main — infra processes AND track metadata

**Lane**: review
**Lane Status**: queue
**Progress**: 100%
**Last Run**: claude/claude-sonnet-5 (primary)
**Type**: dev
**Waiting for reply**: no
**Summary**: All 5 phases implemented — infra path resolution (worker cwd normalization, Makefile, getInstallPath, auditWorktrees lock check) fixed and verified live; startup provenance logging added; continuous doc sync-back with guard-skip surfacing implemented and verified live.

## Problem

This repo dogfoods itself: the files that implement LaneConductor's own
worker orchestration, dispatch, and UI (`conductor/laneconductor.sync.mjs`,
`bin/lc.mjs`, `ui/server/index.mjs`, `ui/src/components/*`) are
simultaneously the infrastructure running the system AND the product
surface that in-flight tracks are actively editing, each inside its own
git worktree. That's expected and fine — a worktree is *supposed* to
diverge from `main` while its track is in progress.

The actual problem: nothing structurally prevents a long-running,
system-wide process (a sync worker, a dev server) from being started
*from inside* one of those worktrees instead of the primary checkout —
and when that happens, everyone using the "live system" is silently
served that worktree's own, possibly very stale or half-finished code,
indistinguishable from the real thing.

Confirmed live so far (both in [1102](../1102-e2e-session-findings/index.md)):
- **F16**: the worker-identity lock computed its path from `process.cwd()`
  — two processes meant to hold the SAME identity's lock could compute
  different paths and never collide, if one was spawned from a worktree.
- **F17**: `lc worker start`/`restart`/`stop`/`worker run`/`worker status`
  all resolved their target script and pidfile from `findProjectRoot(cwd)`
  — running any of them from inside a linked worktree spawned/looked for
  a worker pointed at that worktree's own stale copy of the sync script.
  Live-reproduced: a worker spawned this way recreated the exact
  nested-worktree bug from hours earlier, using code that predated the
  fix entirely.

Both were found by accident, hours apart, from real symptoms (recurring
detached worktrees, "can't delete from the UI"). The open question this
track exists to answer: **what else is exposed to the same class of bug,
and can it be closed off structurally instead of one incident at a time?**

## Scope (candidates to audit — confirm each is either safe or needs the same fix)

- UI dev server (`ui-start` / `make ui-start` / `vite`) — currently
  observed running from primary correctly, but nothing prevents someone
  running `cd .worktrees/X && npm run dev` and serving that worktree's
  frontend on the project's "expected" port instead.
- API server (`api-start` / `ui/server/index.mjs`) — same question.
- Any other `spawn`/`execSync` call site in `bin/lc.mjs` or
  `laneconductor.sync.mjs` that builds a path from `process.cwd()` rather
  than a resolved primary root, beyond the ones F16/F17 already covered.
- Makefile targets (`lc-*`) — do any of them assume `pwd` is the primary
  checkout without checking?
- Whether `resolvePrimaryRepoRoot()` itself needs a cheap cache (it shells
  out to git on every call — fine for occasional CLI commands, worth
  checking it's not called somewhere hot/frequent).

## Problem 2 — track metadata (index/plan/spec/conversation) must be continuously visible in main, not just at run end

Raised directly by the user while looking at track 10018's PR-mode work:
*"plan md, spec md and track info should be seen in main as all the
conversation happens there."* The distinction that matters:

- A track's **code** is supposed to diverge in its worktree until merge —
  that's the isolation model working as designed. (The PR feature existing
  only in `.worktrees/10018` until it merges is correct.)
- A track's **docs** (`index.md`, `plan.md`, `spec.md`, `test.md`,
  `conversation.md`) are NOT feature code — they're the shared
  conversation surface. The board, the DB, the chat, and the human all
  operate against main's copies. If those lag the worktree's, the user is
  conversing with a stale picture of the track's own state.

What already exists (don't rebuild it — close its gaps):
`copyWorktreeArtifactsToPrimary()` (`conductor/services/worktree-artifact-merge.mjs`)
copies the track's docs from the worktree back to the primary at the end
of every run, with `mergeIndexMarkers()` for index.md and
suspicious-shrink guards (the F9 lineage). The orphan-reconcile path
(1110 Phase 6) retries it for runs whose parent worker died. So the
invariant is half-enforced, event-driven, best-effort.

Known gaps to close:
- **Mid-run staleness**: a real run takes 20-30+ minutes; the agent
  updates plan.md/index.md inside the worktree as it works, but main (and
  therefore the board/DB/conversation) only catches up at run end.
  Direction: a periodic doc-sync during runs (the heartbeat already ticks
  every 10s and already owns the merge/guard logic), not just at exit.
- **No run, no sync**: docs edited in a worktree outside a managed run (a
  human, or an agent between runs) reach main only at final merge, or
  never if the branch is discarded.
- **Guard-skipped copies are silent**: when the suspicious-shrink guard
  declines to copy, nothing surfaces that main's copy is now known-stale.

## Non-goals

- NOT trying to make every worktree's copy of infra code identical to
  `main` — that's the opposite of what a worktree is for. A track's
  worktree is *supposed* to diverge until it merges.
- NOT a policy/process change (e.g. limiting how many infra-touching
  tracks can run concurrently) — that reduces the odds of collision but
  doesn't fix the structural gap; this track is about making the gap
  impossible to hit regardless of how many tracks are in flight.

## Related tracks
- [1102](../1102-e2e-session-findings/index.md) — F16 and F17, the two confirmed live incidents motivating this track
- [1114](../1114-worktrees-panel-deep-link-autopilot-cleanup/index.md) — the Worktrees panel work these incidents surfaced during

## Phases
- [x] Phase 1: Audit every candidate spawn/serve/path-resolution site listed above; for each, confirm whether it's vulnerable and whether it needs the `resolvePrimaryRepoRoot()` fix pattern
- [x] Phase 2: Fix whatever the audit finds, one targeted change per site (matching F16/F17's pattern — narrow, not a global `findProjectRoot()` rewrite)
- [x] Phase 3: Consider a lightweight guard/warning (e.g. a startup log line noting "running from worktree, not primary" for any long-running process) as defense-in-depth for whatever this audit doesn't structurally rule out
- [x] Phase 4: Continuous doc sync-back — periodic (piggyback the existing 60s `refreshWorktreeSummaryCache` tick) copy of each live-worktree track's docs to primary via the existing `copyWorktreeArtifactsToPrimary()`/`mergeIndexMarkers()` machinery, instead of only at run end. mtime-compare before copying so untouched files cost nothing. Per-file direction rules: plan/spec/test → worktree wins during a run (agent is sole writer, shrink-guards intact); index.md → `mergeIndexMarkers()` as today; **conversation.md → excluded entirely** — chat replies land in primary's copy while the agent appends to the worktree's, so a blind copy would eat chat messages; the existing conv-sync machinery (`.conv-cursor`) stays that file's sole owner.
  **Decided (2026-08-18, discussed with user): copy-back over read-from-branch.** The alternative — readers using `git show <branch>:<path>` when a worktree exists — was rejected for two reasons: (1) it only sees committed content, so mid-run uncommitted edits (the exact staleness complained about) stay invisible; (2) it forces routing knowledge onto every reader — each consumer (board, DB sync, chat context, `lc show`) would have to correctly answer "is this track in a worktree right now, or running in main?" per track, per moment, forever — while some tracks/lanes legitimately run directly in main (main-mode, workspace-mode) with no worktree at all. Copy-back inverts it: the writer routes (the worker already knows each run's `worktreePath || cwd` at spawn time), readers always read primary, no consumer changes.
  **Implementation deviated from "piggyback refreshWorktreeSummaryCache"**: that function skips local-fs mode, and its `auditWorktrees()` data source drops any worktree whose branch hasn't diverged from main yet — exactly the common case early in a run, before the first commit. Built as its own `syncWorktreeDocsToPrimary()` on its own 60s interval instead, backed by a new `listTrackWorktrees()` (raw `git worktree list`, no branch/commit filtering). See plan.md Phase 4 for the full account.
- [x] Phase 5: Surface guard-skipped copies — when the suspicious-shrink guard declines to sync a doc, log it and mark the track so the board shows "docs may be stale" instead of silently serving old content. Implemented as a de-duplicated `⚠️` `conversation.md` comment (reuses the existing Inbox pipeline) rather than a new marker/DB field.
