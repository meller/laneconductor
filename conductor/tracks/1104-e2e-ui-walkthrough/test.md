# Tests: Track 1104 — E2E UI Walkthrough

## Test Commands
```bash
# Fast-tier Playwright spec produced by Phase 5 (once it exists)
cd ui && npx playwright test --grep "e2e-ui-walkthrough"

# Phase 1 has no automated command — it is a live, recorded browser session
# driven with Playwright browser tools against a running local instance
# (make start-all / lc worker start), not a scripted test run.
```

## Test Cases

### Phase 1: Real browser walkthrough
- [ ] TC-1: New Project wizard produces a registered project — expected:
      project appears in the project selector with `repo_path` set
      immediately after the wizard completes.
- [ ] TC-2: New project directory is a git repo with >= 1 commit —
      expected: `git -C <project> rev-parse HEAD` succeeds; if it fails,
      the failure is filed as (or linked to) 1102 F7, not silently
      worked around.
- [ ] TC-3: UI displays worker machine + mode after project creation —
      expected: hostname and a manual/automatic label are visible; if not,
      the gap is recorded as a finding for track 1103.
- [ ] TC-4: `+ Track` modal scaffolds all 5 files with a populated
      `test.md` — expected: `index.md`, `spec.md`, `plan.md`, `test.md`,
      `conversation.md` all exist, and `test.md` does not contain the
      generic "(Test cases to be added)" stub.
- [ ] TC-5: Plan lane action triggered from the track card's own control
      reaches `plan/success` — expected: observed via UI polling (Activity
      panel / track card), not via `curl`/API.
- [ ] TC-6: Activity panel shows the plan run live — expected: an activity
      entry appears while the action is running and remains readable in
      the track detail drawer after completion.
- [ ] TC-7: A deliberately-broken run (e.g. a lane action against a
      not-a-git-repo project) shows a clear failure reason in the UI —
      expected: no silent `claimed`/`running` limbo (1102 F8); if the UI
      shows nothing, that absence is the finding.
- [ ] TC-8: Inbox reflects real activity from the session — expected: an
      item appears matching the run just performed.
- [ ] TC-9: CI/CD tab + deploy wizard can be walked to its final
      pre-deploy confirmation step without an actual deploy firing —
      expected: wizard reaches the "Deploy" action; walkthrough stops
      there and no deployment is triggered.

### Phase 2: Findings filed
- [ ] TC-10: Every break observed in Phase 1 is either linked to an
      existing 1102 finding or filed as a new `Fn` — expected: no break
      is silently dropped or absorbed without a record.

### Phase 3: Unrepresented-state inventory
- [ ] TC-11: A written list exists enumerating which of {no worker
      running, project not a git repo, lane action failed, which machine}
      the UI currently fails to represent — expected: list is referenced
      from / feeds track 1103 Phase 4.

### Phase 4: Wiki guide
- [ ] TC-12: The wiki UI guide (track 1103 Phase 5 location) matches the
      recorded run — expected: every step in the guide corresponds to an
      actual observed screen/output from Phase 1's session log; no
      invented steps.

### Phase 5: Playwright spec
- [ ] TC-13: `npx playwright test` (fast tier) includes a spec walking
      this documented path and it passes against a real running instance —
      expected: exit code 0, no skipped assertions standing in for
      unverified behavior.

## Acceptance Criteria
- [ ] All Phase 1 steps performed live in a real browser and recorded, not
      simulated or inferred from code.
- [ ] All findings cross-referenced against track 1102 — no duplicates.
- [ ] Playwright spec added to track 1100's fast tier and passing.
