# Track TU-10035: Merge As A Done Lane Action

## Phase 1: Workflow semantics + skill command

**Problem**: `done:success` is declared at quality-gate exit, before anything
ships; there is no merge lane action for a worker to run.
**Solution**: Flip the transition and define the action.

- [x] Task 1: `workflow.json` — set `lanes.quality-gate.on_success` to
      `done:queue`; add done-lane action config (`primary_model`,
      `max_retries: 1`, `on_failure: done:failure`). (REQ-1)
- [x] Task 2: Add `### /laneconductor merge [track-number]` to
      `.claude/skills/laneconductor/SKILL.md`: claim (`done:running`), resolve
      merge mode from index.md, direct → merge to main resolving conflicts
      in-session, pr → push + `gh pr create` + PR markers + exit
      `done:waiting`; completion comment convention; boundary rules. (REQ-2,
      REQ-4, REQ-5)
- [x] Task 3: Update SKILL.md's quality-gate section: on PASS the track now
      lands at `done:queue`, not `done:success`.

**Impact**: The state machine tells the truth; the merge step exists as a
first-class action.

## Phase 2: Worker claims and runs the merge action

**Problem**: The worker's lane-action machinery never claims done-lane tracks,
and lane actions always run in the track's worktree — a merge must run on main.
**Solution**: Teach the claim path that done's action executes in the primary
checkout via the existing `workspace: main` machinery (track 1115).

- [x] Task 1: Auto-launch + dispatch claim paths treat `done:queue` as a
      claimable lane action (Auto Run gate, parallel_limit, retries all
      standard). (REQ-2)
- [x] Task 2: Force `workspace: main` execution for the merge action —
      no worktree creation, no track branch checkout; global main-mode lock
      applies. (REQ-3)
- [x] Task 3: Single-writer rule: from `done:queue` onward the worker never
      writes track files in the branch/worktree copy — primary only. (REQ-8)
      Verified by TC-2.6 (`track-10035-merge-lane-action.test.mjs`): a
      leftover worktree copy of index.md is byte-identical after a
      done-lane merge run.
- [x] Task 4: `finishAutoCompleteWithMerge` no longer merges: auto-complete's
      final transition is simply into `done:queue`; the standard machinery
      takes over. (REQ-10, partial)

**Impact**: One claim path, one execution model, live transcript for merges.

## Phase 3: PR waiting + reconciler loop

**Problem**: PR approval happens on GitHub, outside the system; a conflicted
PR currently has no route back to resolution.
**Solution**: `done:waiting` + two reconciler transitions.

- [x] Task 1: Reconciler (existing PR poller): PR merged → `done:success`,
      remove worktree, delete local branch (existing cleanup). (REQ-7)
      Verified E2E (`track-10035-pr-flow-e2e.test.mjs`) against a real
      worker, real git origin, and mock `gh`.
- [x] Task 2: Reconciler: PR conflicted → move track to `done:queue` + system
      comment; next merge run updates branch from main, resolves in-session,
      pushes, exits `done:waiting` again. (REQ-7)
- [x] Task 3: Retire the reconciler's own one-shot PR-opening self-heal in
      favor of the standard retry: a pr-mode track with no PR just sits at
      `done:queue` and the action (re-)runs. Deleted the now-obsolete
      `track-10024-reconcile-missing-pr.test.mjs`, which tested exactly the
      self-heal this task retires.

**Bugs found and fixed while verifying this phase (not scoped tasks, but
load-bearing — the E2E test would not pass without them):**
- `conductor/constants.mjs`'s `LaneActionStatus` enum had no `waiting` value,
  and `ActionStatusAliases` mapped the literal string `'waiting'` back down
  to `'queue'` — a leftover from before this track existed. The Postgres
  enum type already had `'waiting'` (`migrations/20260304181909_enable_rls.sql`),
  but the JS parser silently downgraded every `done:waiting` write to
  `queue` the moment the generic file-sync watcher re-derived
  `lane_action_status` from the file, undoing the exit handler's own
  correct write moments earlier. Fixed by adding `WAITING: 'waiting'` to the
  enum and removing the stale alias.
- `reconcilePrTracks()` never synced `pr_number`/`pr_url`/`pr_status` to the
  DB the first time `lc worktrees create-pr` wrote them — that command runs
  as a standalone CLI subprocess with no connection to the collector,
  unlike the old `openTrackPrOnDone` one-shot (which wrote the file and
  patched the DB together, in-process). Fixed by making the reconciler
  unconditionally re-patch those three fields every cycle instead of only
  on a detected status change.
- Deleted `conductor/tests/track-10018-pr-flow-e2e.test.mjs` (obsolete — it
  exercised the removed one-shot PR-open side effect) and replaced it with
  `conductor/tests/track-10035-pr-flow-e2e.test.mjs`, which drives the full
  new loop: quality-gate → done:queue → merge action opens a real PR →
  done:waiting → simulated GitHub merge → done:success + cleanup.

**Impact**: The conflicted-1119 scenario resolves itself through the standard
path.

## Phase 4: UI consolidation

**Problem**: Two bespoke button surfaces duplicate the merge machinery.
**Solution**: Standard lane affordances only.

- [x] Task 1: KanbanBoard done-lane groups: queue renders as "Unmerged",
      waiting renders as "PR open"; drop the worktree_class-based Unmerged
      split (lane_action_status is now the truth). (REQ-9)
- [x] Task 2: TrackCard: standard ▶ run on `done:queue`, transcript link on
      `done:running`, PR link on `done:waiting`; DELETE DoneLaneMergeActions.
      (REQ-6, REQ-9)
- [x] Task 3: WorktreesPanel: same three affordances on rows; DELETE Merge to
      main / Create PR / Merge PR / AI Resolve / Force Merge; keep Discard +
      Remove Worktree; Complete & Merge relabeled to reflect it ends at
      done:queue. (REQ-6, REQ-9)

**Bug found and fixed while verifying this phase:** `auditWorktrees()`
(`conductor/services/worktree-audit.mjs`) still gated its
mergeable/stranded/conflicted/pr-open classification on
`laneStatus === 'success'` — a leftover from before this track, when
reaching the done lane and reaching done:success were the same moment. A
track sitting at done:queue/done:waiting/done:failure (the normal,
common state right after quality-gate hands off) would have misclassified
as `'open'` (still mid-pipeline), hiding it from the Worktrees panel's
merge affordances entirely and breaking WorktreesPanel's new "Run merge
action" button. Fixed by gating on `lane === 'done'` alone — a genuinely
merged branch never reaches that check at all (the existing isAncestor
early-continue drops it first). Covered by three new parametrized cases in
`track-1112-worktree-audit.test.mjs`.

**UI test updates**: deleted `TrackCard.aiResolve.test.jsx` (tested the
removed AI Resolve button) and rewrote `TrackCard.viewInWorktrees.test.jsx`
/`KanbanBoard.test.jsx`'s outdated worktree_class-based assertions to match
the new lane_action_status-driven behavior. Full UI suite: 543 tests, 513
pass — the 30 failures across 8 files are pre-existing (auth/DB-dependent
tests failing identically on the unmodified tree, unrelated to this track).

**Impact**: One mental model in both views; the completion link is always
visible when a human is the blocker.

## Phase 5: Deletions, migration, creation-time flags

**Problem**: Dead handlers, stranded legacy tracks, stale DB merge_mode, and
no way to declare merge intent at track creation.
**Solution**: Remove, sweep, correct, extend.

- [x] Task 1: DELETE dispatch handlers `merge-worktree`, `create-pr`,
      `merge-pr`, `ai-resolve-conflict` (UI no longer sends them). (REQ-10)
      A stray dispatch of one of these actions now fails cleanly with an
      "unknown action — removed (track 10035)" result instead of falling
      through to the generic lane-action spawn path. `openTrackPrOnDone`
      and `mergeTrackPr`/`checkGhAuth`/`createTrackPr` imports removed
      (unused now); `mergeWorktreeBranch` remains as a primitive, still
      called from the merge action's own code path.
- [x] Task 2: Shared result-comment helper used by every surviving handler.
      (REQ-13) Added `postDispatchResultComment(trackNumber, resultText)`;
      `remove-worktree` (previously posted nothing at all) and
      `discard-track` both migrated to call it. Verified by
      `conductor/tests/track-10035-removed-dispatch-actions.test.mjs`
      (TC-5.1: all four removed actions fail cleanly; TC-5.2:
      remove-worktree's result reaches conversation.md) — 5/5 pass.
- [x] Task 3: Migration sweep: every `done:success` track with a live
      unmerged branch → `done:queue`; DB `tracks.merge_mode` corrected to
      match the file marker where they disagree. Runs once, logs each change
      as a system comment. (REQ-11) Implemented as `lc worktrees
      migrate-done-lane [--dry-run]`: pure decision logic in
      `conductor/services/done-lane-migration.mjs` (`planDoneLaneMigration`,
      9 unit tests), driven off `auditWorktrees()`'s already-resolved
      lane/laneStatus/classification/mergeMode per row — a genuinely merged
      branch never reaches the sweep at all (auditWorktrees' own isAncestor
      early-continue already drops it). DB merge_mode correction goes
      through the primary collector's HTTP API (`GET`/`PATCH /track/:num`),
      not a raw DB connection, so it works uniformly in local-api and
      remote-api mode alike; local-fs (no DB) only gets the file-based
      requeue. Verified end-to-end against a real git fixture
      (`track-10035-migration-cli.test.mjs`): dry-run writes nothing,
      the real run commits the requeue and posts the comment, a
      genuinely-merged track is left untouched, and re-running is a no-op.
- [x] Task 4: `lc new --merge-mode direct|pr --auto-run yes|no` writes the
      markers; document both in SKILL.md newTrack. (REQ-12) Sparse-emission,
      same convention as the existing `--workspace` flag — both markers
      omitted from index.md unless explicitly passed. Invalid values are
      rejected with a usage error and no track is created. Documented in
      SKILL.md's `newTrack` section (both the CLI flags and the AI-driven
      skill-command equivalent). 5/5 tests pass
      (`track-10035-new-track-flags.test.mjs`, AC-8/TC-5.4).

**Impact**: The old paths are gone, not deprecated; legacy tracks converge.

## Phase 6: E2E validation

**Problem**: This changes the trunk of the workflow; unit tests alone can't
prove the loop closes.
**Solution**: Drive real tracks through the full cycle.

- [x] Task 1: Direct-mode E2E: disposable track through
      implement → review → quality-gate → done:queue → merge action →
      done:success; verify commits on main, transcript existed, no bespoke
      buttons involved. (AC-1, AC-2) `track-10035-direct-merge-e2e.test.mjs`:
      a real worker process runs quality-gate (real worktree, real commit),
      done:queue is claimed, the merge action runs the real `lc worktrees
      merge` primitive (via mock-cli's new `MOCK_CLI_RUN_LC_MERGE` flag),
      and the quality-gate commit is proven reachable from local main by
      SHA (not just by branch name, since the branch is deleted as part of
      the same cleanup) — plus worktree/branch cleanup and done:success.
      Found and fixed a real bug while building this: mock-cli's own
      `MOCK_CLI_COMMIT_FILE` helper (added for this test) was committing
      directly into the primary checkout during the done-lane's own
      workspace:main run, creating a spurious conflict with the real merge
      it was supposed to help prove — fixed by scoping that helper to
      non-`done` commands only.
- [ ] Task 2: PR-mode E2E with mock gh (existing harness): done:waiting with
      PR link → simulate merge → success + cleanup; simulate conflicted →
      done:queue → re-run → waiting again. (AC-3, AC-4, AC-5)
- [ ] Task 3: Migration dry-run against this repo's real track set; verify
      AC-9.

**Impact**: Proven loop, not a plausible diff.

## ✅ REVIEWED

**Review Result**: PASS — Phase 5 complete, all tests green (120/120), no regressions detected.

**Verified:**
- AC-7: Bespoke merge buttons removed from UI ✅
- AC-8: lc new creation-time flags working correctly ✅
- Phase 5 Tasks 1-4 all complete with test coverage ✅
- Full regression suite passing (104 existing + 16 new tests) ✅

**Pending for Phase 6 (E2E validation):**
- AC-1/AC-2: Direct-mode end-to-end cycle
- AC-3/AC-4/AC-5: PR-mode end-to-end cycle + reconciler loop
- AC-9: Migration sweep dry-run validation

Ready to proceed to quality-gate.
