# Spec: Track 10019 — Shared state must live in main

## Problem Statement

Two failures of the same invariant: **anything shared lives in the primary
checkout, and everything that touches shared state must resolve there
regardless of where it was launched from or where it is running.**

**(A) Infra processes.** A long-running system-wide process (sync worker,
API server, Vite UI) started from inside a linked worktree silently serves
that worktree's stale half-finished code as if it were the live system.
Two instances confirmed live (track 1102, F16/F17) and fixed one at a
time. This track closes the class.

**(B) Track docs.** A track's `index.md` / `plan.md` / `spec.md` /
`test.md` are edited by the agent inside its worktree, but the board, the
DB, the chat and the human all read the **primary** copies. Today those
copies are refreshed only at run end (`copyWorktreeArtifactsToPrimary()`),
so for the 20–30+ minutes a run takes, everyone is looking at a stale
picture of the track's own state.

## Preliminary audit (Phase 1 confirms each verdict and extends the list)

Legend: **SAFE** = already resolves to primary, or is structurally
immune. **VULNERABLE** = resolves from `cwd`/`pwd` and can land on a
worktree. **VERIFY** = needs a live check in Phase 1.

**Phase 1 live-confirmation results** (sandbox repo + linked worktree,
zero touches to real machine state):
- **S6/S7/S8 confirmed live**: `make -n api-start` run with cwd set to a
  linked worktree resolves `UI_DIR` to `<worktree>/ui` — the dry-run
  printed `cd <worktree>/ui && node server/index.mjs >> <worktree>/ui/.api.log`
  and a worktree-local `.api.pid`, which would run a second API process
  against that worktree's own code, invisible to and non-colliding with a
  primary instance already on :8091's pidfile.
- **S11 confirmed live** (highest severity — silent data-loss potential):
  built a real repo with track 101 at `done:success`, a worktree holding
  an unmerged commit on `track-101` (so the branch is not yet merged), and
  a lock file at `<primary>/.conductor/locks/101.lock` recording that
  `main` independently reopened the track (now `plan:running`, protected).
  `auditWorktrees({ repoRoot: <primary> })` correctly classified it `open`
  (protected). `auditWorktrees({ repoRoot: <worktree> })` — the exact call
  `reconcileWorktrees()` makes if the sync worker's own cwd is ever a
  worktree (S5) — misclassified the same state as `mergeable`, because the
  lock-file existence check built its path from the passed-in `repoRoot`
  instead of the primary. Chained with S5, this is a real path to
  `reconcileWorktrees()`'s 60s tick auto-merging a track's branch out from
  under a running, locked worker.
- **S9 confirmed** by direct computation (no live process needed — pure
  path arithmetic): `getInstallPath()`'s fallback is
  `resolve(__dirname, '..')`; `__dirname` for a worktree-resident
  `bin/lc.mjs` is `<worktree>/bin`, so the fallback resolves to
  `<worktree>`, not the primary, whenever no rc file is present.
- **S14 verified, downgraded**: from inside a linked worktree, `.git` is a
  *file* (gitdir pointer), not a directory, so `verify-isolation`'s Test 1
  (`<root>/.git/worktrees` exists) fails — but this is a **false negative**
  in a read-only diagnostic command, not a shared-state hazard (it reports
  `❌`, it doesn't silently serve wrong state to anything). Left out of the
  REQ list below; not a fix target for this track.
- **S15 confirmed**: `resolvePrimaryRepoRoot()` does not appear anywhere in
  `reconcileWorktrees()`, `refreshWorktreeSummaryCache()`, or
  `checkOutOfBandGitSync()` — those three 60s/300s-tick functions call
  `process.cwd()` directly (S5's exact shape, not a `resolvePrimaryRepoRoot()`
  cost problem). REQ-1's cwd normalization removes the vulnerability at its
  root; no separate caching work is needed.

| # | Site | How it resolves today | Verdict |
|---|------|----------------------|---------|
| S1 | `lc start` / `stop` / `restart` (`bin/lc.mjs:1518,1639,1671`) | `resolvePrimaryRepoRoot(projectRoot)` | SAFE (F17 fix) |
| S2 | `lc worker run` / `worker status` (`bin/lc.mjs:1764,1782`) | `resolvePrimaryRepoRoot(projectRoot)` | SAFE (F17 fix) |
| S3 | Worker identity lock (`laneconductor.sync.mjs:135`) | `resolvePrimaryRepoRoot(process.cwd())` | SAFE (F16 fix) |
| S4 | `createWorktree` / `removeWorktree` (`sync.mjs:3423,3553`) | `resolvePrimaryRepoRoot(process.cwd())` | SAFE |
| S5 | **`laneconductor.sync.mjs` process cwd itself** — ~60 `process.cwd()` sites (`.env` load L172, `HARDCODED_DEFAULTS.repo_path` L184-185, chokidar watch roots, `.conductor/locks` L3322, tracks dir L3388/3732/4105, `conductor/logs` L3800, reconcile L3613, git-sync L3655) | inherited from the launcher; correct **only** because `lc` spawns it with `cwd: workerRoot`. `node conductor/laneconductor.sync.mjs` run directly from a worktree — or by any future launcher — points every one of those at the worktree | **VULNERABLE** (the structural hole F17 patched at one call site) |
| S6 | `Makefile` `UI_DIR := $(shell pwd)/ui` → `api-start`, `ui-start`, `*-stop`, `*-log`, `start-all` | `pwd` | **VULNERABLE** — `make ui-start` in a worktree serves that worktree's frontend on :8090 and writes its pidfile there, so it can't even see the primary's running UI (different pidfile path) |
| S7 | `Makefile` `SKILL_DIR := $(shell pwd)/.claude/...` → `make install` writes it to `~/.laneconductorrc` | `pwd` | **VULNERABLE** — poisons `getInstallPath()` for *every* later `lc api/ui/logs` invocation, machine-wide and persistent |
| S8 | `Makefile` `install-cli` → `ln -sf $(PWD)/bin/lc.mjs /usr/local/bin/lc` | `PWD` | **VULNERABLE** — points the global `lc` at a worktree's copy |
| S9 | `getInstallPath()` fallback `resolve(__dirname, '..')` (`bin/lc.mjs:61`) | script location | **VULNERABLE** when no rc file and `lc` is invoked as a worktree's `bin/lc.mjs` |
| S10 | `lc api` / `lc ui` / `lc logs` | `getInstallPath()` | SAFE *given* a clean rc file (depends on S7/S9) |
| S11 | `auditWorktrees({ repoRoot })` (`worktree-audit.mjs:180`) | caller's `repoRoot`, **not** resolved. Branch/ref reads are worktree-agnostic, but `mainHasReopenedTrackIndependently()` reads `join(repoRoot, '.conductor/locks/<n>.lock')` (`:136`) | **VULNERABLE (narrow)** — from a worktree it misses live locks and can misclassify an actively-claimed track as safe to auto-resolve |
| S12 | `lc worktrees list/merge/prune` (`bin/lc.mjs:3277,3322,3372`) | passes raw `projectRoot` into S11 | **VULNERABLE** via S11 (`mergeWorktreeBranch`/`checkDivergence` resolve internally, so only the S11 path leaks) |
| S13 | `ui/server/index.mjs` | `__dirname` for its own assets; per-project ops use `repo_path` from the DB; `process.cwd()` only at `:509` (manager stop, global pidfile) and `:540` (manager start) | SAFE — but it inherits whatever cwd started it, so S6 still matters |
| S14 | `lc verify-isolation` (`bin/lc.mjs:3165-3244`) | `projectRoot` + `.git/worktrees` (a *file*, not a dir, inside a worktree) | VERIFY |
| S15 | `resolvePrimaryRepoRoot()` cost — 2 `git rev-parse` per call | called at worker startup and per worktree create/remove/merge; **not** on the 60s `refreshWorktreeSummaryCache` / `reconcileWorktrees` ticks | SAFE — no cache needed **if** S5 normalizes cwd once at startup (that removes the reason to call it per-tick at all) |

**Doc-sync findings (Problem B):**

| # | Site | Finding |
|---|------|---------|
| D1 | `copyWorktreeArtifactsToPrimary()` fires only from the exit handler (`sync.mjs:4158`) and the orphan-reconcile pass (`:5067`) | mid-run edits invisible in primary for the whole run |
| D2 | Docs edited in a worktree with no managed run in flight | never reach primary until final merge — or never, if the branch is discarded |
| D3 | `ARTIFACTS` includes `'conversation.md'` with a **full-file `copyFileSync`** (`worktree-artifact-merge.mjs:39,98`) | **live data-loss risk**: a human comment written to the *primary* copy by the UI during a run is overwritten by the worktree's copy at run end. The shrink guard doesn't catch it — a lost one-line comment leaves the file well above the 50%/200-byte thresholds. Making the copy periodic without fixing this multiplies the damage |
| D4 | Shrink-guard `continue` (`:90,:97`) is silent | primary keeps serving a copy known to be stale, with no signal anywhere |

## Requirements

### Part A — infra must resolve to the primary checkout

- **REQ-1** `conductor/laneconductor.sync.mjs` normalizes its own working
  directory to the primary checkout at startup — before any relative-path
  read (`.env`, `.laneconductor.json`, `conductor/defaults.json`, chokidar
  watch roots) and before the identity-lock block. If the resolved primary
  differs from the launch cwd it `chdir`s there and logs the correction at
  warn level, naming both paths. This is the structural fix for S5: it
  makes every one of the ~60 `process.cwd()` sites correct by
  construction, regardless of launcher, instead of patching them one
  incident at a time.
- **REQ-1a** REQ-1 must not break the two legitimate non-primary cases:
  `--manager` (machine-level, not scoped to any project) and running
  outside a git repo at all (tests, CI fixtures). Both degrade to "leave
  cwd alone", never to a crash.
- **REQ-2** `make api-start`/`ui-start`/`start-all` (and their stop/log
  siblings) operate on the primary checkout's `ui/` and pidfiles no matter
  which directory `make` was run from.
- **REQ-3** `make install` never records a worktree path in
  `~/.laneconductorrc`, and `make install-cli` never symlinks
  `/usr/local/bin/lc` at a worktree's `bin/lc.mjs`.
- **REQ-4** `getInstallPath()`'s no-rc-file fallback never resolves to a
  linked worktree.
- **REQ-5** `auditWorktrees()` resolves `repoRoot` to the primary before
  reading `.conductor/locks`, so lock-awareness is correct from any cwd.
- **REQ-6** Every long-running process (sync worker, API server, Vite UI)
  logs one startup line stating the checkout it is serving and whether
  that checkout is the primary — defense in depth for anything this audit
  does not structurally rule out, and the first thing to look at when the
  next incident of this class happens.
- **REQ-7** No measurable added git cost on the hot paths: the primary
  root is resolved once per process, not per tick.

### Part B — track docs must be continuously visible in main

- **REQ-8** While a track has a live worktree, its `plan.md`, `spec.md`,
  `test.md` and `index.md` in the **primary** checkout are refreshed
  periodically (piggybacking the existing 60s `refreshWorktreeSummaryCache`
  tick), not only at run end. Direction rules, per the 2026-08-18 decision
  recorded in `index.md`:
  - `plan.md` / `spec.md` / `test.md` — worktree wins, full copy, existing
    shrink guards intact.
  - `index.md` — `mergeIndexMarkers()` exactly as today.
  - `conversation.md` — **excluded**. The existing `.conv-cursor`
    machinery stays that file's sole owner.
- **REQ-9** Unchanged files cost nothing: mtime/size comparison before any
  read or write, so a quiet repo with N worktrees does no per-tick file
  writing.
- **REQ-10** `conversation.md` is removed from `ARTIFACTS` in
  `copyWorktreeArtifactsToPrimary()` **including the existing run-end
  path** (D3) — that path is a live message-loss bug today, and REQ-8
  would run it 20× more often.
- **REQ-11** When a shrink guard declines a copy, the skip is logged
  (naming track, file, and both sizes) and recorded on the track so the
  board can show that the primary's docs are known-stale rather than
  silently serving old content.
- **REQ-12** The periodic sync never fights the run: it must not resurrect
  a file the exit handler just wrote, and must be a no-op for tracks with
  no live worktree (main-mode / workspace-mode tracks, which read and
  write primary directly).

## Acceptance Criteria

Each criterion is an observable outcome, not a code shape.

- [ ] **AC-1** With a worker already running from the primary, running
      `node conductor/laneconductor.sync.mjs` from inside
      `.worktrees/<n>/` refuses to start (identity lock collides) instead
      of silently running a second worker on the worktree's stale code.
- [ ] **AC-2** A worker launched from inside a worktree that *is* allowed
      to run (distinct worker number) writes its logs, locks, worktrees
      and track files under the **primary** checkout — verified by
      inspecting the filesystem after the run, not by reading the code.
- [ ] **AC-3** `make ui-start` run from inside a worktree either serves
      the primary's `ui/` on :8090, or reports the primary's already-running
      UI — it never starts a second Vite on the worktree's frontend.
- [ ] **AC-4** `make install` / `make install-cli` run from inside a
      worktree leave `~/.laneconductorrc` and `/usr/local/bin/lc` pointing
      at the primary checkout.
- [ ] **AC-5** `lc worktrees list` produces identical output when run from
      the primary and from inside a worktree, including lock-awareness.
- [ ] **AC-6** Each of the worker, API server, and UI prints one startup
      line naming the checkout it serves and whether it is the primary; a
      non-primary launch is visibly flagged.
- [ ] **AC-7** During a live run in a worktree, editing `plan.md` inside
      the worktree makes the same change visible in the primary's
      `plan.md` (and in the UI) within ~60s, without waiting for the run
      to end.
- [ ] **AC-8** A human comment posted through the UI while a run is in
      flight still exists in the primary's `conversation.md` after that
      run finishes. (Fails today — D3.)
- [ ] **AC-9** With N worktrees present and no doc edits, the periodic
      sync writes zero files and the worker's per-tick cost is unchanged.
- [ ] **AC-10** When a shrink guard declines a sync, the worker logs it
      with track/file/sizes and the track surfaces a "docs may be stale"
      signal — a human can tell from the board that the primary's copy is
      behind.
- [ ] **AC-11** A track running in main with no worktree is completely
      unaffected: no copy, no log line, no lane/marker change.
- [ ] **AC-12** Full suite green: `node --test conductor/tests/` and
      `cd ui && npm test`.

## Out of Scope (deferred, not satisfiable by this track)

- Making worktree copies of infra code match `main` — the opposite of what
  a worktree is for.
- Policy limits on concurrent infra-touching tracks.
- Reworking the `.conv-cursor` conversation sync itself; this track only
  stops the artifact copy from stepping on it.
