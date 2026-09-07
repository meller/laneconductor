# Track AM-10077: Reconcile Track 10050's Split State And Land Its Unshipped Fix

Investigation is complete — see `spec.md` findings F1–F7. Every open question
in the original problem statement is now answered, so the phases below are
execution, not further discovery.

Phases are ordered so that the riskiest, highest-value work (Phase 2, the
actual port) happens on a cleaned-up base, and the audit fix (Phase 3) is
verifiable against a track whose state is already correct.

---

## Phase 1: Collapse the folder split and stop the false success

**Problem**: Six directories claim track 10050, five of them redundant; its
`index.md` copies disagree field-by-field; and the database asserts
`done:success` for code that is not on `main`.

**Solution**: Keep the one registered folder, merge the fields by provenance,
and demote the false success to the honest "awaiting merge".

- [ ] Task 1.1: Confirm no unique content in the five redundant directories
    - [ ] Diff each of `_duplicate-10050-...`, `_duplicate-10050-..._q1788429324`,
          `_quarantine-10050-dup-...`, `_quarantine-10050-nonprefixed-...`, and
          the bare `10050-...` against the registered `TU-10050-...`
    - [ ] Confirm each holds only `index.md` + a stub `spec.md`, and that its
          `conversation.md`, if any, carries no comment the survivor lacks
    - [ ] Abort this task and reassess if anything unique surfaces
- [ ] Task 1.2: Remove the five redundant directories in one commit, so the
      deletion is reviewable and revertable as a unit
- [ ] Task 1.3: Reconcile `TU-10050-.../index.md` field-by-field (REQ-2)
    - [ ] Take `Progress`, `Phase`, `Track Kind`, and the refined `Summary`
          from the branch copy (`git show track-10050:...`)
    - [ ] Keep `Merge Mode: direct` from the primary/DB copy
    - [ ] Bring the branch's `plan.md`, `spec.md`, `test.md`, and
          `conversation.md` into the primary folder — the branch is the only
          place they exist in complete form
- [ ] Task 1.4: Set 10050 to `done:queue`, not `done:success` (REQ-3)
    - [ ] Update the file marker
    - [ ] Update the database row so it agrees; verify by re-querying, not by
          assuming the write landed
- [ ] Task 1.5: Verify `lc track-dir 10050` still resolves the survivor, and
      that it is now the only match under `conductor/tracks/`

**Impact**: One folder, one coherent state, and a track that no longer claims
to have shipped code that does not exist.

**Note**: A sync worker is running and periodically rewrites the primary
checkout's `index.md` from the stale database row. Task 1.4's database
correction must land before or alongside Task 1.3, or the pull will undo the
file edit. Re-check the file after the next worker cycle before calling this
phase done.

---

## Phase 2: Port 10050's implementation onto main

**Problem**: The fix exists only on a branch with no common ancestor with
`main` (F5), so it cannot be merged — but the three defects it fixes are live
(F4).

**Solution**: Transplant the work. New files carry over verbatim; the two
call-site changes are re-applied by hand against current `main`.

- [ ] Task 2.1: Transplant the new modules from `track-10050` verbatim
    - [ ] `conductor/services/worktree-start-point.mjs`
    - [ ] `conductor/services/main-branch.mjs`
    - [ ] The `worktree-create-args.mjs` extension (`renderWorktreeAddCommand`)
          applied onto `main`'s existing copy of that file, which predates 10050
- [ ] Task 2.2: Transplant the three test suites
    - [ ] `conductor/tests/track-10050-worktree-start-point.test.mjs`
    - [ ] `conductor/tests/track-10050-worktree-base-e2e.test.mjs`
    - [ ] `conductor/tests/track-10050-lock-cli.test.mjs`
    - [ ] Run each and confirm it fails against unported `main` before Task 2.3
          — a suite that passes before the fix is not testing the fix
- [ ] Task 2.3: Re-apply the `createWorktree()` change at
      `conductor/laneconductor.sync.mjs:4458` (REQ-5)
    - [ ] Resolve the start point via the new service instead of literal `HEAD`
    - [ ] Replace the hand-rebuilt ternary with the single renderer, so the
          resolved start point can no longer be silently discarded
    - [ ] Resolve only when the branch is genuinely new; leave an existing
          branch on `HEAD` (track 1114's data-loss regression)
- [ ] Task 2.4: Re-apply the `conductor/lock.mjs:138` change (REQ-6) — resolve
      the default branch instead of hardcoding `origin/main`
- [ ] Task 2.5: Verify the ported suites now pass, and run the broader worker
      test suite for regressions
- [ ] Task 2.6: Create a real worktree with the running worker and observe the
      branch's actual base commit (REQ-5 acceptance) — restart the worker
      first, it does not hot-reload
- [ ] Task 2.7: Verify best-effort degradation for real (REQ-7) — with `origin`
      unreachable, worktree creation still succeeds on the local default branch

**Impact**: The bug 10050 was opened for is actually fixed in the code that
runs, for the first time.

**Note**: `main`'s call site is still textually near-identical to the branch's
pre-fix version despite the history drift, so Tasks 2.3–2.4 are small. If that
turns out not to hold, stop and re-scope rather than force-fitting the diff.

---

## Phase 3: Make the worktree audit read merge mode from the right side

**Problem**: `readTrackStateFromBranch()` reads `**Merge Mode**` off the branch
tip, where it structurally cannot be for any track whose merge mode came from
the database — misclassifying those as `pr` and offering the wrong flow (F6).

**Solution**: Fall back to the primary checkout's marker before falling back to
the `pr` default, mirroring the PR-fields fallback in `e84a27eb`.

- [ ] Task 3.1: Write the failing test first — a track with no branch marker and
      a `direct` marker in the primary checkout must resolve `direct`
- [ ] Task 3.2: Add the fallback in
      `conductor/services/worktree-audit.mjs` (REQ-8), preserving branch-wins
      precedence when the branch does have a marker
- [ ] Task 3.3: Update the stale `// Track 10018` comment at that read site,
      which currently asserts reading "straight off the branch tip" is
      sufficient — it documents the defect as if it were the design
- [ ] Task 3.4: Confirm no regression to the PR-fields fallback or the
      no-merge-base path (REQ-9), which tracks 9997/10011/10067 depend on
- [ ] Task 3.5: Verify in the running Worktrees panel that 10050, 10067, and
      1119 all show `direct` and no longer offer the GitHub-PR flow — restart
      the API server first

**Impact**: The panel stops offering a PR flow for direct-mode tracks, for the
whole class of tracks, not just 10050.

---

## Phase 4: Close out track 10050 and verify end to end

**Problem**: Once the port lands, 10050's branch is dead history that will keep
showing up in the Worktrees panel and keep inviting a catastrophic merge.

**Solution**: Retire it explicitly, and confirm the whole chain from a clean state.

- [ ] Task 4.1: Move 10050 to `done:success` — now truthful, its code is on
      `main` via Phase 2 (REQ-10)
- [ ] Task 4.2: Record the supersession on 10050's `conversation.md`: the work
      shipped via track 10077's port, the branch had no merge-base and was never
      mergeable
- [ ] Task 4.3: Remove the `track-10050` branch and `.worktrees/10050`
- [ ] Task 4.4: Walk every acceptance criterion in `spec.md` and record the
      observed result for each — the UI ones by looking at the UI, the worktree
      ones by creating a real worktree
- [ ] Task 4.5: Note in `conversation.md` that siblings 10049/10051/10052 show
      the same `0% / New` + `done:success` shape and are deliberately out of
      scope (a Non-Goal), so the pattern is on record

**Impact**: No dead branch, no unmergeable worktree, and the reconciliation is
verified against the real product rather than the diff.
