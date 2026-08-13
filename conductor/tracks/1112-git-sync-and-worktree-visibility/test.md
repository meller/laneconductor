# Tests: Track 1112 — Out-of-band git sync + worktree visibility/merge

Every test below builds its own throwaway git repo under a temp dir unless
explicitly marked **LIVE**. The LIVE checks run against this machine's real
48-worktree / 44-unmerged-branch state, which is the dataset that motivated
the track — synthetic fixtures alone would not have surfaced RC-A.

## Test Commands

```bash
# New suites for this track
node --test conductor/tests/track-1112-worktree-visibility.test.mjs
node --test conductor/tests/track-1112-worktree-merge.test.mjs
node --test conductor/tests/track-1112-git-divergence.test.mjs
```

```bash
# Regression: existing worktree lifecycle must not break
node --test conductor/tests/track-1035-worktree-lifecycle.test.mjs
```

```bash
# Full worker suite (record NEW failures only, vs. known pre-existing set)
node --test conductor/tests/*.test.mjs
```

```bash
# Syntax check on everything touched
find conductor ui bin -name "*.mjs" -not -path "*/node_modules/*" -exec node --check {} +
```

```bash
# Phase 7 only (if implemented): server + E2E
cd ui && npx vitest run server/tests/
npx playwright test --project=fast
```

## Fixture helper (shared by all three suites)

`makeRepo({ tracks })` builds a temp git repo with: an initial commit on
`main`, a `conductor/tracks/NNN-slug/index.md` per requested track with the
given `**Lane**` / `**Lane Status**`, and a `track-NNN` branch with N commits
ahead. Options per track: `worktree: true|false` (to reproduce the RC-A
stranded shape), `conflictsWithMain: true` (to force a real conflict).
`LC_SKIP_GIT_LOCK=1` is set for worker-level tests, as the existing suites do.

---

## Phase 2 — `lc worktrees` visibility

### Feature: enumeration
- [ ] TC-2.1: Repo with 3 worktrees → `lc worktrees` prints exactly 3 rows —
      expected: one row per worktree, none omitted, none duplicated.
- [ ] TC-2.2: Branch `track-500` unmerged with `.worktrees/500` deleted →
      expected: still listed (union of `git worktree list` and
      `git branch --no-merged`), which `git worktree list` alone cannot show.
- [ ] TC-2.3: A worktree whose branch IS merged into main → expected: either
      omitted or shown as `merged`, never as `mergeable`/`open`.
- [ ] TC-2.4: Repo with zero worktrees → expected: clean "no worktrees"
      message, exit 0, no stack trace.

### Feature: computed columns
- [ ] TC-2.5: Branch with 3 commits ahead, main 1 commit ahead of the branch
      point → expected: `ahead=3`, `behind=1` (both computed, not 0/blank).
- [ ] TC-2.6: Worktree with 2 uncommitted modified files → expected:
      `dirty=2`.
- [ ] TC-2.7: Stranded branch (no directory) → expected: `dirty=-`, and no
      crash from statting a missing path.

### Feature: classification
- [ ] TC-2.8: Track at `done`/`success`, branch unmerged, worktree present →
      expected: `mergeable`.
- [ ] TC-2.9: Track at `done`/`success`, branch unmerged, worktree absent →
      expected: `stranded`.
- [ ] TC-2.10: Track at `implement`/`queue`, branch unmerged → expected:
      `open` (never `mergeable` — must not invite merging unfinished work).
- [ ] TC-2.11: Branch whose merge into main would conflict, track
      `done:success` → expected: `conflicted`, and the classification check
      itself mutates nothing (assert `git status --porcelain` and current
      branch unchanged after running `lc worktrees`).
- [ ] TC-2.12: Worktree directory present but no matching
      `conductor/tracks/NNN-*/index.md` → expected: listed with lane
      `unknown`, not a crash.
- [ ] TC-2.13: Nested/detached worktree (reproduces the live
      `.worktrees/1063/.worktrees/9998` detached-HEAD case) → expected:
      listed, classified `open`/`detached`, never `mergeable`.

### Feature: modes and output
- [ ] TC-2.14: `mode: "local-fs"`, no API process running, no DB reachable →
      expected: full listing produced, exit 0 (REQ-2/AC-3).
- [ ] TC-2.15: `lc worktrees --json` → expected: parses as JSON, one object
      per row, keys `track,title,lane,lane_status,ahead,behind,dirty,class`.
- [ ] TC-2.16: `lc worktrees --stranded` → expected: only `stranded` rows.
- [ ] TC-2.17: **LIVE** — `lc worktrees` in this repo → expected: 1044 and
      1059 shown `stranded`, 1099 shown `mergeable`, computed from git+files,
      not hardcoded. Row count matches
      `git worktree list | wc -l` ∪ `git branch --no-merged main`.

---

## Phase 3 — lifecycle fixes + reconciler

### Feature: RC-A — merge without a worktree directory
- [ ] TC-3.1: Branch `track-600` exists, `.worktrees/600` deleted, track
      `done:success` → `mergeAndRemoveWorktree(600)` → expected: branch IS
      merged into main. **This is the test that fails on today's code** —
      write it first and confirm the failure before changing anything.
- [ ] TC-3.2: Same, then → expected: no error thrown from the skipped
      directory removal; log states the directory was absent.
- [ ] TC-3.3: Worktree present + branch present → expected: merged AND
      directory removed (existing behaviour preserved).
- [ ] TC-3.4: Directory present, branch already deleted → expected: no merge
      attempted, directory removed, no throw.

### Feature: D-5 / REQ-7 — merge does not touch the primary checkout
- [ ] TC-3.5: Capture `git rev-parse --abbrev-ref HEAD` and
      `git status --porcelain` in the primary checkout, run a merge, capture
      again → expected: both byte-identical (AC-6).
- [ ] TC-3.6: Primary checkout has an uncommitted edit to a file the merged
      branch also changed → expected: merge still succeeds (it happens in the
      scratch worktree), and the uncommitted edit is still present and
      unmodified afterwards.
- [ ] TC-3.7: Merge fails mid-way → expected: scratch worktree removed in the
      `finally`, `.worktrees/.merge-*` left behind by nothing,
      `git status` in the primary checkout shows no `MERGING` state.
- [ ] TC-3.8: Scratch path validated by `validatePathIsolation` → expected: a
      path escaping `.worktrees/` is rejected.

### Feature: RC-B — reconciler
- [ ] TC-3.9: Track moved to `done:success` by writing `index.md` directly
      (simulating a UI drag — no worker action, no exit handler) →
      `reconcileWorktrees()` → expected: branch merged. **Also fails on
      today's code**; write first.
- [ ] TC-3.10: Track at `review:queue` with an unmerged branch →
      expected: NOT merged (REQ-5 — never merges unfinished work).
- [ ] TC-3.11: Run `reconcileWorktrees()` twice in a row → expected: second
      run is a no-op, exit clean, no duplicate merge commit.
- [ ] TC-3.12: Nothing to reconcile → expected: no log output (no per-
      heartbeat spam), returns promptly.
- [ ] TC-3.13: Three branches, the middle one conflicts → expected: first and
      third merged, middle left unmerged with its worktree intact, conflict
      reported, pass completes (AC-8).
- [ ] TC-3.14: Branch whose track holds an active git lock → expected: skipped
      this pass, not merged out from under a running worker.
- [ ] TC-3.15: `git.reconcile_worktrees: false` in `.laneconductor.json` →
      expected: pass does not run; `lc worktrees merge` still works.
- [ ] TC-3.16: A conflicted branch is never deleted — assert `git branch
      --list track-NNN` still returns it after a failed merge (REQ-5, no
      `-D`).

---

## Phase 4 — `lc worktrees merge`

- [ ] TC-4.1: `lc worktrees merge 700` on a `done:success` mergeable track →
      expected: merged, exit 0, output names the branch and target;
      `git branch --no-merged main` no longer lists it (AC-4).
- [ ] TC-4.2: `lc worktrees merge 701` where `.worktrees/701` is absent →
      expected: merged anyway (AC-5).
- [ ] TC-4.3: `lc worktrees merge 702` where the track is `implement:queue` →
      expected: refuses, non-zero exit, message explains the lane requirement;
      branch untouched.
- [ ] TC-4.4: Same with `--force` → expected: merges.
- [ ] TC-4.5: `--dry-run` on a mergeable branch → expected: reports "would
      merge", and `git rev-list --count main..track-NNN` is unchanged after.
- [ ] TC-4.6: `--dry-run` on a conflicting branch → expected: reports the
      conflicting file paths, changes nothing.
- [ ] TC-4.7: Merge of a conflicting branch (no `--dry-run`) → expected:
      non-zero exit, conflict paths reported, branch + worktree intact, repo
      not left `MERGING`.
- [ ] TC-4.8: `lc worktrees merge 9999` (no such track/branch) → expected:
      clear error, non-zero exit, no stack trace.
- [ ] TC-4.9: **LIVE** — `lc worktrees merge 1099` then
      `lc worktrees merge 1044` → expected: both disappear from
      `git branch --no-merged main`; 1044 proves the RC-A path on real data.

---

## Phase 5 — out-of-band git sync

Fixture: a bare "origin" repo plus two clones (`local`, `other`). `other`
pushes to simulate the third-party developer.

### Feature: detection (5a)
- [ ] TC-5.1: `other` pushes 2 commits → after one fetch interval, expected:
      worker log reports `behind=2` and names `origin/main` (AC-9).
- [ ] TC-5.2: No remote activity → expected: no divergence reported, and no
      repeated noise in the log each interval.
- [ ] TC-5.3: `git.fetch_interval_ms: 0` → expected: no fetch is performed at
      all (assert by network-less fixture or by fetch-call counter).
- [ ] TC-5.4: Detection phase alone performs no mutation → expected: local
      `main` SHA unchanged after detection when `auto_pull: false`.
- [ ] TC-5.5: Fetch fails (unreachable remote) → expected: warning logged,
      worker continues its heartbeat, no crash.

### Feature: safe auto-pull (5b/5c)
- [ ] TC-5.6: Local `main` strictly behind, clean tree, FF possible →
      expected: pulled via `--ff-only`; local `main` SHA now equals
      `origin/main`.
- [ ] TC-5.7: The pulled commit changed `conductor/tracks/NNN-*/index.md`
      lane to `review` → expected: that lane reaches the database (AC-10).
- [ ] TC-5.8: Local has its own commit AND remote is ahead (true divergence)
      → expected: NO pull, reason reported as diverged, local `main` SHA
      unchanged (AC-11).
- [ ] TC-5.9: A file the incoming commits touch is dirty locally → expected:
      NO pull, reason reported as dirty overlap, the dirty file's contents
      unchanged.
- [ ] TC-5.10: Dirty files exist but none overlap the incoming commits →
      expected: pull proceeds, dirty files still present and unmodified.
- [ ] TC-5.11: After any refused pull → expected: `git status` shows no
      `MERGING` / no `.git/MERGE_HEAD` (AC-11).
- [ ] TC-5.12: `git.auto_pull: false` with the repo behind → expected:
      reported but never pulled.
- [ ] TC-5.13: Assert no bare `git pull` is ever invoked (grep the
      implementation, or assert on a git-command spy) — only
      `merge --ff-only`.

---

## Phase 6 — regression + live evidence

- [ ] TC-6.1: `node --test conductor/tests/track-1035-worktree-lifecycle.test.mjs`
      → expected: all pass (AC-12).
- [ ] TC-6.2: Full `node --test conductor/tests/*.test.mjs` → expected: no NEW
      failures vs. the recorded pre-existing set; record both counts.
- [ ] TC-6.3: `node --check` across all touched `.mjs` → expected: clean.
- [ ] TC-6.4: **LIVE** — paste the real `lc worktrees` output and the real
      before/after `git branch --no-merged main | wc -l` into
      `conversation.md` as evidence, per the quality-gate's real-product
      requirement.

---

## Phase 7 — UI panel (only if implemented)

### Feature: project-scoped listing (D-6)
- [ ] TC-7.1: Worker heartbeat payload includes the worktree summary →
      expected: visible in `GET /api/projects/:id/worktrees`.
- [ ] TC-7.2: Two worker processes for the same project on the same host both
      report → expected: the panel shows each worktree once (deduped), not
      duplicated per worker.
- [ ] TC-7.3: Workers on two different hosts report different lists →
      expected: panel groups rows by host.
- [ ] TC-7.4: Panel renders one entry per reported worktree with its class;
      `stranded` is visually distinguished (sorted first).
- [ ] TC-7.5: Worker reporting zero worktrees → expected: empty-state, not a
      broken panel.
- [ ] TC-7.6: `TrackDetailPanel` for a track with a worktree shows that one
      row's data inline; for a track with none, shows nothing (no empty
      strip).

### Feature: merge button + 1084 stickiness (D-7, AC-13)
- [ ] TC-7.7: Click "Merge to main" on a `mergeable` row → expected: a row
      appears in `worker_dispatch` with `action = 'merge-worktree'` and
      `payload.track_number` set.
- [ ] TC-7.8: The track's assignee has their own worker registered (per
      1084) → expected: `worker_dispatch.worker_id` is that worker, not
      whichever worker happens to be idle-first.
- [ ] TC-7.9: The track's assignee has no workers of their own registered →
      expected: falls back to open-claim (any worker for the project), same
      as `claimable-tracks`' existing zero-config behavior.
- [ ] TC-7.10: Button on a `conflicted` row → expected: disabled, tooltip
      explains why, no dispatch created.
- [ ] TC-7.11: Button on an `open` row → expected: not rendered at all.
- [ ] TC-7.12: Worker picks up a `merge-worktree` dispatch → expected: runs
      Phase 4's merge primitive, reports result via
      `PATCH /worker-dispatch/:id`, posts a `conversation.md` comment on the
      track.
- [ ] TC-7.13: Playwright fast-tier spec covering the panel + merge button
      passes with the UI (`:8090`) and API (`:8091`) restarted first.

---

## Acceptance Criteria

Mirrors `spec.md`; each is ticked only against observed output.

- [ ] AC-1 — `lc worktrees` covers all 48 worktrees + branch-only rows, real counts
- [ ] AC-2 — 1044/1059 `stranded`, 1099 `mergeable`, computed
- [ ] AC-3 — same listing in `local-fs` with no API/DB
- [ ] AC-4 — `merge 1099` clears it from `git branch --no-merged main`
- [ ] AC-5 — `merge 1044` works with no worktree directory
- [ ] AC-6 — primary checkout branch + `git status` unchanged across a merge
- [ ] AC-7 — UI-drag-to-done branch merged by the reconciler, named in the log
- [ ] AC-8 — conflicting branch left intact; pass continues
- [ ] AC-9 — out-of-band push reported within one fetch interval
- [ ] AC-10 — safe FF pull lands, and the pulled track's lane reaches the DB
- [ ] AC-11 — unsafe case: no mutation, no `MERGING` state, reason stated
- [ ] AC-12 — track-1035 lifecycle tests still pass
- [ ] AC-13 — merge button dispatches to the assignee's own worker (1084
      stickiness), not an arbitrary idle one
- [ ] No regressions in the existing worker test suite (record counts)
