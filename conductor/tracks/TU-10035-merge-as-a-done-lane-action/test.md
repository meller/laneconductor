# Tests: Track TU-10035 — Merge As A Done Lane Action

## Test Commands
```bash
# Worker/services unit + integration tests
node --test conductor/tests/track-10035-merge-lane-action.test.mjs

# Existing suites that must stay green (regression guard)
node --test conductor/tests/track-1112-worktree-audit.test.mjs
node --test conductor/tests/track-1112-worktree-merge.test.mjs
node --test conductor/tests/track-10024-auto-complete-spawn-failure.test.mjs

# UI component tests
cd ui && npx vitest run src/components/KanbanBoard.test.jsx src/components/TrackCard.test.jsx src/components/WorktreesPanel.test.jsx
```

## Test Cases

### Phase 1: Workflow semantics + skill command
- [ ] TC-1.1: With the new workflow.json, a quality-gate PASS writes
      `**Lane**: done` / `**Lane Status**: queue` — expected: never
      `done:success` directly.
- [ ] TC-1.2: workflow.json validates — done lane has `on_failure:
      done:failure` and a model; no other lane's transitions changed.

### Phase 2: Worker claims and runs the merge action
- [ ] TC-2.1: A `done:queue` track with `**Auto Run**: yes` is claimed by a
      sync+poll worker and spawns the merge action — expected: Lane Status
      passes through `running`, session transcript file exists.
- [ ] TC-2.2: A `done:queue` track with `**Auto Run**: no` is NOT auto-claimed
      — expected: sits queued until explicit run (▶ / `lc worker run`).
- [ ] TC-2.3: The merge action executes in the primary checkout (cwd == repo
      root, no new worktree created) and takes the global main-mode lock.
- [ ] TC-2.4: Direct-mode clean merge — expected: branch commits reachable
      from main, `done:success`, worktree removed, branch deleted.
- [ ] TC-2.5: Direct-mode with a real (non-bookkeeping) conflict — expected:
      session resolves it and merges, OR exits `done:failure` with a
      conversation.md comment naming the conflicting files; never silently
      back to queue.
- [ ] TC-2.6: After quality-gate exit, no write lands in the worktree copy of
      index.md (single-writer) — expected: branch tip's index.md unchanged
      while primary's advances.
- [ ] TC-2.7: auto-complete-track on a track mid-pipeline ends at `done:queue`
      with no merge attempted by finishAutoCompleteWithMerge.

### Phase 3: PR waiting + reconciler loop
- [ ] TC-3.1: PR-mode merge run — expected: branch pushed, PR created (mock
      gh), PR markers written to primary's index.md, exit `done:waiting`.
- [ ] TC-3.2: Reconciler sees PR merged (mock gh) — expected: `done:success`
      within one cycle, worktree removed, local branch deleted.
- [ ] TC-3.3: Reconciler sees PR conflicted — expected: track moved to
      `done:queue` + system comment; next merge run updates branch from main,
      resolves, pushes, exits `done:waiting`.
- [ ] TC-3.4: A pr-mode `done:queue` track with no PR yet simply gets the
      action re-run (no separate self-heal path fires).

### Phase 4: UI consolidation
- [ ] TC-4.1: KanbanBoard done lane renders groups: queue as "Unmerged",
      waiting as "PR open", plus running/success/failure — driven by
      lane_action_status only.
- [ ] TC-4.2: TrackCard on `done:queue` shows the standard ▶ run button; on
      `done:waiting` shows the PR link; DoneLaneMergeActions no longer exists
      (component removed, tests updated).
- [ ] TC-4.3: WorktreesPanel rows show run/transcript/PR-link; Merge to main /
      Create PR / Merge PR / AI Resolve / Force Merge buttons are gone;
      Discard and Remove Worktree still work.

### Phase 5: Deletions, migration, creation-time flags
- [ ] TC-5.1: Dispatching `merge-worktree` / `create-pr` / `merge-pr` /
      `ai-resolve-conflict` returns failed/unknown-action (handlers deleted).
- [ ] TC-5.2: Every surviving handler's result appears as a conversation.md
      system comment (shared helper) — checked for at least discard-track and
      remove-worktree.
- [ ] TC-5.3: Migration sweep on a fixture repo with (a) done:success +
      unmerged branch, (b) done:success fully merged, (c) DB merge_mode
      disagreeing with file — expected: (a) → done:queue, (b) untouched,
      (c) DB corrected to file value; each change logged as a system comment;
      re-running the sweep is a no-op.
- [ ] TC-5.4: `lc new "T" "d" --merge-mode pr --auto-run yes` — expected:
      index.md contains `**Merge Mode**: pr` and `**Auto Run**: yes`;
      invalid values are rejected with a usage error.

### Phase 6: E2E validation
- [ ] TC-6.1: Direct-mode disposable track full cycle (real worker process,
      mock CLI) — AC-1/AC-2 verified with recorded observations.
- [ ] TC-6.2: PR-mode full cycle with mock gh — AC-3/AC-4/AC-5 verified.
- [ ] TC-6.3: Migration dry-run against this repo — AC-9 verified, output
      reviewed by a human before the real run.

## Acceptance Criteria
- [ ] All new unit/integration tests pass
- [ ] All listed regression suites stay green
- [ ] AC-1 … AC-9 from spec.md each verified with a recorded observation
