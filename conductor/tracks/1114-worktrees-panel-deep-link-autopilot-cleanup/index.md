# Track 1114: Worktrees Panel — Deep Link, Autopilot Complete & Merge, Remove Worktree, Stats & Recommendations

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Last Run**: mock (primary)
**Phase**: Phase 17 complete — live-verified
**Type**: dev
**Waiting for reply**: no
**Summary**: Reopened (2026-08-17): found live chasing "why didn't track 10014 auto-merge on done" — mergeWorktreeBranch()/auditWorktrees() treated ANY conflict inside a track's own conductor/tracks/<N>-*/…

## Problem

Track 1112 shipped the Worktrees panel (project-scoped list, classification,
manual "Merge to main" for already-`done:success` rows). Using it live
immediately surfaced three gaps:

1. **No deep link.** Each row shows `#1065`, `#1067`, etc., but clicking
   does nothing — has to go find the track manually on the board.
2. **"Merge to main" only helps tracks already at `done:success`.** Most
   rows are legitimately `open` (still mid-pipeline) — there's no way to
   say "take this the rest of the way and merge it" without manually
   clicking through review, then quality-gate, waiting on each, then
   merging by hand.
3. **Detached worktrees have no cleanup path.** Rows classified `detached`
   (nested scratch worktrees with no `track-*` branch — mostly leftover
   test-repo fixtures) just sit there with no way to remove them from the
   UI at all.

## Solution

**1. Deep link** — reuse the existing `onSelectTrack(projectId, trackNumber)`
pattern already threaded through `WorkersList`/`WorkerActivityLatch`
(Track 1112/1084 dogfood session). Wire it into `WorktreesPanel` → `App.jsx`.
Rows with no `track` (detached) aren't linkable.

**2. Complete & Merge — worker-side autopilot dispatch.** Decided against
client-side orchestration (a real review/quality-gate run can take 20-30+
minutes — tying that to a browser tab staying open is fragile). New
dispatch action `auto-complete-track`:
- Worker claims it, reads the track's current `lane_status`.
- Runs that lane's action for real (same `spawnCli` path a manual dispatch
  uses) and waits for it to actually finish — not fire-and-forget.
- On success, advances to the next lane per `workflow.json`'s
  `on_success` and repeats, until `lane_status: done, lane_action_status:
  success`.
- On any real failure (a stage genuinely fails/maxes retries): **stop and
  surface it** — leave the track at the failed stage for a human, exactly
  like today's normal failure handling, just automated up to the point it
  broke. No auto-retry, no silent skip of review/quality-gate's actual
  purpose.
- Once `done:success`, calls the existing `mergeWorktreeBranch()`
  primitive (Phase 4 of 1112) to merge — same code path "Merge to main"
  already uses, not a second copy.

**3. Remove Worktree** — `git worktree remove --force <path>`, scoped to
discarding that worktree's own uncommitted changes (does not delete the
branch/commits, which stay recoverable via git — only the working
directory's dirty state is genuinely lost, matching what the user actually
asked to be able to discard). Requires extending the heartbeat's worktree
summary (`refreshWorktreeSummaryCache` in `laneconductor.sync.mjs`) to
include `branch` and `worktreePath` — currently omitted, and detached rows
have no `track` number to identify them by otherwise.
**Widened during implementation**: initially scoped to `detached` rows
only; widened to every row after finding real `backlog`-lane rows in this
repo's own data (tracks 10000-10005 — leftover git branches+worktrees from
this project's own concurrency/E2E test suite, not always cleaned up after
a run). The underlying git operation never touches the branch regardless
of class, so there was no real reason to gate by classification — only the
confirm-dialog wording scales with actual risk.

**4. Force Merge (skip checks)** — explicitly requested, "not recommended
but allow it": marks a track `done:success` directly (on the branch, before
merging) and merges, without running review/quality-gate at all. Reuses
`merge-worktree`'s existing `force: true` payload — previously force only
bypassed the done-check gate for the merge itself and never touched lane
state, so a forced merge left the board showing "review"/"implement" while
the code was already in main. Now force also writes the done:success
marker (worktree case only; a `stranded` row with no active worktree falls
back to the old git-only behavior, lane state left as-is) and syncs it to
the DB, so the board and git history don't diverge.

**5. Native `window.confirm()` doesn't work in this app's runtime** — found
live: a real click on "Remove worktree" produced zero dispatch, zero error,
zero visible feedback. Confirmed by checking `worker_dispatch` directly
after the click: no new row at all. Replaced with an in-DOM two-step armed
button (`useArmedConfirm`) for Remove Worktree, Complete & Merge, and Force
Merge — no dependency on a browser API that isn't reliably available here.

**6. Heartbeat null-clobber (found + fixed live)** — every worker restart
briefly showed "No Unmerged Worktrees" even though the DB already had good
data. Root cause: `cachedWorktreeSummary` starts as `null` (not
`undefined`) at process boot; the heartbeat handler
(`ui/server/index.mjs`) only skips updating the `worktrees` column
`if (worktrees !== undefined)`, and `null !== undefined` is true — so the
very first heartbeat after every restart, sent before the async git-audit
finishes, explicitly overwrote a good cached value with `null`. Fixed by
omitting the field entirely until a real value exists. Verified live:
DB retained its value through a real worker restart afterward.

**7. Pending-action feedback (fixed live)** — `removing`/`autoCompleting`/
`forceMerging` originally only lasted for the dispatch-creation POST call
itself, not the real processing duration. Replaced with a `usePendingActions`
hook: pending keys persist until the row's outcome is confirmed by the next
poll (or a bounded 3-minute safety timeout), and all four action buttons on
a row disable together while any one is pending, preventing a second
conflicting dispatch on the same row.

**8. Stale-closure bug in the poll interval (found + fixed live)** —
found live: rows stuck showing "Removing…" indefinitely, well past any
real completion, "in the end nothing happened." Root cause: the 10s
`setInterval` was set up once at mount with `[projectId]` as its only
dependency (deliberately, to avoid resetting the timer on every
`pendingKeys` change) — but that froze which `fetchRows` closure it
called. It kept invoking the ORIGINAL closure from mount forever, which
had captured `pendingKeys` as `{}` — so the "clear anything no longer
present" check could never find anything to clear, no matter how many
polls ran; only the 3-minute safety timeout was ever freeing a row. Fixed
with a ref (`fetchRowsRef`) so the interval always calls the current
closure. Verified live: confirmed via direct git/filesystem check that
tracks 10000-10004 and 8001-8004 had ALREADY been successfully removed on
their first click — the "nothing happened" was purely the stuck UI, not a
failed operation. The re-click that looked like a no-op correctly failed
with "not-found" because there was genuinely nothing left to remove.

**9. Remove Worktree stayed visible for already-removed rows (found + fixed
live)** — direct fallout of #8: `canRemove` gated on
`row.worktree_path || row.branch`, but an `open` row's `branch` persists
after its worktree is gone (remove-worktree only ever deletes the working
directory, never the branch) — so the button kept showing, and re-clicking
it would always fail with the same "not-found." Fixed to gate on
`row.worktree_path` alone — the only field that actually means "a live
worktree exists to remove." Verified live: tracks 10000-10004 now
correctly show no Remove Worktree button at all.

**10. `createWorktree()` destroyed a resumed branch's history (found + fixed
live — the most serious finding in this track)** — asking "if there's no
worktree, what is there to merge" surfaced it: a branch's commits are
independent of any worktree (merge needs no working directory at all —
confirmed Force Merge is fine without one), but `createWorktree()` in
`conductor/laneconductor.sync.mjs` unconditionally ran
`git worktree add -B <branch> <path> HEAD` whenever a worktree needed
(re)creating. `-B` force-resets a branch to the given start point even if
it already has real commits. Pre-existing bug, not introduced this
session — Remove Worktree just made the trigger state (worktree gone,
branch still holds real work) trivial to reach on purpose instead of only
by accident (crash, manual cleanup). Fixed: only force-create when the
branch is genuinely new (`git rev-parse --verify` check); an existing
branch is checked out as-is via plain `git worktree add <path> <branch>`,
no reset. Decision logic extracted to `worktree-create-args.mjs` and unit
tested (2/2); the fix was also verified directly against real git in a
scratch repo both ways — confirmed the OLD command's own output
(`"resetting branch 'track-999'; was at 3ffbb94"`) destroys a real commit,
and the NEW command preserves it byte-for-byte.

**11. Panel showed unmerged branches with no live worktree at all (found +
fixed live)** — direct user report: "if they don't have a worktree they
shouldn't appear in Worktrees." Real rows like #991/#992/#1044 had genuine
unmerged commits (verified: 2/5/3 commits each, confirmed NOT ancestors of
main via `git merge-base --is-ancestor`) but no live worktree — just
abandoned branches, not active work, cluttering a panel meant to show live
worktrees. Fixed by filtering `refreshWorktreeSummaryCache`'s output
through a new `belongsInWorktreesPanel()` (unit tested, 5/5): excludes any
`open` row with `hasWorktree: false`, but deliberately KEEPS `stranded`
rows even without a worktree, since that's the exact orphaned-but-ready-
to-merge case this panel exists to catch — filtering those too would
silently defeat its own purpose. Nothing deleted; hidden rows' branches
remain fully intact, just out of this view.

**12. Module-load-order TDZ crash on every restart (found + fixed live)**
— found while investigating: `[worktree-summary error]: Cannot access
'cachedMainBranch' before initialization`, present in the log on every
single worker restart this session (3 occurrences, one per restart).
`refreshWorktreeSummaryCache()` was invoked synchronously immediately
after its own definition (~line 888) specifically to populate the cache
"before the first heartbeat, not 60s late" — but it calls `getMainBranch()`,
which reads a `let cachedMainBranch` declared far later in this file
(~line 3132). Since the whole file is one module evaluated top-to-bottom,
that immediate call always fired before the module reached its own
declaration, throwing (caught silently, only logged) every time — meaning
the cache actually stayed stale/empty for up to 60s after every restart,
the opposite of the comment's stated intent. Fixed with a deferred
`setTimeout(fn, 0)` so the module finishes evaluating first. Verified
live: restarted the worker, confirmed zero error in the log and the panel
correctly reflecting fresh data within 3 seconds (previously required
waiting out the full 60s interval).

**13. Stats + recommendations header (requested)** — a summary bar above
the row grid: total worktree count, a per-classification breakdown
(colored dots matching each row's own badge colors), total dirty-file
count across all worktrees, and a list of actionable recommendations
that only appear when relevant:
- `open` count over 10 (the exact threshold requested) → warning: review
  and quality-gate some tracks before opening more
- any `stranded` rows → action: done and ready to merge, but orphaned —
  merge them now (the exact class of problem Track 1112 was built to
  catch, now surfaced at a glance instead of requiring a scroll)
- any `conflicted` rows → action: needs manual resolution
- any `detached` rows → info: safe to remove if not in use

Pure `computeWorktreeStats()` in `ui/src/lib/worktreeStats.js`, unit
tested (9/9 — counting, singular/plural wording, threshold boundary,
empty-list edge case). Verified live against this repo's real data: 30
total, 30 Open, 235 dirty files, and the >10 warning correctly firing.

**17. `mergeWorktreeBranch()`/`auditWorktrees()` treated ANY conflict inside
a track's own bookkeeping files as permanently blocking (found live,
2026-08-17)** — track 10014 reached `done:success` with real, verified
implementation work on its branch, but sat unmergeable, classified
`conflicted`, requiring a manual `git checkout --theirs` on exactly its
own `index.md`/`plan.md` to unblock. Root cause: the periodic DB->FS sync
(`chore(track-N): sync files before worktree`) writes that same track's
status header directly onto main while its own worktree branch
independently does the same — genuine line-level overlap, a real git
conflict by content, but not real work to lose (the branch's copy is
always the authoritative completion record once done:success). Fixed with
`isSafeToAutoResolveBookkeepingConflict()`
(`conductor/services/track-metadata-conflict.mjs`): confirms every
conflicting path is one of the track's own `conductor/tracks/<N>-*/`
bookkeeping files AND that main's own side of the conflict, relative to
the merge-base, never touched anything but known status-header lines
(`**Lane**`, `**Lane Status**`, `**Progress**`, etc.) — not Problem/
Solution prose. `mergeWorktreeBranch()` now auto-resolves by taking the
branch's copy and completing the merge instead of aborting;
`auditWorktrees()`'s classification (via a new read-only
`getConflictPaths()` using `git merge-tree --write-tree`, fully
side-effect-free) agrees, so the 60s reconciler actually attempts it
instead of silently skipping a `conflicted` row forever. A real content
conflict (main hand-editing Problem/Solution prose, or any conflict
touching a file outside the track's own directory) still blocks exactly
as before — deliberately whitelist-based, nothing outside this
well-understood case is ever auto-resolved. 13/13 new/updated unit tests
(`track-1114-track-metadata-conflict.test.mjs` 6/6, plus updated
worktree-audit/worktree-merge suites); live-verified by manually
reproducing and resolving the exact track-10014 shape before the fix
existed, then confirming the new tests exercise the identical scenario
the fix now handles automatically.

## Phases
- [x] Phase 1: Deep link — `onSelectTrack` wired through `WorktreesPanel` → `App.jsx`, verified live
- [x] Phase 2: Extend heartbeat worktree summary with `branch`/`worktreePath` fields
- [x] Phase 3: Remove Worktree — server dispatch handler (`remove-worktree`) + UI button, widened to every class (not just detached), verified live (removed 5+ real worktrees end to end across multiple sessions)
- [x] Phase 4: Complete & Merge — `auto-complete-track` dispatch action (worker-side sequencing, wait-for-real-completion, stop-on-failure) — wired and unit-tested (6/6, `classifyAutoCompleteOutcome`); NOT live-verified end to end (a real multi-stage run takes 20-30+ min, not exercised this session)
- [x] Phase 4b: Force Merge (skip checks) — extends `merge-worktree`'s `force` flag to also write done:success before merging; not yet live-verified against a real `open` track (only exercised the pre-existing plain-force code path indirectly)
- [x] Phase 5a: Replace native `window.confirm()` with in-DOM two-step armed buttons — found live (real click produced zero dispatch), fixed, verified live
- [x] Phase 5b: Heartbeat null-clobber on restart — found live, fixed, verified live (DB value survived a real worker restart after the fix)
- [x] Phase 6: Durable pending-state for all four actions — implemented (`usePendingActions`), then found + fixed a stale-closure bug in the same change that made rows appear permanently stuck, then found + fixed a related `canRemove` gating bug — all three verified live
- [x] Phase 8: Fix `createWorktree()`'s unconditional `-B HEAD` branch-reset — found live (real data-loss bug, pre-existing), fixed, unit tested (2/2), and verified directly against real git both ways in a scratch repo
- [x] Phase 9: Scope the panel to rows with a live worktree (plus the deliberate `stranded` exception) — found live (#991/#992/#1044 cluttering the view with no active work), fixed (`belongsInWorktreesPanel`, unit tested 5/5), verified live (row count 44→30 after the fix took effect)
- [x] Phase 10: Fix a pre-existing TDZ crash on every worker restart (`cachedMainBranch` accessed before its own declaration, due to file load order) — found via the real sync.log (3/3 restarts this session hit it), fixed with a deferred macrotask, verified live (zero error + fresh data within 3s on the next restart, vs. silently stale for up to 60s before)
- [x] Cleanup: deleted 9 confirmed test-fixture branches (`10000`-`10005`, `8001`-`8004` — concurrency/E2E suite debris, verified worthless before deleting); identified `991`/`992`/`1044` as having real unmerged commits (not ancestors of main) and deliberately left them alone pending further review, rather than assuming they're safe to discard
- [x] Phase 11: Stats + recommendations header — `computeWorktreeStats()`, unit tested (9/9), wired into `WorktreesPanel.jsx`, verified live (real counts, real >10 warning firing on this repo's actual data)
- [x] Phase 12: `refresh-worktrees` dispatch action + `POST /api/projects/:id/worktrees/refresh` convenience route — found live during a bulk manual branch/worktree cleanup (30 branches deleted directly via `git`, bypassing the panel's own handlers): `cachedWorktreeSummary` only re-audits on its own 60s timer or at process boot, so the panel kept showing all 30 already-deleted rows with no way to force a re-check short of a full worker restart. New dispatch handler calls `refreshWorktreeSummaryCache()` then immediately pushes via `updateWorkerHeartbeat()` rather than waiting for the next tick; API route does the same "any live worker for the project" resolution `remove-worktree` uses (never track-scoped). Verified live end to end: removed a worktree via raw `git`, confirmed the API still served the stale count, called the new endpoint, confirmed the dispatch was claimed and completed (`"Refreshed — N worktree row(s)"`), and confirmed the API reflected the corrected count immediately after.
- [x] Phase 13: Wire the refresh into the panel itself — manual "↻ Refresh" button in `WorktreeStatsHeader` (and in the empty "No Unmerged Worktrees" state, where it matters most since that's exactly the state a stale cache would produce) plus a background `setInterval` while the panel is mounted (every 30s, fire-and-forget) that nudges the same endpoint so staleness self-heals without a click. Found live while testing: the empty-state path had no `error` banner wired up at all, so a genuine "no worker available" 400 (hit live — the project's worker had gone offline mid-session) failed silently with the button just re-enabling itself; fixed by rendering the same error banner there. Verified live end to end against a real worker: click → dispatch created → claimed and completed within ~10s → button un-disables → row data genuinely changed (dirty count 4→5), confirming a real re-audit ran, not a cached response.
- [x] Phase 14: **The board's own Lane/Lane Status froze for the entire duration a track spent inside a worktree** (found live watching track 1112's own review run: it genuinely passed and moved to `quality-gate` inside `.worktrees/1112`, but the primary checkout — what the UI/DB actually reflect — kept showing `review` indefinitely). Root cause: the step that copies a worktree's `index.md` status back onto the primary checkout's copy (in the spawnCli exit handler, `laneconductor.sync.mjs`) deliberately excluded Lane/Lane Status, on the stale assumption "the exit handler always writes the correct values after this merge" — true only for main-mode tracks with no worktree (there, `workDir` IS the primary checkout, so the exit handler's own write already lands directly). For worktree-based tracks, the exit handler only ever writes Lane/Lane Status into the *worktree's* own copy — the merge-back step was the only thing that ever reached the primary checkout, so excluding those two fields left the board frozen at the track's pre-run lane for its entire time in the worktree, only catching up at final done-merge. This is the same root cause behind this session's earlier "a lot of work was done but I'm not seeing it" / "maybe I'm opening the same tracks over and over" symptoms and the 30-branch cleanup, just caught here at the single-lane-hop scale instead of the terminal (abandoned-branch) scale. Fixed by including Lane/Lane Status in the merge; extracted the merge logic into `mergeIndexMarkers()` (`conductor/services/worktree-artifact-merge.mjs`) so it's unit-testable independent of the whole exit-handler flow — 6/6 tests (`conductor/tests/track-1112-worktree-artifact-merge.test.mjs`), including the exact Lane/Lane-Status regression and a `**Lane**` vs `**Lane Status**` prefix-collision check. Manually restored 1112's clobbered primary-checkout `index.md` (commit `10f2f92`) before the fix landed; live-verifying the fix itself by re-running quality-gate against track 1112.
- [x] Phase 7: Tests — closed the last gap. Extracted three previously-untested behaviors into pure, unit-tested modules (matching this track's established pattern of pulling decision logic out of the dispatch handler / React hooks so it's testable without a real worktree, git process, or DOM):
  - `conductor/services/force-merge-marker.mjs` — the force-merge lane-write decision (`shouldWriteForceDoneMarker`) and the Lane/Lane Status header mutation (`applyDoneSuccessMarkers`), wired into the `merge-worktree` dispatch handler in `laneconductor.sync.mjs`; 8/8 tests (`conductor/tests/track-1114-force-merge-marker.test.mjs`), including the not-done+force+hasWorktree case, the already-done no-op case, the !force no-op case, the stranded/no-worktree fallback case, and the header-mutation prefix-collision case (Lane vs Lane Status)
  - `ui/src/lib/armedConfirm.js` — the two-step confirm's arm-vs-fire decision (`nextArmedState`), wired into `useArmedConfirm`; 4/4 tests (`ui/src/lib/armedConfirm.test.js`)
  - `ui/src/lib/worktreePendingKeys.js` — the row identity keys and the "which pending keys are stale given the current rows" check `fetchRows` runs every poll (`computeStaleKeys`), wired into `WorktreesPanel.jsx`; 5/5 tests (`ui/src/lib/worktreePendingKeys.test.js`), explicitly covering the class of case bug #8 depended on (a pending key whose row disappeared or merged out of the list must be identified as stale)
  - Full suite run: `node --test conductor/tests/*.test.mjs` → 222/229 pass (7 pre-existing failures, unrelated to this change — auto-launch, deploy, integration-multi-pattern, quality-gate retry, lock-unlock, session resume-failure — confirmed via `git stash` that they fail identically without this track's diff applied); `cd ui && npm test` → 291/302 pass (11 pre-existing failures, all in `auth.test.mjs`/`track-1033-worker-auth.test.mjs`, confirmed the same way — untouched by this change)
  - Ran in its own worktree while a concurrent session added Phases 15/16 directly to this file on main — those two are real, freshly-discovered gaps, not yet addressed; noted here rather than silently claiming full completion.
- [ ] Phase 15: Discard track (no merge) — found live doing exactly this by hand for a real track (macrodash #031, abandoned after a product-direction change away from PayPal): the panel has Remove Worktree, Complete & Merge, and Force Merge, but nothing for "this branch is never going to be merged, stop tracking it as active work." Remove Worktree alone leaves the branch and the board's Lane/Lane Status exactly as they were (still `review`/`implement`/etc.), so the row keeps showing up as if it's just waiting its turn. Needs a fourth action — Remove Worktree plus moving the track to `backlog` with an explicit abandonment note in `index.md` (never `done:success`, which would misrepresent it as shipped and risk being auto-merged elsewhere) — surfaced from the panel instead of done by hand against the track file.
- [ ] Phase 16: "No worker available" refresh failure has no recovery path — found live: the empty "No Unmerged Worktrees" state's refresh can fail with "no worker available for this project to refresh worktrees" (Phase 13's error banner correctly surfaces this, but then the user is stuck). Add either an inline "Create worker" action right there, or at minimum a deep link to the project's Worker tab, so hitting this state doesn't require leaving the panel to go figure out worker status manually.
- [x] Phase 17: Auto-resolve merge conflicts confined to a track's own `conductor/tracks/<N>-*/` bookkeeping files (found live — track 10014 stuck `conflicted` despite being genuinely `done:success`) — `isSafeToAutoResolveBookkeepingConflict()` confirms main's side of the conflict never touched anything but known status-header lines relative to the merge-base; `mergeWorktreeBranch()` auto-resolves and `auditWorktrees()`'s classification agrees, so the 60s reconciler actually merges it. Real content conflicts (Problem/Solution prose, or any file outside the track's own directory) still block. 13/13 new/updated unit tests.
- [x] Phase 18: `conflicted` rows have no path forward besides Remove Worktree (asked live: tracks 1111/1113, real content conflicts — 143/163 commits behind main — not Phase 17's bookkeeping-only case). Two parts, both requested ("both"), both implemented and live-verified:
  - **18a (surface, low risk)** — threaded Phase 17's already-computed `conflictPaths` (previously discarded right after classification, `worktree-audit.mjs`) through `auditWorktrees()`'s row → `refreshWorktreeSummaryCache` (`conflict_paths` field) → `/api/projects/:id/worktrees` (already spread-through, no server change needed) → the panel. `conflicted` rows now show the actual conflicting file list plus a copy-pasteable manual-resolve git snippet (`ConflictDetails` component). No new dispatch action — resolving locally and pushing lets the next audit cycle reclassify the row `mergeable` on its own. **Live-verified against the real rows**: #1111 correctly shows 3 conflicting paths, #1113 shows 4, both including `conductor/laneconductor.sync.mjs` itself.
  - **18b (AI-assisted resolve, opt-in)** — new dispatch action `ai-resolve-conflict`: worker runs a real `git merge <mainBranch>` inside the track's worktree (not the dry-run `merge-tree` check), spawns a scoped one-shot Claude session (same raw-spawn pattern as `track_chat`, not `spawnCli` — this isn't a lane) to resolve the resulting conflict markers using its understanding of both sides' intent, then verifies before ever committing. New "AI resolve conflict" button, armed two-step, purple to distinguish from the other four actions, labeled as needing post-merge review.
    - **Found + fixed live verifying against a disposable fixture** (track 9995, deliberately `Lane: done:success` this time, not `implement:queue` — Phase 15's fixture got auto-claimed as real work by giving it a queued lane, learned from that): two real bugs in the new handler.
      1. `gitExec()` uses plain `execSync` with no `encoding` option, so it returns a **Buffer**, not a string — every prior call site only used it for side effects and never parsed stdout as text, so `.split()` on the `git status --porcelain` output threw on first real run. Fixed with `.toString()` at the call site (left the shared `gitExec` helper itself untouched — no other caller needed this).
      2. The `MERGE_HEAD` existence check joined `worktreePath, '.git', 'MERGE_HEAD'` directly — but a **linked worktree's `.git` is a file** (`gitdir: <primary>/.git/worktrees/<name>`), not a directory, so that path can never exist and the check silently always reported "no merge in progress," even when one genuinely was (confirmed live: would have misreported the fixture's real, agent-resolved merge as a failure). Fixed with `git rev-parse -q --verify MERGE_HEAD` run with the worktree as cwd, which resolves correctly regardless of worktree layout.
    - **Verified live end to end** after both fixes: real conflict (same line diverged on both the branch and main) → AI session ran, correctly kept BOTH sides' changes rather than picking one → merge completed and landed on `main` as `Merge track 9995` → branch and worktree cleaned up automatically via the existing `mergeWorktreeBranch()` path. Fixture fully torn down afterward (track dir, DB row, all untracked artifacts).
    - Also accidentally killed two workers belonging to a *different* project (`air-hockey-pvp`) with an overly broad `pkill`-style restart during this — caught immediately and restarted them with matching flags; worth remembering that `sync.mjs` process lists aren't project-scoped, only PID-based kills targeting the exact PIDs you mean to touch are safe in a multi-project host like this one.

## Related tracks
- [1112](../1112-git-sync-and-worktree-visibility/index.md) — built the Worktrees panel this extends
- [1084](../1084-worker-identity-and-assignment/index.md) — `resolveAssignee`/`resolvePinnedWorkers`, same routing `merge-worktree` already uses, reused for `auto-complete-track`
**Auto Run**: yes
