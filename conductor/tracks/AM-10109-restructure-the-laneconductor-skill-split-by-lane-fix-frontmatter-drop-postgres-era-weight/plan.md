# Track AM-10109: Restructure the laneconductor skill

Ground rules for every phase:
- Never rename a command, the skill name, or the path `.claude/skills/laneconductor/SKILL.md`.
- Never change what a lane writes to `index.md` beyond the corrections listed in spec REQ-6.
- Work only on branch `track-10109`. The skill is symlinked from the primary checkout into
  every project, so nothing reaches other projects until the merge. Rollback is `git revert`
  of the merge commit.
- Run worker-spawning `node --test` files with `env -u NODE_TEST_CONTEXT`. After each run,
  check `ps aux | grep laneconductor.sync.mjs` for leaked workers (`readlink /proc/<pid>/cwd`
  before calling one a leak). From inside a worktree, a test where every subtest times out on
  "worker registered" is the track-10082 redirect hazard, not a regression.

## Recorded baseline (Phase 1, 2026-11-15)

SKILL.md before: 2,392 lines / 129,829 bytes (commit 20843334). The structure test reads this
baseline with `git show <baseline_commit>:...` (commit hash stored in
`conductor/tests/fixtures/track-10109-invariants.json`), not `main`, so it keeps working after
the merge. Old section line ranges: plan 1411-1515, brainstorm 1517-1540, implement 1542-1666,
review 1668-1705, quality-gate 1707-1834, merge 1836-1926.

## Phase 1: Baseline, invariants and a failing structure test

**Problem**: Nothing currently guards the skill's content, so a restructure could silently
drop a marker write or a command.
**Solution**: Freeze what must survive, then write the test before moving any text.

- [x] Task 1: Record the baseline in this file: `wc -l -c` of SKILL.md (2,392 / 129,829) and
      the byte range of each lane section (plan 1411-1515, brainstorm 1517-1540, implement
      1542-1666, review 1668-1705, quality-gate 1707-1834, merge 1836-1926).
- [x] Task 2: Create `conductor/tests/fixtures/track-10109-invariants.json`. For each lane,
      list the exact strings its file must contain, extracted from today's SKILL.md:
    - [x] plan: `**Lane**: plan`, `**Lane Status**: running`, `**Track Kind**`,
          `lanes.plan.on_success`, `lc track-dir`, `(Test cases to be added)`, `## KPI`,
          `## Draft`, `FUNDAMENTALS CONFLICT`, `✅ Plan complete`, `already been moved`.
    - [x] brainstorm: `> **system**: Brainstorm`, `**Waiting for reply**: yes`.
    - [x] implement: `**Lane**: implement`, `lanes.implement.on_success`, `last_run.log`,
          `## ✅ COMPLETE`, `feat(track-NNN)`, `background`, `FUNDAMENTALS CONFLICT`,
          `**Waiting for reply**: yes` (non-dev), `✅ Implementation complete`.
    - [x] review: `**Lane**: review`, `**Verdict**: pass`, `**Verdict**: fail`,
          `lanes.review.on_success`, `lanes.review.on_failure`, `## ✅ REVIEWED`,
          `✅ REVIEW PASSED`, `⚠️ REVIEW FAILED`.
    - [x] quality-gate: `**Lane**: quality-gate`, `**Verdict**: pass`, `**Verdict**: fail`,
          `lanes.quality-gate.on_success`, `lanes.quality-gate.on_failure`, `done:queue`,
          `measure.mjs`, `## ❌ KPI MISS`, `## ✅ QUALITY PASSED`, `fix(quality-gate)`,
          the stub-scan `grep -rniE`, `Restart long-running processes`.
    - [x] merge: `**Lane**: done`, `lc worktrees merge`, `lc worktrees create-pr`,
          `branch not found`, `**Lane Status**: waiting`, `**Lane Status**: success`,
          `lanes.done.on_failure`, `✅ Merged track-NNN`, `⚠️ PR opened`.
    - [x] SKILL.md: `> **author**:`, `FRESH_SESSION`, `lc track-dir`, `INITIALS-NNN-slug`,
          `workflow.json`, the three completion emoji, `**Waiting On Tracks**`.
    - [x] A test (Task 3) checks that every string is present in **today's** SKILL.md, so the
          fixture cannot contain a typo that later passes vacuously.
- [x] Task 3: Write `conductor/tests/track-10109-skill-structure.test.mjs` (node:test, zero
      deps) with every case in test.md "Phase 1". Run it: the structure cases fail and the
      fixture-validity case passes. Commit as `test(track-10109): skill structure guard (red)`.

**Impact**: The restructure now has a test that fails until it is done right.

## Phase 2: Lane files

**Problem**: The lane procedures are buried at line 1,411+ and cross-reference each other.
**Solution**: One self-contained file per lane, pruned under the Pruning rule.

- [x] Task 1: Create `lanes/plan.md` from lines 1411-1513. Drop step 6's pulse. Inline the
      spec/plan/test templates from 2111-2185 (without the `**Status**` index template).
      Inline the Track Kind / Workspace marker detail from line 1241-1242.
- [x] Task 2: `lanes/brainstorm.md` from 1517-1538.
- [x] Task 3: `lanes/implement.md` from 1542-1664:
    - [x] Keep one copy of the background-command rule.
    - [x] Delete the `**Status**: implement` write.
    - [x] Replace the lock pseudo-call with: "a worker or runner already locked the track and
          started you in `.worktrees/NNN`; by hand on a branch-mode track, use `node
          conductor/lock.mjs NNN` / `unlock.mjs NNN`". First check that wording against
          `conductor/lock.mjs`.
    - [x] Inline the test.md template.
- [x] Task 4: `lanes/review.md` from 1668-1703. Replace "see implement's step 0" with the
      one-sentence reason inline. Inline the Verdict marker rationale (line 1246).
- [x] Task 5: `lanes/quality-gate.md` from 1707-1832, with the same inline replacement. Keep
      the done-gate, stub scan, real-product check and self-healing TDD rule. Lines 1269-1284
      (stale `qualityGate`) are **not** carried over.
- [x] Task 6: `lanes/merge.md` from 1836-1924. Inline the Merge Mode / PR URL marker detail
      (1244-1245).
- [x] Task 7: Pruning pass on each file. For every paragraph, ask whether it carries a
      project fact or an incident lesson. Delete it if not. Keep the incident references
      short (track number + one clause).
- [x] Task 8: Run the lane-file cases of the structure test (self-containment, invariants).
      Commit `refactor(track-10109): per-lane skill files`.

**Impact**: Each lane's full procedure fits in one small file.

## Phase 3: ops/, setup/, deploy/, legacy/

- [x] Task 1: `ops/tracks.md`, holding:
    - newTrack (1322-1376);
    - move (1288-1302);
    - pulse (1306-1318) without `**Status**`;
    - comment (1940-1945);
    - delete (1949-1960) with the lock path checked against `lock.mjs`;
    - revert (1964-1970);
    - status (1020-1050) without the ASCII art;
    - workflow / workflow set (1054-1097) with corrected lane names;
    - updateTrack / reportaBug / featureRequest -> the `lc update-track` / `report-bug` /
      `feature-request` commands;
    - init-tracks-summary as a one-paragraph pointer.
- [x] Task 2: `setup/setup.md` (322-345, 145-161, 768-925, 2366-2391). Delete the dated model
      names. Add "copy the whole folder" for non-symlink installs.
- [x] Task 3: `setup/scaffold.md` (349-557 minus templates, 561-727). Move the `.gitignore`
      fence paragraph **word-for-word**.
- [x] Task 4: `setup/templates.md` (389-527, 730-764).
- [x] Task 5: `deploy/setup-deploy.md` (1101-1213), `deploy/deploy.md` (1217-1225).
- [x] Task 6: `legacy/worker.md`:
    - lc CLI 98-141;
    - activate/deactivate 985-1016, with `lc worker stop`;
    - lock/unlock 1380-1407, with the real scripts;
    - retries 2264-2276, with workflow.json;
    - logging 2280-2318.
- [x] Task 7: `legacy/db-schema.md` (927-961 + 978-981 + 2189-2222). Both schema copies go
      side by side with a note on how they differ (`lane_action_status` /
      `lane_action_result` / `create_quality_gate` vs `created_by_email` / `author` and the
      unique key).
- [x] Task 8: `legacy/syncdb.md` (1974-2010) and `legacy/remote-sync.md` (2014-2051). The
      first copy at 1928-1934 is dropped.
- [x] Task 9: Retarget `conductor/tests/track-10097-scaffold-gitignore.test.mjs` (both
      `skillPath` reads, lines 140 and 162) to `setup/scaffold.md`. Update the "renamed/moved?"
      message. Run it green.
- [x] Task 10: Commit `refactor(track-10109): setup, deploy, ops and legacy skill files`.

## Phase 4: The new SKILL.md index and frontmatter

- [ ] Task 1: Replace SKILL.md with the frontmatter from spec section 5 and the body from spec
      section 6 (routing table, shared protocols, compact marker table). Keep the MIT
      attribution comment.
- [ ] Task 2: Run the routing-completeness case: every `SLASH_COMMANDS` name, the daemon
      aliases and the two setup generate commands resolve to an existing file.
- [ ] Task 3: Check that it fits: <= 200 lines, <= 20,000 bytes, no `$<digit>` /
      `$ARGUMENTS`, valid YAML, description + when_to_use <= 1,536 characters.
- [ ] Task 4: Diff check that nothing was lost unintentionally. For each `^#{1,3} ` heading
      of the old file (outside code fences), confirm it appears in a new file or in spec
      section 3's "deleted" rows. Record the result here.
- [ ] Task 5: Commit `refactor(track-10109): SKILL.md becomes a routing index`. The message
      lists the REQ-6 behaviour corrections.

## Phase 5: Verification

- [ ] Task 1: Full structure test plus the retargeted 10097 test, green.
- [ ] Task 2: Daemon suites from test.md "Phase 5", run on this branch **and** on `main`'s
      tip in a scratch worktree. Compare the failure sets with `comm -23`. No failure unique
      to this branch.
- [ ] Task 3: Symlink and worktree-copy cases (test.md T-SYM-1/2), green.
- [ ] Task 4: Live run (AC-1).
    - [ ] Create a throwaway track **inside this worktree only**:
          `conductor/tracks/AM-99109-skill-split-canary/` with a small, real docs-only
          problem, `**Auto Run**: no`.
    - [ ] Run `claude -p "/laneconductor plan 99109"` with cwd = this worktree, so the branch's
          skill is used.
    - [ ] Check: the markers, the three files, the completion comment, and from the
          transcript the files that were read.
    - [ ] Then run `claude -p "/laneconductor qualityGate 99109"` and stop it after the claim
          (AC-2).
    - [ ] Delete the throwaway folder afterwards. It must never be committed.
- [ ] Task 5: Trigger spot-check (AC-3). In a fresh session in this worktree, type "plan
      track 99109" and "create a track for fixing the README typo" (no slash). Note whether
      the skill was invoked. Repeat once with the old skill on `main` for comparison. Record
      both in conversation.md.
- [ ] Task 6: Size table (AC-6): SKILL.md alone and SKILL.md + each lane file, in bytes and
      bytes/4, against the 129,829-byte baseline. Record it here.

## Phase 6: References and memory

- [ ] Task 1: Update `.claude/MEMORY.md` lines 4-11: the skill is now an index + lanes/.
- [ ] Task 2: Update the header comment in `conductor/services/slash-commands.mjs` (it is
      sourced from the SKILL.md routing table). Comment only.
- [ ] Task 3: Do not chase the prose "SKILL.md step N" comments in sync.mjs and tests
      (spec 1). They are history, not contracts.
- [ ] Task 4: Append a `> **system**:` note to this track's conversation.md listing the
      follow-ups: the stale `.agents/rules/laneconductor.md`; the `lc.mjs runAIAgent` skill
      path (revisit with 10106); legacy commands still in `SLASH_COMMANDS`; the two-skill
      split after 10106/10107.

**Impact**: A per-lane run loads about 4-8k tokens instead of about 32k. The whole index
survives compaction. Lane files can be served one at a time by the connector (10106) and read
by lane-runner sub-agents (10108).
