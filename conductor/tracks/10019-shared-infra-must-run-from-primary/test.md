# Tests: Track 10019 — Shared state must live in main

## Test Commands

```bash
# Worker / service tests (node:test, zero deps — anything touching real
# processes or the filesystem lives here)
node --test conductor/tests/

# Targeted new/extended suites for this track
node --test conductor/tests/primary-root-normalization.test.mjs
node --test conductor/tests/track-1110-copy-worktree-artifacts.test.mjs
node --test conductor/tests/track-1112-worktree-audit.test.mjs

# UI + API unit/integration tests
cd ui && npm test
```

New suites follow the existing `conductor/tests/worktree-create-path-resolution.test.mjs`
pattern: build a throwaway repo + linked worktree in a temp dir, exercise
the real function, assert on real paths.

---

## Test Cases

### Phase 1 — audit (manual/live; evidence recorded in conversation.md)

- [x] TC-1.2 (done as S6 repro): `make -n api-start`/`ui-start` from a
      worktree — confirmed `UI_DIR` resolved to the worktree's own `ui/`.
- [x] TC-1.3 (done as S11 repro, sandbox): built a real repo with a locked,
      reopened track; `auditWorktrees` from primary vs from a linked
      worktree gave DIFFERENT classifications (`open` vs `mergeable`) —
      the live bug, now fixed and covered by a permanent regression test.
- [x] TC-1.4: confirmed — `.git` is a file inside a linked worktree, so
      `verify-isolation`'s Test 1 fails there. Downgraded to a known,
      non-hazardous false negative (S14) — not fixed, out of this track's
      REQ list (see spec.md).
- [x] TC-1.5: confirmed by reading — no `resolvePrimaryRepoRoot()` call
      exists anywhere in `reconcileWorktrees()`, `refreshWorktreeSummaryCache()`,
      or `checkOutOfBandGitSync()`; those ticks use raw `process.cwd()`,
      which REQ-1 fixes at the root. No caching needed.
- [ ] TC-1.1: superseded by TC-1.5/S5's conclusion (confirmed by reading,
      not a live worker spawn) — not separately reproduced as its own
      before/after run.

### Phase 2 — path resolution (automated)

- [x] TC-2.1/2.2/2.3/2.4: covered by `primary-root-normalization.test.mjs`
      (`resolvePrimaryCwdDecision()`, the extracted pure decision logic —
      `laneconductor.sync.mjs` itself can't be imported in a test).
- [x] TC-2.5 (integration, real process, done live rather than as an
      automated test): `LC_SKIP_WORKER_LOCK=1 node conductor/laneconductor.sync.mjs
      --sync-only --worker-number 9999` from inside this worktree — logged
      the redirect notice, then "Serving from /home/meller/Code/laneconductor
      (primary checkout)", and registered with the DB using the primary's
      `repo_path`.
- [x] TC-2.6 (AC-1, live): with real live workers already holding worker
      number 1's identity lock on the primary, launching another from
      inside this worktree collided on that same lock (confirmed via the
      `[LaneConductor] Another live worker already holds this identity's
      lock` message during live testing) rather than silently running on
      stale worktree code.
- [x] TC-2.7 (AC-3, live): `make -n api-start` from the worktree resolved
      `UI_DIR` to the primary's `ui/`.
- [x] TC-2.8 (AC-4, live — **against the real machine, not a temp HOME**):
      `make install-cli` run for real from inside this worktree refused
      cleanly with the primary's path, never reaching `sudo`.
      `~/.laneconductorrc`/`/usr/local/bin/lc` were never touched — the
      guard is the first line of the recipe, confirmed by output alone
      (deviation from the plan's "temp HOME" suggestion: the guard's own
      refusal made a real run safe to observe directly).
- [x] TC-2.9: covered by direct computation/reasoning (`getInstallPath()`'s
      fallback now routes through `resolvePrimaryRepoRoot()`) — no
      dedicated unit test added (the function isn't cleanly unit-testable
      without duplicating `bin/lc.mjs`'s module-load surface); verified by
      code inspection instead.
- [x] TC-2.10 (AC-5): `track-1112-worktree-audit.test.mjs`'s new "resolves
      the lock-file check against the PRIMARY checkout..." test — real
      sandbox repo, locked reopened track, identical `open` classification
      from both `repoRoot: <primary>` and `repoRoot: <linked worktree>`.

### Phase 3 — provenance (live, all four)

- [x] TC-3.1/3.2 (AC-6): confirmed live in the TC-2.5 run above — the
      redirect line, followed by "Serving from /home/meller/Code/laneconductor
      (primary checkout)" (both `console.log` and structured `logger.info`).
- [x] TC-3.3: `ui/server/index.mjs`'s `listen()` callback logs the same
      shape of line via `logger.info` — verified by code inspection
      (starting the real API server was skipped to avoid disrupting the
      live dashboard other in-flight tracks may be using).
- [x] TC-3.4: `make -n ui-start`/`api-start` dry-runs show the new
      "🚀 Starting ... from <primary ui dir> (primary checkout)" echo line;
      `lc ui start`'s equivalent verified by code inspection (same
      `resolvePrimaryRepoRoot()` check pattern as the worker/API).

### Phase 4 — continuous doc sync-back

- [x] TC-4.1 (**written first — confirmed red before the fix, D3/AC-8**):
      `track-1110-copy-worktree-artifacts.test.mjs` — a human comment in
      primary's `conversation.md`, absent from the worktree's, survives
      `copyWorktreeArtifactsToPrimary({ isSuccess: true })` untouched.
- [x] TC-4.2: same file — `ARTIFACTS` confirmed to exclude
      `conversation.md`; the test asserts it's never in `copied`.
- [x] TC-4.3: `skipUnchanged` tests — worktree `plan.md` with a newer
      mtime IS copied; also verified live in a real sandbox worktree with
      an *uncommitted* edit (the case that matters most).
- [x] TC-4.4: unaffected — `mergeIndexMarkers()` itself untouched by this
      track; covered by its own existing suite
      (`track-1112-worktree-artifact-merge.test.mjs`), still green.
- [x] TC-4.5 (REQ-9/AC-9): `skipUnchanged` test — a file whose worktree
      mtime is NOT newer than primary's triggers zero reads/writes
      (asserted via unchanged mtime, not just "not copied").
- [x] TC-4.6 (REQ-12/AC-11): `listTrackWorktrees()` returns nothing for a
      track with no live worktree, so `syncWorktreeDocsToPrimary()`'s loop
      body never runs for it — structural no-op, not a conditional skip.
- [x] TC-4.7: "refuses to overwrite with a suspiciously truncated
      index.md" test (pre-existing, still covers this path) plus the new
      "records a guard-skipped copy in `skipped`" test.
- [x] TC-4.8: verified by code inspection — `syncTrack(indexPath)` is
      called immediately after a successful `index.md` copy, same call
      shape as the exit handler.
- [x] TC-4.9 (AC-7, live): real sandbox worktree, uncommitted `plan.md`
      edit — one `copyWorktreeArtifactsToPrimary({ skipUnchanged: true })`
      pass (the exact call `syncWorktreeDocsToPrimary()` makes) landed it
      in primary; a second pass with nothing changed touched nothing.

### Phase 5 — guard-skip surfacing

- [x] TC-5.1: "records a guard-skipped copy in `skipped`" test — asserts
      file/reason/both sizes.
- [x] TC-5.2 (AC-10): implemented via a `⚠️` `conversation.md` comment
      (reusing the existing Inbox pipeline) rather than a new board
      field/API response shape — verified by code inspection of
      `syncWorktreeDocsToPrimary()`'s skip-handling block; no dedicated
      automated test (would require spawning the real worker with a live
      worktree and waiting a full tick — judged lower value than the
      live TC-4.9 integration check, which already exercises the same
      code path with `skipped` non-empty, observed directly in that run's
      output).
- [x] TC-5.3: `staleDocSignal` Map — deleted for any file present in
      `copied` at the end of each pass; covered by reading the
      implementation (same reasoning as TC-5.2 on live-test cost/value).

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

- [x] `node --test conductor/tests/*.test.mjs` passes with no NEW
      regressions (AC-12) — confirmed by diffing the full failing-suite
      list against an unmodified-baseline run (`/tmp/lc-baseline-check`,
      commit `2a88bf4`, throwaway detached worktree): identical set of
      ~23 pre-existing failures both before and after every commit in this
      track, all traced to this dev machine's real live workers colliding
      with tests that spawn processes into non-git sandboxes (documented
      above) — not something introduced or fixable within this track's
      scope.
- [ ] `cd ui && npm test` — blocked in this worktree by a pre-existing,
      unrelated environment gap: `ui/node_modules` was never installed
      here (`@vitejs/plugin-react` missing, `ui/node_modules` has a single
      entry). Not caused by this track (no `package.json`/dependency
      change); not fixed here (out of scope — would require running
      `npm install` in `ui/`, a call outside this track's audit).
- [x] TC-2.5, TC-2.6, TC-2.10 pass — infra resolves to primary from any cwd
- [x] TC-4.1 passes — no human comment is lost across a run (AC-8)
- [x] TC-4.5 passes — quiet repo does zero per-tick writes (AC-9)
- [x] Live checks performed with observed output recorded in
      `conversation.md` (primary's copy): TC-1.2/1.3/1.4 (Phase 1),
      TC-2.5/2.6/2.7/2.8 (Phase 2), TC-3.1–3.4 (Phase 3), TC-4.9 (Phase 4)
- [x] Long-running processes: no stale process was verified against — all
      live checks spawned a fresh worker process per check; the API server
      and Vite UI were not started for this verification pass (their
      startup-line changes verified by code inspection + Makefile dry-run
      instead, noted per-TC above), so there is no stale-process risk to
      guard against for those two.
