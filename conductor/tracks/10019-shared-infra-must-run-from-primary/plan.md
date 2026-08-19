# Track 10019: Shared state must live in main — infra processes AND track metadata

Ordering note: Phases 1–3 (infra path resolution) and Phases 4–5 (doc
sync-back) are independent and can be implemented in either order. Phase 1
gates Phase 2. Phase 4 must land REQ-10 (`conversation.md` exclusion)
*before* it makes the copy periodic — see Phase 4 Task 1.

---

## Phase 1: Confirm the audit

**Problem**: `spec.md`'s audit table is derived from reading the code. Two
of the three sites already fixed in this class were found from live
symptoms, not from reading — so every verdict needs a real check before
anything is changed.
**Solution**: reproduce each VULNERABLE verdict once, live, and close out
each VERIFY row. Record the outcome in the table (verdict + one-line
evidence). A row that turns out SAFE gets struck from Phase 2's list.

- [x] Task 1.1: Reproduced S6 live (Makefile `-n` dry-run from the
      worktree resolved `UI_DIR`/pidfile to the worktree's own `ui/`).
- [x] Task 1.2: Reproduced S11 live in a sandbox repo (real lock protecting
      a reopened track was missed when `auditWorktrees` was called with a
      linked-worktree `repoRoot` — misclassified `mergeable` instead of
      `open`). Highest-severity confirmed finding; see spec.md.
- [x] Task 1.3: Confirmed S7/S8 via `make -n`/live guard test (no real
      `~/.laneconductorrc` or `/usr/local/bin/lc` touched).
- [x] Task 1.4: Confirmed S9 by direct path computation (no live process
      needed — pure arithmetic on `__dirname`).
- [x] Task 1.5: Confirmed via the S11 sandbox test above (same mechanism
      covers S12, which already resolves internally via `checkDivergence`).
- [x] Task 1.6: S14 downgraded (false-negative diagnostic, not a
      shared-state hazard, not fixed). S15 confirmed — no
      `resolvePrimaryRepoRoot()` calls exist on any 60s/300s tick; the
      vulnerability there is raw `process.cwd()`, which REQ-1 fixes at the
      root, no caching needed.
- [x] Task 1.7: Swept `bin/lc.mjs`/`laneconductor.sync.mjs`/`services/*.mjs`
      for cwd-derived spawn/exec sites; no S16+ findings beyond S1-S15.
- [x] Task 1.8: `spec.md`'s audit table updated in place with confirmed
      verdicts and live evidence.

**Impact**: Phase 2's scope is a confirmed list, not a suspected one.

---

## Phase 2: Fix the confirmed sites

**Problem**: each confirmed site resolves shared state from wherever it
happened to be launched.
**Solution**: one targeted change per site, matching F16/F17's pattern
(route through `resolvePrimaryRepoRoot()`; do not rewrite
`findProjectRoot()` globally). REQ-1's cwd normalization is the one
deliberately broader change — it is what turns this from a list of patches
into a closed class.

- [x] Task 2.1 (REQ-1, REQ-1a): added a startup cwd normalization block in
      `conductor/laneconductor.sync.mjs`, above the `.env` read and above
      the identity-lock block. Decision logic extracted to a pure,
      testable `resolvePrimaryCwdDecision()` in
      `conductor/services/primary-cwd.mjs` (module-load side effects mean
      `laneconductor.sync.mjs` itself can't be imported in a test — same
      constraint documented elsewhere in this codebase). `--manager` and
      "not inside a git repo" both degrade to no-op. Gated behind a new
      test-only `LC_SKIP_CWD_NORMALIZATION` env var (see "Known pre-existing
      suite flakiness" in test.md for why: many existing tests spawn the
      real worker into a throwaway non-git sandbox nested inside whatever
      worktree the suite runs from, and would otherwise get redirected to
      this dev machine's real, live primary checkout).
- [x] Task 2.2 (REQ-7): confirmed no change needed — Phase 1 Task 1.6
      established no `resolvePrimaryRepoRoot()` call exists on any hot
      tick; REQ-1 fixes the actual vulnerability (raw `process.cwd()`) at
      its root once, at startup, not per-tick.
- [x] Task 2.3 (REQ-2): `Makefile`'s `UI_DIR` now derives from
      `PRIMARY_ROOT` (`git rev-parse --path-format=absolute
      --git-common-dir`, parent of the result) instead of `$(shell pwd)`.
      Verified live: `make -n api-start` from the worktree now resolves to
      the primary's `ui/`.
- [x] Task 2.4 (REQ-3): `SKILL_DIR` resolves from `PRIMARY_ROOT` too;
      `install`/`install-cli` gained a `require-primary-checkout` guard
      that refuses with a clear message instead of silently writing
      worktree paths into `~/.laneconductorrc`/`/usr/local/bin/lc`.
      Verified live: `make install-cli` from the worktree refused cleanly,
      never reaching `sudo`.
- [x] Task 2.5 (REQ-4): `getInstallPath()`'s no-rc fallback now routes
      `resolve(__dirname, '..')` through `resolvePrimaryRepoRoot()`
      (already imported in `bin/lc.mjs`), falling back to the unresolved
      path only if that throws (not inside a git repo).
- [x] Task 2.6 (REQ-5): `auditWorktrees()`'s lock-path check
      (`mainHasReopenedTrackIndependently`) now builds
      `.conductor/locks/<n>.lock` from `primaryPath` — already computed
      for free from `git worktree list`'s own ordering, no new git call —
      instead of the passed-in `repoRoot`. Regression test added to
      `track-1112-worktree-audit.test.mjs` reproducing the exact S11
      scenario.
- [x] Task 2.7: Phase 1 Task 1.7 found no additional sites.
- [x] Task 2.8: committed as a single Phase 2 commit (all sites are small,
      interdependent enough — shared `primary-cwd.mjs` extraction, shared
      audit-table evidence — that splitting further added no reviewability
      benefit over the plan's own narrow, single-purpose diff per file).

**Impact**: `lc`, `make`, and a directly-invoked worker all agree on one
root regardless of invocation directory.

---

## Phase 3: Provenance line for long-running processes

**Problem**: nothing structural can rule out every future launcher; when
the next incident happens, the first question ("which checkout is this
process actually serving?") currently has no answer short of `/proc`
archaeology.
**Solution**: one startup line per long-running process, flagged when it
is not the primary.

- [x] Task 3.1 (REQ-6): sync worker logs one provenance line every startup
      (after REQ-1's own chdir, so it reports the checkout actually being
      served) via both `console.log` and `logger.info` — verified live
      both ways: from a non-git sandbox ("primary status unknown") and
      from inside this worktree ("Launched from .../.worktrees/10019 ...
      running from /home/meller/Code/laneconductor instead" followed by
      "Serving from /home/meller/Code/laneconductor (primary checkout)").
- [x] Task 3.2 (REQ-6): API server (`ui/server/index.mjs`) logs the same
      shape of line in its `listen()` callback, via `logger.info`.
- [x] Task 3.3 (REQ-6): `lc ui start` (`bin/lc.mjs`) and the Makefile's
      `ui-start`/`api-start` targets each print a startup line — the
      Makefile targets are unconditionally primary by construction
      (REQ-2's `UI_DIR` fix), `lc ui start` verifies it live via
      `resolvePrimaryRepoRoot()` rather than assuming.
- [x] Task 3.4: used the existing Pino `logger` (worker, API) alongside
      `console.log`/`echo` (CLI/Makefile, which have no logger instance)
      per the project's dev-logging convention.

**Impact**: a non-primary launch is visible in the first line of the log.

---

## Phase 4: Continuous doc sync-back

**Problem**: primary's copy of a track's docs is refreshed only at run end
(D1), never for unmanaged edits (D2), and the run-end copy can *lose*
human chat messages (D3).
**Solution**: reuse `copyWorktreeArtifactsToPrimary()` /
`mergeIndexMarkers()` unchanged in behavior, driven from the existing 60s
tick, with `conversation.md` removed from its artifact set entirely.

- [x] Task 4.1 (REQ-10): removed `'conversation.md'` from `ARTIFACTS` in
      `conductor/services/worktree-artifact-merge.mjs`. TDD: wrote the
      failing test first
      (`track-1110-copy-worktree-artifacts.test.mjs`: "never touches
      conversation.md — a human comment in the primary copy must survive a
      run-end copy"), confirmed it failed against the unfixed code, then
      applied the fix and confirmed green.
- [x] Task 4.2 (REQ-8): **deviated from the plan's own suggestion**
      (`refreshWorktreeSummaryCache`) — that function early-returns under
      `getIsLocalFs()`, which would have silently made doc-sync a no-op in
      local-fs mode, contradicting REQ-12/AC-11's "any live worktree"
      scope and `reconcileWorktrees()`'s own explicit "runs regardless of
      mode" precedent right next to it. Also, `auditWorktrees()` itself
      turned out to be the wrong data source entirely: it drops any
      track-* branch that hasn't diverged from main yet
      (`isAncestor(...) continue`) — exactly a freshly-created worktree
      with only uncommitted edits, i.e. the most common case early in any
      run and precisely what doc-sync exists to keep fresh. Found live in
      a sandbox repro before it could ship as a silent gap. Added a new,
      narrow `listTrackWorktrees()` in `worktree-audit.mjs` (one
      `git worktree list --porcelain` call, no branch/commit walking) and
      built `syncWorktreeDocsToPrimary()` on its own 60s `setInterval`
      next to `reconcileWorktrees()`'s, calling
      `copyWorktreeArtifactsToPrimary({ ..., isSuccess: false,
      skipUnchanged: true })` per live worktree.
- [x] Task 4.3 (REQ-9): added a `skipUnchanged` param to
      `copyWorktreeArtifactsToPrimary()` (default `false` — existing
      exit-handler/orphan-reconcile callers unaffected) that mtime-compares
      source vs dest per file and skips entirely (no read, no write) when
      the worktree copy isn't newer. Verified live: a real sandbox
      worktree's uncommitted `plan.md` edit propagated to primary on the
      first pass; an unchanged second pass touched nothing (confirmed via
      mtime).
- [x] Task 4.4 (REQ-12): `listTrackWorktrees()` naturally returns nothing
      for a track with no live worktree, so the loop is a no-op for it;
      re-entrancy is inherited from `copyWorktreeArtifactsToPrimary()`'s
      own idempotent behavior (same source, same guards, safe to overlap
      with an exit-handler copy).
- [x] Task 4.5: on a successful `index.md` copy, `syncTrack(indexPath)` is
      called exactly as the exit handler already does.
- [x] Task 4.6: `[doc-sync]` log lines only emitted when `copied.length` or
      `skipped.length` is non-zero for that track.

**Impact**: the board, DB and chat show a track's real state within ~60s
of the agent writing it, instead of at run end.

---

## Phase 5: Surface guard-skipped copies

**Problem**: when the shrink guard declines, primary keeps serving a copy
that is known to be stale, silently (D4).
**Solution**: log it, and mark the track so the board can say so.

- [x] Task 5.1 (REQ-11): `copyWorktreeArtifactsToPrimary()` now returns a
      `skipped` array (`{ file, reason, incomingSize, existingSize }` per
      declined artifact); `syncWorktreeDocsToPrimary()` logs every entry.
- [x] Task 5.2 (REQ-11): **decided against a new marker/DB field** — per
      the plan's own "prefer whatever the board already reads" guidance,
      reused the existing conversation.md → Inbox pipeline instead of
      inventing new plumbing: a `⚠️` `system` comment posted to the
      track's `conversation.md` on the transition into "stale" is picked
      up by the existing Inbox classification (leading-emoji convention,
      documented in this skill's "Completion Comment Convention") with no
      new UI/DB work needed.
- [x] Task 5.3: de-duplicated via an in-memory `staleDocSignal` Map keyed
      `${trackNumber}:${file}` — warns once per stale transition, not
      every 60s tick the guard keeps declining; cleared the moment that
      file syncs successfully again.

**Impact**: a stale primary copy is visible instead of indistinguishable
from a fresh one.

---

## Verification

Run before claiming any phase complete (see `test.md` for the per-phase
cases):

```bash
node --test conductor/tests/
cd ui && npm test
```

Phases 1, 3 and the AC-3/AC-4 cases are **manual/live** checks — record the
observed output in `conversation.md`; a passing unit test does not satisfy
them.

---

## ⚠️ Gaps (review, 2026-08-19)

- **Phase 2 / REQ-2 / REQ-3 — `Makefile`'s `ui-install` target was missed.**
  `install: ui-install install-cli` runs `ui-install` as a prerequisite
  before `install`'s own recipe (and before `install-cli`'s guard fires),
  and `ui-install`'s recipe is still `@cd ui && npm install` — a bare
  relative path, not `$(UI_DIR)`/`$(PRIMARY_ROOT)` like every other target
  in this file was updated to use. Confirmed live via `make -n install`
  from `.worktrees/10019`: it prints `cd ui && npm install` unconditionally,
  before `install-cli`'s `require-primary-checkout` guard aborts the chain
  one target later. A real `make install` from a worktree therefore runs
  `npm install` against the worktree's own `ui/` — wrong directory, wasted
  work — before the guard catches the problem. `~/.laneconductorrc` and
  `/usr/local/bin/lc` stay protected (the guard still aborts before
  `install`'s own recipe or `install-cli`'s symlink step run), so this
  doesn't corrupt persistent state, but it's a real, reproducible miss in
  exactly the class of bug REQ-2/REQ-3 exist to close — not caught because
  verification (test.md TC-2.8) only exercised `make install-cli` directly,
  never the full `make install` chain.
  **Fix**: point `ui-install`'s recipe at `$(UI_DIR)`
  (`cd $(UI_DIR) && npm install`), and consider adding
  `require-primary-checkout` to `ui-install` itself so a worktree-invoked
  `make install` fails on the first target instead of doing real (if
  harmless) work in the wrong directory first.
