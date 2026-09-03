# Tests: Track TU-10050 — Worktree Base Freshness

## Test Commands

```bash
# Phase 1 — pure resolver unit tests
node --test conductor/tests/track-10050-worktree-start-point.test.mjs

# Phase 4 — real-git end-to-end
node --test conductor/tests/track-10050-worktree-base-e2e.test.mjs

# Regression guard — track 1114's no-reset guarantee must still hold
node --test conductor/tests/track-1114-worktree-create-args.test.mjs

# Neighbouring worktree suites that share the changed code path
node --test conductor/tests/track-1112-worktree-merge.test.mjs \
            conductor/tests/track-1112-worktree-audit.test.mjs \
            conductor/tests/track-1112-worktree-visibility.test.mjs \
            conductor/tests/worktree-create-path-resolution.test.mjs \
            conductor/tests/primary-root-normalization.test.mjs \
            conductor/tests/track-10045-worktree-isolation.test.mjs

# Full worker suite
node --test conductor/tests/

# Vitest side (UI + server units) — must stay green
cd ui && npm test
```

## Test Cases

### Phase 1 — `resolveWorktreeStartPoint()` (pure, no git)

File: `conductor/tests/track-10050-worktree-start-point.test.mjs`

- [x] TC-1: `{ mainRefExists: true, fetchOk: true, ahead: 0, behind: 3, pullOutcome: 'pulled' }`
      — expected: `{ startPoint: 'main', reason: 'refreshed', staleBy: 0 }`. The pull already
      moved local `main` to `origin/main`, so the named local ref is the fresh one.
- [x] TC-2: `{ mainRefExists: true, fetchOk: true, ahead: 0, behind: 3, pullOutcome: 'dirty-overlap' }`
      — expected: `{ startPoint: 'origin/main', reason: 'remote-ahead-pull-refused', staleBy: 0 }`.
      Local `main` has no unique commits (`ahead === 0`), so the remote ref is strictly
      newer and nothing can be lost by using it.
- [x] TC-2b: same as TC-2 with `pullOutcome: 'auto-pull-disabled'` and again with
      `'merge-failed'` — expected: identical result. All three refusals are equivalent here.
- [x] TC-3: `{ mainRefExists: true, fetchOk: true, ahead: 27, behind: 0, pullOutcome: null }`
      — expected: `{ startPoint: 'main', reason: 'local-ahead', staleBy: 0 }`. **This is
      this repo's live steady state**; asserting `origin/main` here would be the regression
      spec.md warns about.
- [x] TC-4: `{ mainRefExists: true, fetchOk: true, ahead: 4, behind: 2, pullOutcome: null }`
      — expected: `{ startPoint: 'main', reason: 'diverged', staleBy: 2 }`. Never
      `origin/main` (would drop 4 local commits); `staleBy` reports the 2 missing.
- [x] TC-5: `{ mainRefExists: true, fetchOk: true, ahead: 0, behind: 0 }` — expected:
      `{ startPoint: 'main', reason: 'local-ahead' | 'in-sync', staleBy: 0 }`. In-sync must
      resolve to the local named ref and must never be reported stale.
- [x] TC-6: `{ mainRefExists: true, fetchOk: false, ahead: null, behind: null }` — expected:
      `{ startPoint: 'main', reason: 'offline', staleBy: null }`. `staleBy` is `null`, not
      `0` — the caller must distinguish "known fresh" from "cannot tell" (drives REQ-7's
      silence).
- [x] TC-7: `{ mainRefExists: false, … }` — expected: `{ startPoint: 'HEAD', reason: 'no-main-ref', staleBy: null }`,
      for **every** combination of the other inputs. Preserves today's behavior on a repo
      with one commit and no `main` ref (`laneconductor.sync.mjs:7086`).
- [x] TC-8: `mainBranch: 'master'` with TC-1's and TC-2's inputs — expected: `'master'` and
      `'origin/master'` respectively. No `main` string is hardcoded anywhere in the module.

### Phase 4 — real-git end-to-end

File: `conductor/tests/track-10050-worktree-base-e2e.test.mjs`
(scratch-repo helper modelled on `conductor/tests/track-1112-worktree-merge.test.mjs`)

- [x] TC-9 (**AC-1**): local `main` 2 commits behind a real `origin/main`, clean tree →
      create worktree for track N → expected: `git -C .worktrees/N rev-parse HEAD` equals
      `origin/main`'s SHA, and local `main` has been fast-forwarded to it.
- [x] TC-10 (**AC-2**): local `main` 3 commits ahead of `origin/main` → create worktree →
      expected: worktree `HEAD` equals local `main`'s SHA, and all 3 local-only commits are
      ancestors of it (`git merge-base --is-ancestor <sha> HEAD` succeeds for each). This is
      the case a naive `origin/main` fix breaks.
- [x] TC-11 (**AC-3**): primary checkout on an unrelated branch `scratch-wip` whose tip is
      **not** on `main` → create worktree → expected: worktree `HEAD` equals `main`'s SHA,
      and `scratch-wip`'s tip commit is **not** an ancestor of it.
- [x] TC-12 (**AC-6**): local `main` diverged (2 ahead, 2 behind) → create worktree →
      expected: worktree `HEAD` equals local `main`; the track's `conversation.md` in the
      primary checkout contains a line matching
      `/^> \*\*system\*\*: ⚠️ .*2 commit\(s\) behind/m`; and it appears exactly once.
- [x] TC-13 (**AC-4**, track 1114 regression): `track-N` branch already exists with a commit
      not on `main`, no worktree → create worktree → expected: `git rev-parse track-N` is
      byte-identical before and after, and the worktree is checked out on `track-N`. Also
      assert no `-B` reached the git command.
- [x] TC-14 (**AC-5**, REQ-8): `origin` remote points at a nonexistent path → create
      worktree → expected: creation **succeeds**, exit is clean, worktree `HEAD` equals local
      `main`, and no `⚠️` comment was written (offline is silent per REQ-7).
- [x] TC-15: repo with a single commit and no `main` ref (detached / oddly-named default) →
      create worktree → expected: succeeds, falls back to `HEAD`, matching today's behavior.

### Phase 3 — `conductor/lock.mjs`

- [x] TC-16 (**REQ-9**): `node conductor/lock.mjs N` on a scratch repo → expected:
      `git -C <worktree> symbolic-ref -q HEAD` returns `refs/heads/track-N` (i.e. **not**
      detached, which is what it produces today).
- [x] TC-17: same on a repo whose default branch is `master` → expected: succeeds and bases
      on `master`. Today's hardcoded `origin/main` fails here.
- [x] TC-18: `node conductor/unlock.mjs N` afterwards → expected: worktree removed, lock file
      gone, `git worktree list` clean.

## Acceptance Criteria

- [x] TC-1 … TC-8 pass (pure resolver covers every row of spec.md's resolution table)
- [x] TC-9 … TC-15 pass on real git repositories, asserting real commit SHAs
- [x] TC-16 … TC-18 pass
- [x] `node --test conductor/tests/track-1114-worktree-create-args.test.mjs` still passes
- [x] Neighbouring worktree suites (1112 ×3, 10045, path-resolution, root-normalization)
      show no regressions
- [x] `cd ui && npm test` still green
- [x] Phase 4 Task 4.6 performed for real: worker restarted, one real worktree created, log
      line and `rev-parse` output recorded in `conversation.md`
- [x] No hardcoded `'main'` string introduced in any new code — `getMainBranch()` throughout
