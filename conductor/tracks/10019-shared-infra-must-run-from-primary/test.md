# Tests: Track 10019 — Shared state must live in main

## Test Commands

```bash
# Worker / service tests (node:test, zero deps — anything touching real
# processes or the filesystem lives here)
node --test conductor/tests/

# Targeted new suites for this track
node --test conductor/tests/primary-root-normalization.test.mjs
node --test conductor/tests/worktree-doc-sync.test.mjs

# UI + API unit/integration tests
cd ui && npm test
```

New suites follow the existing `conductor/tests/worktree-create-path-resolution.test.mjs`
pattern: build a throwaway repo + linked worktree in a temp dir, exercise
the real function, assert on real paths.

---

## Test Cases

### Phase 1 — audit (manual/live; evidence recorded in conversation.md)

- [ ] TC-1.1: worker launched from `.worktrees/<n>` (pre-fix) — expected:
      it reads `.env`/config and writes logs/locks under the **worktree**.
      This is the reproduction that justifies REQ-1; record the paths.
- [ ] TC-1.2: `make ui-start` from a worktree with the primary UI already
      up — expected (pre-fix): a second Vite starts, serving the
      worktree's `ui/`, with its own pidfile.
- [ ] TC-1.3: `lc worktrees list` from primary vs from a worktree with a
      live lock present — expected (pre-fix): outputs differ in
      lock-awareness.
- [ ] TC-1.4: `lc verify-isolation` from inside a worktree (where `.git`
      is a file, not a directory) — expected: records whether it errors,
      silently reports nothing, or works.
- [ ] TC-1.5: idle worker for 5 minutes — expected: `resolvePrimaryRepoRoot()`
      is not called on the 60s ticks (S15 / REQ-7 baseline).

### Phase 2 — path resolution (automated)

- [ ] TC-2.1: `normalizePrimaryCwd()` (or equivalent) called with cwd
      inside a linked worktree — expected: returns the primary root and
      `process.cwd()` afterwards equals it.
- [ ] TC-2.2: same, called from the primary — expected: no chdir, no warn
      line, cwd unchanged.
- [ ] TC-2.3: called from a directory outside any git repo — expected: no
      throw, cwd unchanged (REQ-1a).
- [ ] TC-2.4: `--manager` startup outside a project — expected: no chdir,
      worker starts normally (REQ-1a).
- [ ] TC-2.5 (integration, real process): spawn `laneconductor.sync.mjs
      --sync-only --once` with `cwd` set to a linked worktree — expected:
      the run's logs/locks/track reads all land under the primary, and the
      registered `repo_path` is the primary path.
- [ ] TC-2.6: with a worker already running from the primary under worker
      number 1, launching a second one from a worktree under worker number
      1 — expected: exits non-zero with the identity-lock message (AC-1).
- [ ] TC-2.7: Makefile `UI_DIR` resolution evaluated from a worktree —
      expected: equals the primary's `ui/` (AC-3).
- [ ] TC-2.8: `make install` / `install-cli` invoked from a worktree —
      expected: refuses with a message naming the primary; `~/.laneconductorrc`
      and `/usr/local/bin/lc` untouched (AC-4). Run against a temp
      `HOME`/prefix — never against the real machine state.
- [ ] TC-2.9: `getInstallPath()` with no rc file and `__dirname` inside a
      worktree — expected: resolves to the primary, not the worktree.
- [ ] TC-2.10: `auditWorktrees({ repoRoot: <linked worktree> })` with a
      lock file present under the primary's `.conductor/locks/` — expected:
      identical rows (including lock-driven classification) to the same
      call with `repoRoot: <primary>` (AC-5).

### Phase 3 — provenance (automated where possible)

- [ ] TC-3.1: worker started from the primary — expected: exactly one
      startup line naming the checkout, marked as primary (AC-6).
- [ ] TC-3.2: worker started from a worktree — expected: the line flags
      the non-primary launch and names both paths.
- [ ] TC-3.3: API server startup log contains the same shape of line.
- [ ] TC-3.4 (manual): `lc ui start` — observed startup output names the
      checkout being served.

### Phase 4 — continuous doc sync-back

- [ ] TC-4.1 (**write first — fails today, D3/AC-8**): primary's
      `conversation.md` has a human comment the worktree's copy lacks; run
      `copyWorktreeArtifactsToPrimary({ isSuccess: true })` — expected:
      the human comment still present in primary afterwards.
- [ ] TC-4.2: `ARTIFACTS` no longer contains `conversation.md` and the
      function never writes that file, in either the merge or copy branch.
- [ ] TC-4.3: worktree `plan.md` newer than primary's — expected: periodic
      pass copies it; primary's content matches the worktree's.
- [ ] TC-4.4: worktree `index.md` has new `**Progress**`/`**Lane**`
      markers, primary has extra body sections — expected: markers
      updated, primary's body preserved (`mergeIndexMarkers()` semantics
      unchanged).
- [ ] TC-4.5 (REQ-9/AC-9): no files touched since last pass — expected:
      zero writes (assert via mtime unchanged on every primary doc).
- [ ] TC-4.6 (REQ-12/AC-11): track with no live worktree — expected: pass
      is a complete no-op, no log line.
- [ ] TC-4.7: worktree `plan.md` truncated to 10% of primary's, mid-run
      (`isSuccess: false`) — expected: copy declined, primary unchanged
      (shrink guard still armed under the periodic path).
- [ ] TC-4.8: after a successful `index.md` merge — expected:
      `syncTrack(indexPath)` is invoked once for that track.
- [ ] TC-4.9 (integration/live, AC-7): during a real run in a worktree,
      edit `plan.md` inside the worktree; within ~60s the same change is
      readable in the primary's `plan.md`. Record the observation — a unit
      test does not satisfy this criterion.

### Phase 5 — guard-skip surfacing

- [ ] TC-5.1: shrink guard declines a copy — expected: one log line naming
      track, file, incoming size, existing size, tripped threshold.
- [ ] TC-5.2 (AC-10): after a declined copy, the track carries the
      stale-docs signal; the board/API response exposes it.
- [ ] TC-5.3: next successful sync of that file — expected: signal
      cleared.

---

## Known pre-existing suite flakiness (not this track's regression)

Running the full `node --test conductor/tests/*.test.mjs` glob from inside
this worktree, on this dev machine, fails ~20-23 suites regardless of any
change in this track — confirmed by running the identical subset against
the unmodified base commit (`2a88bf4`) in a throwaway detached worktree at
`/tmp/lc-baseline-check`: `worker-mode`, `lock-unlock`,
`track-1084-worker-identity` (x3), and `conv-sync-multi-worker-race` all
already fail there, 9/14 failing on baseline. Root causes, none introduced
by this track:
- Tests that spawn the real `laneconductor.sync.mjs` into a throwaway
  non-git `testDir` collide with this machine's real, live worker
  processes (multiple `--sync-only` workers genuinely running against the
  primary checkout during this session) once any cwd/lock resolution walks
  up to the primary — `lock.mjs`/`unlock.mjs`'s pre-existing (S4, already
  "SAFE") `resolvePrimaryRepoRoot()` call already does this independent of
  anything in this track.
- `.gitignore` already ignores `.conductor/` at HEAD, so `git add
  .conductor/locks/...` (also pre-existing, in `lock.mjs`) fails with
  "ignored by .gitignore" whenever run against the primary checkout.
- Some failures are flaky under this suite's full parallel load on a
  resource-constrained shared dev machine — `worker-id-watchdog` failed in
  the full run, passed cleanly twice in isolation.
- `auto-launch.test.mjs` is a Vitest spec (per tech-stack.md, belongs under
  `cd ui && npm test`), not `node --test` — included only because this
  investigation's glob was too broad; not a real failure.

`LC_SKIP_CWD_NORMALIZATION=1` (added this track, see
`conductor/laneconductor.sync.mjs`) is a test-only escape hatch for
exactly the first bullet's class where MY new REQ-1 code is the trigger
(3 suites fixed by setting it: `remote-api mode (explicit config)`,
`Track 1110 Phase 3: API-mode claim atomicity`, `runDeploy`) — it does not
and should not attempt to paper over the other, pre-existing causes above.
Fixing those (isolating each throwaway `testDir` as its own git repo, or
running the suite from the primary checkout) is test-hermeticity debt
unrelated to this track's scope; not fixed here.

## Acceptance Criteria

- [ ] `node --test conductor/tests/` passes with no regressions (AC-12)
- [ ] `cd ui && npm test` passes with no regressions (AC-12)
- [ ] TC-2.5, TC-2.6, TC-2.10 pass — infra resolves to primary from any cwd
- [ ] TC-4.1 passes — no human comment is lost across a run (AC-8)
- [ ] TC-4.5 passes — quiet repo does zero per-tick writes (AC-9)
- [ ] Live checks TC-1.x, TC-2.8, TC-3.4, TC-4.9 performed with observed
      output recorded in `conversation.md`
- [ ] Long-running processes (worker, API) restarted before any live
      verification — a stale process is a false pass
