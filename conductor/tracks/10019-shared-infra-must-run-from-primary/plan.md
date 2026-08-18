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

- [ ] Task 1.1: Reproduce S5 — launch `node conductor/laneconductor.sync.mjs
      --sync-only --worker-number 9` from inside `.worktrees/10019` with
      `LC_SKIP_WORKER_LOCK=1`, and record where it writes `.env` reads,
      logs, `.conductor/locks`, and its registered `repo_path`.
- [ ] Task 1.2: Reproduce S6 — `make ui-start` from inside a worktree with
      the primary's UI already running; record whether a second Vite
      starts and which `ui/` it serves.
- [ ] Task 1.3: Confirm S7/S8 by inspection of the Makefile variables plus
      a dry-run of what `make install` would write (do **not** actually
      overwrite `~/.laneconductorrc` or the `/usr/local/bin/lc` symlink).
- [ ] Task 1.4: Confirm S9 — `node .worktrees/10019/bin/lc.mjs ui start`
      with `~/.laneconductorrc` temporarily pointed elsewhere / absent.
- [ ] Task 1.5: Confirm S11/S12 — create a lock file under the primary's
      `.conductor/locks/`, run `lc worktrees list` from the primary and
      from inside a worktree, and diff the output.
- [ ] Task 1.6: Close out S14 (`lc verify-isolation` from a worktree,
      where `.git` is a file) and S15 (count `resolvePrimaryRepoRoot()`
      calls on a 5-minute idle worker run — confirm it is not per-tick).
- [ ] Task 1.7: Sweep for sites the table missed: every `spawn`/`spawnSync`/
      `execSync`/`execFileSync` in `bin/lc.mjs`, `conductor/laneconductor.sync.mjs`
      and `conductor/services/*.mjs` whose `cwd` or path argument derives
      from `process.cwd()`/`findProjectRoot()` rather than a resolved
      primary root. Add any new finding to the table as S16+.
- [ ] Task 1.8: Update `spec.md`'s audit table in place with confirmed
      verdicts and evidence.

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

- [ ] Task 2.1 (REQ-1, REQ-1a): add a startup cwd normalization block at
      the top of `conductor/laneconductor.sync.mjs`, above the `.env`
      read and above the identity-lock block. Resolve the primary; if it
      differs from cwd, `chdir` and log at warn naming both paths. Skip
      silently for `--manager` and when not inside a git repo (wrap in
      try/catch — never crash the worker over this).
- [ ] Task 2.2 (REQ-7): capture the resolved primary once in a module
      constant and reuse it, so nothing on the 60s ticks re-shells out.
- [ ] Task 2.3 (REQ-2): make the `Makefile` resolve its `UI_DIR` from the
      primary checkout (`git rev-parse --path-format=absolute
      --git-common-dir` → parent) rather than `$(shell pwd)`.
- [ ] Task 2.4 (REQ-3): same resolution for `SKILL_DIR` and
      `install-cli`'s `$(PWD)/bin/lc.mjs`. Given these two write
      machine-wide, persistent state, prefer a hard refusal with a clear
      message ("run this from the primary checkout: <path>") over a silent
      auto-correct.
- [ ] Task 2.5 (REQ-4): fix `getInstallPath()`'s no-rc fallback so it
      cannot resolve to a linked worktree.
- [ ] Task 2.6 (REQ-5): resolve `repoRoot` to the primary inside
      `auditWorktrees()` (one place — fixes `lc worktrees` and
      `refreshWorktreeSummaryCache` together).
- [ ] Task 2.7: fix anything Phase 1 Task 1.7 adds.
- [ ] Task 2.8: commit each site separately — `fix(track-10019): <site>`.

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

- [ ] Task 3.1 (REQ-6): sync worker — log resolved primary, launch cwd,
      and whether they differed (i.e. whether REQ-1 corrected it).
- [ ] Task 3.2 (REQ-6): API server (`ui/server/index.mjs`) — log the
      checkout it was started from and whether it is the primary.
- [ ] Task 3.3 (REQ-6): Vite UI — same line at start (from `lc ui start`
      / the Makefile target, whichever actually owns the spawn).
- [ ] Task 3.4: use the existing Pino `logger` where available rather than
      `console.*` (per the project's dev-logging convention).

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
