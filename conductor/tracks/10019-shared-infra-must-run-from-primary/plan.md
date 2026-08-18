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

- [ ] Task 4.1 (REQ-10) — **first, independently committable**: remove
      `'conversation.md'` from `ARTIFACTS` in
      `conductor/services/worktree-artifact-merge.mjs`, with a comment
      explaining the D3 loss mechanism and that `.conv-cursor` owns that
      file. Write the failing test (TC-4.1) before the change.
- [ ] Task 4.2 (REQ-8): add a periodic doc-sync pass invoked from the
      existing `refreshWorktreeSummaryCache()` 60s tick (it already
      enumerates live worktrees via `auditWorktrees`, so the worktree list
      is free). For each row with `hasWorktree`, call
      `copyWorktreeArtifactsToPrimary({ ..., isSuccess: false })` —
      `isSuccess: false` deliberately keeps the shrink guards armed for
      mid-run copies.
- [ ] Task 4.3 (REQ-9): mtime/size compare per file before reading or
      writing; skip untouched files entirely.
- [ ] Task 4.4 (REQ-12): skip tracks with no live worktree; make the pass
      re-entrant and cheap enough that overlapping with an exit-handler
      copy is harmless (both write the same content from the same source).
- [ ] Task 4.5: after a successful `index.md` merge, push it to the DB via
      the existing `syncTrack(indexPath)` call so the board reflects it —
      same call the exit handler already makes.
- [ ] Task 4.6: `[doc-sync]`-prefixed log line only when something was
      actually copied (no per-tick spam on a quiet repo).

**Impact**: the board, DB and chat show a track's real state within ~60s
of the agent writing it, instead of at run end.

---

## Phase 5: Surface guard-skipped copies

**Problem**: when the shrink guard declines, primary keeps serving a copy
that is known to be stale, silently (D4).
**Solution**: log it, and mark the track so the board can say so.

- [ ] Task 5.1 (REQ-11): log every guard skip with track, file, incoming
      size, existing size, and which threshold tripped.
- [ ] Task 5.2 (REQ-11): record the skip on the track (marker or DB field
      — decide during implementation; prefer whatever the board already
      reads rather than adding a new column) so the UI can show "docs may
      be stale".
- [ ] Task 5.3: surface it in the UI wherever the track's freshness is
      already displayed; clear it on the next successful sync.

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
