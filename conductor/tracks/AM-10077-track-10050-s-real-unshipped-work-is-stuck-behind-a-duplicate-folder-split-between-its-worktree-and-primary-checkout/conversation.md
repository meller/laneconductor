# Conversation: Track 10077

<!-- Last synced comment ID: 0 -->

> **system**: Classified as **Track Kind**: bug — this is a stuck-state defect in this project's own worktree/merge bookkeeping (a never-merged branch reported as done:success, a merge-mode marker read from the wrong side), not new product capability.

> **system**: Investigation complete. Every open question in the problem statement is now answered — findings F1-F7 in spec.md.
>
> Headline: neither index.md copy is authoritative, because provenance is per-field. The branch owns Progress/Phase/Track Kind (written by lane-action sessions in the worktree). The database owns Merge Mode (written to the primary checkout by DB->FS pull, which structurally can never write the topic branch). Git history confirms it: the `direct` marker entered the primary copy only in `chore(...): sync ... DB->FS` commits, never in a `feat(track-10050)` one.
>
> The `direct` merge mode IS trustworthy — the database carries it for 10050 and for the whole sibling batch 10049/10051/10052, a deliberate uniform setting rather than duplicate-folder noise. That resolves scope item 3's precondition.
>
> The work is still wanted. All three defects 10050 fixes are live on main today: `laneconductor.sync.mjs:4458` still passes `startPoint: 'HEAD'`, the same call site then rebuilds the git command with `HEAD` hardcoded back in (silently discarding whatever start point was resolved), and `lock.mjs:138` still hardcodes `origin/main`.
>
> The branch cannot be merged, only ported. `git merge-base main track-10050` returns empty — no common ancestor at all, the same rewrite discontinuity already documented in worktree-audit.mjs. A plain merge would present 58,000 lines across 292 unrelated files. The real work is four commits totalling ~900 lines, mostly new files, and main's call site is still near-identical to the branch's pre-fix version, so the transplant is small.
>
> Scope item 3 generalises further than expected: sampling six tracks with live worktrees found three (10050, 10067, 1119) with the Merge Mode marker in the primary checkout and absent on the branch. Each is silently misclassified as `pr` and offered the wrong flow. This is a class defect, not a 10050 special case.
>
> Also noted: the database asserts `done:success` for 10050 while its code is not on main, alongside `progress_percent=0` and `current_phase='New'` — internally contradictory on its face, and the reason this sat unnoticed. Siblings 10051/10052 show the same shape and are recorded as a Non-Goal.

> **system**: ✅ Plan complete — moved to plan:success.

> **system**: Implement resumed. Phases 1-2 had already landed real commits
> from an earlier run of this session (`5c04b6d0` folder cleanup, `c972cd45`
> index.md reconciliation, `3166c971` the port itself, 23/23 ported tests
> passing) — verified each rather than re-doing it, and found two real gaps
> to close before calling those phases done:
>
> 1. Track 10050's database row still said `lane_action_status=success,
> progress_percent=0, current_phase='New'` — the exact false state this
> track exists to fix (F3) — despite the earlier commit message claiming the
> DB was updated. Corrected it to `queue`/`100`/the real phase and
> re-queried to confirm the write actually landed, per Task 1.4's own note
> not to trust an unverified write.
> 2. The branch's real, uncommitted `conversation.md` (60 lines: planning
> rationale, the 27-ahead measurement, the full review writeup) had never
> been brought into the primary checkout's TU-10050 folder, even though
> Task 1.3 said it was — it lived only in the still-present `.worktrees/10050`
> working directory. Copied it over now; nothing else in the redundant
> `_duplicate`/`_quarantine` folders had any content beyond a stub index.md +
> 2-line spec.md (re-verified via diff against the git history of their
> deletion commit).
>
> Also found Phase 2 had ported the code but not the two doc sections the
> spec explicitly calls out (spec.md's "Phase 2 touches two fundamental
> docs" note) — track-10050's own Phase 4-5 commit (`1f6f6b2d`) added a
> "Worktree base resolution" table to `conductor/product.md` and a
> companion paragraph to `conductor/workflow.md`, neither of which appeared
> in `3166c971`. Ported both verbatim now that the anchor text they insert
> next to still matches current `main`.
>
> Phase 3 (REQ-8): added the primary-checkout Merge Mode fallback to
> `readTrackStateFromBranch()`/`auditWorktrees()` in
> `conductor/services/worktree-audit.mjs`, TDD'd against a new
> `track-10077-merge-mode-fallback.test.mjs` (7 cases, confirmed TC-19 fails
> pre-fix). Verified live against the real primary checkout's actual git
> state (not just fixtures): track 10050 now resolves `mergeMode: 'direct'`
> (was `pr`), and so does 10067. 1119 no longer applies — it's already fully
> merged into `main`. No regression to the PR-fields fallback, the
> no-merge-base discard path, or the forward-completion path (24/24 existing
> `track-1112-worktree-audit.test.mjs` cases, plus the new suite, both
> green).
>
> Regression sweep beyond the two directly-touched files: ran every test
> suite that imports `lock.mjs`, `main-branch.mjs`, or
> `worktree-create-args.mjs` individually (avoided the full `node --test
> conductor/tests/*` sweep after confirming it spawns real, paid `claude`
> CLI subprocesses for some suites — not worth the cost for a change scoped
> to 3 files). Two genuine-looking failures on first pass both traced to
> pre-existing issues unrelated to this port: `lock-unlock.test.mjs` checks
> for the created worktree at a path computed from `cwd`, which is wrong
> when the test itself runs from inside a linked worktree (this session's
> own `.worktrees/10077`) rather than the primary checkout — confirmed the
> actual worktree was created correctly at the real primary-checkout path;
> and `track-1110-lc-start-lock.test.mjs`'s two failures are in the
> unrelated worker-PID-lock mechanism (`bin/lc.mjs`, never touched by this
> track), reproducing the same real-process-timing flakiness already on
> record from track 10073's orphaned-worker incident — a clean re-run of the
> other suite in that same batch went 59/59. Cleaned up the leftover
> `track-9999` worktree/branch the lock-unlock test left behind in the
> primary checkout.

> **system**: Closed out track 10050 (Phase 4): recorded the supersession on
> its own `conversation.md` and removed its dead `track-10050` branch/
> worktree (no merge-base with `main`, F5 — never mergeable, fully
> transplanted and verified). Deliberately did NOT set 10050's
> `Lane Status` to `success` — track 10077 itself hasn't reached `main` yet
> (still `implement`, on its own branch), so the code isn't actually
> reachable from `main` yet. 10050 stays at `done`/`queue`, honestly, until
> this track's own merge lands the port — the exact discipline this whole
> track exists to enforce.
>
> Per this track's spec.md Non-Goals, siblings 10049/10051/10052 are
> deliberately out of scope. Re-checked their DB rows just now: 10051 and
> 10052 still show the same `0% / New` + `done:success` false-completion
> shape as 10050 did; 10049 shows `100% / done:success` — plausibly already
> genuine, not verified here since it's out of scope. The pattern is
> real and not unique to 10050, but fixing it for the other two is a
> separate track's job.

> **system**: ✅ Implementation complete — moved to review:queue.
>
> All 4 phases done, verified against the real product rather than the
> diff throughout: 10050's split state reconciled (folder collapsed to the
> single registered `TU-10050-...`, fields merged by provenance, DB row
> corrected and re-queried); its worktree-base-freshness fix transplanted
> onto this branch and confirmed against the live primary checkout (a real
> scratch `git worktree add` resolved to `main`'s actual HEAD, not `HEAD`
> the literal string); `worktree-audit.mjs` now falls back to the primary
> checkout's own Merge Mode marker, confirmed live against 10050 and 10067's
> real git state (`direct`, not `pr`); and 10050's own dead branch/worktree
> are gone with the supersession recorded.
>
> One deliberate deviation from the plan as written: did NOT set 10050 to
> `done:success` in Phase 4, since this track's own port isn't reachable
> from `main` yet — that will only become true once this track's own merge
> lands. Doing it now would repeat the exact false-completion bug this
> track exists to fix. Full reasoning in spec.md's Acceptance Criteria
> section and plan.md's Task 4.1 note.

> **system**: ✅ REVIEW PASSED
> 
> **Test Verification**: All test suites pass:
> - track-10050-worktree-start-point.test.mjs: 10/10 ✅
> - track-10050-worktree-base-e2e.test.mjs: 9/9 ✅
> - track-10050-lock-cli.test.mjs: 4/4 ✅
> - track-10077-merge-mode-fallback.test.mjs: 7/7 ✅
> - Regression suite (track-1112-worktree-audit.test.mjs): 24/24 ✅
> 
> **Code Quality**: No stubs, TODOs, or FFU markers found in implemented code. All 285 lines of new service code are complete implementations, not placeholders.
> 
> **Requirements Verification**:
> - REQ-1 through REQ-10 all met (scope collapsed, state reconciled, port complete, audit fixed, track 10050 closed)
> - Acceptance criteria validated: track-dir resolves correctly, merge mode reads from right side, existing branches preserved, best-effort degradation works
> - Four commits cleanly track all changes: chore(track-10077), and three feat(track-10077)
> 
> **Deliberate Design Decision Confirmed**: Task 4.1's deviation (not setting 10050 to done:success yet) is correct and well-reasoned — the port hasn't reached main yet, so claiming it's shipped would recreate the exact false-completion bug this track fixes. This will auto-resolve once this track's own merge lands.
> 
> Ready for quality-gate lane.
